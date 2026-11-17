/* Frontier. Asset Browser prototype: one generic browser over all six workspace catalogues. */
import { ASSET_CATALOG } from './AssetCatalog.js';

/* ------------------------------------------------------------------ icons */
const P = (inner, vb = '0 0 24 24') =>
    `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS = {
    zap: P(`<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>`),
    cloud: P(`<path d="M7 19a4.5 4.5 0 1 1 .7-8.94A6 6 0 0 1 19.2 12 3.5 3.5 0 0 1 18 19z"/>`),
    leaf: P(`<path d="M5 19C5 9 12 4 20 4c0 9-5 15-14 15M5 19c3-5 7-9 12-11"/>`),
    atom: P(`<circle cx="12" cy="12" r="1.4"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>`),
    flame: P(`<path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 1-3.5s.6 1.2 1.6 1.2c0-2.5 1-4.5 2.4-6.7z"/><path d="M12 21a3 3 0 0 1-3-3c0-1.2.7-2.3 1.6-3.1.5 1 1.2 1.6 2 1.9-.3-1.2-.2-2.6.4-4 1.4 1.6 2 3.3 2 5.2a3 3 0 0 1-3 3z"/>`),
    blast: P(`<circle cx="12" cy="12" r="2.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>`),
    puff: P(`<circle cx="9" cy="13" r="3.4"/><circle cx="15" cy="11" r="4.2"/><circle cx="16.5" cy="15.5" r="2.6"/>`),
    tornado: P(`<path d="M5 4h14M7 8.5h10M9 13h6M10.5 17.5h3M12 21v.5"/>`),
    boxes: P(`<rect x="3" y="8" width="8" height="8" rx="1"/><rect x="13" y="8" width="8" height="8" rx="1"/><path d="M7 8V5h10v3"/>`),
    box: P(`<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>`),
    wind: P(`<path d="M3 8h11a2.5 2.5 0 1 0-2.4-3.2M3 12h15a2.5 2.5 0 1 1-2.4 3.2M3 16h8"/>`),
    jet: P(`<path d="M3 12l17-6-5 6 5 6z"/><path d="M3 12h6"/>`),
    front: P(`<path d="M4 18a8 8 0 0 1 16 0"/><path d="M12 10V4M9 6l3-2 3 2"/>`),
    downburst: P(`<path d="M12 3v10M8 9l4 4 4-4"/><path d="M5 17l-2 4M12 18v3M19 17l2 4"/>`),
    thermal: P(`<path d="M12 21V8M8 12l4-4 4 4"/><path d="M7 4h10"/>`),
    wake: P(`<path d="M3 7c4 0 4 3 8 3s4-3 8-3M3 12c4 0 4 3 8 3s4-3 8-3M3 17c4 0 4 3 8 3s4-3 5-2"/>`),
    current: P(`<path d="M2 9c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2M2 15c2.5 0 2.5 2 5 2s2.5-2 5-2 2.5 2 5 2 2.5-2 5-2"/>`),
    attract: P(`<circle cx="12" cy="12" r="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M12 6l-2-2M12 6l2-2M12 18l-2 2M12 18l2 2M6 12 4 10M6 12l-2 2M18 12l2-2M18 12l2 2"/>`),
    repel: P(`<circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M10 4L8 6M14 4l2 2M10 20l-2-2M14 20l2-2M4 10 6 8M4 14l2 2M20 10l-2-2M20 14l-2 2"/>`),
    orbit: P(`<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.8"/>`),
    lift: P(`<path d="M12 20V6M7 11l5-5 5 5"/><path d="M5 3h14"/>`),
    magnet: P(`<path d="M6 4v7a6 6 0 0 0 12 0V4"/><path d="M6 8h4M14 8h4M6 4h4v4H6zM14 4h4v4h-4z"/>`),
    gravity: P(`<circle cx="12" cy="12" r="8"/><path d="M12 8v6M9.5 11.5 12 14l2.5-2.5"/>`),
    damp: P(`<path d="M3 15c2.5 0 2.5 2.5 5 2.5S10.5 15 13 15s2.5 2.5 5 2.5 2-1.6 3-2"/><path d="M4 4l16 8"/>`),
    gem: P(`<path d="M7 4h10l4 6-9 10L3 10z"/><path d="M3 10h18M12 20 8 10l4-6 4 6z"/>`),
    cog: P(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/>`),
    bulb: P(`<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.2 1.3 2.2h4.6c.2-1 .6-1.6 1.3-2.2A6 6 0 0 0 12 3z"/>`),
    moon: P(`<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>`),
    curve: P(`<path d="M3 18c4 0 4-12 9-12s3 9 5 9 2-3 4-3"/><path d="M3 21h18"/>`),
    grid: P(`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>`),
    uv: P(`<path d="M5 4v7a4 4 0 0 0 8 0V4"/><path d="M15 4l2.5 9L20 4"/>`),
    layers: P(`<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>`),
    folder: P(`<path d="M3 6a1 1 0 0 1 1-1h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>`),
    star: P(`<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"/>`),
    clock: P(`<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>`),
    sparkles: P(`<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z"/>`),
    chevron: P(`<path d="M9 5l7 7-7 7"/>`),
    search: P(`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>`),
    sliders: P(`<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2.2"/><circle cx="15" cy="17" r="2.2"/>`),
    drop: P(`<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>`),
    fracture: P(`<path d="M12 2l3 6-4 3 5 4-3 7"/><path d="M4 6l3 2M20 8l-3 3M5 18l4-2"/>`),
    planet: P(`<circle cx="12" cy="12" r="5.5"/><ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-18 12 12)"/>`),
    rays: P(`<path d="M4 20h16"/><circle cx="12" cy="14" r="4"/><path d="M12 3v3M5.5 5.5l2 2M18.5 5.5l-2 2M4 12h3M17 12h3"/>`),
    sun: P(`<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"/>`),
};
function GlyphFor(name) {
    if (!name) return ICONS.box;
    const key = name.replace(/^Studio(Field)?/, '').toLowerCase();
    const alias = {
        zap: 'zap', cloud: 'cloud', leaf: 'leaf', atom: 'atom', flame: 'flame', blast: 'blast',
        puff: 'puff', tornado: 'tornado', boxes: 'boxes', wind: 'wind', jet: 'jet', front: 'front',
        downburst: 'downburst', thermal: 'thermal', wake: 'wake', current: 'current',
        attract: 'attract', repel: 'repel', orbit: 'orbit', lift: 'lift', magnet: 'magnet',
        gravity: 'gravity', damp: 'damp', gem: 'gem', cog: 'cog', bulb: 'bulb', moon: 'moon',
        curve: 'curve', grid: 'grid', uv: 'uv', layers: 'layers',
    };
    return ICONS[alias[key] || 'box'];
}

