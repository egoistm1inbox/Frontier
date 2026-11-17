/*==========================================================================================================================================
                                                           UVVIEWPORT3D.JS
==========================================================================================================================================*/
// Synchronized Three.js WebGL2 3D mesh viewport for Frontier UV Studio:
//   - Live UV texture & UDIM tile mapping (RepeatWrapping + per-UDIM tint/checker/texel/importance/stretch shading)
//   - Real-time 3D Seam overlay & Wireframe edges
//   - Direct 3D face/island picking & 3D edge seam toggling synced with the 2D UV Stage

import * as THREE from '../Vendor/three.esm.min.js';
import { OrbitControls } from '../Vendor/orbit-controls.esm.min.js';
import { EdgeKey, UdimFromUV } from './TopologySurface.js';

function BuildCheckerTexture()
{
    const Size = 512;
    const Canvas = document.createElement('canvas');
    Canvas.width = Size;
    Canvas.height = Size;
    const Ctx = Canvas.getContext('2d');
    const Cells = 8;
    const Step = Size / Cells;

    const Palette = [
        '#36434b', '#3f4d47', '#4a4534', '#413a4b',
        '#344150', '#454a3b', '#4e3c3a', '#354845'
    ];
    for (let y = 0; y < Cells; y++)
    {
        for (let x = 0; x < Cells; x++)
        {
            Ctx.fillStyle = Palette[(x * 3 + y * 5) % Palette.length];
            Ctx.fillRect(x * Step, y * Step, Step, Step);
            const Half = Step * 0.5;
            Ctx.fillStyle = 'rgba(255,255,255,0.09)';
            Ctx.fillRect(x * Step, y * Step, Half, Half);
            Ctx.fillRect(x * Step + Half, y * Step + Half, Half, Half);
            Ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            Ctx.strokeRect(x * Step + 0.5, y * Step + 0.5, Step - 1, Step - 1);
            Ctx.fillStyle = 'rgba(255,255,255,0.52)';
            Ctx.font = '600 13px ui-monospace, monospace';
            Ctx.fillText(`${String.fromCharCode(65 + x)}${Cells - y}`, x * Step + 7, y * Step + 20);
        }
    }

    const Tex = new THREE.CanvasTexture(Canvas);
    Tex.wrapS = THREE.RepeatWrapping;
    Tex.wrapT = THREE.RepeatWrapping;
    Tex.colorSpace = THREE.SRGBColorSpace;
    Tex.anisotropy = 4;
    return Tex;
}

function BuildMatcapTexture(Variant = 'clay')
{
    const Size = 512;
    const Canvas = document.createElement('canvas');
    Canvas.width = Size;
    Canvas.height = Size;
    const Ctx = Canvas.getContext('2d');
    const Img = Ctx.createImageData(Size, Size);
    const Data = Img.data;

    const IsSatin = Variant === 'matcap-satin';
    const BaseDark = IsSatin ? [24, 27, 32] : [74, 46, 36];
    const BaseMid = IsSatin ? [92, 100, 110] : [178, 120, 96];
    const SpecCol = IsSatin ? [239, 244, 207] : [255, 232, 214];
    const RimCol = IsSatin ? [138, 186, 224] : [158, 207, 255];

    const Lx = 0.40, Ly = 0.58, Lz = 0.707;
    const Hx = Lx * 0.5, Hy = Ly * 0.5, Hz = (Lz + 1) * 0.5;
    const HLen = Math.hypot(Hx, Hy, Hz);
    const Hnx = Hx / HLen, Hny = Hy / HLen, Hnz = Hz / HLen;

    const Fx = -0.58, Fy = -0.35, Fz = 0.73;

    for (let y = 0; y < Size; y++)
    {
        const Ny = 1 - (2 * (y + 0.5)) / Size;
        for (let x = 0; x < Size; x++)
        {
            const Nx = (2 * (x + 0.5)) / Size - 1;
            const R2 = Nx * Nx + Ny * Ny;
            const Nz = R2 <= 1 ? Math.sqrt(1 - R2) : 0;
            const idx = (y * Size + x) * 4;

            if (R2 > 1.0)
            {
                const Edge = Math.max(0, 1 - (R2 - 1) * 6);
                Data[idx] = BaseDark[0];
                Data[idx + 1] = BaseDark[1];
                Data[idx + 2] = BaseDark[2];
                Data[idx + 3] = Math.round(Edge * 255);
                continue;
            }

            const NdL = Math.max(0, Nx * Lx + Ny * Ly + Nz * Lz);
            const Wrap = Math.max(0, Math.min(1, (Nx * Lx + Ny * Ly + Nz * Lz + 0.45) / 1.45));
            const NdH = Math.max(0, Nx * Hnx + Ny * Hny + Nz * Hnz);
            const Spec = Math.pow(NdH, IsSatin ? 42 : 22) * (IsSatin ? 0.85 : 0.42);
            const Fill = Math.max(0, Nx * Fx + Ny * Fy + Nz * Fz) * 0.20;
            const Fresnel = Math.pow(1 - Nz, 2.8) * (IsSatin ? 0.42 : 0.24);

            const R = Math.min(255, BaseDark[0] + (BaseMid[0] - BaseDark[0]) * Wrap + SpecCol[0] * Spec + RimCol[0] * (Fresnel + Fill) + NdL * 24);
            const G = Math.min(255, BaseDark[1] + (BaseMid[1] - BaseDark[1]) * Wrap + SpecCol[1] * Spec + RimCol[1] * (Fresnel + Fill) + NdL * 22);
            const B = Math.min(255, BaseDark[2] + (BaseMid[2] - BaseDark[2]) * Wrap + SpecCol[2] * Spec + RimCol[2] * (Fresnel + Fill) + NdL * 20);

            Data[idx] = R;
            Data[idx + 1] = G;
            Data[idx + 2] = B;
            Data[idx + 3] = 255;
        }
    }
    Ctx.putImageData(Img, 0, 0);
    const Tex = new THREE.CanvasTexture(Canvas);
    Tex.colorSpace = THREE.SRGBColorSpace;
    return Tex;
}

