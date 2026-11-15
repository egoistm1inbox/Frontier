/*==========================================================================================================================================
                                                          STUDIOCONTROLS.JS
==========================================================================================================================================*/
// Particle Studio control surface. The UI components (inspector controls, outliner, header, inspector frame, status strip)
// live in UI/; this module keeps the editor-facing names, the DOM helpers and the bespoke diagrams (TimeSeries, emitter,
// curve plot, polar dial, smooth scroll, toast).

const SvgNamespace = 'http://www.w3.org/2000/svg';

import { GlyphPaths, RichGlyphs, ConstructGlyph } from './UI/Glyphs.js';
import { OpenScope, CloseScope, ReleaseScope, Register, Broadcast } from './UI/Runtime.js';
export { GlyphPaths, RichGlyphs, ConstructGlyph, OpenScope, CloseScope, ReleaseScope, Register, Broadcast };
// Inspector control kit: rewritten from scratch in UI/Controls.js; exported here under the names the editor calls.
export { Section as SectionCard, Slider as SliderRow, Switch as SwitchRow, Select as SelectRow, Text as TextRow,
         Segmented as SegmentedRow, Vector as VectorRow, Colour as ColourRow, Tile as ToggleTile, Actions as ActionRow,
         Tabs as PillTabs, Chips as ChipToggles, Stats as MetricTrio, TileGrid, Note } from './UI/Controls.js';

export function Construct(Tag, ClassName, Content)
{
    const Element = document.createElement(Tag);
    if (ClassName) Element.className = ClassName;
    if (Content === undefined || Content === null) return Element;
    if (typeof Content === 'string' || typeof Content === 'number') Element.textContent = String(Content);
    else if (Array.isArray(Content)) Content.forEach(Part => { if (Part !== null && Part !== undefined) Element.append(Part); });
    else Element.append(Content);
    return Element;
}

export function ConstructSvg(Tag, Attributes, Text)
{
    const Element = document.createElementNS(SvgNamespace, Tag);
    for (const [Key, Setting] of Object.entries(Attributes || {})) Element.setAttribute(Key, Setting);
    if (Text !== undefined) Element.textContent = Text;
    return Element;
}

export const LinearToDisplay = Value => Value <= 0.0031308 ? 12.92 * Value : 1.055 * Math.pow(Value, 1 / 2.4) - 0.055;
export const DisplayToLinear = Value => Value <= 0.04045 ? Value / 12.92 : Math.pow((Value + 0.055) / 1.055, 2.4);

const CompassPoints = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const ResolveCompassPoint = Degrees => CompassPoints[Math.round((((Degrees % 360) + 360) % 360) / 22.5) % 16];

export function ConstructMetric(Element, Value, Digits, Unit)
{
    Element.textContent = '';
    const Formatted = Number(Value).toLocaleString('en-US', { minimumFractionDigits: Digits, maximumFractionDigits: Digits });
    Element.append(document.createTextNode(Formatted));
    if (Unit) Element.append(Construct('small', null, ' ' + Unit));
}

