// Particle Studio UI · Outliner dock (written from scratch).
// Dock tab, thin h1 heading with scope line, compact + add round buttons, glass Visible / Hidden tiles with large thin
// numbers, search + one filter pick, a collapsible tree of groups (chevron, isometric icon seat, title / subtitle, count)
// with sub-heads and node rows, and a host for the status strip at the foot.
// The editor supplies data only: Render([{ Key, Title, Glyph, Subtitle, Count, Items: [Row | { Subhead, Count }] }]).
import { h, Icon, SetIcon } from './Dom.js';
import { Register, Broadcast } from './Runtime.js';
import { OpenMenu } from './Controls.js';

const StateNames = { Active: 'active', Waiting: 'waiting', Armed: 'armed', Spent: 'spent', Off: 'off' };

export function CreateOutliner(Host)
{
    const Collapsed = new Set();
    let Query = '';
    let Filters = [];
    let FilterValue = 'all';
    const Api = { OnSelect: null, OnFilter: null, OnQuery: null, IsSelected: () => false };

    // ── head ──
    const Scope = h('span', { class: 'ps-ol-scope', id: 'outliner-subtitle' }, 'Particle scene');
    const CompactBtn = h('button', { class: 'ps-round', id: 'compact-outliner', type: 'button', title: 'Compact outliner (hide the tiles)', 'aria-pressed': 'false' }, Icon('Compact'));
    const AddBtn = h('button', { class: 'ps-round light', id: 'add-button', type: 'button', title: 'Add particle asset, force field, formula or layer', 'aria-expanded': 'false' }, Icon('Plus'));

    // ── stat tiles ──
    const Tile = (Id, MarkId, Mark, Glyph, Label) => h('div', { class: 'ps-ol-stat' },
        h('span', { class: 'ps-ol-mark ' + Mark, id: MarkId }, Icon(Glyph)),
        h('span', { class: 'ps-ol-stat-label' }, Label),
        h('b', { id: Id }, '0'));

    // ── tools ──
    const Search = h('input', { type: 'search', id: 'scene-search', placeholder: 'Search', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search the scene' });
    Search.addEventListener('input', () => { Query = Search.value.trim().toLowerCase(); Api.OnQuery?.(Query); Broadcast(); });
    const FilterText = h('span', { class: 'ps-pick-text' }, 'All');
    const FilterFace = h('button', { class: 'ps-pick ps-ol-filter', id: 'scene-filter-face', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', title: 'Show one part of the scene' },
        Icon('Sliders', 'glyph ps-pick-lead'), FilterText, Icon('Chevron', 'glyph ps-pick-chev'));
    FilterFace.addEventListener('click', () => OpenMenu(FilterFace, Filters, FilterValue, Value => Api.SetFilter(Value, true), { Width: 248 }));

    // ── tree + status ──
    const Content = h('div', { class: 'ps-ol-content', id: 'OutlinerContent' });
    const Scroll = h('div', { class: 'ps-ol-tree', id: 'OutlinerScroll' }, Content);
    const StatusHost = h('footer', { class: 'ps-ol-foot' });

    Host.append(
        h('header', { class: 'ps-docktabs' }, h('span', { class: 'ps-docktab' }, 'Outliner', h('i', { class: 'ps-docktab-x' }, '×'))),
        h('div', { class: 'ps-ol-head' }, h('h1', null, 'Outliner'), Scope, CompactBtn, AddBtn),
        h('div', { class: 'ps-ol-stats' },
            Tile('visible-count', 'stat-visible-icon', 'ok', 'Check', 'Visible'),
            Tile('hidden-count', 'stat-hidden-icon', 'idle', 'EyeOff', 'Hidden')),
        h('div', { class: 'ps-ol-tools' },
            h('label', { class: 'ps-search' }, h('span', { id: 'search-icon-slot' }, Icon('Search')), Search, h('kbd', null, 'Ctrl F')),
            FilterFace),
        Scroll,
        StatusHost);

    Api.StatusHost = StatusHost;

    // Filters: [{ Title, Items: [[Label, Value]], Columns? }]
    Api.SetFilters = List => { Filters = List; Api.SetFilter(FilterValue, false); };
    Api.SetFilter = (Value, Notify) =>
    {
        FilterValue = Value;
        const Found = Filters.flatMap(S => S.Items).find(([, V]) => V === Value);
        FilterText.textContent = Found ? Found[0] : 'All';
        FilterFace.classList.toggle('filtered', Value !== 'all');
        if (Notify) Api.OnFilter?.(Value);
    };
    Api.SetScope = Text => { Scope.textContent = Text; };

    const Matches = Row => !Query || `${Row.Name()} ${Row.Meta()}`.toLowerCase().includes(Query);

    function NodeRow(Row)
    {
        const Name = h('b');
        const Meta = h('small');
        const State = Row.Status ? h('span', { class: 'ps-node-state' }) : null;
        const Eye = h('button', { class: 'ps-node-eye' + (Row.Locked ? ' locked' : ''), type: 'button',
            title: Row.Locked ? 'Permanent scene node (cannot be hidden)' : 'Show / hide' });
        const Main = h('button', { class: 'ps-node-main', type: 'button' },
            h('span', { class: 'ps-node-seat' }, Icon(Row.Glyph || 'Dot')),
            h('span', { class: 'ps-node-copy' }, Name, Meta));
        const El = h('div', { class: 'ps-node' + (Row.Depth ? ' nested' : ''), role: 'treeitem' }, Main, State, Eye);
        Main.addEventListener('click', () => Api.OnSelect?.(Row.Id));
        Eye.addEventListener('click', Ev => { Ev.stopPropagation(); if (!Row.Locked) { Row.Flip(); Broadcast(); } });
        let LastOn = null;
        Register(() =>
        {
            const On = !!Row.Enabled();
            El.style.setProperty('--ink', Row.Colour());
            El.classList.toggle('sel', Api.IsSelected(Row.Id));
            El.classList.toggle('off', !On);
            El.setAttribute('aria-selected', String(Api.IsSelected(Row.Id)));
            Name.textContent = Row.Name();
            Meta.textContent = Row.Meta();
            if (State)
            {
                const Key = StateNames[Row.Status()] || 'off';
                State.textContent = Key;
                State.className = 'ps-node-state ' + Key;
            }
            if (LastOn !== On) { SetIcon(Eye, Row.Locked ? 'Lock' : On ? 'Eye' : 'EyeOff'); LastOn = On; }
            El.hidden = !Matches(Row);
        });
        return { El, Row };
    }

    Api.Render = Groups =>
    {
        Content.textContent = '';
        for (const Group of Groups)
        {
            const Body = h('div', { class: 'ps-grp-body', role: 'group' });
            const Head = h('button', { class: 'ps-grp-head', type: 'button', 'aria-expanded': String(!Collapsed.has(Group.Key)) },
                Icon('Chevron', 'glyph ps-grp-chev'),
                h('span', { class: 'ps-grp-seat' }, Icon(Group.Glyph || 'Folder')),
                h('span', { class: 'ps-grp-copy' }, h('b', null, Group.Title), h('small', null, Group.Subtitle || '')),
                h('em', null, String(Group.Count)));
            const Root = h('div', { class: 'ps-grp' + (Collapsed.has(Group.Key) ? ' shut' : '') }, Head, Body);
            Head.addEventListener('click', () =>
            {
                const Shut = Root.classList.toggle('shut');
                if (Shut) Collapsed.add(Group.Key); else Collapsed.delete(Group.Key);
                Head.setAttribute('aria-expanded', String(!Shut));
            });
            let Sub = null, SubRows = [];
            const CloseSub = () => { if (Sub) { const Rows = SubRows; const El = Sub; Register(() => { El.hidden = !Rows.some(Matches); }); } };
            for (const Item of Group.Items)
            {
                if (Item.Subhead)
                {
                    CloseSub();
                    Sub = h('div', { class: 'ps-sub' }, h('span', null, Item.Subhead), h('em', null, String(Item.Count)));
                    SubRows = [];
                    Body.append(Sub);
                    continue;
                }
                const Node = NodeRow(Item);
                SubRows.push(Item);
                Body.append(Node.El);
            }
            CloseSub();
            if (!Group.Items.length) Body.append(h('p', { class: 'ps-ol-empty' }, 'Nothing here yet'));
            Content.append(Root);
        }
        if (!Groups.length) Content.append(h('p', { class: 'ps-ol-empty' }, 'No nodes match this filter'));
    };

    return Api;
}