function BuildVertexDotTexture()
{
    const Size = 64;
    const Canvas = document.createElement('canvas');
    Canvas.width = Size;
    Canvas.height = Size;
    const Ctx = Canvas.getContext('2d');
    Ctx.beginPath();
    Ctx.arc(Size * 0.5, Size * 0.5, Size * 0.42, 0, Math.PI * 2);
    Ctx.fillStyle = '#eff4cf';
    Ctx.fill();
    Ctx.lineWidth = 6;
    Ctx.strokeStyle = '#0b0b0b';
    Ctx.stroke();
    const Tex = new THREE.CanvasTexture(Canvas);
    Tex.colorSpace = THREE.SRGBColorSpace;
    return Tex;
}

function AppendEdgeTube(OutArr, A, B, Radius)
{
    const Dx = B[0] - A[0], Dy = B[1] - A[1], Dz = B[2] - A[2];
    const Len = Math.hypot(Dx, Dy, Dz);
    if (Len < 1e-7) return;
    const Nx = Dx / Len, Ny = Dy / Len, Nz = Dz / Len;
    const Upx = Math.abs(Ny) < 0.88 ? 0 : 1;
    const Upy = Math.abs(Ny) < 0.88 ? 1 : 0;
    const Upz = 0;

    let Ux = Ny * Upz - Nz * Upy;
    let Uy = Nz * Upx - Nx * Upz;
    let Uz = Nx * Upy - Ny * Upx;
    const UL = Math.hypot(Ux, Uy, Uz) || 1;
    Ux = (Ux / UL) * Radius;
    Uy = (Uy / UL) * Radius;
    Uz = (Uz / UL) * Radius;

    let Vx = Ny * Uz - Nz * Uy;
    let Vy = Nz * Ux - Nx * Uz;
    let Vz = Nx * Uy - Ny * Ux;
    const VL = Math.hypot(Vx, Vy, Vz) || 1;
    Vx = (Vx / VL) * Radius;
    Vy = (Vy / VL) * Radius;
    Vz = (Vz / VL) * Radius;

    const RingA = [
        [A[0] - Ux - Vx, A[1] - Uy - Vy, A[2] - Uz - Vz],
        [A[0] + Ux - Vx, A[1] + Uy - Vy, A[2] + Uz - Vz],
        [A[0] + Ux + Vx, A[1] + Uy + Vy, A[2] + Uz + Vz],
        [A[0] - Ux + Vx, A[1] - Uy + Vy, A[2] - Uz + Vz]
    ];
    const RingB = [
        [B[0] - Ux - Vx, B[1] - Uy - Vy, B[2] - Uz - Vz],
        [B[0] + Ux - Vx, B[1] + Uy - Vy, B[2] + Uz - Vz],
        [B[0] + Ux + Vx, B[1] + Uy + Vy, B[2] + Uz + Vz],
        [B[0] - Ux + Vx, B[1] - Uy + Vy, B[2] - Uz + Vz]
    ];
    for (let s = 0; s < 4; s++)
    {
        const s2 = (s + 1) % 4;
        const a0 = RingA[s], a1 = RingA[s2], b0 = RingB[s], b1 = RingB[s2];
        OutArr.push(
            a0[0], a0[1], a0[2], a1[0], a1[1], a1[2], b1[0], b1[1], b1[2],
            a0[0], a0[1], a0[2], b1[0], b1[1], b1[2], b0[0], b0[1], b0[2]
        );
    }
}