export function TimeSeries(Parent, Binding)
{
    const Height = Binding.Height || 110;
    const Wrap = Construct('div', 'diagram-wrap');
    const Svg = ConstructSvg('svg', { class: 'diagram', height: Height });
    Wrap.append(Svg);
    Parent.append(Wrap);
    const Refresh = () =>
    {
        const Width = Math.max(200, Svg.clientWidth || Parent.clientWidth || 320);
        const Suffix = Binding.Unit ? ' ' + Binding.Unit : '';
        const Samples = (Binding.Samples || []).map(V => Number.isFinite(V) ? V : 0);
        const RawTarget = typeof Binding.Target === 'function' ? Binding.Target() : (Binding.Target || 1);
        const Target = Number.isFinite(RawTarget) ? RawTarget : 1;
        const Peak = Math.max(1e-4, Target * (Binding.Headroom || 1.15), ...Samples);
        const Right = Width - 42, Bottom = Height - 18, Top = 10;
        const AtX = I => (I / Math.max(1, (Binding.Capacity || Samples.length || 2) - 1)) * Right;
        const AtY = V => Bottom - (Math.min(Peak, Math.max(0, Number.isFinite(V) ? V : 0)) / Peak) * (Bottom - Top);

        Svg.textContent = '';
        const Defs = ConstructSvg('defs');
        const Grad = ConstructSvg('linearGradient', { id: 'StudioSeriesGrad', x1: '0', y1: '0', x2: '0', y2: '1' });
        Grad.append(
            ConstructSvg('stop', { offset: '0%', 'stop-color': '#e8c27a', 'stop-opacity': '0.32' }),
            ConstructSvg('stop', { offset: '100%', 'stop-color': '#e8c27a', 'stop-opacity': '0.01' })
        );
        Defs.append(Grad);
        Svg.append(Defs);

        for (const Share of [0.33, 0.66, 1.0])
        {
            const Val = Peak * Share;
            const Y = AtY(Val);
            Svg.append(
                ConstructSvg('line', { x1: 0, x2: Right, y1: Y, y2: Y, stroke: '#ffffff', 'stroke-opacity': 0.06, 'stroke-dasharray': '2 5' }),
                ConstructSvg('text', { x: Width - 2, y: Y + 3, 'text-anchor': 'end', fill: '#666666', 'font-size': 9.5 }, Val.toFixed(Binding.AxisDigits ?? 0))
            );
        }

        const Offset = Binding.Capacity - Samples.length;
        if (Samples.length > 1)
        {
            const Points = Samples.map((V, I) => [AtX(I + Offset), AtY(V)]);
            const Line = Points.map(([X, Y], I) => `${I ? 'L' : 'M'}${X.toFixed(1)} ${Y.toFixed(1)}`).join(' ');
            Svg.append(
                ConstructSvg('path', { d: `${Line} L${Points[Points.length - 1][0].toFixed(1)} ${Bottom} L${Points[0][0].toFixed(1)} ${Bottom} Z`, fill: 'url(#StudioSeriesGrad)' }),
                ConstructSvg('path', { d: Line, fill: 'none', stroke: '#f0cfa0', 'stroke-width': 1.6, 'stroke-linejoin': 'round' })
            );
            const [Ex, Ey] = Points[Points.length - 1];
            Svg.append(
                ConstructSvg('circle', { cx: Ex, cy: Ey, r: 7, fill: '#f0cfa0', 'fill-opacity': 0.18 }),
                ConstructSvg('circle', { cx: Ex, cy: Ey, r: 3.4, fill: '#f7e5c6' })
            );
        }

        const TargetY = AtY(Target);
        Svg.append(
            ConstructSvg('line', { x1: 0, x2: Right, y1: TargetY, y2: TargetY, stroke: '#ffffff', 'stroke-opacity': 0.25, 'stroke-dasharray': '5 5' }),
            ConstructSvg('text', { x: 0, y: Math.max(9, TargetY - 4), fill: '#888888', 'font-size': 9.5 },
                         `${typeof Binding.TargetLabel === 'function' ? Binding.TargetLabel() : (Binding.TargetLabel || 'Target')} ${Target.toFixed(Binding.TargetDigits ?? 1)}${Suffix}`)
        );
        for (const [Label, Share] of [['−10 s', 0], ['−5 s', 0.5], ['now', 1]])
        {
            Svg.append(ConstructSvg('text', { x: Share * Right, y: Height - 2, 'text-anchor': Share === 0 ? 'start' : Share === 1 ? 'end' : 'middle', fill: '#626262', 'font-size': 9.5 }, Label));
        }
    };
    new ResizeObserver(Refresh).observe(Svg);
    Register(Refresh);
    return { Refresh };
}

