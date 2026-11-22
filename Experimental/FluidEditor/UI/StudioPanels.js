//============================================================================================================================================
//                                                          STUDIOPANELS.JS
//            Project-Zero Fluid Studio Chrome — Outliner Tree, Property Inspector (Hero · Metrics · Status Tiles · Pill
//           Controls), Top Control-Centre Notch, Viewport Toolbar + Transport + Legend, Asset Browser Drawer, Status Bar
//============================================================================================================================================

import { icon } from './StudioIcons.js';
import { FlipbookChoices } from '../Engine/FluidStudioApp.js';
import {
    ForceGeneratorTypes, ForceTypeById, FalloffCurves, EmitterShapes, ColourRamps, SliceAxes, ScalarChannels, AdvectionSchemes, BoundaryModes,
    RampStops, MaximumForceGenerators, SmokeLooks, FireLooks, ResolutionPresets, VolumeFilters, FalloffLabels, ForceCategories, VectorModes, timingEnvelope, isKeyed, DebrisKinds, EmitterPathKinds, GridFollowModes, MaximumGridTiles, GridModes, MaximumTilePool,
} from '../Engine/ForceGeneratorCatalog.js';
import { ScenePresets } from '../Engine/PresetScenes.js';
import { LayerSpecificationByCode, GasLayerSpecifications, ParticleLayerSpecifications, BlendModes, PhaseOrder, MaximumLayers, SourceLayerCode } from '../Engine/LayerStack.js';
import { ParticleTemplates, ParticleTemplateById, ParticleCategories, PalettePresets, MaximumPaletteStops, MaximumParticleSystems } from '../Engine/ParticleCatalog.js';
const BoundaryLabels = { ClosedBox: 'Closed Box', OpenTop: 'Open Top', OpenAll: 'Open All' };

function element(tag, className, html)
{
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
}

function formatNumber(value, digits = 2)
{
    return Number(value).toFixed(digits).replace(/\.?0+$/, (match) => (match.startsWith('.') ? '' : match));
}

function formatCells(count)
{
    return count >= 1e6 ? (count / 1e6).toFixed(2) + ' M' : count >= 1e3 ? (count / 1e3).toFixed(0) + ' k' : String(count);
}

function rampGradient(name)
{
    return `linear-gradient(90deg, ${(RampStops[name] || RampStops.Turbo).join(', ')})`;
}

function nodeIcon(node)
{
    if (node.Kind === 'Particles') return (ParticleTemplateById[node.Template] || ParticleTemplates[0]).Icon;
    if (node.Kind === 'Force') return ForceTypeById[node.Type].Icon;
    if (node.Kind === 'Emitter') return node.Fuel > 0 ? 'flame' : 'smoke';
    if (node.Kind === 'Collider') return 'collider';
    if (node.Kind === 'Domain') return 'domain';
    return { 'vis-volume': 'volume', 'vis-vectors': 'vectors', 'vis-slice': 'slice', 'vis-tracers': 'tracers', 'vis-gizmos': 'gizmo', 'vis-forces': 'dburst', 'vis-debris': 'debris' }[node.Id] || 'cube';
}

