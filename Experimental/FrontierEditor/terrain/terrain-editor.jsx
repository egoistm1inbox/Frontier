// Terrain editor: two layer stacks (Terrain = heights and water, Texture = colour) over one live viewport.
// Layers are grouped by category, evaluated top to bottom, and every layer carries the same mask model.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Mountain, Layers, Wind, Waves, Droplets, Scissors, Sparkles, Eye, EyeOff, ChevronUp, ChevronDown, Trash2, Plus, Snowflake, Box } from 'lucide-react';
import '../style.css';
import './terrain.css';
import {
    TERRAIN_LAYERS, TERRAIN_CATEGORIES, TEXTURE_LAYERS, TEXTURE_CATEGORIES,
    makeTerrainLayer, makeTextureLayer, defaultTerrainStack, defaultTextureStack,
    evaluateTerrain, evaluateTexture,
} from './stack.js';
import { createTerrainView } from './terrain-view.js';

const ICONS = { Mountain, Layers, Wind, Waves, Droplets, Scissors, Sparkles, Snowflake, Box };
const Icon = ({ name, size = 15 }) => {
    const C = ICONS[name] || Layers;
    return <C size={size} />;
};

const STORAGE = 'frontier-terrain-stacks-v1';
function loadStacks() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
        if (saved && Array.isArray(saved.terrain) && Array.isArray(saved.texture)) return saved;
    } catch { /* fall through to defaults */ }
    return { terrain: defaultTerrainStack(), texture: defaultTextureStack() };
}

let nextId = 100;
const newId = () => 'L' + (nextId++).toString(36);