function ComputeCreaseCornerNormals(Surface, CreaseAngleDeg = 52)
{
    const CosCrease = Math.cos((CreaseAngleDeg * Math.PI) / 180);
    const VertFaces = new Map();
    for (let fi = 0; fi < Surface.faces.length; fi++)
    {
        for (const C of Surface.faces[fi].corners)
        {
            if (!VertFaces.has(C.v)) VertFaces.set(C.v, []);
            VertFaces.get(C.v).push(fi);
        }
    }
    const CornerNormals = new Array(Surface.faces.length);
    for (let fi = 0; fi < Surface.faces.length; fi++)
    {
        const Fn = Surface.faceNormals[fi] || [0, 1, 0];
        const C = Surface.faces[fi].corners;
        const List = new Array(C.length);
        for (let ci = 0; ci < C.length; ci++)
        {
            const Adj = VertFaces.get(C[ci].v) || [fi];
            let Sx = 0, Sy = 0, Sz = 0;
            for (const Afi of Adj)
            {
                const An = Surface.faceNormals[Afi] || Fn;
                if (Fn[0] * An[0] + Fn[1] * An[1] + Fn[2] * An[2] >= CosCrease)
                {
                    Sx += An[0]; Sy += An[1]; Sz += An[2];
                }
            }
            const L = Math.hypot(Sx, Sy, Sz) || 1;
            List[ci] = [Sx / L, Sy / L, Sz / L];
        }
        CornerNormals[fi] = List;
    }
    return CornerNormals;
}

function HeatRgb(T)
{
    const C = Math.max(0, Math.min(1, T));
    if (C < 0.35)
    {
        const K = C / 0.35;
        return [(68 + K * 37) / 255, (148 + K * 64) / 255, (235 - K * 65) / 255];
    }
    if (C < 0.7)
    {
        const K = (C - 0.35) / 0.35;
        return [(105 + K * 137) / 255, (212 - K * 18) / 255, (170 - K * 74) / 255];
    }
    const K = (C - 0.7) / 0.3;
    return [(242 - K * 10) / 255, (194 - K * 99) / 255, (96 - K * 14) / 255];
}

function HexToRgb01(Hex)
{
    const Clean = (Hex || '#eff4cf').replace('#', '');
    const Num = parseInt(Clean.length === 3 ? Clean.split('').map(C => C + C).join('') : Clean, 16);
    return [((Num >> 16) & 255) / 255, ((Num >> 8) & 255) / 255, (Num & 255) / 255];
}

export class UVViewport3D
{
    constructor(Container, { onPickFace = null, onPickEdge = null, onPickVertex = null, onToggleEdgeSeam = null, onContextMenu = null } = {})
    {
        this.container = Container;
        this.onPickFace = onPickFace;
        this.onPickEdge = onPickEdge;
        this.onPickVertex = onPickVertex;
        this.onToggleEdgeSeam = onToggleEdgeSeam;
        this.onContextMenu = onContextMenu;
        this.shadingMode = 'checker'; // 'checker' | 'flat' | 'matcap' | 'matcap-satin' | 'importance' | 'texel' | 'stretch'
        this.selectionMode = 'island';
        this.activeTool = 'select';
        this.showWireframe = true;
        this.showSeams = true;
        this.showBoundaries = true;
        this.webglReady = false;
        this.triToFace = [];
        this.surface = null;
        this.hoveredEdge = null;
        this.edgeNormalMap = new Map();
        this.edgeScaleRadius = 0.008;

        this.InitScene();
    }

