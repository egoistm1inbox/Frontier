/*==========================================================================================================================================
                                                            UVCANVAS2D.JS
==========================================================================================================================================*/
// High-DPI 2D UV & UDIM Editor canvas renderer and hit-tester:
//   - Multi-UDIM coordinate system (1001 + u + 10*v) with live checker/color-grid/UV-grid & custom image textures
//   - Overlay lenses: Clean, Importance Zones, Texel Density, Angle Stretch, Area Stretch, Overlap & Flipped
//   - Blender UV HUD: 2D Cursor, Pivot indicator, Proportional Falloff ring, Box/Circle/Lasso marquees, G/R/S constraint lines

import { EdgeKey, UdimOrigin } from './TopologySurface.js';

function CreatePatternCanvas(Mode)
{
    const Size = 512;
    const Canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (!Canvas) return null;
    Canvas.width = Size;
    Canvas.height = Size;
    const Ctx = Canvas.getContext('2d');

    if (Mode === 'blank')
    {
        Ctx.fillStyle = '#0f1114';
        Ctx.fillRect(0, 0, Size, Size);
        return Canvas;
    }

    if (Mode === 'checker')
    {
        const Cells = 16;
        const Step = Size / Cells;
        for (let y = 0; y < Cells; y++)
        {
            for (let x = 0; x < Cells; x++)
            {
                Ctx.fillStyle = (x + y) % 2 === 0 ? '#181b1e' : '#111316';
                Ctx.fillRect(x * Step, y * Step, Step, Step);
            }
        }
        return Canvas;
    }

    if (Mode === 'uv')
    {
        const Cells = 8;
        const Step = Size / Cells;
        for (let y = 0; y < Cells; y++)
        {
            for (let x = 0; x < Cells; x++)
            {
                const Hue = ((x + y * 2) / 16) * 360;
                Ctx.fillStyle = (x + y) % 2 === 0 ? '#1c2024' : '#14171b';
                Ctx.fillRect(x * Step, y * Step, Step, Step);
                Ctx.strokeStyle = `hsla(${Hue}, 45%, 60%, 0.25)`;
                Ctx.lineWidth = 1;
                Ctx.strokeRect(x * Step + 0.5, y * Step + 0.5, Step - 1, Step - 1);
                Ctx.fillStyle = 'rgba(242,242,240,0.34)';
                Ctx.font = '500 10px ui-monospace, monospace';
                Ctx.fillText(`${String.fromCharCode(65 + x)}${8 - y}`, x * Step + 6, y * Step + 15);
            }
        }
        // Center cross & diagonal orientation arrow
        Ctx.strokeStyle = 'rgba(239,244,207,0.22)';
        Ctx.beginPath();
        Ctx.moveTo(0, Size / 2); Ctx.lineTo(Size, Size / 2);
        Ctx.moveTo(Size / 2, 0); Ctx.lineTo(Size / 2, Size);
        Ctx.stroke();
        return Canvas;
    }

    // Default 'color' grid (Blender-inspired dark muted calibration grid matching Frontier theme)
    const Cells = 8;
    const Step = Size / Cells;
    const Palette = [
        '#1d262b', '#222b28', '#29261d', '#24202b',
        '#1b242e', '#262922', '#2b2221', '#1e2827'
    ];
    for (let y = 0; y < Cells; y++)
    {
        for (let x = 0; x < Cells; x++)
        {
            const Base = Palette[(x * 3 + y * 5) % Palette.length];
            Ctx.fillStyle = Base;
            Ctx.fillRect(x * Step, y * Step, Step, Step);

            // Subtle 2x2 sub-checker
            const Half = Step * 0.5;
            Ctx.fillStyle = 'rgba(255,255,255,0.035)';
            Ctx.fillRect(x * Step, y * Step, Half, Half);
            Ctx.fillRect(x * Step + Half, y * Step + Half, Half, Half);

            Ctx.fillStyle = 'rgba(242,242,240,0.28)';
            Ctx.font = '500 11px ui-monospace, monospace';
            Ctx.fillText(`${String.fromCharCode(65 + x)}${Cells - y}`, x * Step + 5, y * Step + 15);
        }
    }
    return Canvas;
}

function HeatColor(T, Alpha = 0.42)
{
    // T in [0..1]: 0=cool blue -> 0.33=mint -> 0.66=amber -> 1=coral red
    const Clamped = Math.max(0, Math.min(1, T));
    let R, G, B;
    if (Clamped < 0.35)
    {
        const K = Clamped / 0.35;
        R = 68 + K * (105 - 68);
        G = 148 + K * (212 - 148);
        B = 235 + K * (170 - 235);
    }
    else if (Clamped < 0.7)
    {
        const K = (Clamped - 0.35) / 0.35;
        R = 105 + K * (242 - 105);
        G = 212 + K * (194 - 212);
        B = 170 + K * (96 - 170);
    }
    else
    {
        const K = (Clamped - 0.7) / 0.3;
        R = 242 + K * (232 - 242);
        G = 194 + K * (95 - 194);
        B = 96 + K * (82 - 96);
    }
    return `rgba(${Math.round(R)}, ${Math.round(G)}, ${Math.round(B)}, ${Alpha})`;
}

