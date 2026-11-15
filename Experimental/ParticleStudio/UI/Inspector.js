// Particle Studio UI · Inspector dock frame (written from scratch).
// Dock tab, crumbs "Inspector / Group / **Leaf**" with Reset, heading (glass symbol seat, 25 px editable name, type line,
// enable toggle), segmented page tabs, the scrolling page host and the ins-foot (revision + hint).
// The editor supplies data: SetHeading({...}) and SetTabs([[Id, Label]], ActiveId, OnPick).
import { h, Icon } from './Dom.js';

export function CreateInspector(Host)
{
    const Crumbs = h('span', { class: 'ps-crumbs', id: 'inspector-crumb' });
    const Reset = h('button', { class: 'ps-ghost', id: 'reset-selection-btn', type: 'button', title: 'Reset the selection to its preset' }, Icon('Reset'), 'Reset');
    const Seat = h('span', { class: 'ps-ins-seat', id: 'object-symbol' });
    const Name = h('input', { class: 'ps-ins-name', id: 'object-name', maxlength: '64', spellcheck: 'false', 'aria-label': 'Selected node name' });
    const Type = h('span', { class: 'ps-ins-type', id: 'object-type' });
    const Enabled = h('input', { type: 'checkbox', id: 'object-enabled', 'aria-label': 'Enable the selected node' });
    const Toggle = h('label', { class: 'ps-toggle ps-ins-toggle', title: 'Enable / show the selected node' }, Enabled, h('i'));
    const Tabs = h('div', { class: 'ps-seg ps-ins-tabs', id: 'inspector-tabs', role: 'tablist', 'aria-label': 'Inspector pages' });
    const Content = h('div', { class: 'ps-ins-content', id: 'InspectorContent' });
    const Scroll = h('div', { class: 'ps-ins-scroll', id: 'InspectorScroll' }, Content);
    const Revision = h('span', { id: 'inspector-revision' }, 'Revision 0');

    Name.addEventListener('keydown', Ev => { if (Ev.key === 'Enter') Name.blur(); if (Ev.key === 'Escape') { Name.value = Name.dataset.was || Name.value; Name.blur(); } });
    Name.addEventListener('focus', () => { Name.dataset.was = Name.value; });

    Host.append(
        h('header', { class: 'ps-docktabs' }, h('span', { class: 'ps-docktab' }, 'Inspector', h('i', { class: 'ps-docktab-x' }, '×'))),
        h('div', { class: 'ps-ins-head' },
            h('div', { class: 'ps-ins-crumbrow' }, Crumbs, Reset),
            h('div', { class: 'ps-ins-heading', id: 'object-heading' }, Seat, h('div', { class: 'ps-ins-copy' }, Name, Type), Toggle),
            Tabs),
        Scroll,
        h('footer', { class: 'ps-ins-foot' }, Revision, h('span', null, 'Changes apply live')));

    return {
        // { Crumb: 'Inspector / A / B', Name, Editable, OnRename(Name), Type, Glyph, Colour, Enabled, OnToggle(Bool) }
        SetHeading(Spec)
        {
            const Parts = String(Spec.Crumb || 'Inspector').split(' / ');
            Crumbs.textContent = '';
            Parts.forEach((Part, I) =>
            {
                if (I) Crumbs.append(h('i', null, '/'));
                Crumbs.append(I === Parts.length - 1 ? h('b', null, Part) : h('span', null, Part));
            });
            Name.value = Spec.Name || '';
            Name.disabled = !Spec.Editable;
            Name.title = Spec.Name || '';
            Name.onchange = Spec.Editable && Spec.OnRename ? () => Spec.OnRename(Name.value.trim()) : null;
            Type.textContent = Spec.Type || '';
            Seat.textContent = '';
            Seat.append(Icon(Spec.Glyph || 'Dot'));
            Seat.style.setProperty('--ink', Spec.Colour || '#dec193');
            Enabled.disabled = !Spec.OnToggle;
            Enabled.checked = !!Spec.Enabled;
            Enabled.onchange = Spec.OnToggle ? () => Spec.OnToggle(Enabled.checked) : null;
        },
        SetTabs(Defs, ActiveId, OnPick)
        {
            Tabs.textContent = '';
            Tabs.hidden = !Defs || !Defs.length;
            for (const [Id, Label] of Defs || [])
            {
                const On = Id === ActiveId;
                const Btn = h('button', { type: 'button', role: 'tab', class: On ? 'on' : null, 'aria-selected': String(On) }, Label);
                Btn.addEventListener('click', () => OnPick(Id));
                Tabs.append(Btn);
            }
        }
    };
}