// 📝 Sun-Inspector Style Optical/Emitter Cone & Colour Spectrum Diagram
export function EmitterInstrument(Parent, Effect, ToHex)
{
    const Height = 112;
    const Wrap = Construct('div', 'diagram-wrap sun-instrument');
    const Svg = ConstructSvg('svg', { class: 'diagram', height: Height });
    Wrap.append(Svg);
    Parent.append(Wrap);
    const Refresh = () =>
    {
        const P = Effect.P;
        const W = Math.max(220, Svg.clientWidth || Parent.clientWidth || 320);
        const Cx = W * 0.5, Cy = Height * 0.78, R = Height * 0.62;
        const ColA = ToHex(P.colA);
        const ColB = ToHex(P.colB);
        Svg.textContent = '';
        const Defs = ConstructSvg('defs');
        const ConeGrad = ConstructSvg('radialGradient', { id: 'ConeGlow', cx: '50%', cy: '85%', r: '75%' });
        ConeGrad.append(
            ConstructSvg('stop', { offset: '0%', 'stop-color': ColA, 'stop-opacity': '0.52' }),
            ConstructSvg('stop', { offset: '65%', 'stop-color': ColB, 'stop-opacity': '0.16' }),
            ConstructSvg('stop', { offset: '100%', 'stop-color': ColB, 'stop-opacity': '0' })
        );
        Defs.append(ConeGrad);
        Svg.append(Defs);

        // Horizon & Sun-style concentric optical rings
        Svg.append(ConstructSvg('line', { x1: 16, x2: W - 16, y1: Cy, y2: Cy, stroke: '#ffffff', 'stroke-opacity': 0.14 }));
        for (const Ring of [0.38, 0.68, 0.98])
        {
            Svg.append(ConstructSvg('path', {
                d: `M${Cx - R * Ring} ${Cy} A${R * Ring} ${R * Ring} 0 0 1 ${Cx + R * Ring} ${Cy}`,
                fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.08, 'stroke-dasharray': '3 5'
            }));
        }

        // Direction vector & spread fan
        const Dir = P.dir || [0, 1, 0];
        const Tilt = Math.atan2(Dir[0], Math.max(0.05, Dir[1])) * 0.7;
        const HalfSpread = Math.min(1.35, Math.max(0.08, (P.spread ?? 0.5) * 0.85));
        const A0 = -Math.PI / 2 + Tilt - HalfSpread;
        const A1 = -Math.PI / 2 + Tilt + HalfSpread;
        const X0 = Cx + Math.cos(A0) * R, Y0 = Cy + Math.sin(A0) * R;
        const X1 = Cx + Math.cos(A1) * R, Y1 = Cy + Math.sin(A1) * R;
        Svg.append(
            ConstructSvg('path', { d: `M${Cx} ${Cy} L${X0.toFixed(1)} ${Y0.toFixed(1)} A${R} ${R} 0 0 1 ${X1.toFixed(1)} ${Y1.toFixed(1)} Z`, fill: 'url(#ConeGlow)' }),
            ConstructSvg('line', { x1: Cx, y1: Cy, x2: X0.toFixed(1), y2: Y0.toFixed(1), stroke: ColA, 'stroke-opacity': 0.45 }),
            ConstructSvg('line', { x1: Cx, y1: Cy, x2: X1.toFixed(1), y2: Y1.toFixed(1), stroke: ColA, 'stroke-opacity': 0.45 }),
            ConstructSvg('circle', { cx: Cx, cy: Cy, r: 7.5, fill: ColA, stroke: '#121212', 'stroke-width': 2 }),
            ConstructSvg('text', { x: 16, y: 18, fill: '#7d7d7d', 'font-size': 9.5 }, `SPREAD ${((P.spread ?? 0.5) * 57.2958).toFixed(0)}°`),
            ConstructSvg('text', { x: W - 16, y: 18, 'text-anchor': 'end', fill: '#7d7d7d', 'font-size': 9.5 }, `${P.speedMin?.toFixed(1) ?? '0'}–${P.speedMax?.toFixed(1) ?? '0'} m/s`)
        );
    };
    new ResizeObserver(Refresh).observe(Svg);
    Register(Refresh);
    return { Wrap, Refresh };
}