/* ------------------------------------------------------------------ state */
const WORKSPACES = ['Particle Lab', 'Photometric', 'Fracture Lab', 'Fluid Studio', 'Force Fields', 'UV Studio'];
/* Workspace -> HTML editor page (relative to AssetBrowser/). null = no HTML prototype yet. */
const WORKSPACE_PAGES = {
    'Particle Lab': '../ParticleEditor/',
    'Photometric': '../PhotometricEditor/',
    'Fracture Lab': '../FractureEditor/',
    'Fluid Studio': null,
    'Force Fields': '../ForceFieldEditor/',
    'UV Studio': '../UVEditor/',
};
const State = {
    folder: 'all',          // 'all' | 'fav' | 'recent' | folder path
    query: '',
    kind: 'All',
    sort: 'name',
    view: 'grid',
    selectedId: null,
    favs: new Set(JSON.parse(localStorage.getItem('frontier-asset-favs') || '[]')),
    recents: [],
    openGroups: new Set(WORKSPACES),
};
const $ = id => document.getElementById(id);
const ById = new Map(ASSET_CATALOG.map(i => [i.id, i]));

/* Folder model: workspace -> subfolders with counts */
function BuildFolders() {
    const map = new Map(); // ws -> Map(sub -> count)
    for (const item of ASSET_CATALOG) {
        const [ws, ...rest] = item.folder.split('/');
        if (!map.has(ws)) map.set(ws, new Map());
        const sub = rest.join('/') || '(root)';
        const subs = map.get(ws);
        subs.set(sub, (subs.get(sub) || 0) + 1);
    }
    return map;
}
const FOLDERS = BuildFolders();
const KINDS = ['All', ...new Set(ASSET_CATALOG.map(i => i.kind))].sort((a, b) =>
    a === 'All' ? -1 : b === 'All' ? 1 : a.localeCompare(b));