export class UVCanvas2D
{
    constructor(Canvas)
    {
        this.canvas = Canvas;
        this.ctx = Canvas.getContext('2d');
        this.panU = 0.5;
        this.panV = 0.5;
        this.scalePx = 460; // pixels per 1.0 UV unit
        this.width = 600;
        this.height = 500;
        this.dpr = 1;
        this.patternCache = new Map();
        this.customTileImages = new Map();
    }

    Resize()
    {
        const Rect = this.canvas.getBoundingClientRect();
        if (!Rect.width || !Rect.height) return false;
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = Math.round(Rect.width * this.dpr);
        const H = Math.round(Rect.height * this.dpr);
        if (this.canvas.width !== W || this.canvas.height !== H)
        {
            this.canvas.width = W;
            this.canvas.height = H;
        }
        this.width = Rect.width;
        this.height = Rect.height;
        return true;
    }

    UvToScreen(U, V)
    {
        return [
            this.width * 0.5 + (U - this.panU) * this.scalePx,
            this.height * 0.5 - (V - this.panV) * this.scalePx
        ];
    }

    ScreenToUv(Sx, Sy)
    {
        return [
            this.panU + (Sx - this.width * 0.5) / this.scalePx,
            this.panV - (Sy - this.height * 0.5) / this.scalePx
        ];
    }

    FrameBounds(MinU, MinV, MaxU, MaxV, PaddingRatio = 0.14)
    {
        const SpanU = Math.max(0.15, MaxU - MinU);
        const SpanV = Math.max(0.15, MaxV - MinV);
        const W = Math.max(200, this.width);
        const H = Math.max(200, this.height);
        const UsableW = W * (1 - PaddingRatio * 2);
        const UsableH = H * (1 - PaddingRatio * 2);
        this.scalePx = Math.max(40, Math.min(4000, Math.min(UsableW / SpanU, UsableH / SpanV)));
        this.panU = 0.5 * (MinU + MaxU);
        this.panV = 0.5 * (MinV + MaxV);
    }

    FrameUdimTiles(UdimTiles)
    {
        if (!UdimTiles.length)
        {
            this.FrameBounds(0, 0, 1, 1);
            return;
        }
        let MinU = Infinity, MinV = Infinity, MaxU = -Infinity, MaxV = -Infinity;
        for (const T of UdimTiles)
        {
            const O = UdimOrigin(T.id);
            if (O.u < MinU) MinU = O.u;
            if (O.v < MinV) MinV = O.v;
            if (O.u + 1 > MaxU) MaxU = O.u + 1;
            if (O.v + 1 > MaxV) MaxV = O.v + 1;
        }
        this.FrameBounds(MinU, MinV, MaxU, MaxV, 0.10);
    }

    GetPattern(Mode)
    {
        if (!this.patternCache.has(Mode)) this.patternCache.set(Mode, CreatePatternCanvas(Mode));
        return this.patternCache.get(Mode);
    }

    SetTileCustomImage(TileId, ImageEl)
    {
        this.customTileImages.set(TileId, ImageEl);
    }