    InitScene()
    {
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'viewport-webgl-canvas';
        this.container.append(this.canvas);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#101214');
        this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
        this.camera.position.set(3.8, 2.5, 4.4);

        try
        {
            this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
            this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.08;
            this.webglReady = true;
        }
        catch
        {
            this.webglReady = false;
            return;
        }

        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.08;
        this.controls.target.set(0, 0.85, 0);

        this.scene.add(new THREE.HemisphereLight('#dce6ec', '#2e2b25', 1.45));
        const Key = new THREE.DirectionalLight('#fff2dd', 2.4);
        Key.position.set(5, 8, 5);
        this.scene.add(Key);
        const Fill = new THREE.DirectionalLight('#9ecfff', 1.2);
        Fill.position.set(-5, 4, -4);
        this.scene.add(Fill);
        const Rim = new THREE.DirectionalLight('#9bdac5', 0.9);
        Rim.position.set(0, 3, -6);
        this.scene.add(Rim);

        const Grid = new THREE.GridHelper(12, 24, '#3d4346', '#212527');
        Grid.position.y = -0.002;
        this.scene.add(Grid);

        this.checkerTex = BuildCheckerTexture();
        this.matcapClayTex = BuildMatcapTexture('clay');
        this.matcapSatinTex = BuildMatcapTexture('matcap-satin');
        this.vertexDotTex = BuildVertexDotTexture();

        this.meshMat = new THREE.MeshStandardMaterial({
            map: this.checkerTex,
            vertexColors: true,
            roughness: 0.48,
            metalness: 0.08,
            flatShading: false,
            side: THREE.DoubleSide
        });
        this.matcapMat = new THREE.MeshMatcapMaterial({
            matcap: this.matcapClayTex,
            vertexColors: false,
            side: THREE.DoubleSide
        });

        this.geometry = new THREE.BufferGeometry();
        this.mesh = new THREE.Mesh(this.geometry, this.meshMat);
        this.scene.add(this.mesh);

        // Unmistakable golden highlight overlay over selected faces / islands in ANY shading mode
        this.selectedFaceGeo = new THREE.BufferGeometry();
        this.selectedFaceOverlayMesh = new THREE.Mesh(this.selectedFaceGeo, new THREE.MeshBasicMaterial({
            color: '#f5b84c',
            transparent: true,
            opacity: 0.34,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
            depthWrite: false
        }));
        this.selectedFaceOverlayMesh.renderOrder = 2;
        this.scene.add(this.selectedFaceOverlayMesh);

        this.wireGeo = new THREE.BufferGeometry();
        this.wireLines = new THREE.LineSegments(this.wireGeo, new THREE.LineBasicMaterial({
            color: '#ffffff', transparent: true, opacity: 0.16
        }));
        this.scene.add(this.wireLines);

        this.boundaryGeo = new THREE.BufferGeometry();
        this.boundaryLines = new THREE.LineSegments(this.boundaryGeo, new THREE.LineBasicMaterial({
            color: '#7bd4b8', transparent: true, opacity: 0.78
        }));
        this.scene.add(this.boundaryLines);

        // Thick 3D tubes for crisp Seams, Selected Edges, Active Edge, and Hovered Edge
        this.seamGeo = new THREE.BufferGeometry();
        this.seamMesh = new THREE.Mesh(this.seamGeo, new THREE.MeshBasicMaterial({
            color: '#ff5d47'
        }));
        this.seamMesh.renderOrder = 3;
        this.scene.add(this.seamMesh);

        this.selectedEdgeGeo = new THREE.BufferGeometry();
        this.selectedEdgeMesh = new THREE.Mesh(this.selectedEdgeGeo, new THREE.MeshBasicMaterial({
            color: '#eff4cf'
        }));
        this.selectedEdgeMesh.renderOrder = 4;
        this.scene.add(this.selectedEdgeMesh);

        this.selectedEdgeGhostGeo = new THREE.BufferGeometry();
        this.selectedEdgeGhostLines = new THREE.LineSegments(this.selectedEdgeGhostGeo, new THREE.LineBasicMaterial({
            color: '#eff4cf', transparent: true, opacity: 0.25, depthTest: false
        }));
        this.selectedEdgeGhostLines.renderOrder = 4;
        this.scene.add(this.selectedEdgeGhostLines);

        this.activeEdgeGeo = new THREE.BufferGeometry();
        this.activeEdgeMesh = new THREE.Mesh(this.activeEdgeGeo, new THREE.MeshBasicMaterial({
            color: '#ff9d3b'
        }));
        this.activeEdgeMesh.renderOrder = 5;
        this.scene.add(this.activeEdgeMesh);

        this.hoverEdgeGeo = new THREE.BufferGeometry();
        this.hoverEdgeMat = new THREE.MeshBasicMaterial({
            color: '#7dd3fc'
        });
        this.hoverEdgeMesh = new THREE.Mesh(this.hoverEdgeGeo, this.hoverEdgeMat);
        this.hoverEdgeMesh.renderOrder = 6;
        this.scene.add(this.hoverEdgeMesh);

        this.selectedVertGeo = new THREE.BufferGeometry();
        this.selectedVertPoints = new THREE.Points(this.selectedVertGeo, new THREE.PointsMaterial({
            color: '#ffffff',
            map: this.vertexDotTex,
            size: 13,
            sizeAttenuation: false,
            transparent: true,
            alphaTest: 0.2,
            depthTest: true
        }));
        this.selectedVertPoints.renderOrder = 7;
        this.scene.add(this.selectedVertPoints);

        // Pointer picking & hover edge preview
        let DownPt = null;
        let RightDownPt = null;
        this.canvas.addEventListener('pointerdown', E =>
        {
            if (E.button === 0) DownPt = [E.clientX, E.clientY];
            if (E.button === 2) RightDownPt = [E.clientX, E.clientY];
        });
        this.canvas.addEventListener('pointermove', E =>
        {
            if (E.buttons !== 0) return;
            this.UpdateHover(E);
        });
        this.canvas.addEventListener('pointerleave', () => this.ClearHover());
        this.canvas.addEventListener('pointerup', E =>
        {
            if (E.button === 0)
            {
                const Moved = !DownPt || Math.hypot(E.clientX - DownPt[0], E.clientY - DownPt[1]) > 5;
                DownPt = null;
                if (!Moved) this.HandleClick(E);
            }
        });
        this.canvas.addEventListener('dblclick', E =>
        {
            if (this.selectionMode === 'edge' && this.activeTool !== 'seam')
            {
                const HitEdge = this.FindHitEdge(E);
                if (HitEdge && this.onPickEdge)
                {
                    this.onPickEdge(HitEdge.va, HitEdge.vb, { additive: E.shiftKey, loop: true, ring: false, path: false, faceIndex: HitEdge.faceIndex });
                }
            }
        });
        this.canvas.addEventListener('contextmenu', E =>
        {
            const Moved = RightDownPt && Math.hypot(E.clientX - RightDownPt[0], E.clientY - RightDownPt[1]) > 5;
            RightDownPt = null;
            if (!Moved && this.onContextMenu)
            {
                E.preventDefault();
                const HitEdge = this.FindHitEdge(E);
                this.onContextMenu(E.clientX, E.clientY, HitEdge);
            }
        });

        const Resize = () =>
        {
            const R = this.container.getBoundingClientRect();
            if (!R.width || !R.height || !this.webglReady) return;
            this.renderer.setSize(R.width, R.height, false);
            this.camera.aspect = R.width / R.height;
            this.camera.updateProjectionMatrix();
        };
        new ResizeObserver(Resize).observe(this.container);
        Resize();

        const Loop = () =>
        {
            requestAnimationFrame(Loop);
            if (!this.webglReady) return;
            this.controls.update();
            this.renderer.render(this.scene, this.camera);
        };
        requestAnimationFrame(Loop);
    }