function FilteredItems() {
    const q = State.query.trim().toLowerCase();
    let items = ASSET_CATALOG.filter(item => {
        if (State.folder === 'fav' && !State.favs.has(item.id)) return false;
        if (State.folder === 'recent' && !State.recents.includes(item.id)) return false;
        if (State.folder !== 'all' && State.folder !== 'fav' && State.folder !== 'recent') {
            if (!(item.folder === State.folder || item.folder.startsWith(State.folder + '/'))) return false;
        }
        if (State.kind !== 'All' && item.kind !== State.kind) return false;
        if (q) {
            const hay = `${item.name} ${item.blurb} ${item.ws} ${item.folder} ${item.kind} ${item.tags.join(' ')} ${item.meta.map(m => m.join(' ')).join(' ')}`.toLowerCase();
            if (!q.split(/\s+/).every(word => hay.includes(word))) return false;
        }
        return true;
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    if (State.sort === 'name') items.sort(byName);
    else if (State.sort === 'workspace') items.sort((a, b) => a.ws.localeCompare(b.ws) || byName(a, b));
    else items.sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b));
    if (State.folder === 'recent') {
        const order = new Map(State.recents.map((id, i) => [id, i]));
        items.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    }
    return items;
}

/* ------------------------------------------------------------------ toasts */
function Toast(message, ms = 2600) {
    const stack = $('toast-stack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = message;
    stack.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 250);
    }, ms);
}