    Render(State)
    {
        this.Resize();
        const Ctx = this.ctx;
        Ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        const W = this.width, H = this.height;
        Ctx.fillStyle = '#090a0c';
        Ctx.fillRect(0, 0, W, H);

        const {
            surface,
            islands,
            udimTiles,
            activeUdim,
            importanceGroups,
            selectionMode,
            activeTool,
            overlayLens,
            showChecker,
            showSubGrid,
            showSeams,
            showBoundaries,
            showPins,
            showIslandBadges,
            targetTexelDensity,
            diagnostics,
            hoverHit,
            cursorUV,
            pivotPoint,
            proportional,
            modalTransform,
            marqueeBox,
            circleSelect,
            lassoPoints
        } = State;

        // 1. Background UDIM coordinate workspace lines (ghosted cells 0..9 x 0..3)
        const LeftUV = this.panU - (W * 0.5) / this.scalePx;
        const RightUV = this.panU + (W * 0.5) / this.scalePx;
        const BottomUV = this.panV - (H * 0.5) / this.scalePx;
        const TopUV = this.panV + (H * 0.5) / this.scalePx;

        const MinTileU = Math.max(-2, Math.floor(LeftUV));
        const MaxTileU = Math.min(10, Math.ceil(RightUV));
        const MinTileV = Math.max(-1, Math.floor(BottomUV));
        const MaxTileV = Math.min(5, Math.ceil(TopUV));

        Ctx.lineWidth = 1;
        Ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        for (let tu = MinTileU; tu <= MaxTileU; tu++)
        {
            const [Sx] = this.UvToScreen(tu, 0);
            Ctx.beginPath(); Ctx.moveTo(Sx, 0); Ctx.lineTo(Sx, H); Ctx.stroke();
        }
        for (let tv = MinTileV; tv <= MaxTileV; tv++)
        {
            const [, Sy] = this.UvToScreen(0, tv);
            Ctx.beginPath(); Ctx.moveTo(0, Sy); Ctx.lineTo(W, Sy); Ctx.stroke();
        }

        // Faint coordinate labels on empty potential UDIM slots
        if (this.scalePx > 90)
        {
            Ctx.font = '500 9.5px ui-monospace, monospace';
            Ctx.fillStyle = 'rgba(255,255,255,0.14)';
            for (let tv = 0; tv <= 2; tv++)
            {
                for (let tu = 0; tu <= 4; tu++)
                {
                    const TileId = 1001 + tu + tv * 10;
                    if (udimTiles.some(T => T.id === TileId)) continue;
                    const [Sx, Sy] = this.UvToScreen(tu + 0.04, tv + 0.94);
                    Ctx.fillText(`${TileId}`, Sx, Sy);
                }
            }
        }

        // 2. Active Configured UDIM Tiles
        const TileIslandCounts = new Map();
        const TileAreaSums = new Map();
        for (const Isl of islands)
        {
            if (Isl.hidden) continue;
            TileIslandCounts.set(Isl.udimTile, (TileIslandCounts.get(Isl.udimTile) || 0) + 1);
            TileAreaSums.set(Isl.udimTile, (TileAreaSums.get(Isl.udimTile) || 0) + Isl.areaUV);
        }

        for (const Tile of udimTiles)
        {
            const O = UdimOrigin(Tile.id);
            const [X0, Y1] = this.UvToScreen(O.u, O.v);
            const [X1, Y0] = this.UvToScreen(O.u + 1, O.v + 1);
            const TileW = X1 - X0, TileH = Y1 - Y0;
            if (X1 < 0 || X0 > W || Y1 < 0 || Y0 > H) continue;

            const IsActive = Tile.id === activeUdim;
            Ctx.save();
            Ctx.beginPath();
            Ctx.rect(X0, Y0, TileW, TileH);
            Ctx.clip();

            // Tile Backdrop / Checker / Custom Texture
            const CustomImg = this.customTileImages.get(Tile.id);
            if (CustomImg && CustomImg.complete)
            {
                Ctx.globalAlpha = 0.72;
                Ctx.drawImage(CustomImg, X0, Y0, TileW, TileH);
                Ctx.globalAlpha = 1;
            }
            else if (showChecker)
            {
                const PatCanvas = this.GetPattern(Tile.checkerMode || 'color');
                if (PatCanvas)
                {
                    Ctx.globalAlpha = IsActive ? 0.92 : 0.64;
                    Ctx.drawImage(PatCanvas, X0, Y0, TileW, TileH);
                    Ctx.globalAlpha = 1;
                }
            }
            else
            {
                Ctx.fillStyle = IsActive ? '#111417' : '#0c0e11';
                Ctx.fillRect(X0, Y0, TileW, TileH);
            }

            // Subdivision grid inside UDIM tile
            if (showSubGrid && TileW > 64)
            {
                const Divs = TileW > 420 ? 16 : 8;
                Ctx.strokeStyle = 'rgba(255,255,255,0.055)';
                Ctx.lineWidth = 1;
                for (let k = 1; k < Divs; k++)
                {
                    const Gx = X0 + (TileW * k) / Divs;
                    const Gy = Y0 + (TileH * k) / Divs;
                    Ctx.beginPath(); Ctx.moveTo(Gx, Y0); Ctx.lineTo(Gx, Y1); Ctx.stroke();
                    Ctx.beginPath(); Ctx.moveTo(X0, Gy); Ctx.lineTo(X1, Gy); Ctx.stroke();
                }
            }

            // Border highlight for tile
            Ctx.restore();
            Ctx.strokeStyle = IsActive ? 'rgba(239, 244, 207, 0.55)' : 'rgba(255, 255, 255, 0.16)';
            Ctx.lineWidth = IsActive ? 1.5 : 1;
            Ctx.strokeRect(X0 + 0.5, Y0 + 0.5, TileW - 1, TileH - 1);

            // Tile header badge pill above top-left corner
            const OccPct = Math.min(100, (TileAreaSums.get(Tile.id) || 0) * 100);
            const ResLabel = Tile.resolution >= 1024 ? `${Tile.resolution / 1024}K` : `${Tile.resolution}`;
            const BadgeText = `${Tile.id} · ${ResLabel} · ${OccPct.toFixed(1)}%${Tile.label ? ' · ' + Tile.label : ''}`;
            Ctx.font = '500 10px ui-monospace, monospace';
            const Tw = Math.min(Math.max(90, TileW - 8), Ctx.measureText(BadgeText).width + 16);
            const PillY = Math.max(6, Y0 - 22);
            Ctx.fillStyle = IsActive ? 'rgba(239, 244, 207, 0.94)' : 'rgba(22, 23, 26, 0.90)';
            Ctx.strokeStyle = IsActive ? 'rgba(239, 244, 207, 1)' : 'rgba(255, 255, 255, 0.12)';
            Ctx.beginPath();
            Ctx.roundRect(X0 + 2, PillY, Tw, 18, 9);
            Ctx.fill();
            Ctx.stroke();
            Ctx.fillStyle = IsActive ? '#0b0b0b' : '#d8dad6';
            Ctx.fillText(BadgeText, X0 + 10, PillY + 12.5, Tw - 14);
        }

        // 3. Draw UV Faces
        const GroupColors = new Map(importanceGroups.map(G => [G.id, G.color]));
        const IslandByFace = new Map();
        for (const Isl of islands)
        {
            for (const Fi of Isl.faceIndices) IslandByFace.set(Fi, Isl);
        }

        for (const Isl of islands)
        {
            if (Isl.hidden) continue;
            const IslSelected = surface.selectedIslands.has(Isl.id);
            const GrpColor = Isl.importanceGroupId ? GroupColors.get(Isl.importanceGroupId) : null;

            for (const Fi of Isl.faceIndices)
            {
                const F = surface.faces[Fi];
                const Pts = F.corners.map(C => this.UvToScreen(surface.uvCoords[C.uv][0], surface.uvCoords[C.uv][1]));
                Ctx.beginPath();
                Ctx.moveTo(Pts[0][0], Pts[0][1]);
                for (let k = 1; k < Pts.length; k++) Ctx.lineTo(Pts[k][0], Pts[k][1]);
                Ctx.closePath();

                const IsFaceSel = surface.selectedFaces.has(Fi);
                const IsOverlap = diagnostics?.OverlappingFaces?.has(Fi);
                const IsFlipped = diagnostics?.FlippedFaces?.has(Fi);

                let Fill = 'rgba(255,255,255,0.065)';
                if (overlayLens === 'importance')
                {
                    Fill = GrpColor ? this.HexToRgba(GrpColor, IsFaceSel || IslSelected ? 0.42 : 0.25) : 'rgba(145, 152, 162, 0.16)';
                }
                else if (overlayLens === 'texel')
                {
                    const Ratio = Isl.texelDensity / Math.max(0.1, targetTexelDensity || 10);
                    // Ratio 1.0 -> mint (~0.35), low -> blue (0.0), high -> coral (1.0)
                    const T = Math.max(0, Math.min(1, 0.35 + Math.log2(Math.max(0.125, Ratio)) * 0.28));
                    Fill = HeatColor(T, IsFaceSel ? 0.52 : 0.36);
                }
                else if (overlayLens === 'stretch-angle')
                {
                    const D = surface.FaceTrianglesDistortion(Fi);
                    Fill = HeatColor(Math.min(1, D.angleStretch * 2.2), IsFaceSel ? 0.56 : 0.42);
                }
                else if (overlayLens === 'stretch-area')
                {
                    const D = surface.FaceTrianglesDistortion(Fi);
                    const T = Math.max(0, Math.min(1, 0.35 + Math.log2(Math.max(0.1, D.areaScale)) * 0.22));
                    Fill = HeatColor(T, IsFaceSel ? 0.56 : 0.40);
                }
                else if (overlayLens === 'overlap')
                {
                    if (IsOverlap) Fill = 'rgba(255, 84, 84, 0.54)';
                    else if (IsFlipped) Fill = 'rgba(243, 196, 108, 0.46)';
                    else Fill = 'rgba(120, 199, 150, 0.12)';
                }
                else
                {
                    // Clean lens
                    if (IsFaceSel) Fill = 'rgba(239, 244, 207, 0.20)';
                    else if (IslSelected) Fill = 'rgba(239, 244, 207, 0.12)';
                    else if (GrpColor) Fill = this.HexToRgba(GrpColor, 0.10);
                }

                Ctx.fillStyle = Fill;
                Ctx.fill();

                if (IsFaceSel || IslSelected)
                {
                    Ctx.fillStyle = IsFaceSel ? 'rgba(245, 184, 76, 0.26)' : 'rgba(239, 244, 207, 0.14)';
                    Ctx.fill();
                }

                if (surface.activeFace === Fi)
                {
                    Ctx.strokeStyle = '#ff9d3b';
                    Ctx.lineWidth = 2.0;
                    Ctx.stroke();
                }
            }
        }

        // 4. Draw UV Edges, Island Boundaries, Selected Edges & Seams
        const UvEdgeCount = new Map();
        const SelUvEdgeCount = new Map();
        for (const Isl of islands)
        {
            if (Isl.hidden) continue;
            const IslSel = surface.selectedIslands.has(Isl.id);
            for (const Fi of Isl.faceIndices)
            {
                const C = surface.faces[Fi].corners;
                const FaceSel = surface.selectedFaces.has(Fi) || IslSel;
                for (let k = 0; k < C.length; k++)
                {
                    const Key = EdgeKey(C[k].uv, C[(k + 1) % C.length].uv);
                    UvEdgeCount.set(Key, (UvEdgeCount.get(Key) || 0) + 1);
                    if (FaceSel) SelUvEdgeCount.set(Key, (SelUvEdgeCount.get(Key) || 0) + 1);
                }
            }
        }

        const IsRegionSelMode = selectionMode === 'face' || selectionMode === 'island';
        const DrawnEdges = new Set();
        const ActiveEdges = [];
        for (const Isl of islands)
        {
            if (Isl.hidden) continue;
            const GrpColor = Isl.importanceGroupId ? GroupColors.get(Isl.importanceGroupId) : null;
            const IslSelected = surface.selectedIslands.has(Isl.id);

            for (const Fi of Isl.faceIndices)
            {
                const C = surface.faces[Fi].corners;
                for (let k = 0; k < C.length; k++)
                {
                    const A = C[k], B = C[(k + 1) % C.length];
                    const UvKey = EdgeKey(A.uv, B.uv);
                    if (DrawnEdges.has(UvKey)) continue;
                    DrawnEdges.add(UvKey);

                    const [X0, Y0] = this.UvToScreen(surface.uvCoords[A.uv][0], surface.uvCoords[A.uv][1]);
                    const [X1, Y1] = this.UvToScreen(surface.uvCoords[B.uv][0], surface.uvCoords[B.uv][1]);
                    const IsSeam = showSeams && surface.seams.has(EdgeKey(A.v, B.v));
                    const IsSelEdge = IsRegionSelMode
                        ? SelUvEdgeCount.get(UvKey) === 1
                        : surface.selectedUVEdges.has(UvKey);
                    const IsBoundary = showBoundaries !== false && UvEdgeCount.get(UvKey) === 1;

                    if (IsSelEdge || IsSeam)
                    {
                        ActiveEdges.push({ UvKey, X0, Y0, X1, Y1, IsSeam, IsSelEdge, IsActive: !IsRegionSelMode && surface.activeEdgeUV === UvKey });
                        continue;
                    }

                    Ctx.beginPath();
                    Ctx.moveTo(X0, Y0);
                    Ctx.lineTo(X1, Y1);
                    if (IslSelected)
                    {
                        Ctx.strokeStyle = 'rgba(245, 198, 108, 0.72)';
                        Ctx.lineWidth = 1.25;
                    }
                    else if (IsBoundary)
                    {
                        Ctx.strokeStyle = GrpColor ? this.HexToRgba(GrpColor, 0.72) : 'rgba(123, 212, 184, 0.54)';
                        Ctx.lineWidth = 1.25;
                    }
                    else
                    {
                        Ctx.strokeStyle = GrpColor ? this.HexToRgba(GrpColor, 0.40) : 'rgba(242, 242, 240, 0.30)';
                        Ctx.lineWidth = 0.9;
                    }
                    Ctx.stroke();
                }
            }
        }

        // Pass seams first, then dark contrast halo + selected edges on top so selection always pops clearly
        for (const E of ActiveEdges)
        {
            if (!E.IsSeam || E.IsSelEdge) continue;
            Ctx.beginPath();
            Ctx.moveTo(E.X0, E.Y0);
            Ctx.lineTo(E.X1, E.Y1);
            Ctx.strokeStyle = '#ff6d5a';
            Ctx.lineWidth = 1.95;
            Ctx.stroke();
        }
        Ctx.save();
        Ctx.lineCap = 'round';
        for (const E of ActiveEdges)
        {
            if (!E.IsSelEdge) continue;
            Ctx.beginPath();
            Ctx.moveTo(E.X0, E.Y0);
            Ctx.lineTo(E.X1, E.Y1);
            Ctx.strokeStyle = 'rgba(8, 9, 11, 0.88)';
            Ctx.lineWidth = E.IsActive ? 5.8 : 5.0;
            Ctx.stroke();

            Ctx.beginPath();
            Ctx.moveTo(E.X0, E.Y0);
            Ctx.lineTo(E.X1, E.Y1);
            Ctx.strokeStyle = E.IsActive ? '#ff9d3b' : '#eff4cf';
            Ctx.lineWidth = E.IsActive ? 3.4 : 2.9;
            Ctx.stroke();
        }
        Ctx.restore();

        // Hover edge / vertex preview in 2D
        if (hoverHit?.kind === 'edge')
        {
            const Pa = surface.uvCoords[hoverHit.uvA];
            const Pb = surface.uvCoords[hoverHit.uvB];
            if (Pa && Pb)
            {
                const [X0, Y0] = this.UvToScreen(Pa[0], Pa[1]);
                const [X1, Y1] = this.UvToScreen(Pb[0], Pb[1]);
                Ctx.save();
                Ctx.lineCap = 'round';
                Ctx.beginPath();
                Ctx.moveTo(X0, Y0);
                Ctx.lineTo(X1, Y1);
                Ctx.strokeStyle = 'rgba(8, 9, 11, 0.85)';
                Ctx.lineWidth = 6.0;
                Ctx.stroke();
                Ctx.beginPath();
                Ctx.moveTo(X0, Y0);
                Ctx.lineTo(X1, Y1);
                Ctx.strokeStyle = activeTool === 'seam' ? '#ff8b78' : '#7dd3fc';
                Ctx.lineWidth = 3.6;
                Ctx.stroke();
                Ctx.restore();
            }
        }
        else if (hoverHit?.kind === 'vertex')
        {
            const P = surface.uvCoords[hoverHit.uvIndex];
            if (P)
            {
                const [Sx, Sy] = this.UvToScreen(P[0], P[1]);
                Ctx.beginPath();
                Ctx.arc(Sx, Sy, 6.2, 0, Math.PI * 2);
                Ctx.strokeStyle = '#7dd3fc';
                Ctx.lineWidth = 2.2;
                Ctx.stroke();
            }
        }

        // 5. Draw Island Priority Labels when reasonably sized on screen
        if (showIslandBadges && this.scalePx > 140)
        {
            Ctx.font = '500 9px "DM Sans", sans-serif';
            for (const Isl of islands)
            {
                if (Isl.hidden) continue;
                const BoxW = Isl.bounds.width * this.scalePx;
                const BoxH = Isl.bounds.height * this.scalePx;
                if (BoxW < 42 || BoxH < 20) continue;
                const [Cx, Cy] = this.UvToScreen(Isl.bounds.centerU, Isl.bounds.centerV);
                const Label = Isl.displayName.length > 14 ? Isl.displayName.slice(0, 13) + '…' : Isl.displayName;
                const Tw = Ctx.measureText(Label).width + 10;
                Ctx.fillStyle = 'rgba(11, 12, 14, 0.76)';
                Ctx.beginPath();
                Ctx.roundRect(Cx - Tw * 0.5, Cy - 8, Tw, 16, 8);
                Ctx.fill();
                Ctx.fillStyle = surface.selectedIslands.has(Isl.id) ? '#eff4cf' : 'rgba(242,242,240,0.78)';
                Ctx.textAlign = 'center';
                Ctx.fillText(Label, Cx, Cy + 3);
                Ctx.textAlign = 'left';
            }
        }

        // 6. Draw Vertices & Pins
        const DrawnUVs = new Set();
        const ShowAllVerts = selectionMode === 'vertex' || this.scalePx > 260;
        for (const Isl of islands)
        {
            if (Isl.hidden) continue;
            for (const UvIdx of Isl.uvIndices)
            {
                if (DrawnUVs.has(UvIdx)) continue;
                DrawnUVs.add(UvIdx);

                const IsPin = showPins && surface.pinned.has(UvIdx);
                const IsSel = surface.selectedUVs.has(UvIdx);
                if (!ShowAllVerts && !IsPin && !IsSel) continue;

                const [Sx, Sy] = this.UvToScreen(surface.uvCoords[UvIdx][0], surface.uvCoords[UvIdx][1]);
                if (Sx < -10 || Sx > W + 10 || Sy < -10 || Sy > H + 10) continue;

                if (IsPin)
                {
                    Ctx.beginPath();
                    Ctx.arc(Sx, Sy, 5.2, 0, Math.PI * 2);
                    Ctx.strokeStyle = '#ff645a';
                    Ctx.lineWidth = 1.6;
                    Ctx.stroke();
                }

                if (IsSel || ShowAllVerts)
                {
                    Ctx.beginPath();
                    Ctx.arc(Sx, Sy, IsSel ? 4.3 : 2.1, 0, Math.PI * 2);
                    Ctx.fillStyle = IsSel ? '#eff4cf' : 'rgba(255, 255, 255, 0.45)';
                    Ctx.fill();
                    if (IsSel)
                    {
                        Ctx.lineWidth = 1.5;
                        Ctx.strokeStyle = '#0b0b0b';
                        Ctx.stroke();
                    }
                }
            }
        }

        // 7. 2D Cursor (Blender-style crosshair)
        if (cursorUV)
        {
            const [Cx, Cy] = this.UvToScreen(cursorUV[0], cursorUV[1]);
            Ctx.save();
            Ctx.beginPath();
            Ctx.arc(Cx, Cy, 8, 0, Math.PI * 2);
            Ctx.strokeStyle = '#ff6d5a';
            Ctx.lineWidth = 1.5;
            Ctx.setLineDash([4, 3]);
            Ctx.stroke();
            Ctx.setLineDash([]);
            Ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            Ctx.lineWidth = 1;
            Ctx.beginPath();
            Ctx.moveTo(Cx - 12, Cy); Ctx.lineTo(Cx + 12, Cy);
            Ctx.moveTo(Cx, Cy - 12); Ctx.lineTo(Cx, Cy + 12);
            Ctx.stroke();
            Ctx.restore();
        }

        // 8. Pivot Indicator & Proportional Editing Radius
        if (pivotPoint && surface.selectedUVs.size)
        {
            const [Px, Py] = this.UvToScreen(pivotPoint[0], pivotPoint[1]);
            Ctx.beginPath();
            Ctx.arc(Px, Py, 4.5, 0, Math.PI * 2);
            Ctx.fillStyle = '#e8c27a';
            Ctx.fill();
            Ctx.strokeStyle = '#0b0b0b';
            Ctx.lineWidth = 1.2;
            Ctx.stroke();

            if (proportional?.enabled)
            {
                const RadPx = proportional.radius * this.scalePx;
                Ctx.save();
                Ctx.beginPath();
                Ctx.arc(Px, Py, RadPx, 0, Math.PI * 2);
                Ctx.strokeStyle = 'rgba(239, 244, 207, 0.48)';
                Ctx.lineWidth = 1.2;
                Ctx.setLineDash([5, 5]);
                Ctx.stroke();
                Ctx.restore();
            }
        }

        // 9. Modal Transform Axis Lock Lines & Live HUD
        if (modalTransform)
        {
            const [Px, Py] = this.UvToScreen(modalTransform.pivot[0], modalTransform.pivot[1]);
            if (modalTransform.axis === 'x')
            {
                Ctx.strokeStyle = 'rgba(255, 108, 94, 0.72)';
                Ctx.lineWidth = 1.2;
                Ctx.beginPath(); Ctx.moveTo(0, Py); Ctx.lineTo(W, Py); Ctx.stroke();
            }
            else if (modalTransform.axis === 'y')
            {
                Ctx.strokeStyle = 'rgba(120, 214, 150, 0.72)';
                Ctx.lineWidth = 1.2;
                Ctx.beginPath(); Ctx.moveTo(Px, 0); Ctx.lineTo(Px, H); Ctx.stroke();
            }
            if (modalTransform.mode === 'rotate' || modalTransform.mode === 'scale')
            {
                Ctx.save();
                Ctx.setLineDash([4, 4]);
                Ctx.strokeStyle = 'rgba(239, 244, 207, 0.45)';
                Ctx.beginPath();
                Ctx.moveTo(Px, Py);
                Ctx.lineTo(modalTransform.curScreenX, modalTransform.curScreenY);
                Ctx.stroke();
                Ctx.restore();
            }
        }

        // 10. Box / Circle / Lasso Selection Overlays
        if (marqueeBox)
        {
            const Bx = Math.min(marqueeBox.x0, marqueeBox.x1);
            const By = Math.min(marqueeBox.y0, marqueeBox.y1);
            const Bw = Math.abs(marqueeBox.x1 - marqueeBox.x0);
            const Bh = Math.abs(marqueeBox.y1 - marqueeBox.y0);
            Ctx.fillStyle = 'rgba(239, 244, 207, 0.10)';
            Ctx.strokeStyle = 'rgba(239, 244, 207, 0.85)';
            Ctx.lineWidth = 1.2;
            Ctx.setLineDash([4, 3]);
            Ctx.fillRect(Bx, By, Bw, Bh);
            Ctx.strokeRect(Bx, By, Bw, Bh);
            Ctx.setLineDash([]);
        }
        if (circleSelect?.active)
        {
            Ctx.beginPath();
            Ctx.arc(circleSelect.x, circleSelect.y, circleSelect.radiusPx, 0, Math.PI * 2);
            Ctx.fillStyle = 'rgba(239, 244, 207, 0.08)';
            Ctx.strokeStyle = '#eff4cf';
            Ctx.lineWidth = 1.3;
            Ctx.fill();
            Ctx.stroke();
        }
        if (lassoPoints && lassoPoints.length > 1)
        {
            Ctx.beginPath();
            Ctx.moveTo(lassoPoints[0][0], lassoPoints[0][1]);
            for (let i = 1; i < lassoPoints.length; i++) Ctx.lineTo(lassoPoints[i][0], lassoPoints[i][1]);
            Ctx.closePath();
            Ctx.fillStyle = 'rgba(239, 244, 207, 0.10)';
            Ctx.strokeStyle = '#eff4cf';
            Ctx.lineWidth = 1.3;
            Ctx.setLineDash([4, 3]);
            Ctx.fill();
            Ctx.stroke();
            Ctx.setLineDash([]);
        }
    }