export function CurvePlot(Host, Specification)
{
    const Height = Specification.Height || 124;
    const Panel = Construct('div', 'diagram-wrap curve-plot');
    const Svg = ConstructSvg('svg', { class: 'diagram', height: Height });
    const Caption = Construct('div', 'plot-caption');
    Panel.append(Svg, Caption);
    Host.append(Panel);
    const Refresh = () =>
    {
        const Plot = Specification.Resolve();
        const Width = Math.max(180, Svg.clientWidth || Host.clientWidth || 320);
        const Left = Plot.YTicks && Plot.YTicks.length ? 34 : 6;
        const Right = Width - 8, Top = 8, Bottom = Height - (Plot.XTicks && Plot.XTicks.length ? 18 : 6);
        const [X0, X1] = Plot.XRange;
        const [Y0, Y1] = Plot.YRange;
        const AtX = X => Left + ((X - X0) / ((X1 - X0) || 1)) * (Right - Left);
        const AtY = Y => Bottom - ((Y - Y0) / ((Y1 - Y0) || 1)) * (Bottom - Top);
        Svg.textContent = '';
        for (const [Y, Text] of Plot.YTicks || [])
        {
            Svg.append(
                ConstructSvg('line', { x1: Left, x2: Right, y1: AtY(Y), y2: AtY(Y), stroke: '#ffffff', 'stroke-opacity': 0.06, 'stroke-dasharray': '2 5' }),
                ConstructSvg('text', { x: Left - 6, y: AtY(Y) + 3, 'text-anchor': 'end', fill: '#6a6a6a', 'font-size': 9.5 }, Text)
            );
        }
        for (const [X, Text] of Plot.XTicks || [])
        {
            Svg.append(
                ConstructSvg('line', { x1: AtX(X), x2: AtX(X), y1: Top, y2: Bottom, stroke: '#ffffff', 'stroke-opacity': 0.05, 'stroke-dasharray': '2 5' }),
                ConstructSvg('text', { x: AtX(X), y: Height - 3, 'text-anchor': 'middle', fill: '#6a6a6a', 'font-size': 9.5 }, Text)
            );
        }
        for (const Curve of Plot.Curves || [])
        {
            const Clean = (Curve.Points || []).filter(([X, Y]) => Number.isFinite(X) && Number.isFinite(Y));
            if (Clean.length < 2) continue;
            const Path = Clean.map(([X, Y], Pos) => `${Pos ? 'L' : 'M'}${AtX(X).toFixed(1)} ${AtY(Y).toFixed(1)}`).join(' ');
            if (Curve.Fill)
            {
                const First = Clean[0], Last = Clean[Clean.length - 1];
                const BaseY = AtY(Math.max(Y0, Math.min(Y1, 0)));
                Svg.append(ConstructSvg('path', { d: `${Path} L${AtX(Last[0]).toFixed(1)} ${BaseY} L${AtX(First[0]).toFixed(1)} ${BaseY} Z`, fill: Curve.Fill }));
            }
            Svg.append(ConstructSvg('path', { d: Path, fill: 'none', stroke: Curve.Stroke || '#f0cfa0', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
        }
        Caption.textContent = Plot.Caption || '';
        Caption.style.display = Plot.Caption ? '' : 'none';
    };
    new ResizeObserver(Refresh).observe(Svg);
    Register(Refresh);
    return { Panel, Refresh };
}

export function PolarDial(Host, Specification)
{
    const Size = Specification.Size || 148;
    const Panel = Construct('div', 'diagram-wrap polar-dial');
    const Svg = ConstructSvg('svg', { class: 'diagram dial-svg', height: Size, viewBox: `0 0 ${Size} ${Size}` });
    const Side = Construct('div', 'dial-side');
    Panel.append(Svg, Side);
    Host.append(Panel);
    const Centre = Size / 2, Radius = Size / 2 - 16;
    const Refresh = () =>
    {
        const Bearing = Specification.Read();
        const Turn = Bearing * Math.PI / 180;
        const Tip = [Centre + Math.sin(Turn) * Radius, Centre - Math.cos(Turn) * Radius];
        Svg.textContent = '';
        Svg.setAttribute('width', Size);
        Svg.append(
            ConstructSvg('circle', { cx: Centre, cy: Centre, r: Radius, fill: '#111111', stroke: '#2c2c2c' }),
            ConstructSvg('circle', { cx: Centre, cy: Centre, r: Radius * 0.6, fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.06, 'stroke-dasharray': '2 5' })
        );
        for (const [Text, Angle] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]])
        {
            const A = Angle * Math.PI / 180;
            Svg.append(ConstructSvg('text', { x: Centre + Math.sin(A) * (Radius + 9), y: Centre - Math.cos(A) * (Radius + 9) + 3.5, 'text-anchor': 'middle', fill: Text === 'N' ? '#e0e0e0' : '#6c6c6c', 'font-size': 9.5 }, Text));
        }
        Svg.append(
            ConstructSvg('line', { x1: Centre, y1: Centre, x2: Tip[0], y2: Tip[1], stroke: '#e8c27a', 'stroke-width': 2, 'stroke-linecap': 'round' }),
            ConstructSvg('circle', { cx: Tip[0], cy: Tip[1], r: 6.5, fill: '#f2e0ba', stroke: '#111111', 'stroke-width': 2 }),
            ConstructSvg('circle', { cx: Centre, cy: Centre, r: 3, fill: '#ffffff' })
        );
        const Info = Specification.Resolve ? Specification.Resolve() : { Caption: '' };
        Side.textContent = '';
        Side.append(
            Construct('div', 'dial-label', Specification.Label || 'Bearing'),
            Construct('div', 'dial-reading', [document.createTextNode(Bearing.toFixed(0)), Construct('span', null, '°')]),
            Construct('div', 'dial-point', ResolveCompassPoint(Bearing)),
            Info.Caption ? Construct('div', 'dial-caption', Info.Caption) : null
        );
    };
    const BearingAt = Event =>
    {
        const Bounds = Svg.getBoundingClientRect();
        const Scale = Size / Math.max(1, Bounds.width);
        const X = (Event.clientX - Bounds.left) * Scale - Centre, Y = (Event.clientY - Bounds.top) * Scale - Centre;
        return ((Math.round(Math.atan2(X, -Y) * 180 / Math.PI) % 360) + 360) % 360;
    };
    let Dragging = false;
    Svg.addEventListener('pointerdown', Event => { Dragging = true; Svg.setPointerCapture(Event.pointerId); Specification.Write(BearingAt(Event)); Broadcast(); });
    Svg.addEventListener('pointermove', Event => { if (Dragging) { Specification.Write(BearingAt(Event)); Broadcast(); } });
    Svg.addEventListener('pointerup', () => { Dragging = false; });
    Svg.addEventListener('pointercancel', () => { Dragging = false; });
    Register(Refresh);
    return { Panel, Refresh };
}

export function SmoothScroll(Scroller, Content)
{
    let Target = Scroller.scrollTop, Current = Target, Running = false, LastWheel = 0;
    const Limit = () => Math.max(0, Scroller.scrollHeight - Scroller.clientHeight);
    const Advance = Now =>
    {
        const Max = Limit();
        Target = Now - LastWheel > 120 ? Math.min(Math.max(Target, 0), Max) : Math.min(Math.max(Target, -72), Max + 72);
        Current += (Target - Current) * 0.2;
        if (Math.abs(Target - Current) < 0.25) Current = Target;
        const Clamped = Math.min(Math.max(Current, 0), Max);
        Scroller.scrollTop = Clamped;
        const Stretch = Current - Clamped;
        Content.style.transform = Stretch ? `translateY(${(-Stretch * 0.4).toFixed(2)}px)` : '';
        if (Current !== Target || Stretch !== 0) requestAnimationFrame(Advance);
        else Running = false;
    };
    const Start = () => { if (!Running) { Running = true; requestAnimationFrame(Advance); } };
    Scroller.addEventListener('wheel', Event =>
    {
        if (Event.ctrlKey || Math.abs(Event.deltaX) > Math.abs(Event.deltaY)) return;
        Event.preventDefault();
        if (!Running) Current = Target = Scroller.scrollTop;
        Target += Event.deltaMode === 1 ? Event.deltaY * 18 : Event.deltaY;
        LastWheel = performance.now();
        Start();
    }, { passive: false });
    Scroller.addEventListener('scroll', () => { if (!Running) Current = Target = Scroller.scrollTop; });
    return {
        ScrollTo(Position)
        {
            if (!Running) Current = Scroller.scrollTop;
            Target = Math.min(Math.max(Position, 0), Limit());
            LastWheel = 0;
            Start();
        }
    };
}

export { ParticleInfographic, ForceFieldInfographic, DrawWindRoseInfographic } from './ParticleInfographics.js';

export function Toast(Text)
{
    let Element = document.querySelector('.toast');
    if (!Element) { Element = Construct('div', 'toast'); document.body.append(Element); }
    Element.textContent = Text;
    Element.classList.add('shown');
    clearTimeout(Toast.Timer);
    Toast.Timer = setTimeout(() => Element.classList.remove('shown'), 2000);
}