/* ------------------------------------------------------------------ tree */
function TreeRow({ label, count, icon, active, open, twisty, indent, onClick, onTwisty }) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tree-row' + (active ? ' active' : '') + (open ? ' open' : '');
    const tw = document.createElement('span');
    tw.className = 'twisty';
    tw.textContent = twisty ? '▶' : '';
    if (twisty) tw.addEventListener('click', e => { e.stopPropagation(); onTwisty(); });
    const ic = document.createElement('span');
    ic.className = 'tree-icon';
    ic.innerHTML = icon;
    const lb = document.createElement('span');
    lb.className = 'tree-label';
    lb.textContent = label;
    const ct = document.createElement('span');
    ct.className = 'tree-count';
    ct.textContent = count;
    row.append(tw, ic, lb, ct);
    row.addEventListener('click', onClick);
    return row;
}
function RenderTree() {
    const host = $('folder-tree');
    host.textContent = '';
    $('lib-count').textContent = `${ASSET_CATALOG.length} assets`;
    const mk = opts => host.appendChild(TreeRow(opts));
    mk({ label: 'All Assets', count: ASSET_CATALOG.length, icon: ICONS.boxes, active: State.folder === 'all',
         onClick: () => { State.folder = 'all'; SyncAll(); } });
    mk({ label: 'Favorites', count: State.favs.size, icon: ICONS.star, active: State.folder === 'fav',
         onClick: () => { State.folder = 'fav'; SyncAll(); } });
    mk({ label: 'Recent', count: State.recents.length, icon: ICONS.clock, active: State.folder === 'recent',
         onClick: () => { State.folder = 'recent'; SyncAll(); } });
    const sep = document.createElement('div');
    sep.className = 'tree-sep';
    host.appendChild(sep);
    const wsIcons = { 'Particle Lab': ICONS.sparkles, 'Photometric': ICONS.bulb, 'Fracture Lab': ICONS.gem,
                      'Fluid Studio': ICONS.flame, 'Force Fields': ICONS.wind, 'UV Studio': ICONS.uv };
    for (const ws of WORKSPACES) {
        const subs = FOLDERS.get(ws) || new Map();
        const total = [...subs.values()].reduce((s, n) => s + n, 0);
        const group = document.createElement('div');
        group.className = 'tree-group';
        const open = State.openGroups.has(ws);
        group.appendChild(TreeRow({
            label: ws, count: total, icon: wsIcons[ws] || ICONS.folder,
            active: State.folder === ws, open, twisty: true,
            onClick: () => { State.folder = ws; SyncAll(); },
            onTwisty: () => { open ? State.openGroups.delete(ws) : State.openGroups.add(ws); RenderTree(); },
        }));
        const kids = document.createElement('div');
        kids.className = 'tree-children';
        kids.hidden = !open;
        for (const [sub, count] of [...subs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
            const path = `${ws}/${sub}`;
            kids.appendChild(TreeRow({
                label: sub, count, icon: ICONS.folder, active: State.folder === path,
                onClick: () => { State.folder = path; SyncAll(); },
            }));
        }
        group.appendChild(kids);
        host.appendChild(group);
    }
}

/* ------------------------------------------------------------------ items */
function AccentOf(item) { return item.accent || '#e8c27a'; }
function RenderKindChips() {
    const host = $('kind-chips');
    host.textContent = '';
    const counts = new Map();
    for (const item of ASSET_CATALOG.filter(i =>
        (State.folder === 'all') || (State.folder === 'fav' && State.favs.has(i.id)) ||
        (State.folder === 'recent' && State.recents.includes(i.id)) ||
        (i.folder === State.folder || i.folder.startsWith(State.folder + '/'))))
        counts.set(item.kind, (counts.get(item.kind) || 0) + 1);
    for (const kind of KINDS) {
        if (kind !== 'All' && !counts.has(kind)) continue;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'kind-chip' + (State.kind === kind ? ' active' : '');
        chip.innerHTML = `${kind}<span class="n">${kind === 'All' ? [...counts.values()].reduce((s, n) => s + n, 0) : counts.get(kind)}</span>`;
        chip.addEventListener('click', () => { State.kind = kind; SyncAll(false); });
        host.appendChild(chip);
    }
}
function StarButton(item) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'item-star' + (State.favs.has(item.id) ? ' lit' : '');
    star.textContent = State.favs.has(item.id) ? '★' : '☆';
    star.title = State.favs.has(item.id) ? 'Remove from favorites (F)' : 'Add to favorites (F)';
    star.addEventListener('click', e => { e.stopPropagation(); ToggleFav(item.id); });
    return star;
}
function RenderItems() {
    const host = $('items');
    host.textContent = '';
    host.className = State.view;
    host.id = 'items';
    const items = FilteredItems();
    $('result-count').textContent = `${items.length} of ${ASSET_CATALOG.length}`;
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.innerHTML = `<h3>No assets match</h3><p>Try a different search, folder, or kind filter.</p>`;
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'button ghost';
        clear.textContent = 'Clear search & filters';
        clear.addEventListener('click', () => {
            State.query = ''; $('global-search').value = '';
            State.kind = 'All'; State.folder = 'all'; SyncAll();
        });
        empty.appendChild(clear);
        host.appendChild(empty);
        return;
    }
    if (State.view === 'grid') {
        for (const item of items) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'item-card' + (State.selectedId === item.id ? ' selected' : '');
            card.dataset.id = item.id;
            card.style.color = AccentOf(item);
            card.innerHTML = `<span class="item-thumb" style="--thumb-glow: ${AccentOf(item)}33">${GlyphFor(item.glyph)}</span>
                <span class="item-name" style="color: var(--ink)">${item.name}</span>
                <span class="item-meta">${item.ws} · ${item.kind}</span>`;
            card.appendChild(StarButton(item));
            card.addEventListener('click', () => Select(item.id, true));
            card.addEventListener('dblclick', () => OpenInWorkspace(item.id));
            host.appendChild(card);
        }
    } else {
        for (const item of items) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'item-row' + (State.selectedId === item.id ? ' selected' : '');
            row.dataset.id = item.id;
            row.innerHTML = `<span class="row-glyph" style="color: ${AccentOf(item)}">${GlyphFor(item.glyph)}</span>
                <span class="row-main"><span class="row-name">${item.name}</span>
                <span class="row-blurb">${item.blurb}</span></span>
                <span class="row-side"><span class="row-kind" style="color: ${AccentOf(item)}">${item.kind}</span>
                <span class="row-ws">${item.ws}</span></span>`;
            row.appendChild(StarButton(item));
            row.addEventListener('click', () => Select(item.id, true));
            row.addEventListener('dblclick', () => OpenInWorkspace(item.id));
            host.appendChild(row);
        }
    }
}