    HexToRgba(Hex, Alpha)
    {
        const Clean = (Hex || '#eff4cf').replace('#', '');
        const Num = parseInt(Clean.length === 3 ? Clean.split('').map(C => C + C).join('') : Clean, 16);
        const R = (Num >> 16) & 255, G = (Num >> 8) & 255, B = Num & 255;
        return `rgba(${R}, ${G}, ${B}, ${Alpha})`;
    }

    HitTest(Sx, Sy, { surface, islands, mode, activeTool, udimTiles })
    {
        const [U, V] = this.ScreenToUv(Sx, Sy);
        const ThresholdUV = 12 / this.scalePx;

        // 1. Check UDIM header pill click
        for (const T of udimTiles)
        {
            const O = UdimOrigin(T.id);
            const [X0] = this.UvToScreen(O.u, O.v);
            const [X1, Y0] = this.UvToScreen(O.u + 1, O.v + 1);
            const PillY = Math.max(6, Y0 - 22);
            if (Sx >= X0 && Sx <= Math.min(X1, X0 + 220) && Sy >= PillY && Sy <= PillY + 18)
            {
                return { kind: 'udim', tileId: T.id };
            }
        }

        if (mode === 'vertex' && activeTool !== 'seam')
        {
            let BestUV = null, BestDist = ThresholdUV;
            for (const Isl of islands)
            {
                if (Isl.hidden) continue;
                for (const UvIdx of Isl.uvIndices)
                {
                    const P = surface.uvCoords[UvIdx];
                    const D = Math.hypot(P[0] - U, P[1] - V);
                    if (D < BestDist) { BestDist = D; BestUV = UvIdx; }
                }
            }
            if (BestUV !== null) return { kind: 'vertex', uvIndex: BestUV };
        }

        if (mode === 'edge' || activeTool === 'seam')
        {
            let BestEdge = null, BestDist = ThresholdUV, BestA = -1, BestB = -1, BestVA = -1, BestVB = -1;
            for (const Isl of islands)
            {
                if (Isl.hidden) continue;
                for (const Fi of Isl.faceIndices)
                {
                    const C = surface.faces[Fi].corners;
                    for (let k = 0; k < C.length; k++)
                    {
                        const C0 = C[k], C1 = C[(k + 1) % C.length];
                        const Ua = C0.uv, Ub = C1.uv;
                        const A = surface.uvCoords[Ua], B = surface.uvCoords[Ub];
                        const D = PointSegmentDist(U, V, A[0], A[1], B[0], B[1]);
                        if (D < BestDist)
                        {
                            BestDist = D;
                            BestEdge = EdgeKey(Ua, Ub);
                            BestA = Ua; BestB = Ub;
                            BestVA = C0.v; BestVB = C1.v;
                        }
                    }
                }
            }
            if (BestEdge)
            {
                return {
                    kind: 'edge',
                    edgeKey: BestEdge,
                    uvA: BestA,
                    uvB: BestB,
                    vA: BestVA,
                    vB: BestVB,
                    key3d: EdgeKey(BestVA, BestVB)
                };
            }
        }

        // Face / Island hit test via point-in-polygon
        for (const Isl of islands)
        {
            if (Isl.hidden) continue;
            if (U < Isl.bounds.minU - 0.01 || U > Isl.bounds.maxU + 0.01 ||
                V < Isl.bounds.minV - 0.01 || V > Isl.bounds.maxV + 0.01) continue;
            for (const Fi of Isl.faceIndices)
            {
                const Poly = surface.faces[Fi].corners.map(C => surface.uvCoords[C.uv]);
                if (PointInPoly(U, V, Poly))
                {
                    return { kind: mode === 'face' ? 'face' : 'island', faceIndex: Fi, islandId: Isl.id };
                }
            }
        }
        return null;
    }
}

function PointSegmentDist(Px, Py, Ax, Ay, Bx, By)
{
    const Dx = Bx - Ax, Dy = By - Ay;
    const Len2 = Dx * Dx + Dy * Dy;
    if (Len2 < 1e-12) return Math.hypot(Px - Ax, Py - Ay);
    const T = Math.max(0, Math.min(1, ((Px - Ax) * Dx + (Py - Ay) * Dy) / Len2));
    return Math.hypot(Px - (Ax + T * Dx), Py - (Ay + T * Dy));
}

function PointInPoly(U, V, Poly)
{
    let Inside = false;
    for (let i = 0, j = Poly.length - 1; i < Poly.length; j = i++)
    {
        const Xi = Poly[i][0], Yi = Poly[i][1];
        const Xj = Poly[j][0], Yj = Poly[j][1];
        const Intersect = ((Yi > V) !== (Yj > V)) &&
            (U < ((Xj - Xi) * (V - Yi)) / ((Yj - Yi) || 1e-12) + Xi);
        if (Intersect) Inside = !Inside;
    }
    return Inside;
}