export function App() {
    const [stacks, setStacks] = useState(loadStacks);
    const [tab, setTab] = useState('terrain');
    const [selected, setSelected] = useState({ terrain: stacks.terrain[0]?.id, texture: stacks.texture[0]?.id });
    const [addOpen, setAddOpen] = useState(false);
    const [view, setView] = useState('3d');
    const [resolution, setResolution] = useState(160);
    const [size, setSize] = useState(1200);
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [stats, setStats] = useState({ ms: 0, wet: 0 });

    const viewportRef = useRef(null);
    const viewRef = useRef(null);
    const canvasRef = useRef(null);

    useEffect(() => {
        localStorage.setItem(STORAGE, JSON.stringify(stacks));
    }, [stacks]);

    // Recompute after edits. Debounced so dragging a slider stays responsive.
    useEffect(() => {
        setBusy(true);
        const timer = setTimeout(() => {
            const t0 = performance.now();
            const terrain = evaluateTerrain(stacks.terrain, { N: resolution, size });
            const rgb = evaluateTexture(stacks.texture, terrain);
            const wet = terrain.water.reduce((n, v) => n + (Number.isNaN(v) ? 0 : 1), 0);
            setResult({ terrain, rgb });
            setStats({ ms: Math.round(performance.now() - t0), wet });
            setBusy(false);
        }, 120);
        return () => clearTimeout(timer);
    }, [stacks, resolution, size]);

    useEffect(() => {
        if (!viewportRef.current) return undefined;
        const view = createTerrainView(viewportRef.current);
        viewRef.current = view;
        return () => view.dispose();
    }, []);

    useEffect(() => {
        if (result && viewRef.current && view === '3d') viewRef.current.setTerrain(result.terrain, result.rgb);
    }, [result, view]);

    useEffect(() => {
        if (!result || view === '3d' || !canvasRef.current) return;
        drawMap(canvasRef.current, result.terrain, result.rgb, view);
    }, [result, view]);

    const list = stacks[tab];
    const current = list.find((l) => l.id === selected[tab]) || list[0];
    const categories = tab === 'terrain' ? TERRAIN_CATEGORIES : TEXTURE_CATEGORIES;
    const catalogue = tab === 'terrain' ? TERRAIN_LAYERS : TEXTURE_LAYERS;

    const setList = (fn) => setStacks((s) => ({ ...s, [tab]: fn(s[tab]) }));
    const patchLayer = (id, patch) => setList((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const patchParams = (id, key, value) => setList((l) => l.map((x) => (x.id === id ? { ...x, params: { ...x.params, [key]: value } } : x)));
    const patchMask = (id, key, value) => setList((l) => l.map((x) => (x.id === id ? { ...x, mask: { ...x.mask, [key]: value } } : x)));

    const addLayer = (type) => {
        const id = newId();
        const layer = tab === 'terrain' ? makeTerrainLayer(type, id) : makeTextureLayer(type, id);
        // new layers go on top of the one selected (or the top of the stack)
        setList((l) => {
            const at = l.findIndex((x) => x.id === selected[tab]);
            const out = l.slice();
            out.splice(at < 0 ? 0 : at, 0, layer);
            return out;
        });
        setSelected((s) => ({ ...s, [tab]: id }));
        setAddOpen(false);
    };
    const move = (id, dir) => setList((l) => {
        const i = l.findIndex((x) => x.id === id), j = i + dir;
        if (i < 0 || j < 0 || j >= l.length) return l;
        const out = l.slice();
        [out[i], out[j]] = [out[j], out[i]];
        return out;
    });
    const remove = (id) => {
        setList((l) => l.filter((x) => x.id !== id));
        setSelected((s) => ({ ...s, [tab]: list.find((x) => x.id !== id)?.id }));
    };

    const grouped = useMemo(() => categories.map((c) => ({
        ...c,
        items: Object.entries(catalogue).filter(([, spec]) => spec.category === c.id),
    })), [tab]);

    return (
        <div className="terrain-shell">
            <aside className="terrain-stack" aria-label="Layer stacks">
                <div className="terrain-brand">Terrain <span>editor</span></div>
                <div className="terrain-tabs" role="tablist">
                    {[['terrain', 'Terrain stack'], ['texture', 'Texture stack']].map(([id, label]) => (
                        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => { setTab(id); setAddOpen(false); }}>{label}</button>
                    ))}
                </div>
                <div className="terrain-stack-head">
                    <span>{tab === 'terrain' ? 'Heights · water' : 'Colour · masks'}</span>
                    <button className="terrain-add" onClick={() => setAddOpen((o) => !o)} aria-expanded={addOpen}><Plus size={13} /> Add layer</button>
                </div>
                {addOpen && (
                    <div className="terrain-add-menu" role="menu">
                        {grouped.map((g) => (
                            <section key={g.id}>
                                <h4>{g.label}<small>{g.hint}</small></h4>
                                {g.items.map(([type, spec]) => (
                                    <button key={type} role="menuitem" onClick={() => addLayer(type)}>
                                        <Icon name={spec.icon} />
                                        <span>{spec.label}<small>{spec.blurb}</small></span>
                                    </button>
                                ))}
                            </section>
                        ))}
                    </div>
                )}
                <ol className="terrain-layers">
                    {list.map((layer, i) => {
                        const spec = catalogue[layer.type];
                        return (
                            <li key={layer.id} className={`${layer.id === current?.id ? 'sel' : ''} ${layer.enabled ? '' : 'off'}`} onClick={() => setSelected((s) => ({ ...s, [tab]: layer.id }))}>
                                <button className="terrain-eye" aria-label={layer.enabled ? 'Disable layer' : 'Enable layer'} onClick={(e) => { e.stopPropagation(); patchLayer(layer.id, { enabled: !layer.enabled }); }}>
                                    {layer.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                                </button>
                                <span className="terrain-layer-icon"><Icon name={spec?.icon} /></span>
                                <span className="terrain-layer-name">{spec?.label || layer.type}<small>{spec?.category}</small></span>
                                <span className="terrain-layer-tools" onClick={(e) => e.stopPropagation()}>
                                    <button aria-label="Move up" disabled={i === 0} onClick={() => move(layer.id, -1)}><ChevronUp size={13} /></button>
                                    <button aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(layer.id, 1)}><ChevronDown size={13} /></button>
                                    <button aria-label="Delete layer" onClick={() => remove(layer.id)}><Trash2 size={12} /></button>
                                </span>
                                <input className="terrain-opacity" type="range" min="0" max="1" step="0.01" value={layer.opacity} aria-label="Layer opacity"
                                    onClick={(e) => e.stopPropagation()} onChange={(e) => patchLayer(layer.id, { opacity: +e.target.value })} />
                            </li>
                        );
                    })}
                    {!list.length && <li className="terrain-empty">Empty stack — add a layer.</li>}
                </ol>
            </aside>

            <main className="terrain-main">
                <header className="terrain-top">
                    <div className="terrain-views" role="group" aria-label="View">
                        {[['3d', '3-D'], ['height', 'Height'], ['water', 'Water'], ['slope', 'Slope']].map(([id, label]) => (
                            <button key={id} aria-pressed={view === id} className={view === id ? 'on' : ''} onClick={() => setView(id)}>{label}</button>
                        ))}
                    </div>
                    <div className="terrain-settings">
                        <label>Resolution
                            <select value={resolution} onChange={(e) => setResolution(+e.target.value)}>
                                {[128, 160, 192, 256].map((n) => <option key={n} value={n}>{n}²</option>)}
                            </select>
                        </label>
                        <label>World
                            <select value={size} onChange={(e) => setSize(+e.target.value)}>
                                {[600, 1200, 2400, 4000].map((n) => <option key={n} value={n}>{n >= 1000 ? (n / 1000) + ' km' : n + ' m'}</option>)}
                            </select>
                        </label>
                        <span className={`terrain-status ${busy ? 'busy' : ''}`}>{busy ? 'Evaluating…' : `${stats.ms} ms · ${stats.wet} wet cells`}</span>
                    </div>
                </header>
                <div className="terrain-viewport" ref={viewportRef} style={{ display: view === '3d' ? 'block' : 'none' }} />
                {view !== '3d' && <div className="terrain-map"><canvas ref={canvasRef} width={resolution} height={resolution} aria-label={`${view} map`} /></div>}
            </main>

            <aside className="terrain-inspector" aria-label="Layer settings">
                {current ? (
                    <LayerInspector
                        tab={tab}
                        layer={current}
                        spec={catalogue[current.type]}
                        patchLayer={(p) => patchLayer(current.id, p)}
                        patchParams={(k, v) => patchParams(current.id, k, v)}
                        patchMask={(k, v) => patchMask(current.id, k, v)}
                    />
                ) : <p className="terrain-empty">Select a layer to edit it.</p>}
            </aside>
        </div>
    );
}

function Slider({ label, value, min, max, step, unit, onChange }) {
    return (
        <label className="terrain-slider">
            <span>{label}<b>{Number(value).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}{unit ? ' ' + unit : ''}</b></span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
        </label>
    );
}

const clampTo = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function RangeControl({ label, value, min, max, step, unit, onChange }) {
    return (
        <div className="terrain-range">
            <span>{label}</span>
            {/* open ends (-1e6 … 1e6) are shown clamped to the slider's range */}
            <Slider label="from" value={clampTo(value[0], min, max)} min={min} max={max} step={step} unit={unit} onChange={(v) => onChange([v, Math.max(v, value[1])])} />
            <Slider label="to" value={clampTo(value[1], min, max)} min={min} max={max} step={step} unit={unit} onChange={(v) => onChange([Math.min(v, value[0]), v])} />
        </div>
    );
}

function LayerInspector({ tab, layer, spec, patchLayer, patchParams, patchMask }) {
    const mask = layer.mask;
    return (
        <section className="terrain-card">
            <header>
                <span className="terrain-card-icon"><Icon name={spec?.icon} size={16} /></span>
                <div>
                    <h3>{spec?.label}</h3>
                    <p>{spec?.blurb}</p>
                </div>
            </header>
            <div className="terrain-row">
                <Slider label="Opacity" value={layer.opacity} min={0} max={1} step={0.01} onChange={(v) => patchLayer({ opacity: v })} />
            </div>

            {tab === 'texture' && (
                <label className="terrain-colour">
                    <span>Colour</span>
                    <input type="color" value={layer.colour} onChange={(e) => patchLayer({ colour: e.target.value })} />
                    <code>{layer.colour}</code>
                </label>
            )}

            {spec?.params?.length > 0 && (
                <>
                    <h4>Parameters</h4>
                    {spec.params.map((p) => (
                        <Slider key={p.key} label={p.label} value={layer.params[p.key]} min={p.min} max={p.max} step={p.step} unit={p.unit} onChange={(v) => patchParams(p.key, v)} />
                    ))}
                </>
            )}

            <h4>Mask</h4>
            <p className="terrain-hint">Where this layer applies. Ranges feather at their edges.</p>
            <RangeControl label="Slope (°)" value={mask.slope} min={0} max={90} step={1} unit="°" onChange={(v) => patchMask('slope', v)} />
            <RangeControl label="Height (m)" value={mask.height} min={-200} max={1200} step={5} unit="m" onChange={(v) => patchMask('height', v)} />
            {tab === 'texture' && <RangeControl label="Distance to water (m)" value={mask.waterDist} min={0} max={40} step={0.5} unit="m" onChange={(v) => patchMask('waterDist', v)} />}
            <Slider label="Noise breakup" value={mask.noise} min={0} max={1} step={0.01} onChange={(v) => patchMask('noise', v)} />
            {mask.noise > 0 && <Slider label="Noise scale" value={mask.noiseScale} min={1} max={16} step={0.5} onChange={(v) => patchMask('noiseScale', v)} />}
            <label className="terrain-check">
                <input type="checkbox" checked={mask.invert} onChange={(e) => patchMask('invert', e.target.checked)} />
                Invert mask
            </label>
            <button className="terrain-reset" onClick={() => {
                patchLayer({ opacity: 1 });
                patchMask('slope', [0, 90]); patchMask('height', [-1e6, 1e6]); patchMask('waterDist', [0, 1e6]);
                patchMask('noise', 0); patchMask('invert', false);
            }}>Reset mask</button>
        </section>
    );
}

// 2-D maps: height (grey ramp), water (blue only where the ground is cut), slope (heat ramp).
function drawMap(canvas, terrain, rgb, view) {
    const { N, height, water, slope } = terrain;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    let lo = Infinity, hi = -Infinity;
    for (const v of height) { if (v < lo) lo = v; if (v > hi) hi = v; }
    for (let i = 0; i < N * N; i++) {
        let r, g, b;
        if (view === 'height') {
            const t = (height[i] - lo) / (hi - lo || 1);
            r = g = b = 40 + t * 200;
        } else if (view === 'slope') {
            const t = Math.min(1, slope[i] / 60);
            r = 40 + t * 215; g = 60 + (1 - Math.abs(t - 0.5) * 2) * 160; b = 60 + (1 - t) * 120;
        } else {
            const t = (height[i] - lo) / (hi - lo || 1);
            const wet = !Number.isNaN(water[i]);
            r = wet ? 30 : 60 + t * 120; g = wet ? 90 : 60 + t * 110; b = wet ? 140 : 50 + t * 90;
            if (!wet) { r = 40 + rgb[i * 3] * 200; g = 40 + rgb[i * 3 + 1] * 200; b = 40 + rgb[i * 3 + 2] * 200; }
        }
        const k = i * 4;
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
    // the grid rows run south→north; flip so north is up on screen
    const flipped = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) flipped.data.set(img.data.subarray((N - 1 - y) * N * 4, (N - y) * N * 4), y * N * 4);
    ctx.putImageData(flipped, 0, 0);
}

createRoot(document.getElementById('root')).render(<App />);