function nodeTint(node)
{
    if (node.Kind === 'Force') return ForceTypeById[node.Type].Tint;
    if (node.Kind === 'Emitter') return node.Fuel > 0 ? '#f97316' : '#cbd5e1';
    if (node.Kind === 'Collider') return '#94a3b8';
    if (node.Kind === 'Particles') return (ParticleTemplateById[node.Template] || ParticleTemplates[0]).Tint;
    if (node.Kind === 'Domain') return '#e2e8f0';
    return '#38bdf8';
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  STUDIO UI
//------------------------------------------------------------------------------------------------------------------------

export function mountStudioUI({ app, refs })
{
    const state = { searchTerm: '', collapsed: new Set(), drawerOpen: false, drawerTab: 'presets', notchOpen: false, mode: 'sim', snapshot: null, metrics: null,
        flipbook: { Count: 16, Size: 256, Rate: 30, Warmup: 1, Transparent: false, Restart: true, baking: false, cancelled: false, progress: 0, label: 'Renders the viewport camera into one sprite sheet.', result: null, frame: 0, play: true } };

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  OUTLINER
    //------------------------------------------------------------------------------------------------------------------------

    function renderOutliner(snapshot)
    {
        const { scene, selection } = snapshot;
        const host = refs.outliner;
        host.innerHTML = '';
        const nodes = [scene.Domain, ...scene.Emitters, ...scene.Forces, ...scene.Colliders, ...Object.values(scene.Visualizers)];
        const visible = nodes.filter((node) => node.Visible !== false).length;
        const hidden = nodes.length - visible;

        const heading = element('div', 'panel-heading', `<h1>Outliner</h1><span class="subtitle">${scene.Name} · ${nodes.length} nodes</span>`);
        const headingButton = element('button', 'icon-button', icon('sliders', 14));
        headingButton.title = 'Outliner options';
        headingButton.addEventListener('click', () => toggleDrawer(true, 'forces'));
        heading.appendChild(headingButton);
        host.appendChild(heading);

        host.appendChild(element('div', 'counter-row',
            `<div class="counter-card"><div class="label"><span class="status-dot">${icon('check', 9, 3)}</span>Visible</div><div class="value">${visible}</div></div>
             <div class="counter-card"><div class="label"><span class="status-dot off">${icon('eyeOff', 9)}</span>Hidden</div><div class="value">${hidden}</div></div>`));

        const searchRow = element('div', 'search-row');
        const searchPill = element('div', 'search-pill', icon('search', 13));
        const searchInput = document.createElement('input');
        searchInput.placeholder = 'Search  Ctrl+F';
        searchInput.value = state.searchTerm;
        searchInput.addEventListener('input', () => { state.searchTerm = searchInput.value.toLowerCase(); renderTree(treeHost, snapshot); });
        searchPill.appendChild(searchInput);
        searchRow.appendChild(searchPill);
        const filterButton = element('button', 'filter-pill', `${icon('filter', 12)} Filter ${icon('chevron', 10)}`);
        filterButton.addEventListener('click', () => { state.searchTerm = ''; searchInput.value = ''; renderTree(treeHost, snapshot); });
        searchRow.appendChild(filterButton);
        host.appendChild(searchRow);

        const treeHost = element('div', 'tree');
        host.appendChild(treeHost);
        renderTree(treeHost, snapshot);
    }

    function renderTree(treeHost, snapshot)
    {
        const { scene, selection } = snapshot;
        treeHost.innerHTML = '';
        const collections = [
            { key: 'scenes', title: 'Scenes', icon: 'scene', items: [], subtitle: `${ScenePresets.length} presets · click one to load`, add: () => toggleDrawer(true, 'presets'), presets: true },
            { key: 'domain', title: 'Domain', icon: 'domain', items: [scene.Domain], subtitle: `${scene.Domain.Resolution.join(' × ')} cells` },
            { key: 'emitters', title: 'Emitters', icon: 'flame', items: scene.Emitters, subtitle: `${scene.Emitters.length} items`, add: () => app.addEmitter('Sphere') },
            { key: 'forces', title: 'Force Generators', icon: 'wind', items: scene.Forces, subtitle: `${scene.Forces.length} of ${MaximumForceGenerators} slots`, add: () => toggleDrawer(true, 'forces') },
            { key: 'colliders', title: 'Colliders', icon: 'collider', items: scene.Colliders, subtitle: `${scene.Colliders.length} items`, add: () => app.addCollider() },
            { key: 'particles', title: 'Particle Systems', icon: 'particles', items: scene.Particles || [], subtitle: `${(scene.Particles || []).length} of ${MaximumParticleSystems} systems`, add: () => toggleDrawer(true, 'particles') },
            { key: 'visualizers', title: 'Visualizers', icon: 'vectors', items: Object.values(scene.Visualizers), subtitle: 'Flow diagnostics' },
        ];
        for (const collection of collections)
        {
            const items = collection.presets
                ? ScenePresets.filter((preset) => !state.searchTerm || preset.Name.toLowerCase().includes(state.searchTerm))
                : collection.items.filter((node) => !state.searchTerm || node.Name.toLowerCase().includes(state.searchTerm) || (node.Type || '').toLowerCase().includes(state.searchTerm));
            if (state.searchTerm && items.length === 0) continue;
            const row = element('div', 'tree-collection' + (state.collapsed.has(collection.key) ? ' collapsed' : ''),
                `${icon('chevron', 10)}<span class="collection-icon">${icon(collection.icon, 14)}</span><span class="meta"><strong>${collection.title}</strong><span>${collection.subtitle}</span></span>`);
            row.querySelector('svg').classList.add('chevron');
            row.addEventListener('click', () => { if (state.collapsed.has(collection.key)) state.collapsed.delete(collection.key); else state.collapsed.add(collection.key); renderTree(treeHost, snapshot); });
            if (collection.add)
            {
                const add = element('button', 'add-inline', icon('plus', 12));
                add.title = `Add to ${collection.title}`;
                add.addEventListener('click', (event) => { event.stopPropagation(); collection.add(); });
                row.appendChild(add);
            }
            treeHost.appendChild(row);
            const list = element('div', 'tree-items');
            if (collection.presets) for (const preset of items) list.appendChild(renderPresetItem(preset, scene.PresetId));
            else for (const node of items) list.appendChild(renderTreeItem(node, selection));
            treeHost.appendChild(list);
        }
    }

    function describeNode(node)
    {
        switch (node.Kind)
        {
            case 'Domain': return node.Grid === 'Infinite' ? `Infinite · ${node.TileSize} m tiles · ${(node.CellSize * 100).toFixed(1)} cm voxels` : `${node.Size.map((extent) => extent.toFixed(1)).join(' × ')} m · ${(node.CellSize * 100).toFixed(1)} cm voxels · ${BoundaryLabels[node.Boundary]}`;
            case 'Force': return `${ForceTypeById[node.Type].Name} · ${formatNumber(node.Strength, 1)} · ${FalloffLabels[node.Falloff]}${keyedSuffix(node)}`;
            case 'Emitter': return `${node.Shape} · ρ ${formatNumber(node.Density, 1)} · T ${formatNumber(node.Temperature, 1)}${node.Fuel > 0 ? ' · fuel' : ''}${node.Debris > 0 ? ` · ${(node.DebrisKind || 'rubble').toLowerCase()}` : ''}${keyedSuffix(node)}`;
            case 'Collider': return `Sphere · r ${formatNumber(node.Radius, 2)} m`;
            case 'Particles': return `${node.Mode} · ${node.Shape} · ${node.Count} pts${keyedSuffix(node)}`;
            default:
                if (node.Id === 'vis-vectors') return `${node.Axis} slice · stride ${node.Stride}`;
                if (node.Id === 'vis-slice') return `${node.Channel} · ${node.Axis} ${Math.round(node.Offset * 100)}%`;
                if (node.Id === 'vis-tracers') return `${node.Count} tracers · ${formatNumber(node.Lifetime, 1)} s`;
                if (node.Id === 'vis-volume') return `${node.Steps} steps · ${node.ShadowSteps} shadow`;
                if (node.Id === 'vis-forces') return `${node.Mode} · stride ${node.Stride}`;
                if (node.Id === 'vis-debris') return `${node.Count} particles · ${formatNumber(node.Lifetime, 1)} s`;
                return 'Force + emitter overlays';
        }
    }

    function keyedSuffix(node)
    {
        if (!isKeyed(node)) return '';
        return ` · ⏱ ${formatNumber(node.StartTime || 0, 1)}${node.Duration > 0 ? `–${formatNumber((node.StartTime || 0) + node.Duration, 1)}` : '+'} s`;
    }

    function timingCard(node)
    {
        const time = app.solver ? app.solver.time : 0;
        const envelope = timingEnvelope(node, time);
        const stateText = !isKeyed(node) ? 'ALWAYS' : envelope > 0 ? `LIVE ${Math.round(envelope * 100)}%` : time < (node.StartTime || 0) ? 'WAITING' : 'DONE';
        const track = element('div', 'key-track');
        const loop = app.scene.Domain.SceneLoop > 0 ? app.scene.Domain.SceneLoop : Math.max(6, (node.StartTime || 0) + (node.Duration || 2) + 1);
        const left = Math.min(100, ((node.StartTime || 0) / loop) * 100);
        const width = node.Duration > 0 ? Math.min(100 - left, (node.Duration / loop) * 100) : 100 - left;
        track.innerHTML = `<span class="key-span" style="left:${left}%;width:${width}%"></span><span class="key-head" style="left:${Math.min(100, (time % loop) / loop * 100)}%"></span>`;
        const tile = statusTile('Keyed', stateText, 'clock', isKeyed(node), () => app.updateNode(node.Id, 'Duration', isKeyed(node) ? 0 : 1.0));
        return card('Timing Keys', `${formatNumber(time, 1)} s / ${formatNumber(loop, 1)} s`, [
            tile,
            track,
            slider(node, 'StartTime', 'Start time', 0, 20, 0.05, 's'),
            slider(node, 'Duration', 'Duration (0 = stays on)', 0, 20, 0.05, 's'),
            slider(node, 'Fade', 'Fade in / out', 0.01, 2, 0.01, 's'),
            slider(node, 'Repeat', 'Repeat every (0 = once)', 0, 20, 0.1, 's'),
            element('p', 'note', 'Keys scale the strength (or emission) by a trapezoid envelope on the solver clock. Set a Scene Loop on the domain to replay the sequence automatically.'),
        ]);
    }

    /** Floating right-click menu; closes on any click, scroll, Escape or another menu opening. */
    function openContextMenu(x, y, entries)
    {
        closeContextMenu();
        const menu = element('div', 'context-menu');
        for (const entry of entries)
        {
            const row = element('button', 'context-item' + (entry.danger ? ' danger' : ''), `${icon(entry.icon, 13)}<span>${entry.label}</span>`);
            row.addEventListener('click', (event) => { event.stopPropagation(); closeContextMenu(); entry.action(); });
            menu.appendChild(row);
        }
        document.body.appendChild(menu);
        const rect = menu.getBoundingClientRect();
        menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 6)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 6)}px`;
        state.contextMenu = menu;
        setTimeout(() => { document.addEventListener('pointerdown', closeContextMenu, { once: true }); window.addEventListener('scroll', closeContextMenu, { once: true, capture: true }); }, 0);
    }

    function closeContextMenu()
    {
        if (state.contextMenu) { state.contextMenu.remove(); state.contextMenu = null; }
    }

    function renderPresetItem(preset, currentId)
    {
        const current = preset.Id === currentId;
        const item = element('div', 'tree-item preset-item' + (current ? ' selected' : ''));
        const grid = preset.Grid.Grid === 'Infinite' ? ' · infinite grid' : preset.Grid.Tiles && preset.Grid.Tiles.some((count) => count > 1) ? ` · ${preset.Grid.Tiles.join('×')} tile grid` : '';
        item.innerHTML = `<span class="item-icon" style="color:${current ? '#f5a524' : '#9aa3b2'}">${icon(preset.Icon, 15)}</span><span class="item-meta"><strong>${preset.Name}</strong><span>${preset.Family === 'Pyro' ? 'Pyro · ' : ''}${preset.Grid.Resolution.join('×')} cells${grid}</span></span><span class="load-hint">${current ? 'loaded' : 'load'}</span>`;
        item.title = preset.Summary;
        item.addEventListener('click', () => app.loadPreset(preset.Id));
        return item;
    }

    function renderTreeItem(node, selection)
    {
        const enabled = node.Enabled !== false;
        const item = element('div', 'tree-item' + (node.Id === selection ? ' selected' : '') + (enabled ? '' : ' disabled'));
        item.innerHTML = `<span class="item-icon" style="color:${nodeTint(node)}">${icon(nodeIcon(node), 15)}</span><span class="item-meta"><strong>${node.Name}</strong><span>${describeNode(node)}</span></span>`;
        item.addEventListener('click', () => app.select(node.Id));
        if (node.Kind !== 'Domain' && node.Kind !== 'Visualizer')
        {
            item.addEventListener('contextmenu', (event) =>
            {
                event.preventDefault();
                app.select(node.Id);
                openContextMenu(event.clientX, event.clientY, [
                    { label: 'Duplicate', icon: 'copy', action: () => app.duplicateNode(node.Id) },
                    { label: enabled ? 'Disable' : 'Enable', icon: 'power', action: () => app.updateNode(node.Id, 'Enabled', !enabled) },
                    { label: node.Visible ? 'Hide in viewport' : 'Show in viewport', icon: node.Visible ? 'eyeOff' : 'eye', action: () => app.updateNode(node.Id, 'Visible', !node.Visible) },
                    { label: 'Delete', icon: 'trash', danger: true, action: () => app.removeNode(node.Id) },
                ]);
            });
            const status = element('button', 'status-dot' + (enabled ? '' : ' off'), icon(enabled ? 'check' : 'power', 9, 3));
            status.title = enabled ? 'Enabled — click to disable' : 'Disabled — click to enable';
            status.addEventListener('click', (event) => { event.stopPropagation(); app.updateNode(node.Id, 'Enabled', !enabled); });
            item.appendChild(status);
        }
        if (node.Kind !== 'Domain')
        {
            const eye = element('button', 'eye-button' + (node.Visible ? ' on' : ''), icon(node.Visible ? 'eye' : 'eyeOff', 13));
            eye.title = node.Visible ? 'Visible in viewport' : 'Hidden in viewport';
            eye.addEventListener('click', (event) => { event.stopPropagation(); app.updateNode(node.Id, 'Visible', !node.Visible); });
            item.appendChild(eye);
        }
        return item;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  INSPECTOR CONTROLS
    //------------------------------------------------------------------------------------------------------------------------

    function slider(node, key, label, min, max, step, unit = '', digits = 2, write = (value) => app.updateNode(node.Id, key, value))
    {
        const control = element('div', 'control');
        const head = element('div', 'control-head', `<span>${label}<span class="unit">${unit}</span></span>`);
        const number = document.createElement('input');
        number.type = 'number'; number.step = String(step); number.value = formatNumber(node[key], digits);
        head.appendChild(number);
        const range = document.createElement('input');
        range.type = 'range'; range.min = String(min); range.max = String(max); range.step = String(step); range.value = String(node[key]);
        const paint = () => range.style.setProperty('--fill', `${((Number(range.value) - min) / (max - min)) * 100}%`);
        paint();
        range.addEventListener('input', () => { number.value = formatNumber(range.value, digits); paint(); write(Number(range.value)); });
        number.addEventListener('change', () => { const value = Number(number.value); if (Number.isFinite(value)) { range.value = String(Math.max(min, Math.min(max, value))); paint(); write(value); } });
        control.appendChild(head);
        control.appendChild(range);
        return control;
    }

    function vector(node, key, label, step = 0.05, integer = false, write = (value) => app.updateNode(node.Id, key, value))
    {
        const control = element('div', 'control');
        control.appendChild(element('div', 'control-head', `<span>${label}</span>`));
        const row = element('div', 'vector-row');
        ['x', 'y', 'z'].forEach((axis, index) =>
        {
            const wrap = element('label', axis, `<span>${axis.toUpperCase()}</span>`);
            const input = document.createElement('input');
            input.type = 'number'; input.step = String(step); input.value = integer ? String(node[key][index]) : formatNumber(node[key][index], 2);
            input.addEventListener('change', () =>
            {
                const value = Number(input.value);
                if (!Number.isFinite(value)) return;
                const next = [...node[key]];
                next[index] = integer ? Math.round(value) : value;
                write(next);
            });
            wrap.appendChild(input);
            row.appendChild(wrap);
        });
        control.appendChild(row);
        return control;
    }

    function choice(node, key, label, options, labels = {}, write = (value) => app.updateNode(node.Id, key, value))
    {
        const control = element('div', 'control');
        control.appendChild(element('div', 'control-head', `<span>${label}</span>`));
        const row = element('div', 'choice-row');
        for (const option of options)
        {
            const button = element('button', node[key] === option ? 'active' : '', labels[option] || option);
            button.addEventListener('click', () => write(option));
            row.appendChild(button);
        }
        control.appendChild(row);
        return control;
    }

    function colour(node, key, label, write = (value) => app.updateNode(node.Id, key, value))
    {
        const row = element('div', 'colour-row', `<span>${label}</span>`);
        const input = document.createElement('input');
        input.type = 'color'; input.value = node[key];
        input.addEventListener('input', () => write(input.value));
        row.appendChild(input);
        return row;
    }

    function lookChips(node, label, looks, isActive)
    {
        const control = element('div', 'control');
        control.appendChild(element('div', 'control-head', `<span>${label}</span>`));
        const row = element('div', 'choice-row');
        for (const [name, look] of Object.entries(looks))
        {
            const button = element('button', isActive(look) ? 'active' : '', name);
            button.addEventListener('click', () => app.applyLook(node.Id, look));
            row.appendChild(button);
        }
        control.appendChild(row);
        return control;
    }

    function card(title, hint, controls)
    {
        const wrap = element('div', 'property-card', `<h3>${title}${hint ? `<span>${hint}</span>` : ''}</h3>`);
        for (const control of controls) if (control) wrap.appendChild(control);
        return wrap;
    }

    function statusTile(label, stateText, iconName, on, onClick, warn = false)
    {
        const tile = element('button', 'status-tile' + (on ? ' on' : '') + (warn ? ' warn' : ''), `<span class="tile-icon">${icon(iconName, 16)}</span><span class="tile-label">${label}</span><span class="tile-state">${stateText}</span>`);
        if (onClick) tile.addEventListener('click', onClick); else tile.disabled = true;
        return tile;
    }

    function metric(value, unit, label)
    {
        return `<div class="metric-card"><div class="value">${value}${unit ? `<small>${unit}</small>` : ''}</div><div class="label">${label}</div></div>`;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  INSPECTOR
    //------------------------------------------------------------------------------------------------------------------------

    function renderInspector(snapshot)
    {
        const host = refs.inspector;
        host.innerHTML = '';
        const node = snapshot.node || snapshot.scene.Domain;
        const kindLabel = { Domain: 'Gas Domain', Force: 'Force Generator', Emitter: 'Emitter', Collider: 'Collider', Particles: 'Particle System', Visualizer: 'Visualizer' }[node.Kind];

        const breadcrumb = element('div', 'inspector-breadcrumb', `<span>Inspector / ${kindLabel}</span>`);
        const notes = element('button', 'pill', `${icon('plus', 11)} Add notes`);
        notes.addEventListener('click', () => toggleDrawer(true, 'presets'));
        breadcrumb.appendChild(notes);
        host.appendChild(breadcrumb);

        const title = element('div', 'inspector-title');
        if (node.Kind === 'Domain' || node.Kind === 'Visualizer') title.innerHTML = `<h1>${node.Name}</h1>`;
        else
        {
            const rename = document.createElement('input');
            rename.className = 'rename'; rename.value = node.Name; rename.title = 'Rename';
            rename.addEventListener('change', () => app.updateNode(node.Id, 'Name', rename.value.trim() || node.Name));
            title.appendChild(rename);
        }
        title.appendChild(element('div', 'kind', node.Kind === 'Force' ? ForceTypeById[node.Type].Summary : node.Kind === 'Particles' ? (ParticleTemplateById[node.Template] || ParticleTemplates[0]).Summary : kindLabel));
        host.appendChild(title);

        if (node.Kind === 'Domain') renderDomainInspector(host, node, snapshot);
        else if (node.Kind === 'Force') renderForceInspector(host, node, snapshot);
        else if (node.Kind === 'Emitter') renderEmitterInspector(host, node, snapshot);
        else if (node.Kind === 'Collider') renderColliderInspector(host, node, snapshot);
        else if (node.Kind === 'Particles') renderParticleInspector(host, node, snapshot);
        else renderVisualizerInspector(host, node, snapshot);
    }

    function hero(tint, caption, sub, corner, glyph)
    {
        return element('div', 'hero',
            `<div style="position:absolute;inset:0;background:linear-gradient(135deg, ${tint}66 0%, ${tint}22 45%, #101010 100%)"></div>
             <div style="position:absolute;inset:0;background:radial-gradient(circle at 80% 50%, ${tint}55, transparent 55%)"></div>
             <span class="hero-glyph">${icon(glyph, 56, 1)}</span>
             <div class="hero-caption"><strong>${caption}</strong><span>${sub}</span></div>
             <div class="hero-corner">${corner}</div>`);
    }

    function renderDomainInspector(host, domain, snapshot)
    {
        const metrics = state.metrics || {};
        const size = domain.Resolution.map((cells) => (cells * domain.CellSize).toFixed(1));
        if (domain.Grid === 'Infinite') host.appendChild(hero('#64748b', 'Infinite', `${domain.TileSize} m tiles · ${domain.TileResolution}³ cells · pool ${domain.TilePool}`, `${metrics.residentTiles || 0} tiles resident`, 'infinite'));
        else host.appendChild(hero('#64748b', `${domain.Resolution.join(' × ')}`, `${size.join(' × ')} m · ${BoundaryLabels[domain.Boundary]}`, `${formatCells(domain.Resolution[0] * domain.Resolution[1] * domain.Resolution[2])} cells`, 'domain'));
        host.appendChild(element('div', 'metric-grid',
            metric(formatCells(metrics.cells || 0), '', 'Cells') +
            metric((domain.CellSize * 100).toFixed(1), 'cm', 'Cell size') +
            metric((metrics.stepMilliseconds || 0).toFixed(1), 'ms', 'Solver step') +
            metric(metrics.passes || 0, '', 'GPU passes')));
        const status = element('div', 'status-grid');
        status.appendChild(statusTile(snapshot.playing ? 'Simulating' : 'Paused', snapshot.playing ? 'LIVE' : 'HELD', snapshot.playing ? 'pause' : 'play', snapshot.playing, () => app.togglePlay()));
        status.appendChild(statusTile('MacCormack', domain.Advection === 'MacCormack' ? '2ND ORDER' : 'SEMI-LAGRANGIAN', 'vectors', domain.Advection === 'MacCormack', () => app.updateNode(domain.Id, 'Advection', domain.Advection === 'MacCormack' ? AdvectionSchemes[0] : AdvectionSchemes[1])));
        host.appendChild(status);
        host.appendChild(element('div', 'section-head', '<span>Properties</span><span>Grid, dynamics & solver</span>'));
        const resolutionChips = element('div', 'control');
        resolutionChips.appendChild(element('div', 'control-head', '<span>Quality preset</span>'));
        const chipRow = element('div', 'choice-row');
        for (const [name, cells] of Object.entries(ResolutionPresets))
        {
            const button = element('button', domain.MaxCells === cells ? 'active' : '', `${name} <span style="opacity:.55;margin-left:4px">${cells}</span>`);
            button.addEventListener('click', () => app.updateNode(domain.Id, 'MaxCells', cells));
            chipRow.appendChild(button);
        }
        resolutionChips.appendChild(chipRow);
        host.appendChild(card('Grid', `${domain.Resolution.join(' × ')} = ${formatCells(domain.Resolution[0] * domain.Resolution[1] * domain.Resolution[2])}`, [
            vector(domain, 'Size', 'World size (m)', 0.5),
            slider(domain, 'MaxCells', 'Voxel resolution (longest axis)', 16, 160, 8, 'cells', 0),
            resolutionChips,
            element('p', 'note', `Voxel ${(domain.CellSize * 100).toFixed(1)} cm — lower resolution = coarser, blockier gas and a faster solve; higher resolution = finer detail at a higher GPU cost. World size stays fixed while you change it.`),
            choice(domain, 'Boundary', 'Boundary', BoundaryModes, BoundaryLabels),
            element('p', 'note', 'Open faces let gas flow out of the domain (a sponge band fades it near the edge); closed walls contain it.'),
        ]));
        const infinite = domain.Grid === 'Infinite';
        const gridMode = choice(domain, 'Grid', 'Grid mode', GridModes, { Fixed: 'Fixed box / window', Infinite: 'Infinite tiles' });
        if (infinite)
        {
            const resident = metrics.residentTiles || 0, pool = metrics.poolSize || domain.TilePool;
            const poolStatus = element('div', 'status-grid');
            poolStatus.appendChild(statusTile('Resident tiles', `${resident} / ${pool}`, 'grid', resident > 0, null, resident >= pool));
            poolStatus.appendChild(statusTile('Live cells', formatCells(metrics.cells || 0), 'domain', true, null));
            host.appendChild(card('World Grid', 'Infinite · sparse tiles', [
                gridMode,
                element('p', 'note', 'No box. The world is an endless lattice of cubic tiles that allocate themselves wherever gas arrives and free themselves when it has gone. Emitter tiles (amber) are always resident; the only budget is the tile pool.'),
                slider(domain, 'TileSize', 'Tile edge', 0.5, 8, 0.25, 'm'),
                slider(domain, 'TileResolution', 'Cells per tile edge', 8, 48, 4, 'cells', 0),
                slider(domain, 'TilePool', `Tile pool (max ${MaximumTilePool})`, 4, MaximumTilePool, 4, 'tiles', 0),
                element('p', 'note', `Voxel ${(domain.CellSize * 100).toFixed(1)} cm · up to ${formatCells(domain.TilePool * domain.TileResolution ** 3)} cells resident at once. When the pool is full the thinnest tile is recycled, so smoke furthest behind fades first.`),
                poolStatus,
            ]));
        }
        const tiles = domain.Tiles || [1, 1, 1];
        const tileCount = tiles[0] * tiles[1] * tiles[2];
        const followTargets = domain.Follow === 'Emitter' ? snapshot.scene.Emitters : domain.Follow === 'Particles' ? (snapshot.scene.Particles || []) : [];
        const followChoice = followTargets.length > 1 ? element('div', 'control') : null;
        if (followChoice)
        {
            followChoice.appendChild(element('div', 'control-head', '<span>Follow target</span>'));
            const row = element('div', 'choice-row');
            for (const target of followTargets)
            {
                const active = domain.FollowId ? domain.FollowId === target.Id : target === followTargets[0];
                const button = element('button', active ? 'active' : '', target.Name);
                button.addEventListener('click', () => app.updateNode(domain.Id, 'FollowId', target.Id));
                row.appendChild(button);
            }
            followChoice.appendChild(row);
        }
        const gridStatus = element('div', 'status-grid');
        gridStatus.appendChild(statusTile('Window', `${tiles.join('×')} TILES`, 'grid', tileCount > 1, null));
        gridStatus.appendChild(statusTile('Origin tile', (domain.GridOrigin || [0, 0, 0]).join(', '), 'frame', (domain.GridOrigin || []).some((v) => v !== 0), () => app.recentreGrid()));
        if (!infinite) host.appendChild(card('World Grid', tileCount > 1 || domain.Follow !== 'None' ? `${tileCount} tile${tileCount > 1 ? 's' : ''} · ${(domain.TileCells || domain.Resolution).join('×')} cells each` : 'Single tile', [
            gridMode,
            vector(domain, 'Tiles', `Tiles per axis (max ${MaximumGridTiles})`, 1, true),
            element('p', 'note', `The domain size above is one tile; the solver runs ${tiles.join(' × ')} tiles as one seamless field (${domain.Resolution.join(' × ')} cells), so gas crosses tile seams without hitting a wall.`),
            choice(domain, 'Follow', 'Follow', GridFollowModes, { None: 'Static', Emitter: 'Emitter', Particles: 'Particles', Camera: 'Camera' }),
            followChoice,
            statusTile('Follow height', domain.FollowHeight ? 'ON' : 'LOCKED', 'vectors', Boolean(domain.FollowHeight), () => app.updateNode(domain.Id, 'FollowHeight', !domain.FollowHeight)),
            gridStatus,
            element('p', 'note', 'Following slides the window across the world grid by whole tiles whenever the target enters a neighbouring tile. The fields are moved by an exact cell offset, so smoke already laid down keeps simulating in place — nothing is clipped at the old box. Use 3 × 1 × 3 tiles with an Emitter on a Straight or Slalom path for an endless drift run.'),
        ]));
        renderGasStack(host, snapshot);
        const actions = element('div', 'action-row');
        const reset = element('button', '', `${icon('reset', 12)} Reset fields`);
        reset.addEventListener('click', () => app.reset());
        const frame = element('button', '', `${icon('frame', 12)} Frame domain`);
        frame.addEventListener('click', () => app.frameDomain());
        actions.append(reset, frame);
        host.appendChild(actions);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  GAS LAYER STACK
    //------------------------------------------------------------------------------------------------------------------------

    /** One-line summary of a layer's main amounts, shown in its stack row. */
    function layerSummary(layer, specification, scene)
    {
        if (!specification) return `Category ${layer.Category} · kept, not evaluated`;
        if (specification.Code === SourceLayerCode)
        {
            const emitter = scene.Emitters.find((candidate) => candidate.Id === layer.Parameters.Emitter);
            return emitter ? `${emitter.Name} · ${emitter.Shape.toLowerCase()} ${formatNumber(emitter.Radius, 2)} m` : 'emitter missing';
        }
        // A leading Choice (colour rule, mode, sprite, trail) says more than the first numbers.
        const lead = specification.Parameter[0].Type === 'Choice' ? specification.Parameter[0] : null;
        const option = lead && lead.Options.find((candidate) => candidate.Code === layer.Parameters[lead.Name]);
        const numbers = specification.Parameter.filter((parameter) => parameter.Type === 'Float32' || parameter.Type === 'Int32').slice(0, lead ? 1 : 2)
            .map((parameter) => `${parameter.Label.replace(/ \(.*\)$/, '').toLowerCase()} ${formatNumber(layer.Parameters[parameter.Name], parameter.Digits ?? 2)}`);
        return [option ? option.Label.toLowerCase() : null, ...numbers].filter(Boolean).join(' · ');
    }

    function renderGasStack(host, snapshot)
    {
        const stack = snapshot.scene.GasStack;
        if (!stack) return;
        renderLayerStack(host, snapshot, {
            stack,
            evaluation: snapshot.gas || { Problems: [], Contributing: new Set() },
            specifications: GasLayerSpecifications,
            stopped: (reason) => `⚠️ Gas stopped: ${reason}. Particles keep running.`,
            note: 'Without Smoke shading the smoke is not drawn; without Fire shading hot gas does not glow.',
        });
    }

    /** Layer list + selected-layer editor for any stack (gas volume or particle system). */
    function renderLayerStack(host, snapshot, { stack, evaluation, specifications, stopped, note, owner = null })
    {
        const problemsFor = (token) => evaluation.Problems.filter((problem) => problem.Token === token);
        const stackCard = element('div', 'property-card layer-stack', `<h3>Layers<span>${stack.Layers.length} of ${MaximumLayers} · top to bottom</span></h3>`);
        stackCard.setAttribute('data-layer-stack', stack.Token);
        if (evaluation.Stopped) stackCard.appendChild(element('p', 'layer-stopped', stopped(evaluation.Stopped)));

        // + Add layer: every category of this stack with room left, grouped by phase.
        const add = document.createElement('select');
        add.className = 'layer-add';
        add.setAttribute('aria-label', 'Add layer');
        add.innerHTML = '<option value="">+ Add layer</option>';
        for (const phase of PhaseOrder)
        {
            const group = document.createElement('optgroup');
            group.label = phase;
            for (const specification of specifications.filter((candidate) => candidate.Phase === phase && !candidate.Required))
            {
                const used = stack.Layers.filter((layer) => layer.Category === specification.Code).length;
                const option = document.createElement('option');
                option.value = String(specification.Code);
                option.textContent = `${specification.Name}${specification.Capacity > 1 ? `  (${used}/${specification.Capacity})` : ''}`;
                option.disabled = used >= specification.Capacity || stack.Layers.length >= MaximumLayers;
                group.appendChild(option);
            }
            if (group.children.length) add.appendChild(group);
        }
        add.addEventListener('change', () => { if (add.value) app.addLayer(Number(add.value)); });
        stackCard.querySelector('h3').appendChild(add);

        const list = element('ol', 'layer-list');
        let dragged = null;
        stack.Layers.forEach((layer, index) =>
        {
            const specification = LayerSpecificationByCode[layer.Category];
            const required = Boolean(specification && specification.Required);
            const issues = problemsFor(layer.Token);
            const live = evaluation.Contributing.has(layer.Token);
            const row = element('li', 'layer-row' + (snapshot.selectedLayer === layer.Token ? ' selected' : '') + (live ? '' : ' muted') + (issues.some((issue) => issue.Severity !== 'Info') ? ' problem' : '') + (specification ? '' : ' inert'));
            row.setAttribute('data-layer', layer.Token);
            row.draggable = !required;
            const handle = element('span', 'layer-handle', required ? '' : '≡');
            handle.title = required ? 'Required first layer' : 'Drag to reorder';
            const toggle = element('button', 'layer-toggle' + (layer.Enabled ? ' on' : ''), layer.Enabled ? '◉' : '○');
            toggle.title = required ? 'Required — always on' : layer.Enabled ? 'Disable layer' : 'Enable layer';
            toggle.setAttribute('aria-label', `${layer.Enabled ? 'Disable' : 'Enable'} ${specification ? specification.Name : 'layer'}`);
            toggle.disabled = required || !specification;
            toggle.addEventListener('click', (event) => { event.stopPropagation(); app.updateLayer(layer.Token, 'Enabled', !layer.Enabled); });
            const text = element('span', 'layer-text', `<b>${specification ? specification.Name : 'Unknown layer'}</b><small>${layerSummary(layer, specification, snapshot.scene)}</small>`);
            const badges = element('span', 'layer-badges');
            if (required) badges.appendChild(element('em', 'layer-badge', 'required'));
            if (layer.Solo) badges.appendChild(element('em', 'layer-badge solo', 'solo'));
            if (specification && !specification.Linked && layer.Weight < 1) badges.appendChild(element('em', 'layer-badge', `${Math.round(layer.Weight * 100)}%`));
            for (const issue of issues) { const badge = element('em', 'layer-badge ' + (issue.Severity === 'Info' ? 'info' : 'warn'), issue.Severity === 'Info' ? 'inert' : '!'); badge.title = issue.Text; badges.appendChild(badge); }
            row.append(handle, toggle, text, badges);
            if (!required)
            {
                const move = (delta) => (event) => { event.stopPropagation(); app.moveLayer(layer.Token, index + delta); };
                const up = element('button', 'layer-move', '↑'); up.title = 'Move up'; up.setAttribute('aria-label', 'Move layer up'); up.disabled = index <= 1; up.addEventListener('click', move(-1));
                const down = element('button', 'layer-move', '↓'); down.title = 'Move down'; down.setAttribute('aria-label', 'Move layer down'); down.disabled = index >= stack.Layers.length - 1; down.addEventListener('click', move(1));
                const remove = element('button', 'layer-remove', '×'); remove.title = specification && specification.Linked ? 'Delete layer and its emitter' : 'Delete layer'; remove.setAttribute('aria-label', 'Delete layer');
                remove.addEventListener('click', (event) => { event.stopPropagation(); app.removeLayer(layer.Token); });
                row.append(up, down, remove);
            }
            row.addEventListener('click', () => app.selectLayer(layer.Token));
            row.addEventListener('dragstart', (event) => { dragged = layer.Token; event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
            row.addEventListener('dragend', () => row.classList.remove('dragging'));
            row.addEventListener('dragover', (event) => { if (dragged && dragged !== layer.Token) { event.preventDefault(); row.classList.add('drop-target'); } });
            row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
            row.addEventListener('drop', (event) => { event.preventDefault(); row.classList.remove('drop-target'); if (dragged) app.moveLayer(dragged, index); dragged = null; });
            list.appendChild(row);
        });
        stackCard.appendChild(list);
        stackCard.appendChild(element('p', 'note', `≡ drag or ↑↓ to reorder · ◉/○ enable · layers evaluate top to bottom within each phase (Inject → Advance → Shade → Overlay). ${note}`));
        host.appendChild(stackCard);

        const selected = stack.Layers.find((layer) => layer.Token === snapshot.selectedLayer) || stack.Layers[0];
        if (!selected) return;
        const specification = LayerSpecificationByCode[selected.Category];
        if (!specification)
        {
            host.appendChild(card('Unknown layer', `category ${selected.Category}`, [element('p', 'note', 'Written by a newer editor. Kept verbatim and saved back unchanged; it does not affect the simulation here.')]));
            return;
        }
        const controls = [element('p', 'note', specification.Summary)];
        const writeSetting = (key) => (value) => app.updateLayer(selected.Token, key, value);
        const writeParameter = (key) => (value) => app.updateLayer(selected.Token, key, value, true);
        if (!specification.Required && !specification.Linked)
        {
            controls.push(slider(selected, 'Weight', 'Weight', 0, 1, 0.01, '', 2, writeSetting('Weight')));
            const blendLabels = Object.fromEntries(BlendModes.map((mode) => [mode.Code, mode.Label]));
            controls.push(choice(selected, 'Blend', 'Blend with layers above', BlendModes.map((mode) => mode.Code), blendLabels, writeSetting('Blend')));
            controls.push(statusTile('Solo', selected.Solo ? 'SOLO' : 'OFF', 'eye', selected.Solo, () => app.updateLayer(selected.Token, 'Solo', !selected.Solo)));
        }
        for (const parameter of specification.Parameter)
        {
            const write = writeParameter(parameter.Name);
            if (owner && !particleParameterShown(parameter.Name, selected.Parameters, owner)) continue;
            const range = owner ? particleParameterRange(parameter, owner) : parameter;
            if (parameter.Type === 'Float32' || parameter.Type === 'Int32' || parameter.Type === 'UInt32')
                controls.push(slider(selected.Parameters, parameter.Name, parameter.Label, range.Minimum, range.Maximum, range.Step ?? 0.01, range.Unit || '', parameter.Type === 'Float32' ? (range.Digits ?? 2) : 0, write));
            else if (parameter.Type === 'Vector3') controls.push(vector(selected.Parameters, parameter.Name, parameter.Unit ? `${parameter.Label} (${parameter.Unit})` : parameter.Label, parameter.Step ?? 0.05, false, write));
            else if (parameter.Type === 'Ramp8') controls.push(paletteControl(selected.Parameters, write));
            else if (parameter.Type === 'Choice')
                controls.push(choice(selected.Parameters, parameter.Name, parameter.Label, parameter.Options.map((option) => option.Code), Object.fromEntries(parameter.Options.map((option) => [option.Code, option.Label])), write));
            else if (parameter.Type === 'ColourLinear') controls.push(colour(selected.Parameters, parameter.Name, parameter.Label, write));
            else if (parameter.Type === 'Bool') controls.push(statusTile(parameter.Label, selected.Parameters[parameter.Name] ? 'ON' : 'OFF', 'power', selected.Parameters[parameter.Name], () => write(!selected.Parameters[parameter.Name])));
            else if (parameter.Type === 'Token' && specification.Linked === 'Emitter')
            {
                const emitter = snapshot.scene.Emitters.find((candidate) => candidate.Id === selected.Parameters.Emitter);
                const open = element('button', '', `${icon('flame', 12)} Edit ${emitter ? emitter.Name : 'emitter'}`);
                open.disabled = !emitter;
                open.addEventListener('click', () => emitter && app.select(emitter.Id));
                const actions = element('div', 'action-row'); actions.appendChild(open);
                controls.push(actions);
            }
        }
        const panel = card(`${specification.Name}`, `${specification.Phase} · ${specification.Required ? 'required' : selected.Enabled ? 'enabled' : 'disabled'}`, controls);
        panel.setAttribute('data-layer-inspector', selected.Token);
        host.appendChild(panel);
    }

    function renderForceInspector(host, force, snapshot)
    {
        const type = ForceTypeById[force.Type];
        const slotIndex = snapshot.scene.Forces.filter((candidate) => candidate.Enabled).indexOf(force);
        host.appendChild(hero(type.Tint, type.Name, `${FalloffLabels[force.Falloff]} falloff${slotIndex >= 0 ? ` · slot ${slotIndex + 1}` : ' · not evaluated'}`, `${formatNumber(force.Strength, 1)} m/s²`, type.Icon));
        host.appendChild(element('div', 'metric-grid',
            metric(formatNumber(force.Strength, 1), 'm/s²', 'Strength') +
            metric(force.Falloff === 'Constant' ? '∞' : formatNumber(force.Radius, 2), force.Falloff === 'Constant' ? '' : 'm', 'Reach') +
            metric(force.Position.map((value) => formatNumber(value, 1)).join(', '), '', 'Position') +
            metric(force.Direction.map((value) => formatNumber(value, 1)).join(', '), '', 'Axis')));
        const status = element('div', 'status-grid');
        status.appendChild(statusTile('Enabled', force.Enabled ? 'ON' : 'OFF', 'power', force.Enabled, () => app.updateNode(force.Id, 'Enabled', !force.Enabled)));
        status.appendChild(statusTile('Gizmo', force.Visible ? 'SHOWN' : 'HIDDEN', 'gizmo', force.Visible, () => app.updateNode(force.Id, 'Visible', !force.Visible)));
        host.appendChild(status);
        host.appendChild(element('div', 'section-head', '<span>Properties</span><span>Force, reach & placement</span>'));

        const typeControl = element('div', 'control');
        typeControl.appendChild(element('div', 'control-head', '<span>Generator type</span>'));
        const typeSelect = document.createElement('select');
        for (const category of ForceCategories)
        {
            const group = document.createElement('optgroup');
            group.label = category;
            for (const candidate of ForceGeneratorTypes.filter((entry) => entry.Category === category))
            {
                const option = document.createElement('option');
                option.value = candidate.Id; option.textContent = candidate.Name; option.selected = candidate.Id === force.Type;
                group.appendChild(option);
            }
            typeSelect.appendChild(group);
        }
        typeSelect.addEventListener('change', () =>
        {
            const next = ForceTypeById[typeSelect.value];
            app.updateNode(force.Id, 'Type', next.Id);
            if (force.Name === type.Name) app.updateNode(force.Id, 'Name', next.Name);
        });
        typeControl.appendChild(typeSelect);

        host.appendChild(card('Force', type.Category, [
            typeControl,
            slider(force, 'Strength', 'Strength', -60, 60, 0.5, 'm/s²', 1),
            slider(force, 'Radius', 'Reach radius', 0.1, 4, 0.05, 'm'),
            choice(force, 'Falloff', 'Falloff envelope', FalloffCurves, FalloffLabels),
        ]));
        const extras = [];
        if (type.Labels.Frequency) extras.push(slider(force, 'Frequency', type.Labels.Frequency, 0, type.Category === 'Burst' ? 6 : (type.Id === 'BrownianJitter' ? 20 : (type.Id === 'FlowStream' ? 10 : 4)), 0.05));
        if (type.Labels.Secondary) extras.push(slider(force, 'Secondary', type.Labels.Secondary, 0, type.Id === 'VortexColumn' ? 8 : (type.Id === 'BrownianJitter' ? 30 : 2), 0.05));
        if (type.Labels.Tertiary) extras.push(slider(force, 'Tertiary', type.Labels.Tertiary, 0, 10, 0.1, 's'));
        if (extras.length) host.appendChild(card('Modulation', 'Type-specific', extras));
        if (type.Category === 'Burst') host.appendChild(element('p', 'note', 'Bursts repeat every period after the start delay. Tip: stack an Implosion with a Shockwave Shell, delaying the shell by half a period, for a suck-then-blast fireball.'));
        host.appendChild(card('Placement', 'Drag gizmo in viewport', [
            vector(force, 'Position', 'Position (m)'),
            vector(force, 'Direction', 'Direction / axis', 0.1),
        ]));
        host.appendChild(timingCard(force));
        host.appendChild(nodeActions(force));
    }

    function renderEmitterInspector(host, emitter)
    {
        const burning = emitter.Fuel > 0;
        host.appendChild(hero(burning ? '#f97316' : '#cbd5e1', emitter.Shape + ' source', burning ? 'Combusting fuel · soot + heat' : 'Smoke + heat injection', `ρ ${formatNumber(emitter.Density, 1)} · T ${formatNumber(emitter.Temperature, 1)}`, burning ? 'flame' : 'smoke'));
        host.appendChild(element('div', 'metric-grid',
            metric(formatNumber(emitter.Radius, 2), 'm', 'Radius') +
            metric(formatNumber(Math.hypot(...emitter.Velocity), 1), 'm/s', 'Exit speed') +
            metric(formatNumber(emitter.Temperature, 1), '', 'Temperature') +
            metric(formatNumber(emitter.Fuel, 2), '', 'Fuel')));
        const status = element('div', 'status-grid');
        status.appendChild(statusTile('Enabled', emitter.Enabled ? 'ON' : 'OFF', 'power', emitter.Enabled, () => app.updateNode(emitter.Id, 'Enabled', !emitter.Enabled)));
        status.appendChild(statusTile('Pulsed', emitter.Pulse > 0 ? `${formatNumber(emitter.Pulse, 1)} s` : 'CONTINUOUS', 'burst', emitter.Pulse > 0, () => app.updateNode(emitter.Id, 'Pulse', emitter.Pulse > 0 ? 0 : 1.5)));
        host.appendChild(status);
        host.appendChild(element('div', 'section-head', '<span>Properties</span><span>Shape, injection & motion</span>'));
        host.appendChild(card('Shape', '', [
            choice(emitter, 'Shape', 'Emitter shape', EmitterShapes),
            slider(emitter, 'Radius', 'Radius', 0.05, 2, 0.01, 'm'),
            vector(emitter, 'Position', 'Position (m)'),
            emitter.Shape === 'Disc' ? vector(emitter, 'Orientation', 'Disc normal', 0.1) : null,
        ]));
        host.appendChild(card('Injection', 'Per second', [
            slider(emitter, 'Density', 'Smoke density', 0, 3, 0.05),
            slider(emitter, 'Temperature', 'Temperature', 0, 8, 0.1),
            slider(emitter, 'Fuel', 'Fuel', 0, 2, 0.05),
            slider(emitter, 'Jitter', 'Noise jitter', 0, 1, 0.02),
            slider(emitter, 'Pulse', 'Pulse period', 0, 5, 0.1, 's'),
        ]));
        host.appendChild(card('Exit Velocity', 'm/s', [vector(emitter, 'Velocity', 'Velocity', 0.1)]));
        host.appendChild(card('Motion Path', 'Animated source', [
            choice(emitter, 'PathKind', 'Path', EmitterPathKinds, { None: 'Static', Figure8: 'Figure 8' }),
            emitter.PathKind !== 'None' && emitter.PathKind !== 'Straight' ? slider(emitter, 'PathRadius', emitter.PathKind === 'Slalom' ? 'Weave half-width' : 'Path radius', 0.1, 4, 0.05, 'm') : null,
            emitter.PathKind === 'Straight' || emitter.PathKind === 'Slalom' ? slider(emitter, 'PathSpeed', 'Drive speed', 0, 12, 0.1, 'm/s') : emitter.PathKind !== 'None' ? slider(emitter, 'PathSpeed', 'Angular speed', 0, 4, 0.05, 'rad/s') : null,
            emitter.PathKind === 'Straight' || emitter.PathKind === 'Slalom' ? element('p', 'note', 'Unbounded drive along +X — set the Domain\'s World Grid to follow this emitter so the smoke trail is never clipped.') : null,
            element('p', 'note', 'The emitter orbits its Position along the path; exit velocity is expressed in the moving frame (X = forward, Z = right), so a negative X trails smoke behind it like a drifting tyre.'),
        ]));
        host.appendChild(card('Debris', 'Ballistic ejecta', [
            choice(emitter, 'DebrisKind', 'Kind', DebrisKinds),
            slider(emitter, 'Debris', 'Debris amount', 0, 1, 0.02),
            slider(emitter, 'DebrisSpeed', 'Ejection speed', 0, 20, 0.5, 'm/s', 1),
            element('p', 'note', 'Rubble: heavy, bounces, cools from ember to ash. Ember: near-weightless glowing sparks that drift up with the heat and die on the floor. Paper: light sheets that flutter and get carried by the gas. Shown by the Debris visualizer.'),
        ]));
        host.appendChild(timingCard(emitter));
        host.appendChild(nodeActions(emitter));
    }

    function renderParticleInspector(host, node, snapshot)
    {
        const template = ParticleTemplateById[node.Template] || ParticleTemplates[0];
        const cloner = node.Mode === 'Cloner';
        const evaluation = app.particleEvaluation(node);
        host.appendChild(hero(template.Tint, `${node.Mode} · ${node.Shape}`, cloner ? 'Spring-held formation displaced by the force field' : 'Born, accelerated by the field, aged out', `${node.Count} pts`, template.Icon));
        host.appendChild(element('div', 'metric-grid',
            metric(node.Count, '', 'Particles') +
            metric(cloner ? formatNumber(node.Spring, 1) : formatNumber(node.Lifetime, 1), cloner ? 'k' : 's', cloner ? 'Spring' : 'Lifetime') +
            metric(formatNumber(node.FieldInfluence, 2), '×', 'Field influence') +
            metric(formatNumber(node.Radius, 2), 'm', 'Shape radius')));
        const status = element('div', 'status-grid');
        status.appendChild(statusTile('Enabled', node.Enabled ? 'ON' : 'OFF', 'power', node.Enabled, () => app.updateNode(node.Id, 'Enabled', !node.Enabled)));
        status.appendChild(statusTile('Mode', cloner ? 'CLONER' : 'EMIT', cloner ? 'gridcloner' : 'sparks', cloner, () => app.updateNode(node.Id, 'Mode', cloner ? 'Emit' : 'Cloner')));
        host.appendChild(status);
        host.appendChild(element('div', 'section-head', `<span>Layer stack</span><span>${template.Name} template</span>`));
        renderLayerStack(host, snapshot, {
            stack: node.Stack,
            evaluation,
            specifications: ParticleLayerSpecifications,
            stopped: (reason) => `⚠️ ${node.Name} held: ${reason}. The rest of the scene keeps running.`,
            note: 'Without Gravity, Drag or Field influence the particles ignore them; without Bounce they pass through the floor.',
            owner: node,
        });
        host.appendChild(timingCard(node));
        host.appendChild(nodeActions(node));
    }

    /** Which particle layer parameters apply, given the layer's own amounts (Choice codes) and the evaluated node. */
    function particleParameterShown(name, parameters, node)
    {
        const emit = parameters.Mode === 0, scalar = [1, 2, 3].includes(parameters.ColourMode), trail = parameters.Trail !== 0;
        switch (name)
        {
            case 'Fill': return parameters.Mode === 1 && parameters.Shape === 1;
            case 'Rate': case 'Lifetime': case 'Linger': case 'Speed': case 'Spread': case 'Radial': return emit;
            case 'RampSource': return scalar;
            case 'Ramp': return scalar && parameters.RampSource === 1;
            case 'Palette': return (!scalar || parameters.RampSource === 0) && parameters.ColourMode !== 4;
            case 'MaxSpeed': return parameters.ColourMode === 1;
            case 'DisplacementRange': return parameters.ColourMode === 2;
            case 'CycleSpeed': return parameters.ColourMode === 6;
            case 'Aperture': return parameters.FocusDistance > 0;
            case 'Spring': case 'Damping': case 'Dissolve': return true;
            default: return !(name.startsWith('Trail') && name !== 'Trail') || trail;
        }
    }

    /** Sizes are metres in World units and pixels in Pixels units: the slider range follows. */
    function particleParameterRange(parameter, node)
    {
        if (!['SizeStart', 'SizeEnd', 'TrailWidth'].includes(parameter.Name)) return parameter;
        const world = node.SizeMode !== 'Pixels';
        return world
            ? { ...parameter, Minimum: 0.001, Maximum: parameter.Name === 'TrailWidth' ? 0.1 : 0.15, Step: 0.001, Unit: 'm', Digits: 3 }
            : { ...parameter, Minimum: 0.5, Maximum: 12, Step: 0.5, Unit: 'px', Digits: 1 };
    }

    /** Palette (Ramp8) editor. `holder.Palette` is read; `write(next)` stores the new stop list. */
    function paletteControl(holder, write)
    {
        const palette = holder.Palette;
        const control = element('div', 'control palette');
        const head = element('div', 'control-head', `<span>Palette <span class="unit">${palette.length} stops</span></span>`);
        const tools = element('div', 'palette-tools');
        const add = element('button', 'mini', '+');
        add.title = 'Add stop'; add.disabled = palette.length >= MaximumPaletteStops;
        add.addEventListener('click', () => write([...palette, palette[palette.length - 1]]));
        const shuffle = element('button', 'mini', icon('reset', 10));
        shuffle.title = 'Shuffle order';
        shuffle.addEventListener('click', () => write([...palette].sort(() => Math.random() - 0.5)));
        const reverse = element('button', 'mini', '⇄');
        reverse.title = 'Reverse';
        reverse.addEventListener('click', () => write([...palette].reverse()));
        tools.append(add, shuffle, reverse);
        head.appendChild(tools);
        control.appendChild(head);
        const strip = element('div', 'palette-strip');
        strip.style.background = `linear-gradient(90deg, ${palette.length > 1 ? palette.join(', ') : `${palette[0]}, ${palette[0]}`})`;
        control.appendChild(strip);
        const stops = element('div', 'palette-stops');
        palette.forEach((hex, index) =>
        {
            const stop = element('div', 'palette-stop');
            const input = document.createElement('input');
            input.type = 'color'; input.value = hex; input.title = `Stop ${index + 1}`;
            input.addEventListener('input', () => { const next = [...palette]; next[index] = input.value; write(next); });
            stop.appendChild(input);
            if (palette.length > 1)
            {
                const remove = element('button', 'mini', '×');
                remove.title = 'Remove stop';
                remove.addEventListener('click', () => write(palette.filter((_, i) => i !== index)));
                stop.appendChild(remove);
            }
            stops.appendChild(stop);
        });
        control.appendChild(stops);
        const presets = element('div', 'choice-row');
        for (const [name, swatches] of Object.entries(PalettePresets))
        {
            const button = element('button', '', `<span class="swatch-dots">${swatches.map((hex) => `<i style="background:${hex}"></i>`).join('')}</span>${name}`);
            button.addEventListener('click', () => write([...swatches]));
            presets.appendChild(button);
        }
        control.appendChild(presets);
        return control;
    }

    function renderColliderInspector(host, collider)
    {
        host.appendChild(hero('#94a3b8', 'Sphere collider', 'No-slip solid boundary', `r ${formatNumber(collider.Radius, 2)} m`, 'collider'));
        host.appendChild(element('div', 'metric-grid',
            metric(formatNumber(collider.Radius, 2), 'm', 'Radius') +
            metric(collider.Position.map((value) => formatNumber(value, 1)).join(', '), '', 'Centre')));
        const status = element('div', 'status-grid');
        status.appendChild(statusTile('Enabled', collider.Enabled ? 'ON' : 'OFF', 'power', collider.Enabled, () => app.updateNode(collider.Id, 'Enabled', !collider.Enabled)));
        status.appendChild(statusTile('Visible', collider.Visible ? 'SHOWN' : 'HIDDEN', 'eye', collider.Visible, () => app.updateNode(collider.Id, 'Visible', !collider.Visible)));
        host.appendChild(status);
        host.appendChild(element('div', 'section-head', '<span>Properties</span><span>Placement</span>'));
        host.appendChild(card('Solid', 'Pressure boundary', [
            slider(collider, 'Radius', 'Radius', 0.05, 2, 0.01, 'm'),
            vector(collider, 'Position', 'Position (m)'),
        ]));
        host.appendChild(nodeActions(collider));
    }

    function renderVisualizerInspector(host, visualizer)
    {
        host.appendChild(hero('#38bdf8', visualizer.Name, 'Viewport diagnostic overlay', visualizer.Visible ? 'Shown' : 'Hidden', nodeIcon(visualizer)));
        const status = element('div', 'status-grid');
        status.appendChild(statusTile('Visible', visualizer.Visible ? 'ON' : 'OFF', 'eye', visualizer.Visible, () => app.updateNode(visualizer.Id, 'Visible', !visualizer.Visible)));
        if (visualizer.Ramp)
        {
            const legend = element('div', 'status-tile', `<span class="tile-icon" style="width:100%;height:10px;border-radius:5px;background:${rampGradient(visualizer.Ramp)}"></span><span class="tile-label">${visualizer.Ramp}</span><span class="tile-state">Colour ramp</span>`);
            legend.disabled = true;
            status.appendChild(legend);
        }
        host.appendChild(status);
        host.appendChild(element('div', 'section-head', '<span>Properties</span><span>Overlay settings</span>'));
        if (visualizer.Id === 'vis-volume')
        {
            const owned = element('p', 'note layer-owned', 'Fire and smoke values belong to the Fire shading and Smoke shading layers of the Gas Domain; edits here are written to those layers (one is added if missing). ');
            const openStack = element('button', 'link-button', 'Open layer stack');
            openStack.addEventListener('click', () => app.select('domain'));
            owned.appendChild(openStack);
            host.appendChild(owned);
            host.appendChild(card('Fire', 'Incandescence', [
                lookChips(visualizer, 'Fire preset', FireLooks, (look) => visualizer.FireEmber === look.FireEmber),
                colour(visualizer, 'FireEmber', 'Ember (cool edge)'),
                colour(visualizer, 'FireFlame', 'Flame body'),
                colour(visualizer, 'FireCore', 'Hot core'),
                slider(visualizer, 'FireIntensity', 'Fire emission', 0, 12, 0.1),
                slider(visualizer, 'FireThreshold', 'Ignition temperature', 0.3, 3, 0.05),
                slider(visualizer, 'FireSoftness', 'Temperature span', 0.5, 8, 0.1),
                slider(visualizer, 'FireOpacity', 'Flame opacity', 0, 4, 0.05),
            ]));
            host.appendChild(card('Smoke', 'Scattering', [
                lookChips(visualizer, 'Smoke preset', SmokeLooks, (look) => visualizer.Albedo === look.Albedo),
                colour(visualizer, 'Albedo', 'Smoke albedo'),
                slider(visualizer, 'Density', 'Density scale', 0, 4, 0.05),
                slider(visualizer, 'Absorption', 'Extinction', 0.2, 12, 0.1, '/m'),
                slider(visualizer, 'Anisotropy', 'Forward scatter', 0, 0.9, 0.01),
            ]));
            host.appendChild(card('Lighting', 'Sun + sky', [
                choice(visualizer, 'Filter', 'Volume filtering', VolumeFilters, { Smooth: 'Smooth (trilinear)', Voxel: 'Voxel (show cells)' }),
                slider(visualizer, 'LightIntensity', 'Sun intensity', 0, 4, 0.05),
                slider(visualizer, 'FireLight', 'Fire lights smoke', 0, 4, 0.05),
                colour(visualizer, 'Ambient', 'Ambient sky'),
                slider(visualizer, 'Exposure', 'Exposure', 0.2, 4, 0.05),
                slider(visualizer, 'Steps', 'March steps', 24, 256, 4, '', 0),
                slider(visualizer, 'ShadowSteps', 'Shadow steps', 0, 16, 1, '', 0),
            ]));
        }
        else if (visualizer.Id === 'vis-vectors')
        {
            host.appendChild(card('Vector Slice', 'Velocity arrows', [
                choice(visualizer, 'Axis', 'Slice axis', SliceAxes),
                slider(visualizer, 'Offset', 'Slice position', 0, 1, 0.01),
                slider(visualizer, 'Stride', 'Cell stride', 1, 8, 1, '', 0),
                slider(visualizer, 'Scale', 'Arrow scale', 0.02, 1.5, 0.01, 's'),
                slider(visualizer, 'MaxSpeed', 'Ramp max speed', 0.5, 20, 0.1, 'm/s'),
                choice(visualizer, 'Ramp', 'Colour ramp', ColourRamps),
            ]));
        }
        else if (visualizer.Id === 'vis-forces')
        {
            host.appendChild(card('Force Field Vectors', 'Σ generators', [
                choice(visualizer, 'Mode', 'Sampling', VectorModes, { Slice: 'Slice plane', Volume: 'Sparse 3D' }),
                visualizer.Mode === 'Slice' ? choice(visualizer, 'Axis', 'Slice axis', SliceAxes) : null,
                visualizer.Mode === 'Slice' ? slider(visualizer, 'Offset', 'Slice position', 0, 1, 0.01) : null,
                slider(visualizer, 'Stride', 'Cell stride', 1, 12, 1, '', 0),
                slider(visualizer, 'Scale', 'Arrow scale', 0.005, 0.3, 0.005, 's²'),
                slider(visualizer, 'MaxForce', 'Ramp max |F|', 1, 100, 1, 'm/s²'),
                choice(visualizer, 'Ramp', 'Colour ramp', ColourRamps),
            ]));
            host.appendChild(element('p', 'note', 'Shows the summed acceleration of every enabled force generator at each sample point (evaluated live on the GPU), independent of the current gas velocity except for velocity-dependent types (Drag, Flow Stream).'));
        }
        else if (visualizer.Id === 'vis-slice')
        {
            host.appendChild(card('Scalar Slice', 'Heat-map', [
                choice(visualizer, 'Channel', 'Channel', ScalarChannels, { ForceMagnitude: 'Force |F|' }),
                choice(visualizer, 'Axis', 'Slice axis', SliceAxes),
                slider(visualizer, 'Offset', 'Slice position', 0, 1, 0.01),
                slider(visualizer, 'Range', 'Ramp range', 0.1, 40, 0.1),
                slider(visualizer, 'Opacity', 'Opacity', 0, 1, 0.02),
                choice(visualizer, 'Ramp', 'Colour ramp', ColourRamps),
            ]));
        }
        else if (visualizer.Id === 'vis-debris')
        {
            host.appendChild(card('Debris', 'Ballistic GPU particles', [
                slider(visualizer, 'Count', 'Particle budget', 256, 4096, 256, '', 0),
                slider(visualizer, 'Lifetime', 'Lifetime', 1, 15, 0.5, 's'),
                slider(visualizer, 'Size', 'Point size', 1, 8, 0.5, 'px'),
                slider(visualizer, 'Gravity', 'Gravity', 0, 20, 0.1, 'm/s²'),
                slider(visualizer, 'Drag', 'Gas coupling', 0, 6, 0.1),
                slider(visualizer, 'Bounce', 'Floor restitution', 0, 0.9, 0.05),
                slider(visualizer, 'Glow', 'Ember glow time', 0.1, 4, 0.1, 's'),
            ]));
            host.appendChild(element('p', 'note', 'Debris is sourced from emitters with a Debris amount above zero. Hot fragments glow, cool to ash, and come to rest on the domain floor.'));
        }
        else if (visualizer.Id === 'vis-tracers')
        {
            host.appendChild(card('Flow Tracers', 'GPU particles', [
                slider(visualizer, 'Count', 'Tracer count', 256, 8192, 256, '', 0),
                slider(visualizer, 'Lifetime', 'Lifetime', 0.5, 12, 0.1, 's'),
                slider(visualizer, 'Size', 'Point size', 1, 6, 0.5, 'px'),
                slider(visualizer, 'MaxSpeed', 'Ramp max speed', 0.5, 20, 0.1, 'm/s'),
                choice(visualizer, 'Ramp', 'Colour ramp', ColourRamps),
            ]));
        }
        else
        {
            host.appendChild(card('Gizmos', 'Forces + emitters', [slider(visualizer, 'Opacity', 'Opacity', 0, 1, 0.02)]));
            host.appendChild(element('p', 'note', 'Gizmos are inspection overlays only — they never alter solver state. Hidden by default: the selected node always shows its gizmo; Edit mode or this toggle shows all. Click a gizmo centre to select it, drag to move (hold Shift to lock height).'));
        }
    }

    function nodeActions(node)
    {
        const actions = element('div', 'action-row');
        const duplicate = element('button', '', `${icon('copy', 12)} Duplicate`);
        duplicate.addEventListener('click', () => app.duplicateNode(node.Id));
        const remove = element('button', 'danger', `${icon('trash', 12)} Delete`);
        remove.addEventListener('click', () => app.removeNode(node.Id));
        actions.append(duplicate, remove);
        return actions;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  VIEWPORT TOOLBAR + TRANSPORT
    //------------------------------------------------------------------------------------------------------------------------

    function renderToolbar(snapshot)
    {
        const host = refs.toolbar;
        host.innerHTML = '';
        const scene = snapshot.scene;
        const rowA = element('div', 'toolbar-row');
        rowA.innerHTML = `<div class="scene-title"><span class="scene-icon">${icon('scene', 15)}</span><span class="meta"><strong>${scene.Name}</strong><span>${scene.Forces.length} forces · ${scene.Emitters.length} emitters · ${scene.Domain.Resolution.join('×')}</span></span></div><span class="chip">PREVIEW</span>`;
        const segmented = element('div', 'segmented');
        for (const [key, label, glyph] of [['edit', 'Edit', 'pencil'], ['sim', 'Sim', 'vectors'], ['play', 'Play', 'play']])
        {
            const button = element('button', state.mode === key ? 'active' : '', `${icon(glyph, 11)} ${label}`);
            button.addEventListener('click', () => setMode(key));
            segmented.appendChild(button);
        }
        const scenes = element('button', 'scenes-button', `${icon('scene', 12)} Scenes <span class="badge">${ScenePresets.length}</span>`);
        scenes.title = 'Open the scene preset browser';
        scenes.addEventListener('click', () => toggleDrawer(true, 'presets'));
        rowA.appendChild(scenes);
        const flipbookButton = element('button', 'scenes-button', `${icon('download', 12)} Flipbook`);
        flipbookButton.title = 'Bake the simulation into a sprite sheet';
        flipbookButton.addEventListener('click', () => toggleDrawer(!state.drawerOpen || state.drawerTab !== 'flipbook', 'flipbook'));
        rowA.appendChild(flipbookButton);
        rowA.appendChild(segmented);
        host.appendChild(rowA);

        const rowB = element('div', 'toolbar-row');
        const addForce = element('button', 'pill primary', `${icon('plus', 12)} Add Force <span class="shortcut">Drawer</span>`);
        addForce.addEventListener('click', () => toggleDrawer(!state.drawerOpen || state.drawerTab !== 'forces', 'forces'));
        rowB.appendChild(addForce);
        const frame = element('button', 'view-toggle', icon('frame', 14));
        frame.title = 'Frame domain (F)';
        frame.addEventListener('click', () => app.frameDomain());
        rowB.appendChild(frame);
        const cameraSelect = element('div', 'pill-select', `<span class="leading-icon">${icon('perspective', 13)}</span>`);
        const select = document.createElement('select');
        for (const [value, label] of [['threeQuarter', 'Perspective'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top']])
        {
            const option = document.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
        }
        select.addEventListener('change', () => app.setCameraPreset(select.value));
        cameraSelect.appendChild(select);
        rowB.appendChild(cameraSelect);
        rowB.appendChild(element('div', 'toolbar-spacer'));
        for (const [id, glyph, title] of [['vis-volume', 'volume', 'Volume render'], ['vis-vectors', 'vectors', 'Velocity vectors'], ['vis-slice', 'slice', 'Scalar slice'], ['vis-tracers', 'tracers', 'Flow tracers'], ['vis-forces', 'dburst', 'Force field vectors'], ['vis-debris', 'debris', 'Debris particles'], ['vis-gizmos', 'gizmo', 'Force gizmos']])
        {
            const visualizer = Object.values(scene.Visualizers).find((candidate) => candidate.Id === id);
            const button = element('button', 'view-toggle' + (visualizer.Visible ? ' active' : ''), icon(glyph, 14));
            button.title = title;
            button.addEventListener('click', () => app.updateNode(id, 'Visible', !visualizer.Visible));
            rowB.appendChild(button);
        }
        host.appendChild(rowB);
    }

    function setMode(mode)
    {
        state.mode = mode;
        const gizmos = app.scene.Visualizers.ForceGizmos;
        if (mode === 'play') { gizmos.Visible = false; app.scene.Visualizers.VelocityVectors.Visible = false; app.play(); }
        else if (mode === 'edit') { gizmos.Visible = true; app.pause(); }
        else { gizmos.Visible = true; app.play(); }
    }

    function renderTransport(snapshot)
    {
        const host = refs.transport;
        host.innerHTML = '';
        const play = element('button', 'primary', icon(snapshot.playing ? 'pause' : 'play', 14));
        play.title = snapshot.playing ? 'Pause (Space)' : 'Play (Space)';
        play.addEventListener('click', () => app.togglePlay());
        const step = element('button', '', icon('step', 14));
        step.title = 'Step one frame (.)';
        step.addEventListener('click', () => app.stepOnce());
        const reset = element('button', '', icon('reset', 14));
        reset.title = 'Reset fields (R)';
        reset.addEventListener('click', () => app.reset());
        const readout = element('div', 'readout', `<strong id="transport-time">0.00 s</strong><span id="transport-frame">frame 0</span>`);
        host.append(play, step, reset, readout);
    }

    function renderLegend(snapshot)
    {
        const host = refs.legend;
        host.innerHTML = '';
        const visualizers = snapshot.scene.Visualizers;
        const entries = [];
        if (visualizers.VelocityVectors.Visible) entries.push({ title: 'Velocity', ramp: visualizers.VelocityVectors.Ramp, min: '0', max: `${formatNumber(visualizers.VelocityVectors.MaxSpeed, 1)} m/s` });
        if (visualizers.Tracers.Visible && !(visualizers.VelocityVectors.Visible && visualizers.Tracers.Ramp === visualizers.VelocityVectors.Ramp)) entries.push({ title: 'Tracer speed', ramp: visualizers.Tracers.Ramp, min: '0', max: `${formatNumber(visualizers.Tracers.MaxSpeed, 1)} m/s` });
        if (visualizers.ForceVectors && visualizers.ForceVectors.Visible) entries.push({ title: 'Force |F|', ramp: visualizers.ForceVectors.Ramp, min: '0', max: `${formatNumber(visualizers.ForceVectors.MaxForce, 0)} m/s²` });
        if (visualizers.ScalarSlice.Visible)
        {
            const signed = visualizers.ScalarSlice.Channel === 'Pressure' || visualizers.ScalarSlice.Channel === 'Divergence';
            entries.push({ title: visualizers.ScalarSlice.Channel, ramp: visualizers.ScalarSlice.Ramp, min: signed ? `−${formatNumber(visualizers.ScalarSlice.Range, 1)}` : '0', max: formatNumber(visualizers.ScalarSlice.Range, 1) });
        }
        for (const entry of entries)
            host.appendChild(element('div', 'legend-card', `<strong>${entry.title}</strong><div class="ramp" style="background:${rampGradient(entry.ramp)}"></div><div class="range"><span>${entry.min}</span><span>${entry.max}</span></div>`));
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  NOTCH + DRAWER
    //------------------------------------------------------------------------------------------------------------------------

    function renderNotch()
    {
        refs.notch.innerHTML = `<span class="notch-dot"></span><span>Project-Zero</span><span style="color:#555">·</span><span>Fluid Studio</span>`;
        refs.notch.addEventListener('click', () => { state.notchOpen = !state.notchOpen; refs.notchMenu.classList.toggle('open', state.notchOpen); });
        const menu = refs.notchMenu;
        menu.innerHTML = '';
        menu.appendChild(element('h4', '', 'Workspace'));
        const workspaces = element('div', 'notch-grid');
        for (const [label, sub, active] of [['World', 'Scene editor', false], ['Fluid', 'Gas + fire solver', true], ['ForceField', 'Vector field design', false]])
        {
            workspaces.appendChild(element('button', active ? 'active' : '', `<strong>${label}</strong><span>${sub}</span>`));
        }
        menu.appendChild(workspaces);
        menu.appendChild(element('h4', '', 'Scene document'));
        const documentRow = element('div', 'notch-grid');
        const exportButton = element('button', '', `<strong>${icon('download', 12)} Export</strong><span>.FluidScene JSON</span>`);
        exportButton.addEventListener('click', () =>
        {
            const blob = new Blob([app.exportJson()], { type: 'application/json' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${app.scene.Name.replace(/\s+/g, '')}.FluidScene.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        });
        const importButton = element('button', '', `<strong>${icon('upload', 12)} Import</strong><span>Load JSON</span>`);
        importButton.addEventListener('click', () =>
        {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'application/json';
            input.addEventListener('change', () =>
            {
                const file = input.files && input.files[0];
                if (!file) return;
                file.text().then((text) => app.importJson(text)).catch((error) => alert(error.message));
            });
            input.click();
        });
        const presetButton = element('button', '', `<strong>${icon('download', 12)} Save as preset</strong><span>.toml document</span>`);
        presetButton.title = 'Writes a frontier-fluid-preset document. Put it in Experimental/FluidEditor/Presets/ and run node GeneratePresetLibrary.mjs to add it to the Scenes list.';
        presetButton.addEventListener('click', () =>
        {
            const slug = app.scene.Name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
            downloadBlob(new Blob([app.exportPresetToml({ Id: `preset-${slug}`, Family: 'Custom' })], { type: 'application/toml' }), `${slug}.toml`);
        });
        const resetButton = element('button', '', `<strong>${icon('reset', 12)} Reload</strong><span>Reset preset</span>`);
        resetButton.addEventListener('click', () => app.loadPreset(app.scene.PresetId || ScenePresets[0].Id));
        documentRow.append(exportButton, importButton, presetButton, resetButton);
        menu.appendChild(documentRow);
        menu.appendChild(element('p', 'note', 'Shortcuts — Space play/pause · . step · R reset · F frame · Delete remove selection · LMB orbit · RMB/MMB pan · Wheel dolly · drag gizmo to move (Shift locks height).'));
        document.addEventListener('pointerdown', (event) =>
        {
            if (state.notchOpen && !menu.contains(event.target) && !refs.notch.contains(event.target)) { state.notchOpen = false; menu.classList.remove('open'); }
        });
    }

    function toggleDrawer(open, tab)
    {
        state.drawerOpen = open;
        if (tab) state.drawerTab = tab;
        refs.drawer.classList.toggle('open', open);
        renderDrawer();
    }

    function renderDrawer()
    {
        const drawer = refs.drawer;
        drawer.innerHTML = '';
        const head = element('div', 'drawer-head', `<span style="color:#ddd;font-size:12px">${icon('folder', 13)}</span>`);
        const seg = element('div', 'seg');
        for (const [key, label] of [['presets', 'Scene Presets'], ['forces', 'Force Generators'], ['particles', 'Particle Systems'], ['emitters', 'Emitters & Colliders'], ['flipbook', 'Flipbook']])
        {
            const button = element('button', state.drawerTab === key ? 'active' : '', label);
            button.addEventListener('click', () => { state.drawerTab = key; renderDrawer(); });
            seg.appendChild(button);
        }
        head.appendChild(seg);
        head.appendChild(element('span', 'hint', state.drawerTab === 'forces' ? `Click a card to construct it in the domain · ${app.scene.Forces.length}/${MaximumForceGenerators} slots used` : state.drawerTab === 'particles' ? `Mograph-style GPU particles driven by the same force gizmos · ${(app.scene.Particles || []).length}/${MaximumParticleSystems} systems` : state.drawerTab === 'flipbook' ? 'Bake the simulation into a sprite-sheet PNG + JSON for game engines' : 'Click a card to construct'));
        const close = element('button', 'icon-button', '×');
        close.addEventListener('click', () => toggleDrawer(false));
        head.appendChild(close);
        drawer.appendChild(head);
        const body = element('div', 'drawer-body');
        if (state.drawerTab === 'flipbook') renderFlipbook(body);
        else if (state.drawerTab === 'presets')
        {
            body.classList.add('categorised');
            for (const [family, title] of [['Studio', 'Fluid Studio scenes'], ['Pyro', 'Pyro scenes · from the other fluid editor']])
            {
                const members = ScenePresets.filter((preset) => preset.Family === family);
                const group = element('div', 'asset-group');
                group.appendChild(element('h4', '', `${title} <span>${members.length}</span>`));
                const row = element('div', 'asset-row');
                for (const preset of members)
                {
                    const cardNode = element('button', 'asset-card', `<div class="thumb" style="background:linear-gradient(140deg,#2a2a2a,#141414)">${icon(preset.Icon, 34, 1)}</div><strong>${preset.Name}</strong><span>${preset.Summary}</span><span class="badge">${preset.Grid.Resolution.join('×')}</span>`);
                    cardNode.addEventListener('click', () => app.loadPreset(preset.Id));
                    row.appendChild(cardNode);
                }
                group.appendChild(row);
                body.appendChild(group);
            }
        }
        else if (state.drawerTab === 'forces')
        {
            body.classList.add('categorised');
            for (const category of ForceCategories)
            {
                const group = element('div', 'asset-group');
                group.appendChild(element('h4', '', `${category} <span>${ForceGeneratorTypes.filter((type) => type.Category === category).length}</span>`));
                const row = element('div', 'asset-row');
                for (const type of ForceGeneratorTypes.filter((entry) => entry.Category === category))
                {
                    const cardNode = element('button', 'asset-card', `<div class="thumb" style="background:linear-gradient(140deg,${type.Tint}55,#141414)">${icon(type.Icon, 34, 1)}</div><strong>${type.Name}</strong><span>${type.Summary}</span><span class="badge">${FalloffLabels[type.Defaults.Falloff]} falloff</span>`);
                    cardNode.addEventListener('click', () => { app.addForce(type.Id); });
                    row.appendChild(cardNode);
                }
                group.appendChild(row);
                body.appendChild(group);
            }
        }
        else if (state.drawerTab === 'particles')
        {
            body.classList.add('categorised');
            for (const category of ParticleCategories)
            {
                const group = element('div', 'asset-group');
                group.appendChild(element('h4', '', `${category} <span>${ParticleTemplates.filter((template) => template.Category === category).length}</span>`));
                const row = element('div', 'asset-row');
                for (const template of ParticleTemplates.filter((entry) => entry.Category === category))
                {
                    const cardNode = element('button', 'asset-card', `<div class="thumb" style="background:linear-gradient(140deg,${template.Tint}55,#141414)">${icon(template.Icon, 34, 1)}</div><strong>${template.Name}</strong><span>${template.Summary}</span><span class="badge">${template.Defaults.Mode} · ${template.Defaults.Shape}</span>`);
                    cardNode.addEventListener('click', () => { app.addParticles(template.Id); });
                    row.appendChild(cardNode);
                }
                group.appendChild(row);
                body.appendChild(group);
            }
        }
        else
        {
            for (const [shape, summary] of [['Sphere', 'Volumetric source of smoke, heat or fuel.'], ['Disc', 'Flat nozzle — orient the normal to aim the jet.'], ['Box', 'Cubic source region with soft edges.']])
            {
                const cardNode = element('button', 'asset-card', `<div class="thumb" style="background:linear-gradient(140deg,#f9731655,#141414)">${icon('flame', 34, 1)}</div><strong>${shape} Emitter</strong><span>${summary}</span><span class="badge">Emitter</span>`);
                cardNode.addEventListener('click', () => app.addEmitter(shape));
                body.appendChild(cardNode);
            }
            const collider = element('button', 'asset-card', `<div class="thumb" style="background:linear-gradient(140deg,#94a3b855,#141414)">${icon('collider', 34, 1)}</div><strong>Sphere Collider</strong><span>Solid obstacle: no-slip walls with pressure Neumann boundary.</span><span class="badge">Collider</span>`);
            collider.addEventListener('click', () => app.addCollider());
            body.appendChild(collider);
        }
        drawer.appendChild(body);
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  METRICS + STATUS BAR
    //------------------------------------------------------------------------------------------------------------------------

    function updateMetrics(metrics)
    {
        state.metrics = metrics;
        const time = document.getElementById('transport-time');
        const frame = document.getElementById('transport-frame');
        if (time) time.textContent = `${metrics.simulationTime.toFixed(2)} s`;
        if (frame) frame.textContent = `frame ${metrics.simulationFrame}`;
        refs.statusFps.textContent = `${metrics.fps.toFixed(0)} fps`;
        refs.statusStep.textContent = `${metrics.stepMilliseconds.toFixed(1)} ms · ${metrics.passes} passes`;
        refs.statusGrid.textContent = `${metrics.resolution.join('×')} · ${formatCells(metrics.cells)}`;
        refs.statusForces.textContent = `${metrics.forces} active · ${metrics.emitters} emitters${metrics.particleSystems ? ` · ${formatCells(metrics.particles)} particles` : ''}`;
        refs.statusText.innerHTML = `HTML preview · <b>WebGL2 GPU solver</b> · ${metrics.playing ? 'simulating' : 'paused'} · no engine connection`;
    }

    //------------------------------------------------------------------------------------------------------------------------
    //                                                  FLIPBOOK DRAWER
    //------------------------------------------------------------------------------------------------------------------------

    function renderFlipbook(body)
    {
        const settings = state.flipbook;
        body.classList.add('flipbook-body');
        const locked = settings.baking ? ' disabled' : '';

        // Settings card.
        const setup = element('div', 'flipbook-card');
        setup.appendChild(element('h4', '', 'Sheet'));
        const choice = (label, key, values, suffix) =>
        {
            const row = element('label', 'flipbook-row', `<span>${label}</span>`);
            const select = document.createElement('select');
            select.disabled = settings.baking;
            for (const value of values)
            {
                const option = document.createElement('option');
                option.value = value; option.textContent = `${value}${suffix}`; option.selected = value === settings[key];
                select.appendChild(option);
            }
            select.addEventListener('change', () => { settings[key] = Number(select.value); renderDrawer(); });
            row.appendChild(select);
            return row;
        };
        setup.appendChild(choice('Frames', 'Count', FlipbookChoices.Count, ''));
        setup.appendChild(choice('Tile size', 'Size', FlipbookChoices.Size, ' px'));
        setup.appendChild(choice('Frame rate', 'Rate', FlipbookChoices.Rate, ' fps'));
        const warm = element('label', 'flipbook-row', `<span>Warm-up</span><input type="number" min="0" max="3" step="0.5" value="${settings.Warmup}"${locked}><em>s</em>`);
        warm.querySelector('input').addEventListener('change', (event) => { settings.Warmup = Math.max(0, Math.min(3, Number(event.target.value) || 0)); renderDrawer(); });
        setup.appendChild(warm);
        const columns = Math.ceil(Math.sqrt(settings.Count));
        setup.appendChild(element('p', 'flipbook-note', `${columns} × ${Math.ceil(settings.Count / columns)} grid · ${columns * settings.Size} × ${Math.ceil(settings.Count / columns) * settings.Size} px · ${(settings.Count / settings.Rate).toFixed(2)} s of playback`));
        body.appendChild(setup);

        // Options + bake card.
        const options = element('div', 'flipbook-card');
        options.appendChild(element('h4', '', 'Bake'));
        const toggle = (label, key, hint) =>
        {
            const row = element('label', 'flipbook-toggle', `<input type="checkbox"${settings[key] ? ' checked' : ''}${locked}><span><strong>${label}</strong><em>${hint}</em></span>`);
            row.querySelector('input').addEventListener('change', (event) => { settings[key] = event.target.checked; });
            return row;
        };
        options.appendChild(toggle('Start from an empty grid', 'Restart', 'Otherwise the bake continues from the current frame'));
        options.appendChild(toggle('Transparent background', 'Transparent', 'No floor or sky; straight alpha from smoke and fire'));
        const progress = element('div', 'flipbook-progress', `<div class="bar"><span style="width:${Math.round(settings.progress * 100)}%"></span></div><p id="flipbook-label">${settings.label}</p>`);
        options.appendChild(progress);
        const bake = element('button', 'pill primary', settings.baking ? `${icon('pause', 12)} Cancel` : `${icon('play', 12)} Bake flipbook`);
        bake.addEventListener('click', () => { if (settings.baking) settings.cancelled = true; else startFlipbookBake(); });
        options.appendChild(bake);
        body.appendChild(options);

        // Preview + export card.
        const preview = element('div', 'flipbook-card flipbook-preview');
        preview.appendChild(element('h4', '', 'Result'));
        preview.insertAdjacentHTML('beforeend', '<canvas id="flipbook-preview" width="168" height="168"></canvas>');
        const side = element('div', 'flipbook-side');
        if (settings.result)
        {
            const metadata = settings.result.metadata;
            side.appendChild(element('p', 'flipbook-note', `${settings.result.name}<br>${metadata.width} × ${metadata.height} · ${metadata.frameCount} frames · ${metadata.framesPerSecond} fps`));
            const scrub = element('label', 'flipbook-row', `<span>Frame</span><input type="range" min="0" max="${metadata.frameCount - 1}" value="${settings.frame}"><em id="flipbook-frame">${settings.frame + 1}</em>`);
            scrub.querySelector('input').addEventListener('input', (event) => { settings.play = false; settings.frame = Number(event.target.value); drawFlipbookPreview(); });
            side.appendChild(scrub);
            const play = element('label', 'flipbook-toggle', `<input type="checkbox"${settings.play ? ' checked' : ''}><span><strong>Loop playback</strong></span>`);
            play.querySelector('input').addEventListener('change', (event) => { settings.play = event.target.checked; });
            side.appendChild(play);
            const png = element('button', 'pill', `${icon('download', 12)} Sheet .png`);
            png.addEventListener('click', () => settings.result.sheet.toBlob((blob) => downloadBlob(blob, `${settings.result.name}.flipbook.png`), 'image/png'));
            const json = element('button', 'pill', `${icon('download', 12)} Timing + UV .json`);
            json.addEventListener('click', () => downloadBlob(new Blob([JSON.stringify(settings.result.metadata, null, 2)], { type: 'application/json' }), `${settings.result.name}.flipbook.json`));
            side.append(png, json);
        }
        else side.appendChild(element('p', 'flipbook-note', 'No bake yet. The sheet uses the viewport camera, so frame the shot first.'));
        preview.appendChild(side);
        body.appendChild(preview);
        drawFlipbookPreview();
    }

    function drawFlipbookPreview()
    {
        const settings = state.flipbook;
        const canvas = document.getElementById('flipbook-preview');
        if (!canvas) return;
        const context = canvas.getContext('2d');
        context.fillStyle = '#101010';
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (!settings.result) return;
        const frame = settings.result.metadata.frames[settings.frame];
        if (settings.result.metadata.alphaMode !== 'opaque')
        {
            // Checkerboard behind transparent frames so the alpha is visible.
            for (let y = 0; y < canvas.height; y += 12) for (let x = 0; x < canvas.width; x += 12) { context.fillStyle = ((x + y) / 12) % 2 ? '#2a2a2a' : '#1a1a1a'; context.fillRect(x, y, 12, 12); }
        }
        context.drawImage(settings.result.sheet, frame.x, frame.y, frame.width, frame.height, 0, 0, canvas.width, canvas.height);
        const label = document.getElementById('flipbook-frame');
        if (label) label.textContent = `${settings.frame + 1}`;
    }

    function downloadBlob(blob, name)
    {
        if (!blob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1500);
    }

    async function startFlipbookBake()
    {
        const settings = state.flipbook;
        settings.baking = true;
        settings.cancelled = false;
        settings.progress = 0;
        settings.label = 'Starting the bake…';
        renderDrawer();
        const report = (fraction, text) =>
        {
            settings.progress = fraction;
            settings.label = text;
            const bar = refs.drawer.querySelector('.flipbook-progress .bar span');
            if (bar) bar.style.width = `${Math.round(fraction * 100)}%`;
            const label = document.getElementById('flipbook-label');
            if (label) label.textContent = text;
        };
        try
        {
            settings.result = await app.bakeFlipbook(settings, report, () => settings.cancelled);
            settings.frame = 0;
            settings.label = 'Bake complete — download the sheet and its timing / UV metadata.';
            settings.progress = 1;
        }
        catch (error)
        {
            settings.label = error.message;
        }
        settings.baking = false;
        renderDrawer();
    }

    // Loop the baked frames at their own rate while the Flipbook drawer is open.
    let flipbookClock = 0;
    function flipbookPlayback(time)
    {
        requestAnimationFrame(flipbookPlayback);
        const settings = state.flipbook;
        if (!settings.result || !settings.play || settings.baking || !state.drawerOpen || state.drawerTab !== 'flipbook') return;
        if (time - flipbookClock < 1000 / settings.result.metadata.framesPerSecond) return;
        flipbookClock = time;
        settings.frame = (settings.frame + 1) % settings.result.metadata.frameCount;
        drawFlipbookPreview();
        const scrub = refs.drawer.querySelector('.flipbook-preview input[type=range]');
        if (scrub) scrub.value = settings.frame;
    }
    requestAnimationFrame(flipbookPlayback);

    function renderAll(snapshot)
    {
        state.snapshot = snapshot;
        renderOutliner(snapshot);
        renderInspector(snapshot);
        renderToolbar(snapshot);
        renderTransport(snapshot);
        renderLegend(snapshot);
        if (state.drawerOpen) renderDrawer();
        if (state.metrics) updateMetrics(state.metrics);
    }

    renderNotch();
    refs.drawerTab.innerHTML = `${icon('folder', 12)} Asset Browser`;
    refs.drawerTab.addEventListener('click', () => toggleDrawer(!state.drawerOpen));
    document.addEventListener('keydown', (event) =>
    {
        if (event.key === 'Escape') closeContextMenu();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f')
        {
            event.preventDefault();
            const input = refs.outliner.querySelector('.search-pill input');
            if (input) input.focus();
        }
    });

    return { renderAll, updateMetrics, toggleDrawer };
}