    RaycastMesh(Event)
    {
        if (!this.webglReady || !this.surface || !this.triToFace.length) return null;
        const Rect = this.canvas.getBoundingClientRect();
        if (!Rect.width || !Rect.height) return null;
        const Ptr = new THREE.Vector2(
            ((Event.clientX - Rect.left) / Rect.width) * 2 - 1,
            -((Event.clientY - Rect.top) / Rect.height) * 2 + 1
        );
        const Ray = new THREE.Raycaster();
        Ray.setFromCamera(Ptr, this.camera);
        const Hits = Ray.intersectObject(this.mesh, false);
        if (!Hits.length) return null;
        const Hit = Hits[0];
        const FaceIndex = this.triToFace[Hit.faceIndex];
        if (FaceIndex === undefined) return null;
        return { hit: Hit, faceIndex: FaceIndex };
    }

    FindHitEdge(Event)
    {
        const Pick = this.RaycastMesh(Event);
        if (!Pick) return null;
        const { hit, faceIndex } = Pick;
        const F = this.surface.faces[faceIndex];
        if (!F) return null;
        const Hp = hit.point;
        let BestEdge = null, BestD = Infinity;
        for (let k = 0; k < F.corners.length; k++)
        {
            const Va = F.corners[k].v, Vb = F.corners[(k + 1) % F.corners.length].v;
            const A = this.surface.positions[Va], B = this.surface.positions[Vb];
            const D = PointToSeg3D(Hp.x, Hp.y, Hp.z, A, B);
            if (D < BestD)
            {
                BestD = D;
                BestEdge = { va: Va, vb: Vb, key: EdgeKey(Va, Vb), faceIndex, point: Hp };
            }
        }
        return BestEdge;
    }

    FindHitVertex(Event)
    {
        const Pick = this.RaycastMesh(Event);
        if (!Pick) return null;
        const { hit, faceIndex } = Pick;
        const F = this.surface.faces[faceIndex];
        if (!F) return null;
        const Hp = hit.point;
        let BestV = null, BestD = Infinity;
        for (const C of F.corners)
        {
            const P = this.surface.positions[C.v];
            const D = Math.hypot(Hp.x - P[0], Hp.y - P[1], Hp.z - P[2]);
            if (D < BestD) { BestD = D; BestV = C.v; }
        }
        return BestV !== null ? { v: BestV, faceIndex } : null;
    }