/* ------------------------------------------------------------------ crumbs */
function RenderCrumbs() {
    const host = $('crumbs');
    host.textContent = '';
    const parts = State.folder === 'all' ? ['All Assets']
        : State.folder === 'fav' ? ['Favorites']
        : State.folder === 'recent' ? ['Recent']
        : ['All Assets', ...State.folder.split('/')];
    parts.forEach((part, i) => {
        if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'crumb-sep';
            sep.textContent = '/';
            host.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = part;
        const last = i === parts.length - 1;
        if (last) btn.classList.add('current');
        btn.addEventListener('click', () => {
            if (part === 'All Assets') State.folder = 'all';
            else if (part === 'Favorites') State.folder = 'fav';
            else if (part === 'Recent') State.folder = 'recent';
            else State.folder = parts.slice(1, i + 1).join('/');
            SyncAll();
        });
        host.appendChild(btn);
    });
}

/* ------------------------------------------------------------------ selection */
function Select(id, fromItems) {
    State.selectedId = id;
    document.querySelectorAll('#items .selected').forEach(el => el.classList.remove('selected'));
    const el = document.querySelector(`#items [data-id="${CSS.escape(id)}"]`);
    if (el) {
        el.classList.add('selected');
        if (!fromItems) el.scrollIntoView({ block: 'nearest' });
    }
    RenderInspector();
    RenderStatus();
}
function ToggleFav(id) {
    const item = ById.get(id);
    if (State.favs.has(id)) {
        State.favs.delete(id);
        Toast(`Removed “${item.name}” from favorites`);
    } else {
        State.favs.add(id);
        Toast(`Starred “${item.name}”`);
    }
    localStorage.setItem('frontier-asset-favs', JSON.stringify([...State.favs]));
    SyncAll(false);
}
function PushRecent(id) {
    State.recents = [id, ...State.recents.filter(r => r !== id)].slice(0, 12);
}
function OpenInWorkspace(id) {
    const item = ById.get(id);
    if (!item) return;
    PushRecent(id);
    Select(id, false);
    RenderTree();
    const page = WORKSPACE_PAGES[item.ws];
    if (!page) {
        Toast(`No HTML prototype for ${item.ws} yet — staying in the browser`);
        return;
    }
    location.href = `${page}?asset=${encodeURIComponent(item.id)}`;
}

