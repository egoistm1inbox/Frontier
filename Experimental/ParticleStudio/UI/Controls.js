// Particle Studio UI · inspector control kit (written from scratch).
// Project Zero editor rules, same as the Fracture Editor: collapsible uppercase section heads, one rounded gradient panel
// per section, label + black amount field + full-width drag track, segmented controls, colour-tagged XYZ fields, glass
// quick tiles, wide action buttons and a floating pick menu that is never clipped by the inspector scroller.
// Every control keeps the editor's binding contract: { Label, Read, Write, Availability?, … }.
import { h, Icon, Availability } from './Dom.js';
import { Register, Broadcast } from './Runtime.js';

const SectionMemory = new Map();
const DigitsFor = Step => Step >= 1 ? 0 : Step >= 0.1 ? 1 : Step >= 0.01 ? 2 : 3;
const Clamp = (V, Lo, Hi) => Math.min(Hi, Math.max(Lo, V));

function ApplyState(Root, Binding, Disable)
{
    const State = Availability(Binding);
    Root.classList.toggle('ps-locked', !State.Enabled);
    if (!State.Enabled && State.Reason) Root.title = State.Reason;
    else Root.removeAttribute('title');
    if (Disable) Disable(!State.Enabled);
    return State;
}

//------------------------------------------------------------------------------------------------------------------------
// Section · <section.ps-sec> > button.ps-sec-head (chevron, glyph, h3, small) + .ps-sec-body > .ps-panel
//------------------------------------------------------------------------------------------------------------------------
export function Section(Parent, { Id, Title, Glyph, Status, Badge, Hint, Open = true })
{
    const Key = Id || Title;
    const Shut = SectionMemory.has(Key) ? SectionMemory.get(Key) : !Open;
    const Tag = h('small', { class: 'ps-sec-tag' }, typeof Status === 'string' ? Status : (Badge || ''));
    const Head = h('button', { class: 'ps-sec-head', type: 'button', 'aria-expanded': String(!Shut) },
        Icon('Chevron', 'glyph ps-sec-chev'),
        Glyph ? h('span', { class: 'ps-sec-glyph' }, Icon(Glyph)) : null,
        h('h3', null, Title),
        Tag);
    const Panel = h('div', { class: 'ps-panel' });
    if (Hint) Panel.append(h('p', { class: 'ps-note' }, Hint));
    const Root = h('section', { class: 'ps-sec' + (Shut ? ' shut' : ''), 'data-section': Id || null }, Head, h('div', { class: 'ps-sec-body' }, Panel));
    Head.addEventListener('click', () =>
    {
        const Now = Root.classList.toggle('shut');
        SectionMemory.set(Key, Now);
        Head.setAttribute('aria-expanded', String(!Now));
    });
    Parent.append(Root);
    if (typeof Status === 'function') Register(() => { Tag.textContent = Status(); });
    return { Card: Root, Inner: Panel };
}

export function Note(Parent, Text)
{
    const El = h('p', { class: 'ps-note' }, Text);
    Parent.append(El);
    return El;
}

export function TileGrid()
{
    return h('div', { class: 'ps-tiles' });
}