    UpdateHover(Event)
    {
        const WantEdgeHover = this.activeTool === 'seam' || this.selectionMode === 'edge' || Event.altKey;
        if (!WantEdgeHover)
        {
            this.ClearHover();
            this.canvas.style.cursor = 'default';
            return;
        }
        const Edge = this.FindHitEdge(Event);
        this.hoveredEdge = Edge;
        if (!Edge)
        {
            this.hoverEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
            this.hoverEdgeMesh.visible = false;
            this.canvas.style.cursor = this.activeTool === 'seam' ? 'crosshair' : 'default';
            return;
        }
        this.hoverEdgeMat.color.set(this.activeTool === 'seam' ? '#ff8b78' : '#7dd3fc');
        this.canvas.style.cursor = this.activeTool === 'seam' ? 'crosshair' : 'pointer';

        const A = this.surface.positions[Edge.va];
        const B = this.surface.positions[Edge.vb];
        const N = this.edgeNormalMap.get(Edge.key) || this.surface.faceNormals[Edge.faceIndex] || [0, 1, 0];
        const Lift = this.edgeScaleRadius * 0.45;
        const P0 = [A[0] + N[0] * Lift, A[1] + N[1] * Lift, A[2] + N[2] * Lift];
        const P1 = [B[0] + N[0] * Lift, B[1] + N[1] * Lift, B[2] + N[2] * Lift];
        const Arr = [];
        AppendEdgeTube(Arr, P0, P1, this.edgeScaleRadius * 1.32);
        this.hoverEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(Arr, 3));
        this.hoverEdgeGeo.computeVertexNormals();
        this.hoverEdgeMesh.visible = true;
    }

    ClearHover()
    {
        if (!this.hoveredEdge) return;
        this.hoveredEdge = null;
        this.hoverEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
        this.hoverEdgeMesh.visible = false;
    }

    HandleClick(Event)
    {
        if (!this.webglReady || !this.surface) return;

        // 1. Dedicated Seam Brush tool: click edge = toggle seam, Alt+click = toggle seam loop
        if (this.activeTool === 'seam')
        {
            const Edge = this.FindHitEdge(Event);
            if (Edge && this.onToggleEdgeSeam)
            {
                this.onToggleEdgeSeam(Edge.va, Edge.vb, { loop: Event.altKey, faceIndex: Edge.faceIndex });
            }
            return;
        }

        // 2. Edge Selection Mode (Blender-faithful modifiers: Click, Shift+Click, Alt+Click Loop, Ctrl+Alt+Click Ring, Ctrl+Click Path)
        if (this.selectionMode === 'edge')
        {
            const Edge = this.FindHitEdge(Event);
            if (!Edge) return;
            if (this.onPickEdge)
            {
                this.onPickEdge(Edge.va, Edge.vb, {
                    additive: Event.shiftKey,
                    loop: Event.altKey && !Event.ctrlKey,
                    ring: Event.ctrlKey && Event.altKey,
                    path: Event.ctrlKey && !Event.altKey,
                    faceIndex: Edge.faceIndex
                });
            }
            return;
        }

        // 3. Vertex Selection Mode
        if (this.selectionMode === 'vertex' && !Event.altKey && !Event.ctrlKey)
        {
            const VHit = this.FindHitVertex(Event);
            if (VHit && this.onPickVertex)
            {
                this.onPickVertex(VHit.v, { additive: Event.shiftKey, faceIndex: VHit.faceIndex });
                return;
            }
        }

        // 4. Quick Seam shortcut in Face/Island mode via Alt+Click or Ctrl+Click
        if (Event.altKey || Event.ctrlKey)
        {
            const Edge = this.FindHitEdge(Event);
            if (Edge && this.onToggleEdgeSeam)
            {
                this.onToggleEdgeSeam(Edge.va, Edge.vb, { loop: Event.shiftKey && Event.altKey, faceIndex: Edge.faceIndex });
            }
            return;
        }

        // 5. Face / Island picking
        const Pick = this.RaycastMesh(Event);
        if (Pick && this.onPickFace) this.onPickFace(Pick.faceIndex, Event.shiftKey);
    }

    CameraPreset(Preset)
    {
        if (!this.webglReady) return;
        let Target = new THREE.Vector3(0, 0.85, 0);
        if (this.surface && this.surface.positions.length)
        {
            let MinY = Infinity, MaxY = -Infinity;
            for (const P of this.surface.positions)
            {
                if (P[1] < MinY) MinY = P[1];
                if (P[1] > MaxY) MaxY = P[1];
            }
            Target.set(0, 0.5 * (MinY + MaxY), 0);
        }
        this.controls.target.copy(Target);
        if (Preset === 'Front') this.camera.position.set(0, Target.y + 0.4, 5.2);
        else if (Preset === 'Side') this.camera.position.set(5.2, Target.y + 0.4, 0.01);
        else if (Preset === 'Top') this.camera.position.set(0, Target.y + 5.4, 0.01);
        else this.camera.position.set(3.8, Target.y + 1.8, 4.4);
        this.controls.update();
    }

    SyncFromSurface(Surface, Islands, ImportanceGroups, TargetTexelDensity = 10)
    {
        this.surface = Surface;
        if (!this.webglReady || !Surface) return;

        const PosArr = [];
        const NormArr = [];
        const UvArr = [];
        const ColArr = [];
        const SelFacePosArr = [];
        const WireArr = [];
        const BoundaryArr = [];
        const SeamTubeArr = [];
        const SelEdgeTubeArr = [];
        const SelEdgeGhostArr = [];
        const ActiveEdgeTubeArr = [];
        const SelVertArr = [];
        this.triToFace = [];
        this.edgeNormalMap.clear();

        const IslandByFace = new Map();
        for (const Isl of Islands)
        {
            for (const Fi of Isl.faceIndices) IslandByFace.set(Fi, Isl);
        }
        const GroupColors = new Map(ImportanceGroups.map(G => [G.id, HexToRgb01(G.color)]));
        const UdimTints = [
            [0.95, 0.96, 0.92],
            [0.78, 0.90, 1.00],
            [0.98, 0.88, 0.70],
            [0.74, 0.94, 0.85]
        ];

        const IsMatcap = this.shadingMode === 'matcap' || this.shadingMode === 'matcap-satin';
        const IsFlat = this.shadingMode === 'flat';
        const CreaseNormals = IsMatcap ? ComputeCreaseCornerNormals(Surface, 52) : null;

        if (IsMatcap)
        {
            this.matcapMat.matcap = this.shadingMode === 'matcap-satin' ? this.matcapSatinTex : this.matcapClayTex;
            this.matcapMat.needsUpdate = true;
            this.mesh.material = this.matcapMat;
        }
        else
        {
            this.meshMat.map = this.shadingMode === 'checker' ? this.checkerTex : null;
            this.meshMat.flatShading = IsFlat;
            this.meshMat.needsUpdate = true;
            this.mesh.material = this.meshMat;
        }

        // Track edge face counts, selection boundary counts, & averaged normal per unique 3D edge
        const EdgeAccum = new Map();

        for (let fi = 0; fi < Surface.faces.length; fi++)
        {
            const F = Surface.faces[fi];
            const Isl = IslandByFace.get(fi);
            if (Isl?.hidden) continue;

            const Corners = F.corners;
            const FaceN = Surface.faceNormals[fi] || [0, 1, 0];
            const SmoothN = CreaseNormals ? CreaseNormals[fi] : null;
            const IsSel = Surface.selectedFaces.has(fi) || (Isl && Surface.selectedIslands.has(Isl.id));

            // Determine face color based on 3D shading lens
            let R = 0.85, G = 0.86, B = 0.85;
            if (this.shadingMode === 'checker')
            {
                const TileIdx = Math.max(0, (Isl?.udimTile || 1001) - 1001) % UdimTints.length;
                [R, G, B] = UdimTints[TileIdx];
            }
            else if (this.shadingMode === 'flat')
            {
                R = 0.76; G = 0.78; B = 0.80;
            }
            else if (this.shadingMode === 'importance')
            {
                const GrpRgb = Isl?.importanceGroupId ? GroupColors.get(Isl.importanceGroupId) : null;
                [R, G, B] = GrpRgb || [0.42, 0.45, 0.48];
            }
            else if (this.shadingMode === 'texel')
            {
                const Ratio = (Isl?.texelDensity || 0) / Math.max(0.1, TargetTexelDensity);
                const T = Math.max(0, Math.min(1, 0.35 + Math.log2(Math.max(0.125, Ratio)) * 0.28));
                [R, G, B] = HeatRgb(T);
            }
            else if (this.shadingMode === 'stretch')
            {
                const D = Surface.FaceTrianglesDistortion(fi);
                [R, G, B] = HeatRgb(Math.min(1, D.angleStretch * 2.2));
            }

            if (IsSel && !IsMatcap)
            {
                R = Math.min(1, R * 0.62 + 0.96 * 0.42);
                G = Math.min(1, G * 0.62 + 0.76 * 0.42);
                B = Math.min(1, B * 0.62 + 0.28 * 0.42);
            }

            for (let k = 1; k < Corners.length - 1; k++)
            {
                const Idxs = [0, k, k + 1];
                for (const ci of Idxs)
                {
                    const C = Corners[ci];
                    const Pt = Surface.positions[C.v];
                    const Uv = Surface.uvCoords[C.uv];
                    const Nrm = SmoothN ? SmoothN[ci] : FaceN;
                    PosArr.push(Pt[0], Pt[1], Pt[2]);
                    NormArr.push(Nrm[0], Nrm[1], Nrm[2]);
                    UvArr.push(Uv[0], Uv[1]);
                    ColArr.push(R, G, B);
                    if (IsSel) SelFacePosArr.push(Pt[0], Pt[1], Pt[2]);
                }
                this.triToFace.push(fi);
            }

            const Eps = 0.002;
            for (let k = 0; k < Corners.length; k++)
            {
                const Va = Corners[k].v, Vb = Corners[(k + 1) % Corners.length].v;
                const A = Surface.positions[Va], Bpt = Surface.positions[Vb];
                WireArr.push(
                    A[0] + FaceN[0] * Eps, A[1] + FaceN[1] * Eps, A[2] + FaceN[2] * Eps,
                    Bpt[0] + FaceN[0] * Eps, Bpt[1] + FaceN[1] * Eps, Bpt[2] + FaceN[2] * Eps
                );

                const K3 = EdgeKey(Va, Vb);
                if (!EdgeAccum.has(K3))
                {
                    EdgeAccum.set(K3, { va: Va, vb: Vb, nx: FaceN[0], ny: FaceN[1], nz: FaceN[2], count: 1, selFaceCount: IsSel ? 1 : 0 });
                }
                else
                {
                    const Acc = EdgeAccum.get(K3);
                    Acc.nx += FaceN[0]; Acc.ny += FaceN[1]; Acc.nz += FaceN[2];
                    Acc.count++;
                    if (IsSel) Acc.selFaceCount++;
                }
            }
        }

        this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(PosArr, 3));
        this.geometry.setAttribute('normal', new THREE.Float32BufferAttribute(NormArr, 3));
        this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(UvArr, 2));
        this.geometry.setAttribute('color', new THREE.Float32BufferAttribute(ColArr, 3));
        this.geometry.computeBoundingSphere();

        const ModelRadius = this.geometry.boundingSphere?.radius || 2.0;
        const BaseR = Math.max(0.0038, Math.min(0.022, ModelRadius * 0.0042));
        this.edgeScaleRadius = BaseR;

        // Selected vertices in Vertex mode
        const SelVert3DSet = new Set();
        if (this.selectionMode === 'vertex')
        {
            for (const F of Surface.faces)
            {
                for (const C of F.corners)
                {
                    if (Surface.selectedUVs.has(C.uv)) SelVert3DSet.add(C.v);
                }
            }
            for (const V of SelVert3DSet)
            {
                const P = Surface.positions[V];
                if (P) SelVertArr.push(P[0], P[1], P[2]);
            }
        }

        const IsRegionMode = this.selectionMode === 'face' || this.selectionMode === 'island';

        for (const [K3, Acc] of EdgeAccum)
        {
            const NLen = Math.hypot(Acc.nx, Acc.ny, Acc.nz) || 1;
            const Nx = Acc.nx / NLen, Ny = Acc.ny / NLen, Nz = Acc.nz / NLen;
            this.edgeNormalMap.set(K3, [Nx, Ny, Nz]);

            const A = Surface.positions[Acc.va], Bpt = Surface.positions[Acc.vb];
            if (Acc.count === 1)
            {
                const BEps = BaseR * 0.4;
                BoundaryArr.push(
                    A[0] + Nx * BEps, A[1] + Ny * BEps, A[2] + Nz * BEps,
                    Bpt[0] + Nx * BEps, Bpt[1] + Ny * BEps, Bpt[2] + Nz * BEps
                );
            }
            if (Surface.seams.has(K3))
            {
                const SEps = BaseR * 0.35;
                AppendEdgeTube(
                    SeamTubeArr,
                    [A[0] + Nx * SEps, A[1] + Ny * SEps, A[2] + Nz * SEps],
                    [Bpt[0] + Nx * SEps, Bpt[1] + Ny * SEps, Bpt[2] + Nz * SEps],
                    BaseR * 0.70
                );
            }

            const ShowSelEdge = IsRegionMode
                ? (Acc.selFaceCount === 1) // crisp selection perimeter around selected faces/islands
                : Surface.selectedEdges3D.has(K3);

            if (ShowSelEdge)
            {
                const EEps = BaseR * 0.45;
                const P0 = [A[0] + Nx * EEps, A[1] + Ny * EEps, A[2] + Nz * EEps];
                const P1 = [Bpt[0] + Nx * EEps, Bpt[1] + Ny * EEps, Bpt[2] + Nz * EEps];
                const IsActiveEdge = !IsRegionMode && Surface.activeEdge3D === K3;
                AppendEdgeTube(IsActiveEdge ? ActiveEdgeTubeArr : SelEdgeTubeArr, P0, P1, IsActiveEdge ? BaseR * 1.45 : BaseR * 1.15);
                SelEdgeGhostArr.push(P0[0], P0[1], P0[2], P1[0], P1[1], P1[2]);
            }
        }

        this.selectedFaceGeo.setAttribute('position', new THREE.Float32BufferAttribute(SelFacePosArr, 3));
        this.selectedFaceOverlayMesh.visible = SelFacePosArr.length > 0;

        this.wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(WireArr, 3));
        this.wireLines.visible = this.showWireframe;

        this.boundaryGeo.setAttribute('position', new THREE.Float32BufferAttribute(BoundaryArr, 3));
        this.boundaryLines.visible = this.showBoundaries;

        this.seamGeo.setAttribute('position', new THREE.Float32BufferAttribute(SeamTubeArr, 3));
        this.seamMesh.visible = this.showSeams && SeamTubeArr.length > 0;

        this.selectedEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(SelEdgeTubeArr, 3));
        this.selectedEdgeMesh.visible = SelEdgeTubeArr.length > 0;

        this.selectedEdgeGhostGeo.setAttribute('position', new THREE.Float32BufferAttribute(SelEdgeGhostArr, 3));
        this.selectedEdgeGhostLines.visible = SelEdgeGhostArr.length > 0 && !IsRegionMode;

        this.activeEdgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ActiveEdgeTubeArr, 3));
        this.activeEdgeMesh.visible = ActiveEdgeTubeArr.length > 0;

        this.selectedVertGeo.setAttribute('position', new THREE.Float32BufferAttribute(SelVertArr, 3));
        this.selectedVertPoints.visible = SelVertArr.length > 0;
    }
}

function PointToSeg3D(Px, Py, Pz, A, B)
{
    const Abx = B[0] - A[0], Aby = B[1] - A[1], Abz = B[2] - A[2];
    const Len2 = Abx * Abx + Aby * Aby + Abz * Abz || 1e-8;
    const T = Math.max(0, Math.min(1, ((Px - A[0]) * Abx + (Py - A[1]) * Aby + (Pz - A[2]) * Abz) / Len2));
    return Math.hypot(Px - (A[0] + T * Abx), Py - (A[1] + T * Aby), Pz - (A[2] + T * Abz));
}