/* ------------------------------------------------------------------ inspector */
function RenderInspector() {
    const body = $('inspector-body');
    body.textContent = '';
    const item = ById.get(State.selectedId);
    if (!item) {
        $('inspector-kind').textContent = '';
        $('inspector-footer').textContent = 'Select an asset to inspect';
        const empty = document.createElement('div');
        empty.className = 'insp-empty';
        empty.textContent = 'Pick any card or row to preview its metadata, tags, and workspace actions here.';
        body.appendChild(empty);
        return;
    }
    $('inspector-kind').textContent = item.kind;
    $('inspector-footer').textContent = `${item.id}`;
    const hero = document.createElement('div');
    hero.className = 'preview-hero';
    hero.style.color = AccentOf(item);
    hero.style.setProperty('--thumb-glow', `${AccentOf(item)}44`);
    hero.innerHTML = `${GlyphFor(item.glyph)}<span class="kind-badge">${item.kind}</span>`;
    const name = document.createElement('h2');
    name.className = 'insp-name';
    name.textContent = item.name;
    const path = document.createElement('div');
    path.className = 'insp-path';
    path.textContent = item.folder;
    const blurb = document.createElement('p');
    blurb.className = 'insp-blurb';
    blurb.textContent = item.blurb;
    body.append(hero, name, path, blurb);
    if (item.meta.length) {
        const table = document.createElement('table');
        table.className = 'meta-table';
        for (const [k, v] of item.meta) {
            const tr = document.createElement('tr');
            const th = document.createElement('th');
            th.textContent = k;
            const td = document.createElement('td');
            td.textContent = v;
            tr.append(th, td);
            table.appendChild(tr);
        }
        body.appendChild(table);
    }
    if (item.tags.length) {
        const tags = document.createElement('div');
        tags.className = 'tag-row';
        for (const tag of item.tags) {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'tag';
            pill.textContent = `#${tag}`;
            pill.title = `Search #${tag}`;
            pill.addEventListener('click', () => {
                State.query = tag;
                $('global-search').value = tag;
                SyncAll();
            });
            tags.appendChild(pill);
        }
        body.appendChild(tags);
    }
    const actions = document.createElement('div');
    actions.className = 'insp-actions';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button primary';
    open.textContent = `Open in ${item.ws}`;
    if (!WORKSPACE_PAGES[item.ws]) {
        open.disabled = true;
        open.title = `No HTML prototype for ${item.ws} yet`;
    }
    open.addEventListener('click', () => OpenInWorkspace(item.id));
    const row = document.createElement('div');
    row.className = 'row';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'button ghost';
    add.textContent = 'Add to scene';
    add.addEventListener('click', () => Toast(`Prototype: “${item.name}” would stage into the scene`));
    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'button ghost';
    fav.textContent = State.favs.has(item.id) ? '★ Favorited' : '☆ Favorite';
    fav.addEventListener('click', () => ToggleFav(item.id));
    row.append(add, fav);
    actions.append(open, row);
    body.appendChild(actions);
    const related = ASSET_CATALOG.filter(i => i.id !== item.id && i.folder === item.folder).slice(0, 4);
    if (related.length) {
        const title = document.createElement('div');
        title.className = 'insp-section-title';
        title.textContent = `More in ${item.folder.split('/').pop()}`;
        const list = document.createElement('div');
        list.className = 'related-list';
        for (const rel of related) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'related-row';
            btn.innerHTML = `<span style="color: ${AccentOf(rel)}; display: contents;">${GlyphFor(rel.glyph)}</span>
                <span class="r-name">${rel.name}</span><span class="r-kind">${rel.kind}</span>`;
            btn.addEventListener('click', () => {
                State.folder = rel.folder.includes('/') ? rel.folder : State.folder;
                SyncAll();
                Select(rel.id, false);
            });
            list.appendChild(btn);
        }
        body.append(title, list);
    }
}

/* ------------------------------------------------------------------ status */
function RenderStatus() {
    $('status-counts').textContent = `${ASSET_CATALOG.length} assets · 6 libraries · ${State.favs.size} favorites`;
    const item = ById.get(State.selectedId);
    $('status-selection').textContent = item ? `${item.name} — ${item.ws}` : 'No selection';
}