//------------------------------------------------------------------------------------------------------------------------
// Drag track (shared by Slider and the Colour alpha): pointer drag anywhere on the track, arrow keys, Home / End.
//------------------------------------------------------------------------------------------------------------------------
function DragTrack({ Label, Minimum, Maximum, Step, OnValue })
{
    const Fill = h('i', { class: 'ps-track-fill' });
    const Knob = h('b', { class: 'ps-track-knob' });
    const Track = h('div', { class: 'ps-track', role: 'slider', tabindex: '0', 'aria-label': Label, 'aria-valuemin': Minimum, 'aria-valuemax': Maximum },
        h('span', { class: 'ps-track-rail' }, Fill), Knob);
    let Value = Minimum, Locked = false;
    const Span = (Maximum - Minimum) || 1;
    const Show = V =>
    {
        Value = V;
        Track.style.setProperty('--f', Clamp((V - Minimum) / Span, 0, 1).toFixed(4));
        Track.setAttribute('aria-valuenow', String(V));
    };
    const FromPointer = Ev =>
    {
        const R = Track.getBoundingClientRect();
        const F = Clamp((Ev.clientX - R.left - 7) / Math.max(1, R.width - 14), 0, 1);
        return Math.round((Minimum + F * Span) / Step) * Step;
    };
    Track.addEventListener('pointerdown', Ev =>
    {
        if (Locked || Ev.button !== 0) return;
        Track.setPointerCapture(Ev.pointerId);
        Track.classList.add('drag');
        OnValue(FromPointer(Ev));
    });
    Track.addEventListener('pointermove', Ev => { if (Track.hasPointerCapture(Ev.pointerId)) OnValue(FromPointer(Ev)); });
    const End = Ev => { if (Track.hasPointerCapture?.(Ev.pointerId)) Track.releasePointerCapture(Ev.pointerId); Track.classList.remove('drag'); };
    Track.addEventListener('pointerup', End);
    Track.addEventListener('pointercancel', End);
    Track.addEventListener('keydown', Ev =>
    {
        if (Locked) return;
        const Big = Ev.shiftKey ? 10 : 1;
        let Next = null;
        if (Ev.key === 'ArrowRight' || Ev.key === 'ArrowUp') Next = Value + Step * Big;
        else if (Ev.key === 'ArrowLeft' || Ev.key === 'ArrowDown') Next = Value - Step * Big;
        else if (Ev.key === 'Home') Next = Minimum;
        else if (Ev.key === 'End') Next = Maximum;
        if (Next === null) return;
        Ev.preventDefault();
        OnValue(Clamp(Next, Minimum, Maximum));
    });
    return {
        El: Track, Show,
        Lock: L => { Locked = L; Track.tabIndex = L ? -1 : 0; Track.setAttribute('aria-disabled', String(L)); }
    };
}

// Drag on a label / axis tag to scrub a number (Shift = fine, Alt = coarse).
function Scrubber(Handle, { Read, Span, Step, Commit, IsLocked })
{
    let Start = null;
    Handle.classList.add('ps-scrub');
    Handle.addEventListener('pointerdown', Ev =>
    {
        if (IsLocked() || Ev.button !== 0) return;
        Start = { X: Ev.clientX, V: Number(Read()) || 0 };
        Handle.setPointerCapture(Ev.pointerId);
    });
    Handle.addEventListener('pointermove', Ev =>
    {
        if (!Start) return;
        const Factor = Ev.shiftKey ? 0.15 : Ev.altKey ? 4 : 1;
        const Next = Start.V + ((Ev.clientX - Start.X) / 220) * Span * Factor;
        Commit(Math.round(Next / Step) * Step);
    });
    const Stop = () => { Start = null; };
    Handle.addEventListener('pointerup', Stop);
    Handle.addEventListener('pointercancel', Stop);
}

