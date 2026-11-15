// Particle Studio UI · centre dock header (written from scratch).
// Scene documents as dock tabs (+ new), the "Particle Studio" notch, then the viewport header: identity seat + title /
// subtitle, LIVE and engine badges, Scene / Assets / Log segments, help and Export, and a tools row (camera, overlay,
// throw-ball, view toggles). Element ids are the contract the editor binds to.
import { h, Icon } from './Dom.js';

export function CreateHeader(Host)
{
    const Tabs = h('div', { class: 'ps-scene-tabs', id: 'scene-tabs', role: 'tablist', 'aria-label': 'Particle scenes' });
    const NewScene = h('button', { class: 'ps-dock-add', id: 'new-scene-btn', type: 'button', title: 'New blank particle scene', 'aria-label': 'New scene' }, Icon('Plus'));

    const Round = (Id, Glyph, Title, Extra = '') => h('button', { class: 'ps-tool ' + Extra, id: Id, type: 'button', title: Title, 'aria-label': Title }, Icon(Glyph));
    const Mode = (Id, Label, CountId, Count) => h('button', { class: 'ps-mode' + (Id === 'nav-workspace' ? ' active' : ''), id: Id, type: 'button' }, Label, CountId ? h('small', { id: CountId }, Count) : null);

    const Camera = h('select', { class: 'ps-native-pick', id: 'camera-view-select', 'aria-label': 'Camera view' },
        h('option', { value: 'orbit' }, 'Perspective orbit'),
        h('option', { value: 'top' }, 'Top lattice'),
        h('option', { value: 'front' }, 'Front axis'),
        h('option', { value: 'side' }, 'Side elevation'));
    const Overlay = h('select', { class: 'ps-native-pick', id: 'overlay-channel-select', 'aria-label': 'Field overlay' },
        h('option', { value: 'Flow' }, 'Field · Flow (m/s)'),
        h('option', { value: 'Accelerate' }, 'Field · Accelerate (m/s²)'),
        h('option', { value: 'Damp' }, 'Field · Damp (1/s)'),
        h('option', { value: 'off', selected: true }, 'Clean viewport'));

    Host.append(
        h('header', { class: 'ps-docktabs ps-scene-dock' }, Tabs, NewScene),
        h('div', { class: 'ps-notch' }, h('span', null, 'Particle Studio')),
        h('div', { class: 'ps-vp-head' },
            h('div', { class: 'ps-vp-row' },
                h('div', { class: 'ps-vp-id' },
                    h('span', { class: 'ps-vp-seat', id: 'viewport-title-icon' }, Icon('Sparkles')),
                    h('span', { class: 'ps-vp-copy' },
                        h('strong', { id: 'viewport-object' }, 'Force Field'),
                        h('small', { id: 'viewport-subtitle' }, 'Particle scene')),
                    h('span', { class: 'ps-badge live', id: 'live-pill' }, h('i'), h('span', { id: 'live-pill-label' }, 'Live')),
                    h('span', { class: 'ps-badge', id: 'engine-pill', 'aria-describedby': 'status-ready' },
                        h('span', { id: 'engine-pill-text' }, 'Starting'),
                        h('span', { class: 'ps-sr', id: 'status-ready' }, 'Starting engine'))),
                h('nav', { class: 'ps-modes', 'aria-label': 'Workspace views' },
                    Mode('nav-workspace', 'Scene'),
                    Mode('nav-library', 'Assets', 'nav-preset-total', '0'),
                    Mode('nav-log', 'Log', 'nav-log-count', '0')),
                Round('help-button', 'Help', 'Shortcuts & engine notes'),
                h('button', { class: 'ps-primary', id: 'export-button', type: 'button', title: 'Export the scene as .levelspace TOML' }, Icon('Download'), 'Export')),
            h('div', { class: 'ps-vp-row ps-vp-tools' },
                Camera, Overlay,
                h('span', { class: 'ps-divider' }),
                h('button', { class: 'ps-pill', id: 'throw-ball-btn', type: 'button', title: 'Throw-ball tool (T) · Alt+click throws at the selection' }, 'Throw ball', h('kbd', null, 'T')),
                // The overlay pick owns the overlay; this hidden button keeps the V shortcut and the pick in sync.
                h('button', { class: 'ps-hidden', id: 'toggle-overlay-btn', type: 'button', tabindex: '-1', 'aria-hidden': 'true' }),
                // The Log segment owns the drawer; this hidden button keeps the editor's drawer sync working.
                h('button', { class: 'ps-hidden', id: 'toggle-log-btn', type: 'button', tabindex: '-1', 'aria-hidden': 'true' }),
                h('span', { class: 'ps-grow' }),
                Round('toggle-arrows-btn', 'Wind', 'Field arrows'),
                Round('toggle-minimap-btn', 'Map', 'Lattice minimap'),
                Round('focus-btn', 'Focus', 'Reset camera focus'),
                Round('maximize-btn', 'Maximize', 'Maximise viewport'))));

    return {
        // Scenes: [{ Id, Name }]
        SetScenes(Scenes, ActiveId, OnPick)
        {
            Tabs.textContent = '';
            for (const S of Scenes)
            {
                const On = S.Id === ActiveId;
                const Tab = h('button', { class: 'ps-scene-tab' + (On ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(On), title: S.Name }, h('span', null, S.Name));
                Tab.addEventListener('click', () => OnPick(S.Id));
                Tabs.append(Tab);
                if (On) requestAnimationFrame(() => Tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
            }
        }
    };
}