/* ------------------------------------------------------------------ sync + events */
function SyncAll(full = true) {
    if (full) RenderTree();
    else {
        // Light refresh keeps tree scroll: counts only change on fav toggle.
        RenderTree();
    }
    RenderCrumbs();
    RenderKindChips();
    RenderItems();
    RenderInspector();
    RenderStatus();
}
function MoveSelection(delta) {
    const items = FilteredItems();
    if (!items.length) return;
    let idx = items.findIndex(i => i.id === State.selectedId);
    idx = idx < 0 ? (delta > 0 ? 0 : items.length - 1) : (idx + delta + items.length) % items.length;
    Select(items[idx].id, false);
}
/* ------------------------------------------------------------------ notch */
function SetSheetOpen(open) {
    const sheet = $('browser-sheet');
    const notch = $('notch');
    sheet.classList.toggle('open', open);
    sheet.style.height = '';
    notch.setAttribute('aria-expanded', open ? 'true' : 'false');
    $('notch-chevron').textContent = open ? '\u25BE' : '\u25B4';
    $('status-text').textContent = open ? 'Ready' : 'Browser docked — press B or drag the notch';
}
function SheetOpen() {
    return $('browser-sheet').classList.contains('open');
}
function InitNotch() {
    const notch = $('notch');
    const sheet = $('browser-sheet');
    let suppressClick = false;
    notch.addEventListener('click', () => {
        if (suppressClick) { suppressClick = false; return; }
        SetSheetOpen(!SheetOpen());
    });
    $('stage-browse-btn').addEventListener('click', () => {
        SetSheetOpen(true);
        $('global-search').focus();
    });
    // Drag travel with snap: upward past 25% (or a fast upward flick) opens.
    let dragging = false, startY = 0, startH = 0, lastY = 0, lastT = 0, velocity = 0, moved = false;
    const maxH = () => Math.round(window.innerHeight * 0.8);
    notch.addEventListener('pointerdown', e => {
        dragging = true; moved = false;
        startY = e.clientY; lastY = e.clientY;
        lastT = performance.now(); velocity = 0;
        startH = SheetOpen() ? sheet.getBoundingClientRect().height : 0;
        notch.setPointerCapture(e.pointerId);
    });
    notch.addEventListener('pointermove', e => {
        if (!dragging) return;
        const dy = startY - e.clientY;
        if (Math.abs(dy) > 4) moved = true;
        const now = performance.now();
        velocity = (lastY - e.clientY) / Math.max(1, now - lastT);
        lastY = e.clientY; lastT = now;
        const h = Math.min(maxH(), Math.max(0, startH + dy));
        sheet.style.transition = 'none';
        sheet.style.height = `${h}px`;
        sheet.classList.toggle('open', h > 8);
    });
    const endDrag = e => {
        if (!dragging) return;
        dragging = false;
        sheet.style.transition = '';
        if (!moved) return; // plain click: the click handler toggles.
        suppressClick = true; // swallow the synthetic click after a drag.
        e.preventDefault();
        const h = sheet.getBoundingClientRect().height;
        const flickOpen = velocity > 0.6, flickClosed = velocity < -0.6;
        SetSheetOpen(flickOpen || (!flickClosed && h > maxH() * 0.25));
    };
    notch.addEventListener('pointerup', endDrag);
    notch.addEventListener('pointercancel', () => { dragging = false; sheet.style.transition = ''; SetSheetOpen(SheetOpen()); });
}
function Init() {
    $('search-icon').innerHTML = ICONS.search;
    const search = $('global-search');
    search.addEventListener('input', () => { State.query = search.value; RenderKindChips(); RenderItems(); });
    search.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (search.value) { search.value = ''; State.query = ''; RenderKindChips(); RenderItems(); }
            else search.blur();
        }
        if (e.key === 'Enter') {
            const first = FilteredItems()[0];
            if (first) Select(first.id, false);
        }
    });
    document.querySelectorAll('#view-toggle button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#view-toggle button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            State.view = btn.dataset.view;
            RenderItems();
        });
    });
    $('sort-select').addEventListener('change', e => { State.sort = e.target.value; RenderItems(); });
    $('import-btn').addEventListener('click', () => Toast('Prototype: import would stage a package into the library'));
    document.addEventListener('keydown', e => {
        const typing = document.activeElement === search;
        if (e.key === '/' && !typing) { e.preventDefault(); search.focus(); search.select(); }
        else if (e.key === 'Escape' && !typing) {
            if (SheetOpen()) SetSheetOpen(false);
            else { State.selectedId = null; RenderItems(); RenderInspector(); RenderStatus(); }
        }
        else if (typing) return;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); MoveSelection(1); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); MoveSelection(-1); }
        else if (e.key === 'Enter' && State.selectedId) OpenInWorkspace(State.selectedId);
        else if ((e.key === 'f' || e.key === 'F') && State.selectedId) ToggleFav(State.selectedId);
        else if (e.key === 'g' || e.key === 'G') document.querySelector('#view-toggle [data-view="grid"]').click();
        else if (e.key === 'l' || e.key === 'L') document.querySelector('#view-toggle [data-view="list"]').click();
        else if (e.key === 'b' || e.key === 'B') SetSheetOpen(!SheetOpen());
    });
    InitNotch();
    const boot = new URLSearchParams(location.search);
    if (WORKSPACES.includes(boot.get('ws'))) State.folder = boot.get('ws');
    if (KINDS.includes(boot.get('kind'))) State.kind = boot.get('kind');
    SyncAll();
    SetSheetOpen(true);
    setTimeout(() => Toast('Drag the notch down (or press B) to dock the browser'), 600);
    const params = new URLSearchParams(location.search);
    if (params.get('select') && ById.get(params.get('select'))) Select(params.get('select'), false);
    console.log(`[asset-browser] ${ASSET_CATALOG.length} items across ${WORKSPACES.length} libraries`);
}
Init();