function NumberField(Unit, Label)
{
    const Input = h('input', { class: 'ps-amount-in', type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': Label });
    Input.addEventListener('keydown', Ev => { if (Ev.key === 'Enter') Input.blur(); if (Ev.key === 'Escape') { Input.dataset.cancel = '1'; Input.blur(); } });
    const Root = h('span', { class: 'ps-amount' }, Input, h('em', null, Unit || '·'));
    return { Root, Input };
}

//------------------------------------------------------------------------------------------------------------------------
// Slider · label (scrubbable) + amount field on one line, full-width drag track under it
//------------------------------------------------------------------------------------------------------------------------
export function Slider(Parent, Binding)
{
    const Minimum = Binding.Minimum, Maximum = Binding.Maximum;
    const Step = Binding.Step ?? 0.01;
    const Digits = Binding.Digits ?? DigitsFor(Step);
    const Snap = V => { const P = Math.pow(10, Digits + 2); return Math.round(Clamp(V, Minimum, Maximum) * P) / P; };
    let Locked = false;

    const Commit = Raw =>
    {
        if (!Number.isFinite(Raw) || Locked) return;
        const V = Snap(Raw);
        Binding.Write(V);
        Track.Show(V);
        Broadcast();
    };
    const Label = h('span', { class: 'ps-label' }, Binding.Label);
    const Amount = NumberField(Binding.Unit, Binding.Label);
    const Track = DragTrack({ Label: Binding.Label, Minimum, Maximum, Step, OnValue: Commit });
    const Row = h('div', { class: 'ps-field ps-field-slider' }, Label, Amount.Root, Track.El);
    Parent.append(Row);

    Amount.Input.addEventListener('change', () =>
    {
        if (Amount.Input.dataset.cancel) { delete Amount.Input.dataset.cancel; return; }
        Commit(Number(Amount.Input.value.replace(',', '.')));
    });
    Scrubber(Label, { Read: Binding.Read, Span: Maximum - Minimum, Step, Commit, IsLocked: () => Locked });

    Register(() =>
    {
        const V = Number(Binding.Read());
        const Safe = Number.isFinite(V) ? V : Minimum;
        Track.Show(Safe);
        if (document.activeElement !== Amount.Input) Amount.Input.value = Safe.toFixed(Digits);
        ApplyState(Row, Binding, Off => { Locked = Off; Track.Lock(Off); Amount.Input.disabled = Off; });
    });
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
// Switch · label + optional detail, compact toggle at the right
//------------------------------------------------------------------------------------------------------------------------
export function Switch(Parent, Binding)
{
    const Input = h('input', { type: 'checkbox', 'aria-label': Binding.Label });
    const Row = h('label', { class: 'ps-field ps-field-switch' },
        h('span', { class: 'ps-copy' }, h('span', { class: 'ps-label' }, Binding.Label), Binding.Detail ? h('small', { class: 'ps-detail' }, Binding.Detail) : null),
        h('span', { class: 'ps-toggle' }, Input, h('i')));
    Parent.append(Row);
    Input.addEventListener('change', () => { Binding.Write(Input.checked); Broadcast(); });
    Register(() =>
    {
        Input.checked = !!Binding.Read();
        ApplyState(Row, Binding, Off => { Input.disabled = Off; });
    });
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
// Pick menu · one floating list on <body>, positioned against its face, flips upward when space runs out
//------------------------------------------------------------------------------------------------------------------------
let OpenMenuState = null;

export function CloseMenu()
{
    if (!OpenMenuState) return;
    OpenMenuState.Menu.remove();
    OpenMenuState.Face.classList.remove('open');
    OpenMenuState.Face.setAttribute('aria-expanded', 'false');
    OpenMenuState = null;
}

// Sections: [{ Title?, Items: [[Label, Value], …] }]
export function OpenMenu(Face, Sections, Current, OnPick, { Width } = {})
{
    const Again = OpenMenuState && OpenMenuState.Face === Face;
    CloseMenu();
    if (Again) return;
    const Menu = h('div', { class: 'ps-menu', role: 'listbox' });
    const Buttons = [];
    for (const Sec of Sections)
    {
        if (Sec.Title) Menu.append(h('div', { class: 'ps-menu-title' }, Sec.Title));
        const Grid = h('div', { class: 'ps-menu-items' + (Sec.Columns ? ' cols' : '') });
        for (const [Label, Value] of Sec.Items)
        {
            const On = String(Value) === String(Current);
            const Btn = h('button', { class: 'ps-menu-item' + (On ? ' on' : ''), type: 'button', role: 'option', 'aria-selected': String(On) },
                h('span', null, Label), On ? Icon('Check', 'glyph ps-menu-check') : null);
            Btn.addEventListener('click', () => { CloseMenu(); OnPick(Value); });
            Grid.append(Btn);
            Buttons.push(Btn);
        }
        Menu.append(Grid);
    }
    document.body.append(Menu);
    const R = Face.getBoundingClientRect();
    const W = Math.max(R.width, Width || 0);
    Menu.style.width = W + 'px';
    Menu.style.left = Clamp(R.right - W, 8, innerWidth - W - 8) + 'px';
    const Room = innerHeight - R.bottom - 12;
    const Want = Math.min(Menu.scrollHeight, 340);
    if (Room < Want && R.top > Room) { Menu.style.bottom = (innerHeight - R.top + 6) + 'px'; Menu.style.maxHeight = Math.min(340, R.top - 12) + 'px'; }
    else { Menu.style.top = (R.bottom + 6) + 'px'; Menu.style.maxHeight = Math.max(160, Room) + 'px'; }
    Face.classList.add('open');
    Face.setAttribute('aria-expanded', 'true');
    OpenMenuState = { Menu, Face };
    (Buttons.find(B => B.classList.contains('on')) || Buttons[0])?.focus({ preventScroll: true });
    Buttons.find(B => B.classList.contains('on'))?.scrollIntoView({ block: 'nearest' });
    Menu.addEventListener('keydown', Ev =>
    {
        const I = Buttons.indexOf(document.activeElement);
        if (Ev.key === 'ArrowDown') { Ev.preventDefault(); Buttons[Math.min(Buttons.length - 1, I + 1)]?.focus(); }
        else if (Ev.key === 'ArrowUp') { Ev.preventDefault(); Buttons[Math.max(0, I - 1)]?.focus(); }
        else if (Ev.key === 'Escape') { Ev.preventDefault(); CloseMenu(); Face.focus(); }
    });
}

addEventListener('pointerdown', Ev =>
{
    if (OpenMenuState && !OpenMenuState.Menu.contains(Ev.target) && !OpenMenuState.Face.contains(Ev.target)) CloseMenu();
}, true);
addEventListener('scroll', Ev => { if (OpenMenuState && !OpenMenuState.Menu.contains(Ev.target)) CloseMenu(); }, true);
addEventListener('resize', CloseMenu);

export function PickFace(Label)
{
    const Text = h('span', { class: 'ps-pick-text' });
    const Face = h('button', { class: 'ps-pick', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': Label },
        Text, Icon('Chevron', 'glyph ps-pick-chev'));
    return { Face, Text };
}

//------------------------------------------------------------------------------------------------------------------------
// Select · label + pick face
//------------------------------------------------------------------------------------------------------------------------
export function Select(Parent, Binding)
{
    const { Face, Text } = PickFace(Binding.Label);
    const Row = h('div', { class: 'ps-field ps-field-pick' }, h('span', { class: 'ps-label' }, Binding.Label), Face);
    Parent.append(Row);
    Face.addEventListener('click', () =>
    {
        if (Face.disabled) return;
        OpenMenu(Face, [{ Items: Binding.Options }], Binding.Read(), Value => { Binding.Write(Value); Broadcast(); }, { Width: 210 });
    });
    Register(() =>
    {
        const Cur = String(Binding.Read());
        const Found = Binding.Options.find(([, V]) => String(V) === Cur);
        Text.textContent = Found ? Found[0] : Cur;
        ApplyState(Row, Binding, Off => { Face.disabled = Off; });
    });
    return Row;
}

export function Text(Parent, Binding)
{
    const Input = h('input', { class: 'ps-text', type: 'text', spellcheck: 'false', 'aria-label': Binding.Label });
    const Row = h('div', { class: 'ps-field ps-field-pick' }, h('span', { class: 'ps-label' }, Binding.Label), Input);
    Parent.append(Row);
    Input.addEventListener('change', () => { Binding.Write(Input.value); Broadcast(); });
    Register(() => { if (document.activeElement !== Input) Input.value = String(Binding.Read() ?? ''); });
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
// Segmented · label over a full-width segment track
//------------------------------------------------------------------------------------------------------------------------
function SegTrack(Options, OnPick)
{
    const Track = h('div', { class: 'ps-seg', role: 'tablist' });
    const Buttons = Options.map(([Label, Value]) =>
    {
        const Btn = h('button', { type: 'button', role: 'tab' }, Label);
        Btn.addEventListener('click', () => { if (!Btn.disabled) OnPick(Value); });
        Track.append(Btn);
        return [Btn, Value];
    });
    return { Track, Sync: Cur => Buttons.forEach(([B, V]) => { const On = Cur === V; B.classList.toggle('on', On); B.setAttribute('aria-selected', String(On)); }), Buttons };
}

export function Segmented(Parent, Binding)
{
    const Seg = SegTrack(Binding.Options, Value => { Binding.Write(Value); Broadcast(); });
    const Row = h('div', { class: 'ps-field ps-field-stack' }, h('span', { class: 'ps-label' }, Binding.Label), Seg.Track);
    Parent.append(Row);
    Register(() =>
    {
        Seg.Sync(Binding.Read());
        ApplyState(Row, Binding, Off => Seg.Buttons.forEach(([B]) => { B.disabled = Off; }));
    });
    return Row;
}

export function Tabs(Parent, Binding)
{
    const Seg = SegTrack(Binding.Options, Value => { Binding.Write(Value); Broadcast(); });
    Seg.Track.classList.add('ps-seg-tabs');
    Parent.append(Seg.Track);
    Register(() => Seg.Sync(Binding.Read()));
    return Seg.Track;
}

//------------------------------------------------------------------------------------------------------------------------
// Vector · label + unit, three colour-tagged fields; drag an axis tag to scrub that component
//------------------------------------------------------------------------------------------------------------------------
export function Vector(Parent, Binding)
{
    const Step = Binding.Step ?? 0.05;
    const Digits = Binding.Digits ?? 2;
    const Lo = Binding.Minimum ?? -Infinity, Hi = Binding.Maximum ?? Infinity;
    const Grid = h('div', { class: 'ps-xyz' });
    const WriteAxis = (I, V) =>
    {
        const Vec = (Binding.Read() || [0, 0, 0]).slice();
        Vec[I] = Clamp(Number.isFinite(V) ? V : 0, Lo, Hi);
        Binding.Write(Vec);
        Broadcast();
    };
    const Inputs = ['X', 'Y', 'Z'].map((Axis, I) =>
    {
        const Tag = h('em', null, Axis);
        const Input = h('input', { type: 'text', inputmode: 'decimal', spellcheck: 'false', 'aria-label': `${Binding.Label} ${Axis}` });
        Input.addEventListener('keydown', Ev => { if (Ev.key === 'Enter') Input.blur(); });
        Input.addEventListener('change', () => WriteAxis(I, Number(Input.value.replace(',', '.'))));
        Scrubber(Tag, { Read: () => (Binding.Read() || [0, 0, 0])[I], Span: Number.isFinite(Hi - Lo) ? Hi - Lo : Step * 200, Step, Commit: V => WriteAxis(I, V), IsLocked: () => false });
        Grid.append(h('label', { class: 'ps-axis-' + Axis.toLowerCase() }, Tag, Input));
        return Input;
    });
    const Row = h('div', { class: 'ps-field ps-field-stack' },
        h('span', { class: 'ps-label-line' }, h('span', { class: 'ps-label' }, Binding.Label), Binding.Unit ? h('small', { class: 'ps-unit' }, Binding.Unit) : null),
        Grid);
    Parent.append(Row);
    Register(() =>
    {
        const Vec = Binding.Read() || [0, 0, 0];
        Inputs.forEach((Input, I) => { if (document.activeElement !== Input) Input.value = Number(Vec[I] ?? 0).toFixed(Digits); });
    });
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
// Colour · label, swatch (native picker underneath), editable hex, optional alpha drag track
//------------------------------------------------------------------------------------------------------------------------
const ToLinear = V => V <= 0.04045 ? V / 12.92 : Math.pow((V + 0.055) / 1.055, 2.4);
const ToDisplay = V => V <= 0.0031308 ? 12.92 * V : 1.055 * Math.pow(V, 1 / 2.4) - 0.055;
const HexOf = Lin => '#' + [0, 1, 2].map(I => Math.round(Clamp(ToDisplay(Clamp(Lin[I] ?? 1, 0, 1)), 0, 1) * 255).toString(16).padStart(2, '0')).join('');
const LinearOf = Hex => [1, 3, 5].map(I => ToLinear(parseInt(Hex.slice(I, I + 2), 16) / 255));

export function Colour(Parent, Binding)
{
    const Picker = h('input', { type: 'color', 'aria-label': Binding.Label });
    const Swatch = h('label', { class: 'ps-swatch' }, Picker);
    const Hex = h('input', { class: 'ps-hex', type: 'text', maxlength: '7', spellcheck: 'false', 'aria-label': `${Binding.Label} hex` });
    const Alpha = h('small', { class: 'ps-unit' });
    const Row = h('div', { class: 'ps-field ps-field-colour' },
        h('span', { class: 'ps-label' }, Binding.Label),
        h('span', { class: 'ps-colour' }, Binding.Alpha ? Alpha : null, Hex, Swatch));
    const WriteHex = Value =>
    {
        if (!/^#[0-9a-f]{6}$/i.test(Value)) return;
        const Prev = Binding.Read() || [1, 1, 1, 1];
        Binding.Write([...LinearOf(Value), Prev[3] ?? 1]);
        Broadcast();
    };
    Picker.addEventListener('input', () => WriteHex(Picker.value));
    Hex.addEventListener('keydown', Ev => { if (Ev.key === 'Enter') Hex.blur(); });
    Hex.addEventListener('change', () => WriteHex(Hex.value.startsWith('#') ? Hex.value : '#' + Hex.value));
    let Track = null;
    if (Binding.Alpha)
    {
        Track = DragTrack({ Label: `${Binding.Label} opacity`, Minimum: 0, Maximum: 1, Step: 0.01, OnValue: A =>
        {
            const Lin = (Binding.Read() || [1, 1, 1, 1]).slice();
            Lin[3] = A;
            Binding.Write(Lin);
            Broadcast();
        } });
        Track.El.classList.add('ps-track-alpha');
        Row.append(Track.El);
    }
    Parent.append(Row);
    Register(() =>
    {
        const Lin = Binding.Read() || [1, 1, 1, 1];
        const Value = HexOf(Lin);
        Picker.value = Value;
        Swatch.style.setProperty('--swatch', Value);
        if (document.activeElement !== Hex) Hex.value = Value;
        if (Track)
        {
            const A = Number(Lin[3] ?? 1);
            Track.Show(A);
            Track.El.style.setProperty('--swatch', Value);
            Alpha.textContent = `${Math.round(A * 100)}%`;
        }
    });
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
// Quick tile · glass tile with a lit seat, name and ON / OFF / LOCKED state (place inside TileGrid())
//------------------------------------------------------------------------------------------------------------------------
export function Tile(Parent, Binding)
{
    const State = h('small');
    const Tile = h('button', { class: 'ps-qt', type: 'button', 'aria-pressed': 'false' },
        h('span', { class: 'ps-qt-seat' }, Icon(Binding.Glyph || 'Check')),
        h('b', null, Binding.Label),
        State);
    Tile.addEventListener('click', () =>
    {
        if (!Availability(Binding).Enabled) return;
        Binding.Write(!Binding.Read());
        Broadcast();
    });
    Parent.append(Tile);
    Register(() =>
    {
        const On = !!Binding.Read();
        const Avail = ApplyState(Tile, Binding, Off => { Tile.disabled = Off; });
        Tile.classList.toggle('on', On && Avail.Enabled);
        Tile.setAttribute('aria-pressed', String(On));
        State.textContent = !Avail.Enabled ? 'Locked' : On ? 'On' : 'Off';
    });
    return Tile;
}

//------------------------------------------------------------------------------------------------------------------------
// Actions · equal-width wide buttons; Tone 'accent' (amber) or 'danger' (red)
//------------------------------------------------------------------------------------------------------------------------
export function Actions(Parent, List)
{
    const Row = h('div', { class: 'ps-actions' });
    for (const Act of List)
    {
        const Btn = h('button', { class: 'ps-act' + (Act.Tone ? ' ' + Act.Tone : ''), type: 'button' },
            Act.Glyph ? Icon(Act.Glyph) : null, h('span', null, Act.Label));
        Btn.addEventListener('click', () => { if (!Btn.disabled) { Act.Act(); Broadcast(); } });
        Row.append(Btn);
        if (Act.Availability) Register(() =>
        {
            const St = Act.Availability() || { Enabled: true };
            Btn.disabled = !St.Enabled;
            if (!St.Enabled && St.Reason) Btn.title = St.Reason;
            else Btn.removeAttribute('title');
        });
    }
    Parent.append(Row);
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
// Chips · multi-select toggles with an optional live detail line
//------------------------------------------------------------------------------------------------------------------------
export function Chips(Parent, Binding)
{
    const Grid = h('div', { class: 'ps-chips' });
    const Detail = h('small', { class: 'ps-detail' });
    const Chips = Binding.Options.map(([Label, Key]) =>
    {
        const Btn = h('button', { class: 'ps-chip', type: 'button' }, Label);
        Btn.addEventListener('click', () =>
        {
            const Cur = new Set(Binding.Read());
            if (Cur.has(Key)) Cur.delete(Key); else Cur.add(Key);
            Binding.Write([...Cur]);
            Broadcast();
        });
        Grid.append(Btn);
        return [Btn, Key];
    });
    const Row = h('div', { class: 'ps-field ps-field-stack' }, h('span', { class: 'ps-label' }, Binding.Label), Grid, Detail);
    Parent.append(Row);
    Register(() =>
    {
        const Active = new Set(Binding.Read());
        Chips.forEach(([B, K]) => B.classList.toggle('on', Active.has(K)));
        Detail.textContent = Binding.Detail ? Binding.Detail([...Active]) : '';
        Detail.hidden = !Detail.textContent;
    });
    return Row;
}

//------------------------------------------------------------------------------------------------------------------------
// Stats · row of glass stat tiles (label, large thin number, sub line); Highlight → warm tile
//------------------------------------------------------------------------------------------------------------------------
export function Stats(Parent, Items)
{
    const Grid = h('div', { class: 'ps-stats' });
    const Updates = Items.map(Item =>
    {
        const Num = h('b', { class: 'ps-stat-num' });
        const Sub = h('small');
        Grid.append(h('div', { class: 'ps-stat' + (Item.Highlight ? ' warm' : '') }, h('label', null, Item.Label), Num, Sub));
        return () =>
        {
            const [Value, Foot] = Item.Resolve();
            Num.textContent = Value;
            Sub.textContent = Foot || '';
        };
    });
    Parent.append(Grid);
    const Refresh = () => Updates.forEach(U => U());
    Register(Refresh);
    return { Grid, Refresh };
}
