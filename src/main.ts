/**
 * Frontier — Ultra-Realistic Botanical Fern & Plant, Real Bryophyte Moss,
 * and Studio Fur & Hair Groom Generator.
 *
 * SolidArc three-card workspace:
 *   1. Left Card:  Hierarchical Scene Outliner + 21-Preset Searchable Library
 *   2. Center:     Interactive WebGL Stage (6 display modes, Macro zoom, Wind)
 *   3. Right Card: Context-Sensitive Node & Generator Inspector + CLI Bar
 */

import './ui/styles.css';

import {
  BROADLEAF_NAMES,
  BroadleafSubtype,
  DEFAULT_FERN_PARAMS,
  FERN_ARCH_NAMES,
  FernArchitecture,
} from './generators/fernParams';
import {
  applyFlowerPalette,
  DEFAULT_FLOWER_PARAMS,
  FLOWER_PALETTE_NAMES,
  FLOWER_SPECIES_NAMES,
  FlowerColorPalette,
  FlowerParams,
  FlowerSpecies,
  SPECIES_SIGNATURE_PIGMENTS,
  VIBRANT_PALETTE_SWATCHES,
} from './generators/flowerParams';
import { DEFAULT_HAIR_PARAMS, HAIR_FLOW_NAMES, HairFlowMode } from './generators/hairParams';
import {
  applyMarinePalette,
  applyMarineSpeciesDefaults,
  DEFAULT_MARINE_PARAMS,
  MARINE_PALETTE_NAMES,
  MARINE_PALETTES,
  MARINE_SPECIES_NAMES,
  MarineColorPalette,
  MarineParams,
  MarineSpecies,
} from './generators/marineParams';
import { DEFAULT_MOSS_PARAMS, MOSS_HABIT_NAMES, MossHabit } from './generators/mossParams';
import { DEFAULT_PALM_PARAMS, PALM_SPECIES_NAMES, PalmSpecies } from './generators/palmParams';
import { DEFAULT_TREE_PARAMS, TREE_SPECIES_NAMES, TreeSpecies } from './generators/treeParams';
import {
  DEFAULT_TROPICAL_PARAMS,
  TROPICAL_ARCH_NAMES,
  TropicalArchitecture,
} from './generators/tropicalParams';
import { PRESETS, PRESET_GROUPS } from './generators/presets';
import {
  GeneratorKind,
  GeneratorLayer,
  OutlinerNode,
  PresetDefinition,
  SceneBuildResponse,
  SceneSpec,
  cloneScene,
} from './generators/types';
import { SUBSTRATE_NAMES, SubstrateKind } from './substrates/substrate';
import {
  button,
  check,
  colorField,
  el,
  fmtCompact,
  icon,
  iconButton,
  section,
  select,
  slider,
  stepper,
} from './ui/controls';
import { ViewportStage } from './viewer/scene';
import { DisplayMode } from './viewer/shaders';
import type { WorkerReq, WorkerRes } from './worker/generator.worker';

type InspectorTab = 'shape' | 'detail' | 'surface' | 'node' | 'scene';
type LeftViewMode = 'split' | 'outliner' | 'library';

class FrontierStudio {
  private sceneSpec: SceneSpec;
  private activePreset: PresetDefinition;
  private lastBuild: SceneBuildResponse | null = null;

  // Outliner state
  private selectedNodeId = 'layer-1';
  private collapsedOutlinerIds = new Set<string>();
  private hiddenPartIds = new Set<string>();
  private soloNodeId: string | null = null;
  private leftMode: LeftViewMode = 'split';
  private presetQuery = '';

  // Inspector & Viewport state
  private activeTab: InspectorTab = 'shape';
  private sunAzimuth = 38;
  private sunElevation = 48;
  private exposure = 1.08;
  private windStrength = 0.36;
  private windGust = 0.52;
  private windAngle = 35;

  // Worker orchestration (in-flight coalescing so rapid slider scrubs stay 60fps!)
  private worker: Worker;
  private nextReqId = 1;
  private busy = false;
  private queuedGenerate = false;
  private autoFrameNext = true;

  // Core DOM refs
  private stage!: ViewportStage;
  private leftCard!: HTMLElement;
  private outlinerBadge!: HTMLElement;
  private outlinerTreeEl!: HTMLElement;
  private presetTreeEl!: HTMLElement;
  private tileTris!: HTMLElement;
  private tileTrisSub!: HTMLElement;
  private tileVerts!: HTMLElement;
  private tileVertsSub!: HTMLElement;
  private tileElems!: HTMLElement;
  private tileElemsSub!: HTMLElement;
  private tileMs!: HTMLElement;
  private tileMsSub!: HTMLElement;
  private censusBar!: HTMLElement;
  private footAudit!: HTMLElement;

  // Viewport HUD refs
  private modeButtons = new Map<DisplayMode, HTMLButtonElement>();
  private spinBtn!: HTMLButtonElement;
  private scaleBtn!: HTMLButtonElement;
  private fpsPill!: HTMLElement;
  private soloPill!: HTMLElement;
  private vTitleName!: HTMLElement;
  private vTitleMeta!: HTMLElement;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private legendEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer: number | null = null;

  // Inspector DOM refs
  private inspBadge!: HTMLElement;
  private heroIco!: HTMLElement;
  private heroName!: HTMLElement;
  private heroSub!: HTMLElement;
  private heroBigVal!: HTMLElement;
  private heroBigUnit!: HTMLElement;
  private heroBigLab!: HTMLElement;
  private heroSide1!: HTMLElement;
  private heroSide2!: HTMLElement;
  private heroSide3!: HTMLElement;
  private heroSpark!: SVGSVGElement;
  private presenceEl!: HTMLElement;
  private tabButtons = new Map<InspectorTab, HTMLButtonElement>();
  private inspBody!: HTMLElement;
  private cmdInput!: HTMLInputElement;

  constructor(root: HTMLElement) {
    this.activePreset = PRESETS[0];
    this.sceneSpec = cloneScene(this.activePreset.scene);
    // Collapse dense individual-frond / paddle lists by default so Outliner stays scannable, expandable in 1 click!
    this.collapsedOutlinerIds.add('layer-1:fronds');
    this.collapsedOutlinerIds.add('layer-1:leaves');

    this.worker = new Worker(new URL('./worker/generator.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerRes>) => this.onWorkerMessage(ev.data);

    this.mountLayout(root);
    this.bindKeyboard();
    this.renderPresetLibrary();
    this.rebuildInspector();
    this.requestGenerate(true);

    setInterval(() => {
      if (this.fpsPill && this.stage) {
        this.fpsPill.textContent = `${this.stage.currentFps} fps · wind ${Math.round(this.windStrength * 100)}%`;
      }
    }, 500);
  }

  // ===========================================================================
  // DOM Layout Construction (Three Floating SolidArc Cards)
  // ===========================================================================

  private mountLayout(root: HTMLElement): void {
    root.innerHTML = '';
    root.append(el('div', 'bg'));

    // 1. LEFT CARD: OUTLINER + PRESET LIBRARY
    this.leftCard = el('aside', 'card outliner-card');
    const lHead = el('div', 'card-head');
    const lTitle = el('h1');
    lTitle.append(el('span', 'dot'), el('span', '', 'Outliner'));
    this.outlinerBadge = el('span', 'badge', 'SCENE');
    lHead.append(lTitle, this.outlinerBadge);

    // 4 Stat Tiles
    const tiles = el('div', 'tiles');
    const mkTile = (label: string, cls: string) => {
      const t = el('div', `tile ${cls}`);
      const l = el('div', 'l', label);
      const s = el('div', 's', '–');
      const b = el('b', '', '–');
      t.append(l, b, s);
      tiles.append(t);
      return { b, s };
    };
    const t1 = mkTile('Triangles', 'ok');
    this.tileTris = t1.b;
    this.tileTrisSub = t1.s;
    const t2 = mkTile('Vertices', 'cyan');
    this.tileVerts = t2.b;
    this.tileVertsSub = t2.s;
    const t3 = mkTile('Organs / Strands', 'ok');
    this.tileElems = t3.b;
    this.tileElemsSub = t3.s;
    const t4 = mkTile('Synth Time', 'ok');
    this.tileMs = t4.b;
    this.tileMsSub = t4.s;

    // Split / Outliner / Library Switcher
    const modeBar = el('div', 'left-mode-bar');
    const modeBtns: Record<LeftViewMode, HTMLButtonElement> = {
      split: el('button', 'on', 'Split View'),
      outliner: el('button', '', 'Outliner'),
      library: el('button', '', `Presets (${PRESETS.length})`),
    };
    const setLeftView = (m: LeftViewMode) => {
      this.leftMode = m;
      this.leftCard.classList.toggle('view-outliner', m === 'outliner');
      this.leftCard.classList.toggle('view-library', m === 'library');
      (Object.keys(modeBtns) as LeftViewMode[]).forEach((k) =>
        modeBtns[k].classList.toggle('on', k === m),
      );
    };
    modeBtns.split.addEventListener('click', () => setLeftView('split'));
    modeBtns.outliner.addEventListener('click', () => setLeftView('outliner'));
    modeBtns.library.addEventListener('click', () => setLeftView('library'));
    modeBar.append(modeBtns.split, modeBtns.outliner, modeBtns.library);

    // Outliner Pane
    const outlinerPane = el('div', 'outliner-pane');
    const outSub = el('div', 'pane-subhead');
    outSub.append(el('span', '', 'Hierarchy'));
    const addPills = el('div', 'add-pills');
    const mkAdd = (label: string, kind: GeneratorKind) => {
      const b = el('button', 'mini-pill');
      b.append(icon('plus'), el('span', '', label));
      b.title = `Add ${label} generator layer to current scene`;
      b.addEventListener('click', () => this.addLayer(kind));
      return b;
    };
    addPills.append(
      mkAdd('Tree', 'tree'),
      mkAdd('Palm', 'palm'),
      mkAdd('Flower', 'flower'),
      mkAdd('Sea', 'marine'),
      mkAdd('Moss', 'moss'),
      mkAdd('Tropical', 'tropical'),
      mkAdd('Fern', 'fern'),
      mkAdd('Hair', 'hair'),
    );
    outSub.append(addPills);
    this.outlinerTreeEl = el('div', 'outliner-tree');
    outlinerPane.append(outSub, this.outlinerTreeEl);

    // Preset Library Pane
    const libPane = el('div', 'library-pane');
    const libSub = el('div', 'pane-subhead');
    libSub.append(el('span', '', 'Species & Groom Library'));
    const searchWrap = el('div', 'search');
    searchWrap.append(icon('search'));
    const sInp = el('input');
    sInp.placeholder = 'Filter kelp, coral, anemone, oak, palm, flower, moss…';
    sInp.addEventListener('input', () => {
      this.presetQuery = sInp.value.trim().toLowerCase();
      this.renderPresetLibrary();
    });
    searchWrap.append(sInp);
    this.presetTreeEl = el('div', 'tree');
    libPane.append(libSub, searchWrap, this.presetTreeEl);

    // Left Card Footer Census
    const lFoot = el('div', 'card-foot');
    this.censusBar = el('div', 'census');
    const fRow = el('div', 'foot-row');
    this.footAudit = el('span', 'kv ok', 'Audit · 0 NaN');
    const expHint = el('span', 'kv', 'Dbl-click 3D to pick');
    fRow.append(this.footAudit, el('span', 'sp'), expHint);
    lFoot.append(this.censusBar, fRow);

    this.leftCard.append(lHead, tiles, modeBar, outlinerPane, libPane, lFoot);

    // 2. CENTER CARD: 3D WEBGL VIEWPORT
    const vpCard = el('main', 'card viewport');
    const vtop = el('div', 'vtop');

    // Display Mode Segmented Bar
    const modeSeg = el('div', 'seg');
    const modes: [DisplayMode, string, string][] = [
      ['shaded', 'Shaded', '1'],
      ['clay', 'Clay', '2'],
      ['wire', 'Wire', '3'],
      ['anatomy', 'Anatomy', '4'],
      ['detail', 'Veins / Locks', '5'],
      ['wind', 'Wind', '6'],
    ];
    for (const [m, label, k] of modes) {
      const b = el('button', m === 'shaded' ? 'on' : '');
      b.append(el('span', '', label), el('kbd', '', k));
      b.addEventListener('click', () => this.setDisplayMode(m));
      this.modeButtons.set(m, b);
      modeSeg.append(b);
    }

    // Camera & Stage Action Segmented Bar
    const camSeg = el('div', 'seg');
    const mkCamBtn = (ic: string, label: string, k: string, title: string, fn: () => void) => {
      const b = el('button');
      b.title = title;
      b.append(icon(ic), el('span', '', label));
      if (k) b.append(el('kbd', '', k));
      b.addEventListener('click', fn);
      camSeg.append(b);
      return b;
    };
    mkCamBtn('frame', 'Frame', 'F', 'Frame full specimen', () => this.stage.frameAll());
    mkCamBtn('macro', 'Macro', 'M', 'Zoom into ultra-close leaf venation / moss phyllids / fur locks', () => {
      this.stage.frameMacro();
      this.toast('Macro close-up · inspect 3D veins, phyllids & hair shafts');
    });
    mkCamBtn('roots', 'Base', 'B', 'Inspect crown, rhizome, roots & substrate contact', () => this.stage.frameBase());
    this.spinBtn = mkCamBtn('turntable', 'Spin', 'T', 'Toggle studio turntable', () => {
      const next = !this.stage.getTurntable();
      this.stage.setTurntable(next);
      this.spinBtn.classList.toggle('on', next);
    });
    this.scaleBtn = mkCamBtn('grid', 'Ruler', 'G', 'Toggle 1m / 10cm botanical scale post', () => {
      const next = !this.stage.getScaleVisible();
      this.stage.setScaleVisible(next);
      this.scaleBtn.classList.toggle('on', next);
    });

    vtop.append(modeSeg, el('div', 'spacer'), camSeg);

    const axisHud = el('div', 'axis-hud');
    this.fpsPill = el('div', 'pill', '60 fps');
    this.soloPill = el('div', 'pill');
    axisHud.append(this.fpsPill, this.soloPill);

    const vtitle = el('div', 'vtitle');
    this.vTitleName = el('div', 'n', this.activePreset.name);
    this.vTitleMeta = el('div', 'm', this.activePreset.subtitle);
    vtitle.append(this.vTitleName, this.vTitleMeta);

    this.legendEl = el('div', 'legend');

    const hud = el('div', 'hud');
    const keysNav = el('div', 'nav glass keysbar');
    keysNav.innerHTML =
      `<span class="kl">Orbit</span><span class="k">Drag</span>` +
      `<span class="kl">Macro</span><span class="k">M</span>` +
      `<span class="kl">Frame</span><span class="k">F</span>` +
      `<span class="kl">Seed</span><span class="k">R</span>` +
      `<span class="kl">Pause</span><span class="k">Space</span>`;
    const statusNav = el('div', 'nav glass status');
    this.statusDot = el('span', 'sdot ok');
    this.statusText = el('span', '', 'Ready');
    statusNav.append(this.statusDot, this.statusText);
    hud.append(keysNav, statusNav);

    this.toastEl = el('div', 'toast');
    vpCard.append(vtop, axisHud, vtitle, this.legendEl, hud, this.toastEl);

    // 3. RIGHT CARD: INSPECTOR + COMMAND LINE
    const inspCard = el('aside', 'card inspector');
    const iHead = el('div', 'card-head');
    const iTitle = el('h1');
    iTitle.append(el('span', 'dot green'), el('span', '', 'Inspector'));
    this.inspBadge = el('span', 'badge', 'FERN LAYER');
    const headActs = el('div', 'head-actions');
    headActs.append(
      this.inspBadge,
      iconButton('dice', 'Randomize active seed (R)', () => this.randomizeSeed()),
      iconButton('reset', 'Reset to clean preset defaults', () => this.loadPreset(this.activePreset.name)),
    );
    iHead.append(iTitle, headActs);

    // Hero Card with Profile Sparkline
    const hero = el('div', 'hero');
    const cTop = el('div', 'c-top');
    this.heroIco = el('div', 'ico');
    this.heroIco.append(icon('fern'));
    const hText = el('div', 't');
    this.heroName = el('div', 'n', this.activePreset.name);
    this.heroSub = el('div', 'm', this.activePreset.subtitle);
    hText.append(this.heroName, this.heroSub);
    cTop.append(this.heroIco, hText);

    const big = el('div', 'big');
    this.heroBigVal = el('span', 'v', '–');
    this.heroBigUnit = el('span', 'u', 'tris');
    this.heroBigLab = el('span', 'lab', 'High-poly 3D mesh');
    big.append(this.heroBigVal, this.heroBigUnit, this.heroBigLab);

    this.heroSpark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.heroSpark.setAttribute('viewBox', '0 0 96 52');
    this.heroSpark.setAttribute('class', 'spark');

    const side = el('div', 'side');
    const mkSide = (label: string, valCls = 'v2') => {
      const d = el('div');
      const k = el('span', 'k', label);
      const v = el('span', valCls, '–');
      d.append(k, v);
      side.append(d);
      return v;
    };
    this.heroSide1 = mkSide('Dimensions');
    this.heroSide2 = mkSide('Structure');
    this.heroSide3 = mkSide('Topology', 'v2 ok');
    hero.append(cTop, big, this.heroSpark, side);

    // 4-Tile Quick Anatomy / Coat Presence Bar
    this.presenceEl = el('div', 'presence');

    // 5 Inspector Tabs
    const tabsEl = el('div', 'tabs');
    const tabDefs: [InspectorTab, string][] = [
      ['shape', 'Shape'],
      ['detail', 'Detail'],
      ['surface', 'Surface'],
      ['node', 'Node'],
      ['scene', 'Scene'],
    ];
    for (const [id, label] of tabDefs) {
      const b = el('button', id === this.activeTab ? 'on' : '', label);
      b.addEventListener('click', () => {
        this.activeTab = id;
        for (const [k, btn] of this.tabButtons) btn.classList.toggle('on', k === id);
        this.rebuildInspector();
      });
      this.tabButtons.set(id, b);
      tabsEl.append(b);
    }

    this.inspBody = el('div', 'insp');

    // Footer Command Bar
    const cmdWrap = el('div', 'cmdline');
    cmdWrap.append(el('span', 'prompt', '>'));
    this.cmdInput = el('input');
    this.cmdInput.placeholder = 'preset · macro · tier 4 · add moss · export glb';
    this.cmdInput.spellcheck = false;
    this.cmdInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const raw = this.cmdInput.value.trim();
        if (raw) {
          this.executeCommand(raw);
          this.cmdInput.value = '';
        }
      }
    });
    cmdWrap.append(this.cmdInput);

    inspCard.append(iHead, hero, this.presenceEl, tabsEl, this.inspBody, cmdWrap);
    root.append(this.leftCard, vpCard, inspCard);

    // Initialize WebGL stage inside vpCard
    this.stage = new ViewportStage(vpCard);
    this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
    this.stage.setLighting(this.sunAzimuth, this.sunElevation, this.exposure);
    this.stage.onPartPicked = (partId) => {
      this.selectOutlinerNode(partId);
      this.toast(`Selected ${partId}`);
    };
  }

  // ===========================================================================
  // Worker Generation & Telemetry Sync
  // ===========================================================================

  private requestGenerate(autoFrame = false): void {
    if (autoFrame) this.autoFrameNext = true;
    if (this.busy) {
      this.queuedGenerate = true;
      return;
    }
    this.busy = true;
    this.statusDot.className = 'sdot busy';
    this.statusText.textContent = 'Synthesizing…';

    const req: WorkerReq = {
      type: 'generate',
      id: this.nextReqId++,
      scene: this.sceneSpec,
    };
    this.worker.postMessage(req);
  }

  private onWorkerMessage(msg: WorkerRes): void {
    if (msg.type === 'generated') {
      this.busy = false;
      this.lastBuild = msg.data;

      // Ensure selectedNodeId still exists in outliner
      if (!msg.data.outliner.some((n) => n.id === this.selectedNodeId)) {
        this.selectedNodeId = this.sceneSpec.layers[0]?.id ?? 'scene:root';
      }

      const shouldFrame = this.autoFrameNext;
      this.autoFrameNext = false;

      this.stage.setSceneParts(msg.data.parts, msg.data.sceneHeight, msg.data.macroTarget, shouldFrame);
      this.applyVisibilityToStage();
      this.renderOutliner();
      this.updateTelemetryUI();
      if (this.activeTab === 'node' || this.activeTab === 'scene') {
        this.rebuildInspector();
      }

      this.statusDot.className = 'sdot ok';
      this.statusText.textContent = `Ready · ${Math.round(msg.data.timings.totalMs)}ms`;

      if (this.queuedGenerate) {
        this.queuedGenerate = false;
        this.requestGenerate(false);
      }
    } else if (msg.type === 'exported') {
      const slug = (this.sceneSpec.presetName || 'frontier')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      const mime = msg.format === 'glb' ? 'model/gltf-binary' : 'text/plain;charset=utf-8';
      const blob = new Blob([msg.buffer], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}.${msg.format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.statusDot.className = 'sdot ok';
      this.statusText.textContent = `Exported .${msg.format}`;
      this.toast(`Downloaded ${slug}.${msg.format} (${(msg.buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
    } else if (msg.type === 'error') {
      this.busy = false;
      this.statusDot.className = 'sdot err';
      this.statusText.textContent = 'Synth Error';
      this.toast(`Error: ${msg.message.split('\n')[0]}`);
      console.error(msg.message);
    }
  }

  // ===========================================================================
  // Scene Outliner Rendering, Selection, Visibility & Solo
  // ===========================================================================

  private renderOutliner(): void {
    this.outlinerTreeEl.innerHTML = '';
    const nodes = this.lastBuild?.outliner ?? [];
    this.outlinerBadge.textContent = `${nodes.length} NODES`;

    const childrenByParent = new Map<string | null, OutlinerNode[]>();
    for (const n of nodes) {
      const arr = childrenByParent.get(n.parentId) ?? [];
      arr.push(n);
      childrenByParent.set(n.parentId, arr);
    }

    const renderRec = (parentId: string | null, depth: number): void => {
      const kids = childrenByParent.get(parentId);
      if (!kids) return;

      for (const node of kids) {
        const nodeKids = childrenByParent.get(node.id) ?? [];
        const hasKids = nodeKids.length > 0;
        const isClosed = this.collapsedOutlinerIds.has(node.id);
        const isSel = this.selectedNodeId === node.id;
        const allHidden = node.partIds.length > 0 && node.partIds.every((pid) => this.hiddenPartIds.has(pid));
        const isSolo = this.soloNodeId === node.id;

        const row = el('div', 'orow' + (isSel ? ' sel' : '') + (allHidden ? ' dimmed' : ''));
        row.style.paddingLeft = `${6 + depth * 13}px`;

        const twisty = el('span', 'twisty' + (isClosed ? ' closed' : '') + (!hasKids ? ' leaf-spacer' : ''));
        if (hasKids) {
          twisty.append(icon('caret'));
          twisty.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (this.collapsedOutlinerIds.has(node.id)) this.collapsedOutlinerIds.delete(node.id);
            else this.collapsedOutlinerIds.add(node.id);
            this.renderOutliner();
          });
        }

        const ndot = el('span', 'ndot');
        ndot.style.setProperty('--acc', node.accent);
        ndot.append(icon(node.icon));

        const nameSpan = el('span', 'oname', node.name);
        const metaSpan = el('span', 'ometa', node.triangles > 0 ? fmtCompact(node.triangles) : node.meta);

        row.append(twisty, ndot, nameSpan, metaSpan);

        if (node.kind !== 'scene' && node.partIds.length > 0) {
          // Solo button
          const soloBtn = el('button', 'oact' + (isSolo ? ' solo-on' : ''));
          soloBtn.title = isSolo ? 'Exit Solo isolation' : `Solo isolate "${node.name}"`;
          soloBtn.append(icon('solo'));
          soloBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.toggleSolo(node.id);
          });

          // Visibility eye button
          const eyeBtn = el('button', 'oact' + (allHidden ? ' eye-off' : ''));
          eyeBtn.title = allHidden ? `Show "${node.name}"` : `Hide "${node.name}"`;
          eyeBtn.append(icon(allHidden ? 'eyeOff' : 'eye'));
          eyeBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this.toggleNodeVisibility(node.id);
          });

          row.append(soloBtn, eyeBtn);
        }

        row.addEventListener('click', () => this.selectOutlinerNode(node.id));
        row.addEventListener('dblclick', () => {
          this.selectOutlinerNode(node.id);
          this.stage.frameSelected();
        });

        this.outlinerTreeEl.append(row);
        if (hasKids && !isClosed) {
          renderRec(node.id, depth + 1);
        }
      }
    };

    renderRec(null, 0);
  }

  public selectOutlinerNode(nodeId: string): void {
    const nodes = this.lastBuild?.outliner ?? [];
    const target = nodes.find((n) => n.id === nodeId);
    if (!target) return;

    this.selectedNodeId = target.id;
    // Expand ancestor groups if needed so selection is visible in the Outliner!
    let pId = target.parentId;
    while (pId) {
      this.collapsedOutlinerIds.delete(pId);
      pId = nodes.find((x) => x.id === pId)?.parentId ?? null;
    }

    // If user clicked the Host Substrate node, switch to Surface tab if currently on Shape/Detail
    if (target.kind === 'substrate' && (this.activeTab === 'shape' || this.activeTab === 'detail')) {
      this.activeTab = 'surface';
      for (const [k, btn] of this.tabButtons) btn.classList.toggle('on', k === this.activeTab);
    }

    this.applyVisibilityToStage();
    this.renderOutliner();
    this.updateTelemetryUI();
    this.rebuildInspector();
  }

  public toggleNodeVisibility(nodeId: string): void {
    const node = this.lastBuild?.outliner.find((n) => n.id === nodeId);
    if (!node || node.partIds.length === 0) return;

    const currentlyHidden = node.partIds.every((pid) => this.hiddenPartIds.has(pid));
    for (const pid of node.partIds) {
      if (currentlyHidden) this.hiddenPartIds.delete(pid);
      else this.hiddenPartIds.add(pid);
    }
    if (node.kind === 'substrate') {
      this.sceneSpec.substrateVisible = currentlyHidden;
    } else if (node.kind === 'layer') {
      const layer = this.sceneSpec.layers.find((l) => l.id === node.id);
      if (layer) layer.visible = currentlyHidden;
    }
    this.applyVisibilityToStage();
    this.renderOutliner();
    this.renderPresenceTiles();
  }

  public toggleSolo(nodeId: string): void {
    this.soloNodeId = this.soloNodeId === nodeId ? null : nodeId;
    this.applyVisibilityToStage();
    this.renderOutliner();
  }

  private applyVisibilityToStage(): void {
    const nodes = this.lastBuild?.outliner ?? [];
    const soloNode = this.soloNodeId ? nodes.find((n) => n.id === this.soloNodeId) : null;
    const soloSet = soloNode ? new Set(soloNode.partIds) : null;

    const selNode = nodes.find((n) => n.id === this.selectedNodeId);
    // Highlight only when a sub-part or multi-layer child is selected (not the entire single-layer root!)
    let highlightSet = new Set<string>();
    if (
      selNode &&
      selNode.kind !== 'scene' &&
      !(selNode.kind === 'layer' && this.sceneSpec.layers.length === 1)
    ) {
      highlightSet = new Set(selNode.partIds);
    }

    this.stage.setOutlinerState(this.hiddenPartIds, soloSet, highlightSet);
    this.soloPill.textContent = soloNode ? `SOLO · ${soloNode.name}` : '';
  }

  // ===========================================================================
  // Preset Library & Multi-Layer Scene Composition
  // ===========================================================================

  private renderPresetLibrary(): void {
    this.presetTreeEl.innerHTML = '';
    const q = this.presetQuery;

    for (const grp of PRESET_GROUPS) {
      const items = PRESETS.filter(
        (p) =>
          p.group === grp.label &&
          (!q ||
            p.name.toLowerCase().includes(q) ||
            p.subtitle.toLowerCase().includes(q) ||
            p.group.toLowerCase().includes(q)),
      );
      if (items.length === 0) continue;

      const grpEl = el('div', 'grp');
      const gh = el('div', 'grp-h');
      gh.append(icon('caret', 'i car'), el('span', '', grp.label), el('span', 'cnt', String(items.length)));
      const kids = el('div', 'kids');
      gh.addEventListener('click', () => grpEl.classList.toggle('closed'));

      for (const preset of items) {
        const isSel = preset.name === this.sceneSpec.presetName;
        const row = el('div', 'row' + (isSel ? ' sel' : ''));
        const ico = el('div', 'ico');
        ico.style.setProperty('--acc', preset.accent);
        ico.append(icon(preset.icon));
        const txt = el('div', 'txt');
        txt.append(el('div', 'name', preset.name), el('div', 'meta', preset.subtitle));
        row.append(ico, txt);
        row.addEventListener('click', () => this.loadPreset(preset.name));
        kids.append(row);
      }

      grpEl.append(gh, kids);
      this.presetTreeEl.append(grpEl);
    }
  }

  public loadPreset(name: string): void {
    const found = PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!found) {
      this.toast(`Unknown preset "${name}"`);
      return;
    }
    this.activePreset = found;
    this.sceneSpec = cloneScene(found.scene);
    this.hiddenPartIds.clear();
    this.soloNodeId = null;
    this.selectedNodeId = this.sceneSpec.layers[0]?.id ?? 'scene:root';
    this.collapsedOutlinerIds.clear();
    for (const l of this.sceneSpec.layers) {
      this.collapsedOutlinerIds.add(`${l.id}:fronds`);
      this.collapsedOutlinerIds.add(`${l.id}:leaves`);
    }

    if (this.activeTab === 'node') this.activeTab = 'shape';
    for (const [k, btn] of this.tabButtons) btn.classList.toggle('on', k === this.activeTab);

    this.renderPresetLibrary();
    this.rebuildInspector();
    this.requestGenerate(true);
  }

  public addLayer(kind: GeneratorKind): void {
    const idx = this.sceneSpec.layers.length + 1;
    const id = `layer-${Date.now().toString(36).slice(-4)}-${idx}`;
    const seed = 10 + idx * 17;

    let newLayer: GeneratorLayer;
    if (kind === 'tree') {
      newLayer = {
        id,
        name: `English Oak #${idx}`,
        kind: 'tree',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: (idx * 55) % 360, scale: 1 },
        tree: { ...DEFAULT_TREE_PARAMS },
      };
    } else if (kind === 'palm') {
      newLayer = {
        id,
        name: `Date Palm #${idx}`,
        kind: 'palm',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: (idx * 50) % 360, scale: 1 },
        palm: { ...DEFAULT_PALM_PARAMS },
      };
    } else if (kind === 'flower') {
      newLayer = {
        id,
        name: `Colossal Hibiscus #${idx}`,
        kind: 'flower',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: (idx * 45) % 360, scale: 1 },
        flower: { ...DEFAULT_FLOWER_PARAMS },
      };
    } else if (kind === 'marine') {
      newLayer = {
        id,
        name: `Giant Kelp / Reef #${idx}`,
        kind: 'marine',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: (idx * 40) % 360, scale: 1 },
        marine: { ...DEFAULT_MARINE_PARAMS },
      };
    } else if (kind === 'fern') {
      newLayer = {
        id,
        name: `Sword Fern #${idx}`,
        kind: 'fern',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: (idx * 65) % 360, scale: 1 },
        fern: { ...DEFAULT_FERN_PARAMS },
      };
      this.collapsedOutlinerIds.add(`${id}:fronds`);
    } else if (kind === 'tropical') {
      newLayer = {
        id,
        name: `Giant Banana #${idx}`,
        kind: 'tropical',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: (idx * 55) % 360, scale: 1 },
        tropical: { ...DEFAULT_TROPICAL_PARAMS },
      };
      this.collapsedOutlinerIds.add(`${id}:leaves`);
    } else if (kind === 'moss') {
      newLayer = {
        id,
        name: `Velvet Carpet Moss #${idx}`,
        kind: 'moss',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 },
        moss: { ...DEFAULT_MOSS_PARAMS },
      };
    } else {
      newLayer = {
        id,
        name: `Fur & Hair Groom #${idx}`,
        kind: 'hair',
        seed,
        visible: true,
        locked: false,
        transform: { x: 0, y: 0, z: 0, yaw: 0, scale: 1 },
        hair: { ...DEFAULT_HAIR_PARAMS },
      };
    }

    this.sceneSpec.layers.push(newLayer);
    this.selectedNodeId = id;
    this.activeTab = 'shape';
    for (const [k, btn] of this.tabButtons) btn.classList.toggle('on', k === this.activeTab);
    this.rebuildInspector();
    this.requestGenerate(false);
    this.toast(`Added ${newLayer.name} to Scene Outliner`);
  }

  private getActiveLayer(): GeneratorLayer {
    const nodes = this.lastBuild?.outliner ?? [];
    const sel = nodes.find((n) => n.id === this.selectedNodeId);
    if (sel?.layerId) {
      const found = this.sceneSpec.layers.find((l) => l.id === sel.layerId);
      if (found) return found;
    }
    const direct = this.sceneSpec.layers.find((l) => l.id === this.selectedNodeId);
    return direct ?? this.sceneSpec.layers[0];
  }

  public randomizeSeed(): void {
    const layer = this.getActiveLayer();
    if (!layer) return;
    layer.seed = Math.floor(Math.random() * 9999) + 1;
    this.rebuildInspector();
    this.requestGenerate(false);
    this.toast(`${layer.name} · Seed ${layer.seed}`);
  }

  // ===========================================================================
  // Telemetry, Hero Sparkline & Presence Bar Updates
  // ===========================================================================

  private updateTelemetryUI(): void {
    const b = this.lastBuild;
    if (!b) return;

    const top = b.topology;
    this.tileTris.textContent = fmtCompact(top.renderedTriangles);
    this.tileTrisSub.textContent = `${fmtCompact(top.quads)} quads · ${fmtCompact(top.tris)} tris`;
    this.tileVerts.textContent = fmtCompact(top.vertices);
    this.tileVertsSub.textContent = `${b.parts.length} GPU draw parts`;

    // Aggregate semantic elements across active layers
    let elemCount = 0;
    let elemSub = '';
    for (const rep of b.layerReports) {
      if (rep.tree) {
        elemCount += rep.tree.leaves + rep.tree.weldedJunctions;
        elemSub = `${rep.tree.weldedJunctions} welded collars · ${fmtCompact(rep.tree.leaves)} leaves`;
      } else if (rep.palm) {
        elemCount += rep.palm.leaflets + rep.palm.fruits;
        elemSub = `${rep.palm.fronds} fronds · ${rep.palm.fruits} 3D fruits`;
      } else if (rep.flower) {
        elemCount += rep.flower.petals + rep.flower.stamensAndFlorets;
        elemSub = `${rep.flower.blooms} blooms · ${rep.flower.petals} 3D petals`;
      } else if (rep.marine) {
        elemCount += rep.marine.bladesOrTentacles + rep.marine.vesiclesOrPolyps;
        elemSub = `${rep.marine.stemsOrTubes} axes · ${fmtCompact(rep.marine.bladesOrTentacles)} marine organs`;
      } else if (rep.fern) {
        elemCount += rep.fern.leaflets + rep.fern.soriClusters;
        elemSub = `${rep.fern.fronds} fronds · ${rep.fern.leaflets} leaflets`;
      } else if (rep.tropical) {
        elemCount += rep.tropical.ribbons + rep.tropical.fruitsOrFlowers;
        elemSub = `${rep.tropical.leaves} paddles · ${rep.tropical.weldedJunctions ?? 0} welded collars`;
      } else if (rep.moss) {
        elemCount += rep.moss.phyllids;
        elemSub = `${fmtCompact(rep.moss.shoots)} shoots · ${rep.moss.sporophytes} caps`;
      } else if (rep.hair) {
        elemCount += rep.hair.totalStrands;
        elemSub = `${rep.hair.guides} guides · 3 coats`;
      }
    }
    this.tileElems.textContent = fmtCompact(elemCount);
    this.tileElemsSub.textContent = elemSub || 'Procedural organs';
    this.tileMs.textContent = `${Math.round(b.timings.totalMs)}`;
    this.tileMsSub.textContent = `gen ${Math.round(b.timings.generatorsMs)}ms · pack ${Math.round(b.timings.packMs)}ms`;

    // Left footer proportional triangle census bar
    this.censusBar.innerHTML = '';
    const totT = Math.max(1, top.renderedTriangles);
    for (const n of b.outliner) {
      if (n.kind === 'part' && n.triangles > 0) {
        const seg = el('i');
        seg.style.width = `${Math.max(2, (n.triangles / totT) * 100)}%`;
        seg.style.background = n.accent;
        seg.title = `${n.name}: ${n.triangles.toLocaleString('en-US')} tris`;
        this.censusBar.append(seg);
      }
    }
    this.footAudit.textContent = `Audit · ${top.nanVertices} NaN · ${top.degenerateFaces} deg`;

    // Viewport bottom-left title
    const selNode = b.outliner.find((n) => n.id === this.selectedNodeId);
    this.vTitleName.textContent =
      selNode && selNode.kind !== 'scene' && selNode.kind !== 'layer'
        ? `${this.sceneSpec.presetName} › ${selNode.name}`
        : this.sceneSpec.presetName;
    this.vTitleMeta.textContent = `${this.activePreset.subtitle} · ${fmtCompact(top.renderedTriangles)} tris`;

    // Right Hero Card
    const layer = this.getActiveLayer();
    const rep = b.layerReports.find((r) => r.layerId === layer?.id);
    if (selNode && (selNode.kind === 'part' || selNode.kind === 'group' || selNode.kind === 'substrate')) {
      this.inspBadge.textContent = selNode.kind.toUpperCase();
      this.heroIco.innerHTML = '';
      this.heroIco.style.color = selNode.accent;
      this.heroIco.style.background = `color-mix(in srgb, ${selNode.accent} 16%, transparent)`;
      this.heroIco.append(icon(selNode.icon));
      this.heroName.textContent = selNode.name;
      this.heroSub.textContent = `${selNode.meta} · ${fmtCompact(selNode.vertices)} verts`;
      this.heroBigVal.textContent = fmtCompact(selNode.triangles);
      this.heroBigUnit.textContent = 'tris';
      this.heroBigLab.textContent = `${((selNode.triangles / Math.max(1, top.renderedTriangles)) * 100).toFixed(1)}% of\nscene mesh`;
    } else if (layer) {
      this.inspBadge.textContent = `${layer.kind.toUpperCase()} · SEED ${layer.seed}`;
      const acc =
        layer.kind === 'tree'
          ? '#52d17c'
          : layer.kind === 'palm'
            ? '#eab308'
            : layer.kind === 'flower'
              ? (layer.flower?.huePrimary ?? '#ff2a78')
              : layer.kind === 'marine'
                ? (layer.marine?.hueSecondary ?? '#00e5ff')
                : layer.kind === 'fern'
                  ? '#34c759'
                  : layer.kind === 'tropical'
                    ? '#7ee058'
                    : layer.kind === 'moss'
                      ? '#86c232'
                      : '#ffb454';
      const icoName =
        layer.kind === 'tree'
          ? 'tree'
          : layer.kind === 'palm'
            ? 'palm'
            : layer.kind === 'flower'
              ? 'flower'
              : layer.kind === 'marine'
                ? 'marine'
                : layer.kind === 'fern'
                  ? 'fern'
                  : layer.kind === 'tropical'
                    ? 'tropical'
                    : layer.kind === 'moss'
                      ? 'moss'
                      : 'fur';
      this.heroIco.innerHTML = '';
      this.heroIco.style.color = acc;
      this.heroIco.style.background = `color-mix(in srgb, ${acc} 16%, transparent)`;
      this.heroIco.append(icon(icoName));
      this.heroName.textContent = layer.name;
      this.heroSub.textContent =
        layer.kind === 'tree' && layer.tree
          ? TREE_SPECIES_NAMES[layer.tree.species]
          : layer.kind === 'palm' && layer.palm
            ? PALM_SPECIES_NAMES[layer.palm.species]
            : layer.kind === 'flower' && layer.flower
              ? FLOWER_SPECIES_NAMES[layer.flower.species]
              : layer.kind === 'marine' && layer.marine
                ? MARINE_SPECIES_NAMES[layer.marine.species]
                : layer.kind === 'fern' && layer.fern
                  ? FERN_ARCH_NAMES[layer.fern.architecture]
                  : layer.kind === 'tropical' && layer.tropical
                    ? TROPICAL_ARCH_NAMES[layer.tropical.architecture]
                    : layer.kind === 'moss' && layer.moss
                      ? MOSS_HABIT_NAMES[layer.moss.habit]
                      : layer.hair
                        ? HAIR_FLOW_NAMES[layer.hair.flowMode]
                        : '';
      this.heroBigVal.textContent = fmtCompact(rep?.triangles ?? top.renderedTriangles);
      this.heroBigUnit.textContent = 'tris';
      this.heroBigLab.textContent = `Tier ${
        layer.tree?.detailTier ??
        layer.palm?.detailTier ??
        layer.flower?.detailTier ??
        layer.marine?.detailTier ??
        layer.fern?.detailTier ??
        layer.tropical?.detailTier ??
        layer.moss?.detailTier ??
        layer.hair?.detailTier ??
        3
      }\nHigh-Poly`;
    }

    this.heroSide1.textContent =
      b.sceneHeight >= 1.5 ? `${b.sceneHeight.toFixed(2)} m tall` : `${(b.sceneHeight * 100).toFixed(0)} cm tall`;
    this.heroSide2.textContent =
      rep?.tree
        ? `${rep.tree.weldedJunctions} collars · ${rep.tree.rootStems} roots`
        : rep?.palm
          ? `${rep.palm.fronds} fronds · ${rep.palm.fruits} fruits`
          : rep?.flower
            ? `${rep.flower.blooms} blooms · ${rep.flower.petals} petals`
            : rep?.marine
              ? `${rep.marine.bladesOrTentacles} organs · ${rep.marine.vesiclesOrPolyps} bodies`
              : rep?.fern
                ? `${rep.fern.leaflets} blades · ${rep.fern.soriClusters} sori`
                : rep?.tropical
                  ? `${rep.tropical.leaves} paddles · ${rep.tropical.weldedJunctions ?? 0} collars`
                  : rep?.moss
                    ? `${fmtCompact(rep.moss.phyllids)} phyllids`
                    : rep?.hair
                      ? `${fmtCompact(rep.hair.totalStrands)} strands`
                      : `${b.parts.length} parts`;
    const isWeldedClean =
      top.nanVertices === 0 &&
      (rep?.tree
        ? rep.tree.closedManifold
        : rep?.palm
          ? rep.palm.closedTrunkManifold
          : rep?.marine
            ? rep.marine.closedManifold
            : true);
    this.heroSide3.textContent = isWeldedClean ? 'Closed Manifold' : `${top.nanVertices} NaN`;

    this.drawSparkline(layer);
    this.renderPresenceTiles();
  }

  private drawSparkline(layer: GeneratorLayer | undefined): void {
    this.heroSpark.innerHTML = '';
    if (!layer) return;

    const pts: string[] = [];
    const acc =
      layer.kind === 'tree'
        ? '#52d17c'
        : layer.kind === 'palm'
          ? '#eab308'
          : layer.kind === 'flower'
            ? (layer.flower?.huePrimary ?? '#ff2a78')
            : layer.kind === 'marine'
              ? (layer.marine?.hueSecondary ?? '#00e5ff')
              : layer.kind === 'fern'
              ? '#34c759'
              : layer.kind === 'tropical'
                ? '#7ee058'
                : layer.kind === 'moss'
                  ? '#86c232'
                  : '#ffb454';
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      let yNorm = 0.5;
      if (layer.kind === 'tree' && layer.tree) {
        yNorm = 0.16 + 0.72 * Math.sin(Math.pow(t, 0.75) * Math.PI) + 0.08 * Math.sin(t * 16.0);
      } else if (layer.kind === 'palm' && layer.palm) {
        yNorm = 0.22 + 0.66 * Math.sin(t * Math.PI * 0.92) * (1 - 0.35 * t);
      } else if (layer.kind === 'flower' && layer.flower) {
        yNorm = 0.24 + 0.58 * Math.sin(t * Math.PI) + 0.14 * Math.abs(Math.sin(t * Math.PI * 5.0));
      } else if (layer.kind === 'marine' && layer.marine) {
        yNorm = 0.30 + 0.48 * Math.sin(t * Math.PI * 1.1) + 0.16 * Math.sin(t * 14.0) * layer.marine.ruffleWave;
      } else if (layer.kind === 'fern' && layer.fern) {
        const droop = layer.fern.archDroop / 130;
        yNorm = Math.sin(t * Math.PI * 0.88) * (1 - droop * t * 0.55);
      } else if (layer.kind === 'tropical' && layer.tropical) {
        const droop = layer.tropical.archDroopDeg / 100;
        yNorm = 0.28 + Math.sin(t * Math.PI * 0.85) * 0.65 * (1 - droop * t * 0.45);
      } else if (layer.kind === 'moss' && layer.moss) {
        yNorm =
          layer.moss.habit === 'velvet_carpet'
            ? 0.42 + 0.16 * Math.sin(t * Math.PI * 2.5) + 0.12 * Math.sin(t * 14.0)
            : Math.sin(t * Math.PI) * 0.65 + 0.25 * Math.abs(Math.sin(t * 9.4));
      } else if (layer.kind === 'hair' && layer.hair) {
        const turns = Math.min(6, layer.hair.curlTurns);
        yNorm = 0.78 - 0.52 * t + Math.sin(t * turns * 6.28) * Math.min(0.24, layer.hair.curlRadiusMm * 0.03);
      }
      const x = (4 + t * 88).toFixed(1);
      const y = (46 - Math.max(0.05, Math.min(0.95, yNorm)) * 40).toFixed(1);
      pts.push(`${x},${y}`);
    }

    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts.join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', acc);
    poly.setAttribute('stroke-width', '2');
    poly.setAttribute('stroke-linecap', 'round');
    this.heroSpark.append(poly);
  }

  private renderPresenceTiles(): void {
    this.presenceEl.innerHTML = '';
    const layer = this.getActiveLayer();
    if (!layer) return;

    const addCell = (ic: string, label: string, isOn: boolean, toggle: () => void) => {
      const c = el('button', 'pcell' + (isOn ? ' on' : ''));
      c.append(icon(ic), el('span', '', label));
      c.addEventListener('click', toggle);
      this.presenceEl.append(c);
    };

    const isPartVis = (suffix: string): boolean => {
      const id = `${layer.id}:${suffix}`;
      return !this.hiddenPartIds.has(id);
    };
    const flipPart = (suffix: string): void => {
      const id = `${layer.id}:${suffix}`;
      if (this.lastBuild?.outliner.some((n) => n.id === id)) {
        this.toggleNodeVisibility(id);
      }
    };

    if (layer.kind === 'tree' && layer.tree) {
      const tr = layer.tree;
      addCell('tree', 'Welded Wood', isPartVis('wood'), () => flipPart('wood'));
      addCell('leaf', 'Canopy', tr.showLeaves && isPartVis('leaves'), () => {
        tr.showLeaves = !tr.showLeaves;
        this.rebuildInspector();
        this.requestGenerate();
      });
      addCell('roots', 'Buttresses', tr.rootCount > 0, () => {
        tr.rootCount = tr.rootCount > 0 ? 0 : 6;
        this.rebuildInspector();
        this.requestGenerate();
      });
      addCell('ground', 'Host Base', !this.hiddenPartIds.has('substrate:host') && this.sceneSpec.substrate.kind !== 'none', () => {
        this.toggleNodeVisibility('substrate:host');
      });
    } else if (layer.kind === 'palm' && layer.palm) {
      const pp = layer.palm;
      addCell('palm', 'Trunk & Bole', isPartVis('skeleton'), () => flipPart('skeleton'));
      addCell('leaf', 'Frond Blades', isPartVis('leaflets'), () => {
        flipPart('rachises');
        flipPart('leaflets');
      });
      addCell('sparkles', '3D Fruits', pp.showFruits && isPartVis('fruits'), () => {
        pp.showFruits = !pp.showFruits;
        this.rebuildInspector();
        this.requestGenerate();
      });
      addCell('ground', 'Host Base', !this.hiddenPartIds.has('substrate:host') && this.sceneSpec.substrate.kind !== 'none', () => {
        this.toggleNodeVisibility('substrate:host');
      });
    } else if (layer.kind === 'flower' && layer.flower) {
      addCell('flower', '3D Corolla', isPartVis('corolla'), () => flipPart('corolla'));
      addCell('sparkles', 'Stamens', isPartVis('reproductive'), () => flipPart('reproductive'));
      addCell('leaf', 'Foliage', isPartVis('foliage'), () => flipPart('foliage'));
      addCell('roots', 'Welded Stems', isPartVis('stem'), () => flipPart('stem'));
    } else if (layer.kind === 'marine' && layer.marine) {
      addCell('roots', 'Holdfast / Base', isPartVis('holdfast'), () => flipPart('holdfast'));
      addCell('tussock', 'Stipes / Lattice', isPartVis('stipe'), () => flipPart('stipe'));
      addCell('leaf', 'Blades / Tentacles', isPartVis('fronds'), () => flipPart('fronds'));
      addCell('sparkles', 'Bladders / Polyps', isPartVis('vesicles'), () => flipPart('vesicles'));
    } else if (layer.kind === 'fern' && layer.fern) {
      const fp = layer.fern;
      addCell('sprout', 'Crosiers', fp.crosierCount > 0 && isPartVis('crosiers'), () => {
        if (fp.crosierCount === 0) {
          fp.crosierCount = 4;
          this.requestGenerate();
        } else {
          flipPart('crosiers');
        }
      });
      addCell('sparkles', 'Sori Spores', fp.soriCoverage > 0.02 && isPartVis('sori'), () => {
        if (fp.soriCoverage <= 0.02) {
          fp.soriCoverage = 0.65;
          this.requestGenerate();
        } else {
          flipPart('sori');
        }
      });
      addCell('leaf', '3D Veins', fp.veinRelief > 0.15, () => {
        fp.veinRelief = fp.veinRelief > 0.15 ? 0.0 : 0.9;
        fp.midribRelief = fp.veinRelief > 0.15 ? 0.95 : 0.2;
        this.rebuildInspector();
        this.requestGenerate();
      });
      addCell('ground', 'Host Base', !this.hiddenPartIds.has('substrate:host') && this.sceneSpec.substrate.kind !== 'none', () => {
        this.toggleNodeVisibility('substrate:host');
      });
    } else if (layer.kind === 'tropical' && layer.tropical) {
      const tp = layer.tropical;
      addCell('sprout', 'Cigar Furl', tp.showCigarLeaf && isPartVis('cigar'), () => {
        tp.showCigarLeaf = !tp.showCigarLeaf;
        this.rebuildInspector();
        this.requestGenerate();
      });
      addCell('sparkles', 'Fruit / Bloom', tp.showInflorescence && isPartVis('inflorescence'), () => {
        tp.showInflorescence = !tp.showInflorescence;
        this.rebuildInspector();
        this.requestGenerate();
      });
      addCell('wind', 'Wind Splits', tp.windTears > 0, () => {
        tp.windTears = tp.windTears > 0 ? 0 : 7;
        this.rebuildInspector();
        this.requestGenerate();
      });
      addCell('ground', 'Host Base', !this.hiddenPartIds.has('substrate:host') && this.sceneSpec.substrate.kind !== 'none', () => {
        this.toggleNodeVisibility('substrate:host');
      });
    } else if (layer.kind === 'moss') {
      addCell('leaf', 'Phyllids', isPartVis('phyllids'), () => flipPart('phyllids'));
      addCell('sprout', 'Capsules', isPartVis('capsules'), () => {
        flipPart('setae');
        flipPart('capsules');
      });
      addCell('roots', 'Rhizoids', isPartVis('rhizoids'), () => flipPart('rhizoids'));
      addCell('ground', 'Host Stone', !this.hiddenPartIds.has('substrate:host'), () =>
        this.toggleNodeVisibility('substrate:host'),
      );
    } else if (layer.kind === 'hair') {
      addCell('sparkles', 'Guard Coat', isPartVis('guard'), () => flipPart('guard'));
      addCell('layers', 'Undercoat', isPartVis('undercoat'), () => flipPart('undercoat'));
      addCell('wind', 'Guides', !this.hiddenPartIds.has(`${layer.id}:guides`) && this.selectedNodeId === `${layer.id}:guides`, () => {
        if (this.selectedNodeId === `${layer.id}:guides`) {
          this.selectOutlinerNode(layer.id);
        } else {
          this.hiddenPartIds.delete(`${layer.id}:guides`);
          this.selectOutlinerNode(`${layer.id}:guides`);
        }
      });
      addCell('grass', 'Whiskers', isPartVis('whiskers'), () => flipPart('whiskers'));
    }
  }

  // ===========================================================================
  // Inspector Panels (Shape · Detail · Surface · Node · Scene)
  // ===========================================================================

  private rebuildInspector(): void {
    this.inspBody.innerHTML = '';
    const layer = this.getActiveLayer();
    const trigger = () => this.requestGenerate(false);

    if (this.activeTab === 'shape') {
      if (layer?.kind === 'tree' && layer.tree) this.buildTreeShapeTab(layer.tree, trigger);
      else if (layer?.kind === 'palm' && layer.palm) this.buildPalmShapeTab(layer.palm, trigger);
      else if (layer?.kind === 'flower' && layer.flower) this.buildFlowerShapeTab(layer.flower, trigger);
      else if (layer?.kind === 'marine' && layer.marine) this.buildMarineShapeTab(layer.marine, trigger);
      else if (layer?.kind === 'fern' && layer.fern) this.buildFernShapeTab(layer.fern, trigger);
      else if (layer?.kind === 'tropical' && layer.tropical) this.buildTropicalShapeTab(layer.tropical, trigger);
      else if (layer?.kind === 'moss' && layer.moss) this.buildMossShapeTab(layer.moss, trigger);
      else if (layer?.kind === 'hair' && layer.hair) this.buildHairShapeTab(layer.hair, trigger);
    } else if (this.activeTab === 'detail') {
      if (layer?.kind === 'tree' && layer.tree) this.buildTreeDetailTab(layer.tree, trigger);
      else if (layer?.kind === 'palm' && layer.palm) this.buildPalmDetailTab(layer.palm, trigger);
      else if (layer?.kind === 'flower' && layer.flower) this.buildFlowerDetailTab(layer.flower, trigger);
      else if (layer?.kind === 'marine' && layer.marine) this.buildMarineDetailTab(layer.marine, trigger);
      else if (layer?.kind === 'fern' && layer.fern) this.buildFernDetailTab(layer.fern, trigger);
      else if (layer?.kind === 'tropical' && layer.tropical) this.buildTropicalDetailTab(layer.tropical, trigger);
      else if (layer?.kind === 'moss' && layer.moss) this.buildMossDetailTab(layer.moss, trigger);
      else if (layer?.kind === 'hair' && layer.hair) this.buildHairDetailTab(layer.hair, trigger);
    } else if (this.activeTab === 'surface') {
      if (layer) this.buildSurfaceTab(layer, trigger);
    } else if (this.activeTab === 'node') {
      this.buildNodeInspectorTab();
    } else if (this.activeTab === 'scene') {
      this.buildSceneTab();
    }
  }

  // --- WELDED WOODY TREE TABS ---
  private buildTreeShapeTab(tr: NonNullable<GeneratorLayer['tree']>, onChange: () => void): void {
    const sSp = section('Welded Tree Architecture', this.inspBody, { hint: 'V - E + F = 2' });
    select<TreeSpecies>(
      sSp,
      'Tree Species',
      (Object.keys(TREE_SPECIES_NAMES) as TreeSpecies[]).map((k) => ({
        value: k,
        label: TREE_SPECIES_NAMES[k],
      })),
      () => tr.species,
      (v) => (tr.species = v),
      onChange,
    );
    select<number>(
      sSp,
      'Mesh Detail Tier',
      [
        { value: 1, label: '1 · Light Crown' },
        { value: 2, label: '2 · Standard Manifold' },
        { value: 3, label: '3 · High-Poly Welded' },
        { value: 4, label: '4 · Cinema Specimen' },
      ],
      () => tr.detailTier,
      (v) => (tr.detailTier = v),
      onChange,
    );
    slider(sSp, 'Tree Height', () => tr.height, (v) => (tr.height = v), { min: 4, max: 24, step: 0.25, unit: 'm' }, onChange);
    slider(sSp, 'Trunk Girth Ratio', () => tr.trunkRatio, (v) => (tr.trunkRatio = v), { min: 0.015, max: 0.095, step: 0.002 }, onChange);
    slider(sSp, 'Basal Trunk Flare', () => tr.basalFlare, (v) => (tr.basalFlare = v), { min: 0, max: 1.8, step: 0.05 }, onChange);

    const sCrown = section('Welded Limbs, Forks & Crown', this.inspBody, { hint: 'Weber-Penn' });
    stepper(sCrown, 'Branch Recursion', () => tr.branchLevels, (v) => (tr.branchLevels = v), { min: 2, max: 4, integer: true }, onChange);
    slider(sCrown, 'Scaffold Limbs', () => tr.limbCount, (v) => (tr.limbCount = Math.round(v)), { min: 5, max: 28, step: 1 }, onChange);
    slider(sCrown, 'Emergence Angle', () => tr.branchAngleDeg, (v) => (tr.branchAngleDeg = v), { min: 25, max: 82, step: 1, unit: '°' }, onChange);
    slider(sCrown, 'Y-Fork Tendency', () => tr.forkTendency, (v) => (tr.forkTendency = v), { min: 0, max: 0.85, step: 0.03 }, onChange);
    slider(sCrown, 'Canopy Spread', () => tr.canopyFlatten, (v) => (tr.canopyFlatten = v), { min: 0, max: 1, step: 0.03 }, onChange);

    const sRoot = section('Terrain-Welded Buttress Roots', this.inspBody, { hint: 'manifold' });
    slider(sRoot, 'Primary Surface Roots', () => tr.rootCount, (v) => (tr.rootCount = Math.round(v)), { min: 0, max: 9, step: 1 }, onChange);
    slider(sRoot, 'Root Radial Reach', () => tr.rootReach, (v) => (tr.rootReach = v), { min: 0.1, max: 0.42, step: 0.01 }, onChange);
    slider(sRoot, 'Buttress Lobe Flutes', () => tr.buttressRelief, (v) => (tr.buttressRelief = v), { min: 0, max: 0.75, step: 0.03 }, onChange);

    this.appendLiveWindMiniSection();
  }

  private buildTreeDetailTab(tr: NonNullable<GeneratorLayer['tree']>, onChange: () => void): void {
    const sCollar = section('Bezier Branch Collars & Pipe Law', this.inspBody, { hint: 'quad weld' });
    slider(sCollar, 'Collar Fillet Curve', () => tr.collarFillet, (v) => (tr.collarFillet = v), { min: 0.25, max: 0.98, step: 0.02 }, onChange);
    slider(sCollar, 'Da Vinci Pipe Law', () => tr.pipeConservation, (v) => (tr.pipeConservation = v), { min: 0, max: 1, step: 0.04 }, onChange);
    slider(sCollar, 'Lateral Rootlets', () => tr.rootLaterals, (v) => (tr.rootLaterals = Math.round(v)), { min: 0, max: 4, step: 1 }, onChange);
    slider(sCollar, 'Wind Sway Flex', () => tr.windCompliance, (v) => (tr.windCompliance = v), { min: 0.2, max: 2.0, step: 0.05 }, onChange);

    const sLeaf = section('3D Sculpted Canopy Foliage', this.inspBody, { hint: 'rigid SO(3)' });
    check(sLeaf, 'Show Canopy Leaves', () => tr.showLeaves, (v) => (tr.showLeaves = v), onChange);
    slider(sLeaf, 'Foliage Density', () => tr.leafDensity, (v) => (tr.leafDensity = v), { min: 0.25, max: 1.8, step: 0.05 }, onChange);
    slider(sLeaf, 'Leaf Blade Length', () => tr.leafSize, (v) => (tr.leafSize = v), { min: 0.08, max: 0.28, step: 0.01, unit: 'm' }, onChange);
  }

  // --- FRUITING & DICHOTOMOUS PALM TABS ---
  private buildPalmShapeTab(pp: NonNullable<GeneratorLayer['palm']>, onChange: () => void): void {
    const sSp = section('Palm Species & Trunk Architecture', this.inspBody, { hint: 'Arecaceae' });
    select<PalmSpecies>(
      sSp,
      'Palm Species',
      (Object.keys(PALM_SPECIES_NAMES) as PalmSpecies[]).map((k) => ({
        value: k,
        label: PALM_SPECIES_NAMES[k],
      })),
      () => pp.species,
      (v) => (pp.species = v),
      onChange,
    );
    select<number>(
      sSp,
      'Mesh Detail Tier',
      [
        { value: 1, label: '1 · Light Palm' },
        { value: 2, label: '2 · Standard Crown' },
        { value: 3, label: '3 · High-Poly Fruiting' },
        { value: 4, label: '4 · Cinema Botanical' },
      ],
      () => pp.detailTier,
      (v) => (pp.detailTier = v),
      onChange,
    );
    slider(sSp, 'Trunk Height', () => pp.trunkHeight, (v) => (pp.trunkHeight = v), { min: 3, max: 16, step: 0.2, unit: 'm' }, onChange);
    slider(sSp, 'Trunk Radius', () => pp.trunkRadius, (v) => (pp.trunkRadius = v), { min: 0.12, max: 0.45, step: 0.01, unit: 'm' }, onChange);
    slider(sSp, 'Trade-Wind Lean', () => pp.trunkLeanDeg, (v) => (pp.trunkLeanDeg = v), { min: 0, max: 32, step: 1, unit: '°' }, onChange);
    slider(sSp, 'Phototropic Sweep', () => pp.trunkCurveDeg, (v) => (pp.trunkCurveDeg = v), { min: 0, max: 42, step: 1, unit: '°' }, onChange);
    stepper(sSp, 'Aerial Y-Fork Levels', () => pp.forkLevels, (v) => (pp.forkLevels = v), { min: 0, max: 2, integer: true }, onChange);

    const sCr = section('Phyllotactic Frond Crown', this.inspBody, { hint: '137.5° spiral' });
    slider(sCr, 'Fronds per Crown', () => pp.frondCount, (v) => (pp.frondCount = Math.round(v)), { min: 10, max: 56, step: 1 }, onChange);
    slider(sCr, 'Frond Length', () => pp.frondLength, (v) => (pp.frondLength = v), { min: 1.4, max: 5.2, step: 0.1, unit: 'm' }, onChange);
    slider(sCr, 'Frond Span Width', () => pp.frondWidth, (v) => (pp.frondWidth = v), { min: 0.6, max: 1.8, step: 0.04, unit: 'm' }, onChange);
    slider(sCr, 'Rachis Arch Droop', () => pp.frondArchDeg, (v) => (pp.frondArchDeg = v), { min: 20, max: 115, step: 2, unit: '°' }, onChange);
    slider(sCr, 'Dry Petticoat Skirt', () => pp.skirtFraction, (v) => (pp.skirtFraction = v), { min: 0, max: 0.48, step: 0.02 }, onChange);

    this.appendLiveWindMiniSection();
  }

  private buildPalmDetailTab(pp: NonNullable<GeneratorLayer['palm']>, onChange: () => void): void {
    const sFr = section('3D Infructescence & Fruit Clusters', this.inspBody, { hint: 'spadix' });
    check(sFr, 'Show Fruiting Bunches', () => pp.showFruits, (v) => (pp.showFruits = v), onChange);
    slider(sFr, 'Axil / Spadix Bunches', () => pp.fruitBunches, (v) => (pp.fruitBunches = Math.round(v)), { min: 0, max: 12, step: 1 }, onChange);
    slider(sFr, 'Fruit Abundance', () => pp.fruitAbundance, (v) => (pp.fruitAbundance = v), { min: 0.3, max: 1.6, step: 0.05 }, onChange);
    slider(sFr, 'Fruit Ripeness', () => pp.fruitRipeness, (v) => (pp.fruitRipeness = v), { min: 0, max: 1, step: 0.03 }, onChange);

    const sAn = section('Pinnae, Crownshaft & Bole Relief', this.inspBody, { hint: 'anatomy' });
    slider(sAn, 'Pinna Pairs / Pleats', () => pp.leafletPairs, (v) => (pp.leafletPairs = Math.round(v)), { min: 18, max: 60, step: 2 }, onChange);
    slider(sAn, 'Plumose Multi-Plane', () => pp.plumoseSplay, (v) => (pp.plumoseSplay = v), { min: 0, max: 1, step: 0.03 }, onChange);
    slider(sAn, 'Crownshaft Ratio', () => pp.crownshaftRatio, (v) => (pp.crownshaftRatio = v), { min: 0, max: 0.28, step: 0.01 }, onChange);
    slider(sAn, 'Basal Root Bole', () => pp.basalBole, (v) => (pp.basalBole = v), { min: 0, max: 0.9, step: 0.03 }, onChange);
    slider(sAn, 'Welded Root Spurs', () => pp.rootButtresses, (v) => (pp.rootButtresses = Math.round(v)), { min: 0, max: 8, step: 1 }, onChange);
    slider(sAn, 'Boot / Ring Relief', () => pp.trunkRelief, (v) => (pp.trunkRelief = v), { min: 0, max: 1, step: 0.03 }, onChange);
    slider(sAn, 'Trade-Wind Sway', () => pp.windSway, (v) => (pp.windSway = v), { min: 0.2, max: 2.0, step: 0.05 }, onChange);
  }

  // --- GIGANTIC VIBRANT FLOWER TABS ---
  private appendFlowerColorwaySwatches(parent: HTMLElement, flp: FlowerParams, onChange: () => void): void {
    select<FlowerColorPalette>(
      parent,
      'Colorway Palette',
      (Object.keys(FLOWER_PALETTE_NAMES) as FlowerColorPalette[]).map((k) => ({
        value: k,
        label: FLOWER_PALETTE_NAMES[k],
      })),
      () => flp.colorPalette,
      (v) => {
        applyFlowerPalette(flp, v);
        this.rebuildInspector();
      },
      onChange,
    );

    const swatchOrder: { id: Exclude<FlowerColorPalette, 'custom'>; short: string }[] = [
      { id: 'species_signature', short: 'Signature' },
      { id: 'electric_magenta_gold', short: 'Magenta' },
      { id: 'crimson_velvet_ruby', short: 'Crimson' },
      { id: 'solar_tangerine_flame', short: 'Tangerine' },
      { id: 'ultraviolet_orchid', short: 'UV Orchid' },
      { id: 'cerulean_sapphire', short: 'Sapphire' },
      { id: 'imperial_coral_sunset', short: 'Coral' },
      { id: 'bioluminescent_aurora', short: 'Aurora' },
      { id: 'royal_amethyst_rose', short: 'Amethyst' },
      { id: 'neon_cyber_lotus', short: 'Neon Cyber' },
      { id: 'golden_saffron_emperor', short: 'Saffron' },
      { id: 'velvet_midnight_noir', short: 'Noir Ruby' },
      { id: 'pastel_sakura_pearl', short: 'Sakura' },
    ];
    const grid = el('div', 'swatch-grid');
    for (const item of swatchOrder) {
      const set =
        item.id === 'species_signature'
          ? SPECIES_SIGNATURE_PIGMENTS[flp.species]
          : VIBRANT_PALETTE_SWATCHES[item.id];
      const chip = el('button', 'swatch-chip' + (flp.colorPalette === item.id ? ' on' : ''));
      chip.type = 'button';
      chip.title = FLOWER_PALETTE_NAMES[item.id];
      const orb = el('i', 'sw-orb');
      orb.style.background = `radial-gradient(circle at 32% 32%, ${set.hueSecondary}, ${set.huePrimary} 62%, ${set.hueThroat})`;
      chip.append(orb, el('span', '', item.short));
      chip.addEventListener('click', () => {
        applyFlowerPalette(flp, item.id);
        this.rebuildInspector();
        onChange();
      });
      grid.append(chip);
    }
    parent.append(grid);
    slider(parent, 'Chromatic Vibrancy', () => flp.vibrancy, (v) => (flp.vibrancy = v), { min: 0.65, max: 1.75, step: 0.03 }, onChange);
  }

  private buildFlowerShapeTab(flp: FlowerParams, onChange: () => void): void {
    const sSp = section('Gigantic Floral Species & Stature', this.inspBody, { hint: 'V - E + F = 2' });
    select<FlowerSpecies>(
      sSp,
      'Floral Species',
      (Object.keys(FLOWER_SPECIES_NAMES) as FlowerSpecies[]).map((k) => ({
        value: k,
        label: FLOWER_SPECIES_NAMES[k],
      })),
      () => flp.species,
      (v) => {
        flp.species = v;
        if (flp.colorPalette === 'species_signature') {
          applyFlowerPalette(flp, 'species_signature');
        }
        this.rebuildInspector();
      },
      onChange,
    );
    select<number>(
      sSp,
      'Mesh Detail Tier',
      [
        { value: 1, label: '1 · Light Floral' },
        { value: 2, label: '2 · Standard 3D Petals' },
        { value: 3, label: '3 · High-Poly Sculpted' },
        { value: 4, label: '4 · Cinema Botanical' },
      ],
      () => flp.detailTier,
      (v) => (flp.detailTier = v),
      onChange,
    );
    slider(sSp, 'Giant Plant Height', () => flp.plantHeight, (v) => (flp.plantHeight = v), { min: 0.8, max: 7.5, step: 0.1, unit: 'm' }, onChange);
    slider(sSp, 'Hero Bloom Diameter', () => flp.bloomDiameter, (v) => (flp.bloomDiameter = v), { min: 0.3, max: 2.2, step: 0.04, unit: 'm' }, onChange);
    stepper(sSp, 'Open Hero Blooms', () => flp.bloomCount, (v) => (flp.bloomCount = v), { min: 1, max: 7, integer: true }, onChange);
    stepper(sSp, 'Sculpted Buds', () => flp.budCount, (v) => (flp.budCount = v), { min: 0, max: 6, integer: true }, onChange);

    const sCol = section('Vibrant Colorways & Chroma', this.inspBody, { hint: '1-click' });
    this.appendFlowerColorwaySwatches(sCol, flp, onChange);

    this.appendLiveWindMiniSection();
  }

  private buildFlowerDetailTab(flp: FlowerParams, onChange: () => void): void {
    const sPet = section('3D Sculpted Petals & Venation', this.inspBody, { hint: 'corolla' });
    slider(sPet, 'Petal Count Scale', () => flp.petalCountScale, (v) => (flp.petalCountScale = v), { min: 0.6, max: 1.8, step: 0.05 }, onChange);
    slider(sPet, 'Corolla Openness', () => flp.corollaOpenness, (v) => (flp.corollaOpenness = v), { min: 0.35, max: 1.25, step: 0.03 }, onChange);
    slider(sPet, '3D Margin Ruffle', () => flp.petalRuffle, (v) => (flp.petalRuffle = v), { min: 0, max: 1.6, step: 0.04 }, onChange);
    slider(sPet, 'Distal Curl / Reflex', () => flp.petalCurl, (v) => (flp.petalCurl = v), { min: -0.6, max: 1.2, step: 0.04 }, onChange);
    slider(sPet, '3D Vein & Plisse Relief', () => flp.veinRelief, (v) => (flp.veinRelief = v), { min: 0, max: 1.6, step: 0.04 }, onChange);

    const sRep = section('3D Stamens, Corona & Welded Stems', this.inspBody, { hint: 'organs' });
    slider(sRep, 'Stamen / Floret Lushness', () => flp.stamenLushness, (v) => (flp.stamenLushness = v), { min: 0.4, max: 1.6, step: 0.05 }, onChange);
    slider(sRep, '3D Foliage Density', () => flp.foliageDensity, (v) => (flp.foliageDensity = v), { min: 0, max: 1.6, step: 0.05 }, onChange);
    stepper(sRep, 'Welded Buttress Roots', () => flp.rootCount, (v) => (flp.rootCount = v), { min: 0, max: 8, integer: true }, onChange);
    slider(sRep, 'Breeze Compliance', () => flp.windCompliance, (v) => (flp.windCompliance = v), { min: 0.2, max: 1.8, step: 0.05 }, onChange);
  }

  // --- SEA PLANTS & MARINE REEF SPECIES TABS ---
  private appendMarineColorwaySwatches(parent: HTMLElement, mrp: MarineParams, onChange: () => void): void {
    const swatchOrder: Array<{ id: Exclude<MarineColorPalette, 'custom'>; short: string }> = [
      { id: 'pacific_amber_kelp', short: 'Amber Kelp' },
      { id: 'fucus_intertidal_amber', short: 'Rockweed' },
      { id: 'emerald_seagrass', short: 'Posidonia' },
      { id: 'eelgrass_teal_meadow', short: 'Eelgrass' },
      { id: 'jade_tidepool', short: 'Jade Ulva' },
      { id: 'caulerpa_emerald_caviar', short: 'Sea Grapes' },
      { id: 'acetabularia_mint_parasol', short: 'Wineglass' },
      { id: 'padina_peacock_chalk', short: 'Peacock' },
      { id: 'crimson_dulse_rhodo', short: 'Red Dulse' },
      { id: 'acropora_rose_gold', short: 'Rose Reef' },
      { id: 'royal_purple_gorgonian', short: 'Sea Fan' },
      { id: 'biolum_bubble_anemone', short: 'Biolum' },
      { id: 'caribbean_azure_sponge', short: 'Azure' },
      { id: 'crimson_gold_crinoid', short: 'Crimson' },
      { id: 'abyssal_neon_reef', short: 'Abyss UV' },
      { id: 'bleached_ivory_reef', short: 'Ivory Reef' },
    ];
    const grid = el('div', 'swatch-grid');
    for (const item of swatchOrder) {
      const set = MARINE_PALETTES[item.id];
      const chip = el('button', 'swatch-chip' + (mrp.colorPalette === item.id ? ' on' : ''));
      chip.type = 'button';
      chip.title = MARINE_PALETTE_NAMES[item.id];
      const orb = el('i', 'sw-orb');
      orb.style.background = `radial-gradient(circle at 32% 32%, ${set.hueAccent}, ${set.hueSecondary} 55%, ${set.huePrimary})`;
      chip.append(orb, el('span', '', item.short));
      chip.addEventListener('click', () => {
        applyMarinePalette(mrp, item.id);
        this.rebuildInspector();
        onChange();
      });
      grid.append(chip);
    }
    parent.append(grid);
  }

  private buildMarineShapeTab(mrp: MarineParams, onChange: () => void): void {
    const sSp = section('Sea Plant & Marine Reef Species', this.inspBody, { hint: 'benthic 3D' });
    select<MarineSpecies>(
      sSp,
      'Marine Species',
      (Object.keys(MARINE_SPECIES_NAMES) as MarineSpecies[]).map((k) => ({
        value: k,
        label: MARINE_SPECIES_NAMES[k],
      })),
      () => mrp.species,
      (v) => {
        applyMarineSpeciesDefaults(mrp, v);
        this.rebuildInspector();
      },
      onChange,
    );
    select<number>(
      sSp,
      'Mesh Detail Tier',
      [
        { value: 1, label: '1 · Light Benthic Preview' },
        { value: 2, label: '2 · Standard Reef Mesh' },
        { value: 3, label: '3 · High-Poly Sculpted' },
        { value: 4, label: '4 · Cinema Ocean Macro' },
      ],
      () => mrp.detailTier,
      (v) => (mrp.detailTier = v),
      onChange,
    );
    slider(sSp, 'Colony Height / Span', () => mrp.colonyHeight, (v) => (mrp.colonyHeight = v), { min: 0.25, max: 6.0, step: 0.05, unit: 'm' }, onChange);
    stepper(sSp, 'Stipes / Shoots / Tubes', () => mrp.colonyCount, (v) => (mrp.colonyCount = v), { min: 1, max: 44, integer: true }, onChange);
    slider(sSp, 'Crown / Meadow Spread', () => mrp.canopySpread, (v) => (mrp.canopySpread = v), { min: 0.35, max: 1.85, step: 0.04 }, onChange);
    slider(sSp, 'Blade / Tentacle Length', () => mrp.organLength, (v) => (mrp.organLength = v), { min: 0.10, max: 2.2, step: 0.03, unit: 'm' }, onChange);

    const sCol = section('Marine Flora & Reef Colorways', this.inspBody, { hint: '1-click' });
    this.appendMarineColorwaySwatches(sCol, mrp, onChange);

    this.appendLiveWindMiniSection();
  }

  private buildMarineDetailTab(mrp: MarineParams, onChange: () => void): void {
    const sOrg = section('Thallus, Corallite & Tentacle Sculpt', this.inspBody, { hint: 'anatomy' });
    slider(sOrg, 'Organ Width / Gauge', () => mrp.organWidth, (v) => (mrp.organWidth = v), { min: 0.04, max: 0.85, step: 0.02 }, onChange);
    slider(sOrg, 'Organ / Lattice Density', () => mrp.organDensity, (v) => (mrp.organDensity = v), { min: 0.4, max: 1.8, step: 0.05 }, onChange);
    slider(sOrg, 'Ruffle / Bubble Inflation', () => mrp.ruffleWave, (v) => (mrp.ruffleWave = v), { min: 0, max: 1.2, step: 0.03 }, onChange);
    slider(sOrg, 'Bladders / Grapes / Polyps', () => mrp.vesicleAbundance, (v) => (mrp.vesicleAbundance = v), { min: 0, max: 1.6, step: 0.05 }, onChange);
    stepper(sOrg, 'Branch / Fork Order', () => mrp.branchOrder, (v) => (mrp.branchOrder = v), { min: 1, max: 4, integer: true }, onChange);

    const sCur = section('Ocean Current & Surge Kinematics', this.inspBody, { hint: 'SO(3) surge' });
    slider(sCur, 'Prevailing Current Lean', () => mrp.currentLeanDeg, (v) => (mrp.currentLeanDeg = v), { min: 0, max: 45, step: 1, unit: '°' }, onChange);
    slider(sCur, 'Underwater Surge Sway', () => mrp.currentSway, (v) => (mrp.currentSway = v), { min: 0, max: 1.8, step: 0.04 }, onChange);
  }

  // --- FERN / PLANT TABS ---
  private buildFernShapeTab(fp: NonNullable<GeneratorLayer['fern']>, onChange: () => void): void {
    const sArch = section('Botanical Architecture', this.inspBody, { hint: 'frond plan' });
    select<FernArchitecture>(
      sArch,
      'Architecture',
      (Object.keys(FERN_ARCH_NAMES) as FernArchitecture[]).map((k) => ({
        value: k,
        label: FERN_ARCH_NAMES[k],
      })),
      () => fp.architecture,
      (v) => {
        fp.architecture = v;
        this.rebuildInspector();
      },
      onChange,
    );
    if (fp.architecture === 'broadleaf_rosette') {
      select<BroadleafSubtype>(
        sArch,
        'Leaf Species',
        (Object.keys(BROADLEAF_NAMES) as BroadleafSubtype[]).map((k) => ({
          value: k,
          label: BROADLEAF_NAMES[k],
        })),
        () => fp.broadleafPlaced,
        (v) => (fp.broadleafPlaced = v),
        onChange,
      );
    }
    select<number>(
      sArch,
      'Mesh Detail Tier',
      [
        { value: 1, label: '1 · Light Preview' },
        { value: 2, label: '2 · Standard Quad' },
        { value: 3, label: '3 · High-Poly Botanical' },
        { value: 4, label: '4 · Cinema Ultra-Mesh' },
      ],
      () => fp.detailTier,
      (v) => (fp.detailTier = v),
      onChange,
    );

    const sRosette = section('Rosette & Frond Stature', this.inspBody, { hint: 'macro' });
    slider(sRosette, 'Frond Count', () => fp.frondCount, (v) => (fp.frondCount = v), { min: 3, max: 32, step: 1 }, onChange);
    slider(sRosette, 'Frond Length', () => fp.frondLength, (v) => (fp.frondLength = v), { min: 0.2, max: 1.5, step: 0.02, unit: 'm' }, onChange);
    slider(sRosette, 'Blade Width', () => fp.frondWidth, (v) => (fp.frondWidth = v), { min: 0.06, max: 0.48, step: 0.005, unit: 'm' }, onChange);
    slider(sRosette, 'Rosette Splay', () => fp.rosetteAngle, (v) => (fp.rosetteAngle = v), { min: 10, max: 75, step: 1, unit: '°' }, onChange);
    slider(sRosette, 'Gravity Arch Droop', () => fp.archDroop, (v) => (fp.archDroop = v), { min: 5, max: 130, step: 1, unit: '°' }, onChange);
    slider(sRosette, 'Stipe Petiole Ratio', () => fp.stipeFraction, (v) => (fp.stipeFraction = v), { min: 0.06, max: 0.55, step: 0.01 }, onChange);
    slider(sRosette, 'Stipe Radius', () => fp.stipeRadius * 1000, (v) => (fp.stipeRadius = v * 0.001), { min: 1.2, max: 11, step: 0.2, unit: 'mm' }, onChange);

    if (fp.architecture !== 'broadleaf_rosette') {
      const sPin = section('Compound Pinnae & Pinnules', this.inspBody, { hint: 'division' });
      slider(sPin, 'Pinna Pairs', () => fp.pinnaPairs, (v) => (fp.pinnaPairs = v), { min: 6, max: 48, step: 1 }, onChange);
      if (fp.architecture === 'bipinnate_lacy' || fp.architecture === 'tree_fern' || fp.architecture === 'maidenhair_fan') {
        slider(sPin, 'Pinnule Sub-Pairs', () => fp.pinnulePairs, (v) => (fp.pinnulePairs = v), { min: 4, max: 16, step: 1 }, onChange);
      }
      slider(sPin, 'Insertion Angle', () => fp.pinnaAngle, (v) => (fp.pinnaAngle = v), { min: 35, max: 95, step: 1, unit: '°' }, onChange);
    }

    const sCrown = section('Rhizome Crown & Caudex', this.inspBody, { collapsed: true });
    slider(sCrown, 'Caudex Trunk Height', () => fp.caudexHeight, (v) => (fp.caudexHeight = v), { min: 0.01, max: 1.2, step: 0.01, unit: 'm' }, onChange);
    slider(sCrown, 'Crown Radius', () => fp.crownRadius, (v) => (fp.crownRadius = v), { min: 0.02, max: 0.18, step: 0.005, unit: 'm' }, onChange);
    slider(sCrown, 'Ramenta Chaff Scales', () => fp.ramentaDensity, (v) => (fp.ramentaDensity = v), { min: 0, max: 1, step: 0.05 }, onChange);
  }

  private buildFernDetailTab(fp: NonNullable<GeneratorLayer['fern']>, onChange: () => void): void {
    const sVein = section('3D Leaf Venation & Lamina Relief', this.inspBody, { hint: 'ultra-mesh' });
    slider(sVein, 'Lamina Thickness', () => fp.laminaThicknessMm, (v) => (fp.laminaThicknessMm = v), { min: 0.2, max: 1.6, step: 0.05, unit: 'mm' }, onChange);
    slider(sVein, 'Midrib / Costa Relief', () => fp.midribRelief, (v) => (fp.midribRelief = v), { min: 0, max: 1.5, step: 0.05 }, onChange);
    slider(sVein, 'Lateral Vein Relief', () => fp.veinRelief, (v) => (fp.veinRelief = v), { min: 0, max: 1.5, step: 0.05 }, onChange);
    slider(sVein, 'Lateral Vein Pairs', () => fp.veinCount, (v) => (fp.veinCount = v), { min: 4, max: 26, step: 1 }, onChange);
    slider(sVein, 'Bullate Quilting', () => fp.bullation, (v) => (fp.bullation = v), { min: 0, max: 1.2, step: 0.04 }, onChange);
    slider(sVein, 'Transverse V-Camber', () => fp.laminaCamber, (v) => (fp.laminaCamber = v), { min: -0.5, max: 0.7, step: 0.02 }, onChange);

    const sMarg = section('Margins, Auricles & Curl', this.inspBody, { hint: 'silhouette' });
    slider(sMarg, 'Serration / Lobe Depth', () => fp.serrationDepth, (v) => (fp.serrationDepth = v), { min: 0, max: 0.38, step: 0.01 }, onChange);
    slider(sMarg, 'Serration Teeth', () => fp.serrationCount, (v) => (fp.serrationCount = v), { min: 4, max: 28, step: 1 }, onChange);
    slider(sMarg, 'Basal Sword Auricle', () => fp.auricle, (v) => (fp.auricle = v), { min: 0, max: 1, step: 0.05 }, onChange);
    slider(sMarg, 'Margin Ruffle Wave', () => fp.edgeUndulation, (v) => (fp.edgeUndulation = v), { min: 0, max: 1, step: 0.04 }, onChange);
    slider(sMarg, 'Apex Tip Droop Curl', () => fp.tipCurl, (v) => (fp.tipCurl = v), { min: -0.4, max: 0.8, step: 0.03 }, onChange);

    const sRepro = section('Circinate Crosiers & Abaxial Sori', this.inspBody, { hint: 'spores' });
    slider(sRepro, 'Fiddlehead Crosiers', () => fp.crosierCount, (v) => (fp.crosierCount = v), { min: 0, max: 9, step: 1 }, onChange);
    slider(sRepro, 'Crosier Emergent H', () => fp.crosierHeight, (v) => (fp.crosierHeight = v), { min: 0.06, max: 0.45, step: 0.01, unit: 'm' }, onChange);
    slider(sRepro, 'Spiral Coil Turns', () => fp.crosierTurns, (v) => (fp.crosierTurns = v), { min: 1.2, max: 3.6, step: 0.1 }, onChange);
    slider(sRepro, 'Abaxial Sori Coverage', () => fp.soriCoverage, (v) => (fp.soriCoverage = v), { min: 0, max: 1, step: 0.05 }, onChange);
    slider(sRepro, 'Sori Dome Diameter', () => fp.soriSizeMm, (v) => (fp.soriSizeMm = v), { min: 0.6, max: 2.6, step: 0.1, unit: 'mm' }, onChange);
  }

  // --- GIANT TROPICAL MEGAPHYLL TABS ---
  private buildTropicalShapeTab(tp: NonNullable<GeneratorLayer['tropical']>, onChange: () => void): void {
    const sArch = section('Giant Tropical Architecture', this.inspBody, { hint: 'megaphyll' });
    select<TropicalArchitecture>(
      sArch,
      'Species Plan',
      (Object.keys(TROPICAL_ARCH_NAMES) as TropicalArchitecture[]).map((k) => ({
        value: k,
        label: TROPICAL_ARCH_NAMES[k],
      })),
      () => tp.architecture,
      (v) => {
        tp.architecture = v;
        this.rebuildInspector();
      },
      onChange,
    );
    select<number>(
      sArch,
      'Mesh Detail Tier',
      [
        { value: 1, label: '1 · Light Canopy' },
        { value: 2, label: '2 · Standard Megaphyll' },
        { value: 3, label: '3 · High-Poly Botanical' },
        { value: 4, label: '4 · Cinema Ultra-Mesh' },
      ],
      () => tp.detailTier,
      (v) => (tp.detailTier = v),
      onChange,
    );

    const sCrown = section('Pseudostem & Colossal Paddles', this.inspBody, { hint: 'stature' });
    slider(sCrown, 'Pseudostem Height', () => tp.pseudostemHeight, (v) => (tp.pseudostemHeight = v), { min: 0.3, max: 3.6, step: 0.05, unit: 'm' }, onChange);
    slider(sCrown, 'Pseudostem Radius', () => tp.pseudostemRadius * 100, (v) => (tp.pseudostemRadius = v * 0.01), { min: 4, max: 24, step: 0.5, unit: 'cm' }, onChange);
    slider(sCrown, 'Clump Stem Count', () => tp.stemCount, (v) => (tp.stemCount = v), { min: 1, max: 4, step: 1 }, onChange);
    slider(sCrown, 'Paddle Leaf Count', () => tp.leafCount, (v) => (tp.leafCount = v), { min: 4, max: 20, step: 1 }, onChange);
    slider(sCrown, 'Leaf Total Length', () => tp.leafLength, (v) => (tp.leafLength = v), { min: 0.8, max: 3.4, step: 0.05, unit: 'm' }, onChange);
    slider(sCrown, 'Paddle Blade Width', () => tp.leafWidth, (v) => (tp.leafWidth = v), { min: 0.24, max: 1.25, step: 0.02, unit: 'm' }, onChange);
    slider(sCrown, 'Petiole Ratio', () => tp.petioleFraction, (v) => (tp.petioleFraction = v), { min: 0.1, max: 0.58, step: 0.02 }, onChange);
    slider(sCrown, 'Crown Splay Angle', () => tp.crownSplayDeg, (v) => (tp.crownSplayDeg = v), { min: 14, max: 72, step: 1, unit: '°' }, onChange);
    slider(sCrown, 'Gravity Arch Droop', () => tp.archDroopDeg, (v) => (tp.archDroopDeg = v), { min: 8, max: 95, step: 1, unit: '°' }, onChange);

    this.appendLiveWindMiniSection();
  }

  private buildTropicalDetailTab(tp: NonNullable<GeneratorLayer['tropical']>, onChange: () => void): void {
    const sTear = section('Wind-Split Ribbons & Sail Aero', this.inspBody, { hint: 'banana strips' });
    if (tp.architecture !== 'elephant_ear_alocasia') {
      slider(sTear, 'Wind Tear Splits', () => tp.windTears, (v) => (tp.windTears = v), { min: 0, max: 16, step: 1 }, onChange);
      slider(sTear, 'Tear Cleft Depth', () => tp.tearDepth, (v) => (tp.tearDepth = v), { min: 0.2, max: 0.94, step: 0.02 }, onChange);
    }
    slider(sTear, 'Wind Sail Flex', () => tp.windSail, (v) => (tp.windSail = v), { min: 0.2, max: 1.8, step: 0.05 }, onChange);
    slider(sTear, 'Adaxial V-Dihedral', () => tp.laminaVDih, (v) => (tp.laminaVDih = v), { min: 0, max: 0.7, step: 0.02 }, onChange);
    slider(sTear, 'Parallel Vein Relief', () => tp.veinRelief, (v) => (tp.veinRelief = v), { min: 0, max: 1.4, step: 0.05 }, onChange);
    slider(sTear, 'Margin Ruffle Wave', () => tp.edgeWave, (v) => (tp.edgeWave = v), { min: 0, max: 1.0, step: 0.03 }, onChange);

    const sOrg = section('Cigar Furl, Fruit Hands & Spathe', this.inspBody, { hint: 'organs' });
    check(sOrg, 'Central Rolled Cigar Leaf', () => tp.showCigarLeaf, (v) => (tp.showCigarLeaf = v), onChange);
    check(sOrg, 'Banana Bell + Fruit / Blooms', () => tp.showInflorescence, (v) => (tp.showInflorescence = v), onChange);

    this.appendLiveWindMiniSection();
  }

  private appendLiveWindMiniSection(): void {
    const sWind = section('Live Wind & Gust Drive', this.inspBody, { hint: '0% scale' });
    slider(
      sWind,
      'Wind Breeze Strength',
      () => this.windStrength,
      (v) => {
        this.windStrength = v;
        this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
      },
      { min: 0, max: 1.5, step: 0.02 },
      () => {},
    );
    slider(
      sWind,
      'Turbulent Gustiness',
      () => this.windGust,
      (v) => {
        this.windGust = v;
        this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
      },
      { min: 0, max: 1.0, step: 0.02 },
      () => {},
    );
    slider(
      sWind,
      'Wind Direction',
      () => this.windAngle,
      (v) => {
        this.windAngle = v;
        this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
      },
      { min: 0, max: 360, step: 5, unit: '°' },
      () => {},
    );
  }

  // --- REAL BRYOPHYTE & CARPET MOSS TABS ---
  private buildMossShapeTab(mp: NonNullable<GeneratorLayer['moss']>, onChange: () => void): void {
    const sHab = section('Bryophyte & Carpet Habit', this.inspBody, { hint: 'bryology' });
    select<MossHabit>(
      sHab,
      'Growth Habit',
      (Object.keys(MOSS_HABIT_NAMES) as MossHabit[]).map((k) => ({
        value: k,
        label: MOSS_HABIT_NAMES[k],
      })),
      () => mp.habit,
      (v) => {
        mp.habit = v;
        if (v === 'velvet_carpet') {
          mp.colonyCoverage = Math.max(0.92, mp.colonyCoverage);
          mp.patchiness = Math.min(0.12, mp.patchiness);
          mp.shootCount = Math.max(1350, mp.shootCount);
        }
        this.rebuildInspector();
      },
      onChange,
    );
    select<number>(
      sHab,
      'Mesh Detail Tier',
      [
        { value: 1, label: '1 · Light Colony' },
        { value: 2, label: '2 · Standard Turf' },
        { value: 3, label: '3 · Lush High-Poly' },
        { value: 4, label: '4 · Cinema Macro' },
      ],
      () => mp.detailTier,
      (v) => (mp.detailTier = v),
      onChange,
    );

    const sCol = section('Carpet & Cushion Coverage', this.inspBody, { hint: 'meadow' });
    slider(sCol, 'Gametophyte Shoots', () => mp.shootCount, (v) => (mp.shootCount = v), { min: 100, max: 2200, step: 25 }, onChange);
    slider(sCol, 'Colony Coverage', () => mp.colonyCoverage, (v) => (mp.colonyCoverage = v), { min: 0.2, max: 1.0, step: 0.02 }, onChange);
    slider(sCol, 'Island Patchiness', () => mp.patchiness, (v) => (mp.patchiness = v), { min: 0, max: 1, step: 0.02 }, onChange);
    slider(sCol, 'Carpet Nap Sweep', () => mp.carpetSweep, (v) => (mp.carpetSweep = v), { min: 0, max: 1, step: 0.03 }, onChange);
    slider(sCol, 'Wind Ripple Flex', () => mp.windCompliance, (v) => (mp.windCompliance = v), { min: 0.2, max: 2.0, step: 0.05 }, onChange);
    slider(sCol, 'Crevice Affinity', () => mp.creviceAffinity, (v) => (mp.creviceAffinity = v), { min: 0, max: 1, step: 0.03 }, onChange);
    slider(sCol, 'Undulation / Pillow H', () => mp.cushionHeightMm, (v) => (mp.cushionHeightMm = v), { min: 2, max: 140, step: 1, unit: 'mm' }, onChange);
    slider(sCol, 'Undulation Freq', () => mp.cushionScale, (v) => (mp.cushionScale = v), { min: 1.5, max: 10, step: 0.15 }, onChange);
    if (mp.habit === 'billowing_pillow') {
      slider(sCol, 'Sun-Toasted Crests', () => mp.pillowToast ?? 0.2, (v) => (mp.pillowToast = v), { min: 0, max: 0.55, step: 0.02 }, onChange);
    }

    const sSt = section('Gametophyte Stems & Branching', this.inspBody);
    slider(sSt, 'Shoot / Velvet Height', () => mp.shootHeightMm, (v) => (mp.shootHeightMm = v), { min: 2.5, max: 75, step: 0.2, unit: 'mm' }, onChange);
    slider(sSt, 'Lateral Branching', () => mp.branching, (v) => (mp.branching = v), { min: 0, max: 8, step: 1 }, onChange);
    slider(sSt, 'Basal Rhizoid Felt', () => mp.rhizoidDensity, (v) => (mp.rhizoidDensity = v), { min: 0, max: 1, step: 0.05 }, onChange);

    this.appendLiveWindMiniSection();
  }

  private buildMossDetailTab(mp: NonNullable<GeneratorLayer['moss']>, onChange: () => void): void {
    const sPh = section('3D Spiraled Phyllids (Micro-Leaves)', this.inspBody, { hint: 'golden 137.5°' });
    slider(sPh, 'Phyllids per Shoot', () => mp.phyllidsPerShoot, (v) => (mp.phyllidsPerShoot = v), { min: 8, max: 48, step: 1 }, onChange);
    slider(sPh, 'Phyllid Length', () => mp.phyllidLengthMm, (v) => (mp.phyllidLengthMm = v), { min: 1.5, max: 12, step: 0.2, unit: 'mm' }, onChange);
    slider(sPh, 'Phyllid Width', () => mp.phyllidWidthMm, (v) => (mp.phyllidWidthMm = v), { min: 0.5, max: 3.2, step: 0.05, unit: 'mm' }, onChange);
    slider(sPh, 'Hydration Star-Open', () => mp.hydration, (v) => (mp.hydration = v), { min: 0, max: 1, step: 0.02 }, onChange);
    slider(sPh, 'Falcate / Dry Curl', () => mp.phyllidCurl, (v) => (mp.phyllidCurl = v), { min: -0.6, max: 1.0, step: 0.03 }, onChange);
    slider(sPh, 'Hyaline Silver Awns', () => mp.hyalineHairPoint, (v) => (mp.hyalineHairPoint = v), { min: 0, max: 0.85, step: 0.03 }, onChange);

    const sSp = section('Sporophytes: Setae & Spore Capsules', this.inspBody, { hint: 'diploid' });
    slider(sSp, 'Sporophyte Density', () => mp.sporophyteDensity, (v) => (mp.sporophyteDensity = v), { min: 0, max: 0.6, step: 0.02 }, onChange);
    slider(sSp, 'Seta Stalk Height', () => mp.setaHeightMm, (v) => (mp.setaHeightMm = v), { min: 12, max: 90, step: 1, unit: 'mm' }, onChange);
    slider(sSp, 'Theca Capsule Len', () => mp.capsuleLengthMm, (v) => (mp.capsuleLengthMm = v), { min: 2, max: 10, step: 0.2, unit: 'mm' }, onChange);
    slider(sSp, 'Swan-Neck Nod Angle', () => mp.capsuleNodDeg, (v) => (mp.capsuleNodDeg = v), { min: 0, max: 150, step: 2, unit: '°' }, onChange);
  }

  // --- STUDIO FUR & HAIR GROOM TABS ---
  private buildHairShapeTab(hp: NonNullable<GeneratorLayer['hair']>, onChange: () => void): void {
    const sFlow = section('Groom Flow & Coat Density', this.inspBody, { hint: 'follicles' });
    select<HairFlowMode>(
      sFlow,
      'Flow & Parting',
      (Object.keys(HAIR_FLOW_NAMES) as HairFlowMode[]).map((k) => ({
        value: k,
        label: HAIR_FLOW_NAMES[k],
      })),
      () => hp.flowMode,
      (v) => (hp.flowMode = v),
      onChange,
    );
    select<number>(
      sFlow,
      'Groom Density Tier',
      [
        { value: 1, label: '1 · Fast Groom' },
        { value: 2, label: '2 · Standard Coat' },
        { value: 3, label: '3 · Studio Plush' },
        { value: 4, label: '4 · Cinema Dense' },
      ],
      () => hp.detailTier,
      (v) => (hp.detailTier = v),
      onChange,
    );
    slider(sFlow, 'Master Guides', () => hp.guideCount, (v) => (hp.guideCount = v), { min: 36, max: 320, step: 4 }, onChange);
    slider(sFlow, 'Guard / Main Strands', () => hp.guardCount, (v) => (hp.guardCount = v), { min: 200, max: 7500, step: 100 }, onChange);
    slider(sFlow, 'Undercoat Down', () => hp.undercoatCount, (v) => (hp.undercoatCount = v), { min: 0, max: 9000, step: 100 }, onChange);
    slider(sFlow, 'Whiskers / Halo', () => hp.whiskerCount, (v) => (hp.whiskerCount = v), { min: 0, max: 250, step: 5 }, onChange);

    const sPhys = section('Length, Taper & Cantilever Drape', this.inspBody, { hint: 'physics' });
    slider(sPhys, 'Guard Length', () => hp.lengthCm, (v) => (hp.lengthCm = v), { min: 1.5, max: 42, step: 0.5, unit: 'cm' }, onChange);
    slider(sPhys, 'Undercoat Ratio', () => hp.undercoatLengthRatio, (v) => (hp.undercoatLengthRatio = v), { min: 0.25, max: 0.95, step: 0.02 }, onChange);
    slider(sPhys, 'Root Shaft Radius', () => hp.rootRadiusMm, (v) => (hp.rootRadiusMm = v), { min: 0.2, max: 1.4, step: 0.02, unit: 'mm' }, onChange);
    slider(sPhys, 'Root Follicle Lift', () => hp.rootLift, (v) => (hp.rootLift = v), { min: 0.05, max: 1.0, step: 0.02 }, onChange);
    slider(sPhys, 'Comb Alignment', () => hp.combStrength, (v) => (hp.combStrength = v), { min: 0, max: 1, step: 0.02 }, onChange);
    slider(sPhys, 'Part Line Crispness', () => hp.partSharpness, (v) => (hp.partSharpness = v), { min: 0.05, max: 1, step: 0.03 }, onChange);
    slider(sPhys, 'Gravity Droop', () => hp.gravity, (v) => (hp.gravity = v), { min: 0, max: 2.4, step: 0.04 }, onChange);
    slider(sPhys, 'Bending Stiffness', () => hp.stiffness, (v) => (hp.stiffness = v), { min: 0.6, max: 2.8, step: 0.05 }, onChange);
  }

  private buildHairDetailTab(hp: NonNullable<GeneratorLayer['hair']>, onChange: () => void): void {
    const sClump = section('Lock Clumping & Sub-Clusters', this.inspBody, { hint: 'locks' });
    slider(sClump, 'Primary Clumping', () => hp.clumpStrength, (v) => (hp.clumpStrength = v), { min: 0, max: 1, step: 0.02 }, onChange);
    slider(sClump, 'Clump Profile Exp', () => hp.clumpPower, (v) => (hp.clumpPower = v), { min: 0.4, max: 2.6, step: 0.05 }, onChange);
    slider(sClump, 'Sub-Lock Clustering', () => hp.subClumpStrength, (v) => (hp.subClumpStrength = v), { min: 0, max: 1, step: 0.02 }, onChange);
    slider(sClump, 'Tip Taper Sharpness', () => hp.tipTaper, (v) => (hp.tipTaper = v), { min: 0.5, max: 1.0, step: 0.01 }, onChange);

    const sCurl = section('3D Helical Curls, Waves & Frizz', this.inspBody, { hint: 'modifiers' });
    slider(sCurl, 'Helical Curl Radius', () => hp.curlRadiusMm, (v) => (hp.curlRadiusMm = v), { min: 0, max: 14, step: 0.2, unit: 'mm' }, onChange);
    slider(sCurl, 'Helical Curl Turns', () => hp.curlTurns, (v) => (hp.curlTurns = v), { min: 0, max: 12, step: 0.2 }, onChange);
    slider(sCurl, 'S-Wave Amplitude', () => hp.waveAmplitudeMm, (v) => (hp.waveAmplitudeMm = v), { min: 0, max: 18, step: 0.3, unit: 'mm' }, onChange);
    slider(sCurl, 'S-Wave Cycles', () => hp.waveCycles, (v) => (hp.waveCycles = v), { min: 0.5, max: 6, step: 0.1 }, onChange);
    slider(sCurl, 'Coherent Frizz', () => hp.frizzMm, (v) => (hp.frizzMm = v), { min: 0, max: 6, step: 0.1, unit: 'mm' }, onChange);
    slider(sCurl, 'Stray Flyaway Halo', () => hp.flyawayFraction, (v) => (hp.flyawayFraction = v), { min: 0, max: 0.3, step: 0.01 }, onChange);

    const sTess = section('Strand Shaft Tessellation', this.inspBody, { collapsed: true });
    slider(sTess, 'Segments per Strand', () => hp.strandSegments, (v) => (hp.strandSegments = v), { min: 6, max: 28, step: 1 }, onChange);
    select<number>(
      sTess,
      'Tube Cross-Section',
      [
        { value: 3, label: '3-Sided Prism Shaft' },
        { value: 4, label: '4-Sided Quad Tube' },
      ],
      () => hp.shaftSides,
      (v) => (hp.shaftSides = v),
      onChange,
    );
  }

  // --- SURFACE, PIGMENTATION & HOST SUBSTRATE TAB ---
  private buildSurfaceTab(layer: GeneratorLayer, onChange: () => void): void {
    if (layer.kind === 'tree' && layer.tree) {
      const tr = layer.tree;
      const sCol = section('Bark, Buttress & Canopy Pigments', this.inspBody, { hint: 'SSS' });
      colorField(sCol, 'Heartwood & Bark', () => tr.hueBark, (c) => (tr.hueBark = c), onChange);
      colorField(sCol, 'Inner Canopy Leaf', () => tr.hueLeaf, (c) => (tr.hueLeaf = c), onChange);
      colorField(sCol, 'Sunlit Crown Tips', () => tr.hueLeafTip, (c) => (tr.hueLeafTip = c), onChange);
    } else if (layer.kind === 'palm' && layer.palm) {
      const pp = layer.palm;
      const sCol = section('Trunk, Frond & Infructescence Pigments', this.inspBody, { hint: 'SSS' });
      colorField(sCol, 'Trunk & Leaf-Boots', () => pp.hueTrunk, (c) => (pp.hueTrunk = c), onChange);
      colorField(sCol, 'Mature Frond Blade', () => pp.hueFrond, (c) => (pp.hueFrond = c), onChange);
      colorField(sCol, 'Sunlit Spear & Tips', () => pp.hueFrondTip, (c) => (pp.hueFrondTip = c), onChange);
      colorField(sCol, 'Ripe Dates / Coconuts', () => pp.hueFruit, (c) => (pp.hueFruit = c), onChange);
      colorField(sCol, 'Spadix & Strands', () => pp.hueSpadix, (c) => (pp.hueSpadix = c), onChange);
    } else if (layer.kind === 'flower' && layer.flower) {
      const flp = layer.flower;
      const sPal = section('Curated Vibrant Colorways', this.inspBody, { hint: 'swatches' });
      this.appendFlowerColorwaySwatches(sPal, flp, onChange);

      const sPig = section('Custom 6-Zone Floral Pigments', this.inspBody, { hint: 'floral SSS' });
      const markCustom = (fn: (c: string) => void) => (c: string) => {
        flp.colorPalette = 'custom';
        fn(c);
      };
      colorField(sPig, 'Primary Petal Corolla', () => flp.huePrimary, markCustom((c) => (flp.huePrimary = c)), onChange);
      colorField(sPig, 'Margin / Tip / Picotee', () => flp.hueSecondary, markCustom((c) => (flp.hueSecondary = c)), onChange);
      colorField(sPig, 'Velvet Throat / Eye', () => flp.hueThroat, markCustom((c) => (flp.hueThroat = c)), onChange);
      colorField(sPig, '3D Veins & Papillae', () => flp.hueVein, markCustom((c) => (flp.hueVein = c)), onChange);
      colorField(sPig, 'Pollen / Anther / Disc', () => flp.huePollen, markCustom((c) => (flp.huePollen = c)), onChange);
      colorField(sPig, 'Stems, Sepals & Leaves', () => flp.hueStemLeaf, markCustom((c) => (flp.hueStemLeaf = c)), onChange);

      slider(sPig, 'Margin / Tip Blend', () => flp.edgeBlend, (v) => (flp.edgeBlend = v), { min: 0, max: 1, step: 0.03 }, onChange);
      slider(sPig, 'Velvet Throat Size', () => flp.throatSize, (v) => (flp.throatSize = v), { min: 0, max: 0.65, step: 0.02 }, onChange);
      slider(sPig, 'Vein Guide Contrast', () => flp.veinContrast, (v) => (flp.veinContrast = v), { min: 0, max: 1, step: 0.03 }, onChange);
    } else if (layer.kind === 'marine' && layer.marine) {
      const mrp = layer.marine;
      const sPal = section('Curated Reef & Kelp Colorways', this.inspBody, { hint: 'swatches' });
      this.appendMarineColorwaySwatches(sPal, mrp, onChange);

      const sPig = section('5-Zone Marine & Biolum Pigments', this.inspBody, { hint: 'ocean SSS' });
      const markCustom = (fn: (c: string) => void) => (c: string) => {
        mrp.colorPalette = 'custom';
        fn(c);
      };
      colorField(sPig, 'Primary Thallus / Coral', () => mrp.huePrimary, markCustom((c) => (mrp.huePrimary = c)), onChange);
      colorField(sPig, 'Secondary Blade / Atrium', () => mrp.hueSecondary, markCustom((c) => (mrp.hueSecondary = c)), onChange);
      colorField(sPig, 'Bladders / Glowing Tips', () => mrp.hueAccent, markCustom((c) => (mrp.hueAccent = c)), onChange);
      colorField(sPig, 'Holdfast / Reef Base', () => mrp.hueHoldfast, markCustom((c) => (mrp.hueHoldfast = c)), onChange);
      colorField(sPig, 'Polyps / Epiphytes', () => mrp.huePolyp, markCustom((c) => (mrp.huePolyp = c)), onChange);
      slider(sPig, 'Subsurface Translucency', () => mrp.translucency, (v) => (mrp.translucency = v), { min: 0.05, max: 0.95, step: 0.03 }, onChange);
    } else if (layer.kind === 'fern' && layer.fern) {
      const fp = layer.fern;
      const sCol = section('Chlorophyll, Cuticle & Senescence', this.inspBody, { hint: 'SSS' });
      colorField(sCol, 'Mature Mesophyll', () => fp.hueBase, (c) => (fp.hueBase = c), onChange);
      colorField(sCol, 'Young Flush / Crosier', () => fp.hueYoung, (c) => (fp.hueYoung = c), onChange);
      colorField(sCol, 'Stipe & Rachis', () => fp.hueStipe, (c) => (fp.hueStipe = c), onChange);
      slider(sCol, 'Outer Frond Aging', () => fp.senescence, (v) => (fp.senescence = v), { min: 0, max: 0.85, step: 0.02 }, onChange);
    } else if (layer.kind === 'tropical' && layer.tropical) {
      const tp = layer.tropical;
      const sCol = section('Tropical Cuticle, Midrib & Sheaths', this.inspBody, { hint: 'SSS' });
      colorField(sCol, 'Mature Paddle Blade', () => tp.hueBlade, (c) => (tp.hueBlade = c), onChange);
      colorField(sCol, 'Young Inner / Cigar', () => tp.hueYoung, (c) => (tp.hueYoung = c), onChange);
      colorField(sCol, 'Midrib & Petiole', () => tp.hueMidrib, (c) => (tp.hueMidrib = c), onChange);
      colorField(sCol, 'Pseudostem Sheaths', () => tp.hueStem, (c) => (tp.hueStem = c), onChange);
      slider(sCol, 'Outer Skirt Senescence', () => tp.senescence, (v) => (tp.senescence = v), { min: 0, max: 0.75, step: 0.02 }, onChange);
    } else if (layer.kind === 'moss' && layer.moss) {
      const mp = layer.moss;
      const sCol = section('Bryophyte Hydration Pigments', this.inspBody, { hint: 'velvet' });
      colorField(sCol, 'Canopy Phyllids', () => mp.hueCanopy, (c) => (mp.hueCanopy = c), onChange);
      colorField(sCol, 'Apical Star / Capitulum', () => mp.hueTip, (c) => (mp.hueTip = c), onChange);
      colorField(sCol, 'Peat Base & Rhizoids', () => mp.hueBase, (c) => (mp.hueBase = c), onChange);
      colorField(sCol, 'Sporophyte Capsule', () => mp.hueCapsule, (c) => (mp.hueCapsule = c), onChange);
    } else if (layer.kind === 'hair' && layer.hair) {
      const hp = layer.hair;
      const sMel = section('Physical Melanin, Agouti & Cuticle', this.inspBody, { hint: 'Marschner' });
      slider(sMel, 'Eumelanin (Black/Brown)', () => hp.eumelanin, (v) => (hp.eumelanin = v), { min: 0.01, max: 1.5, step: 0.02 }, onChange);
      slider(sMel, 'Pheomelanin (Red/Gold)', () => hp.pheomelanin, (v) => (hp.pheomelanin = v), { min: 0, max: 1.5, step: 0.02 }, onChange);
      slider(sMel, 'Agouti Wild Fur Band', () => hp.agoutiBand, (v) => (hp.agoutiBand = v), { min: 0, max: 1, step: 0.02 }, onChange);
      slider(sMel, 'Sun-Bleached Tips', () => hp.tipBleach, (v) => (hp.tipBleach = v), { min: 0, max: 1, step: 0.02 }, onChange);
      slider(sMel, 'Follicle Root Depth', () => hp.rootDarkening, (v) => (hp.rootDarkening = v), { min: 0, max: 0.85, step: 0.02 }, onChange);
      slider(sMel, 'Undercoat Contrast', () => hp.undercoatWarmth, (v) => (hp.undercoatWarmth = v), { min: -0.5, max: 0.6, step: 0.02 }, onChange);
      slider(sMel, 'Cuticle Roughness', () => hp.cuticleRoughness, (v) => (hp.cuticleRoughness = v), { min: 0.08, max: 0.75, step: 0.01 }, onChange);
    }

    const sub = this.sceneSpec.substrate;
    const sSub = section('3D Host Emitter / Substrate', this.inspBody, { hint: 'host mesh' });
    select<SubstrateKind>(
      sSub,
      'Host Geometry',
      (Object.keys(SUBSTRATE_NAMES) as SubstrateKind[]).map((k) => ({
        value: k,
        label: SUBSTRATE_NAMES[k],
      })),
      () => sub.kind,
      (v) => (sub.kind = v),
      () => this.requestGenerate(true),
    );
    slider(sSub, 'Host Scale / Radius', () => sub.size, (v) => (sub.size = v), { min: 0.1, max: 5.5, step: 0.02, unit: 'm' }, onChange);
    slider(sSub, 'Micro-Relief Crags', () => sub.roughness, (v) => (sub.roughness = v), { min: 0, max: 1, step: 0.03 }, onChange);
    slider(sSub, 'Surface Moisture', () => sub.moisture, (v) => (sub.moisture = v), { min: 0, max: 1, step: 0.03 }, onChange);
    slider(sSub, 'Host Grid Resolution', () => sub.resolution, (v) => (sub.resolution = v), { min: 24, max: 120, step: 4 }, onChange);
  }

  // --- OUTLINER NODE & LAYER TRANSFORM INSPECTOR TAB ---
  private buildNodeInspectorTab(): void {
    const nodes = this.lastBuild?.outliner ?? [];
    const sel = nodes.find((n) => n.id === this.selectedNodeId) ?? nodes[0];
    const layer = this.getActiveLayer();

    if (sel) {
      const sInfo = section('Selected Outliner Node', this.inspBody, { hint: sel.kind });
      const kv = el('div', 'kvgrid');
      const addKv = (k: string, v: string, cls = '') => {
        kv.append(el('span', '', k), el('b', cls, v));
      };
      addKv('Node ID', sel.id);
      addKv('Name', sel.name);
      addKv('Triangles', sel.triangles.toLocaleString('en-US'), 'ok');
      addKv('Vertices', sel.vertices.toLocaleString('en-US'));
      addKv('Shading Profile', sel.shading ?? 'composite');
      sInfo.append(kv);

      if (sel.partIds.length > 0 && sel.kind !== 'scene') {
        const acts = el('div', 'actions');
        acts.append(
          button('Frame Selected', () => this.stage.frameSelected(), { icon: 'frame' }),
          button(this.soloNodeId === sel.id ? 'Exit Solo' : 'Solo Node', () => this.toggleSolo(sel.id), {
            icon: 'solo',
            cls: this.soloNodeId === sel.id ? 'primary' : '',
          }),
        );
        sInfo.append(acts);
      }
    }

    if (layer) {
      const sXform = section(`Layer · ${layer.name}`, this.inspBody, { hint: 'transform' });
      const st = stepper(
        sXform,
        'Generator Seed',
        () => layer.seed,
        (v) => (layer.seed = v),
        { min: 1, max: 99999, step: 1, integer: true },
        () => this.requestGenerate(false),
      );
      st.element.classList.add('seed');

      const xf = layer.transform;
      const trig = () => this.requestGenerate(false);
      slider(sXform, 'Offset X', () => xf.x, (v) => (xf.x = v), { min: -0.6, max: 0.6, step: 0.01, unit: 'm' }, trig);
      slider(sXform, 'Offset Y', () => xf.y, (v) => (xf.y = v), { min: -0.4, max: 0.6, step: 0.01, unit: 'm' }, trig);
      slider(sXform, 'Offset Z', () => xf.z, (v) => (xf.z = v), { min: -0.6, max: 0.6, step: 0.01, unit: 'm' }, trig);
      slider(sXform, 'Yaw Rotation', () => xf.yaw, (v) => (xf.yaw = v), { min: -180, max: 180, step: 2, unit: '°' }, trig);
      slider(sXform, 'Uniform Scale', () => xf.scale, (v) => (xf.scale = v), { min: 0.25, max: 2.5, step: 0.02 }, trig);

      const lActs = el('div', 'actions');
      lActs.append(
        button('Duplicate Layer', () => {
          const copy = JSON.parse(JSON.stringify(layer)) as GeneratorLayer;
          copy.id = `layer-${Date.now().toString(36).slice(-4)}`;
          copy.name = `${layer.name} Copy`;
          copy.seed = layer.seed + 7;
          copy.transform.x += 0.12;
          this.sceneSpec.layers.push(copy);
          this.selectedNodeId = copy.id;
          this.requestGenerate(false);
        }, { icon: 'copy' }),
      );
      if (this.sceneSpec.layers.length > 1) {
        lActs.append(
          button('Remove Layer', () => {
            this.sceneSpec.layers = this.sceneSpec.layers.filter((l) => l.id !== layer.id);
            this.selectedNodeId = this.sceneSpec.layers[0].id;
            this.rebuildInspector();
            this.requestGenerate(false);
          }, { icon: 'trash', cls: 'danger' }),
        );
      }
      sXform.append(lActs);
    }
  }

  // --- SCENE LIGHTING, WIND, AUDIT & EXPORT TAB ---
  private buildSceneTab(): void {
    const sEnv = section('Wind & Studio Illumination', this.inspBody, { hint: 'realtime' });
    slider(
      sEnv,
      'Wind Breeze Strength',
      () => this.windStrength,
      (v) => {
        this.windStrength = v;
        this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
      },
      { min: 0, max: 1.5, step: 0.02 },
      () => {},
    );
    slider(
      sEnv,
      'Turbulent Gustiness',
      () => this.windGust,
      (v) => {
        this.windGust = v;
        this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
      },
      { min: 0, max: 1.0, step: 0.02 },
      () => {},
    );
    slider(
      sEnv,
      'Wind Azimuth',
      () => this.windAngle,
      (v) => {
        this.windAngle = v;
        this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
      },
      { min: 0, max: 360, step: 5, unit: '°' },
      () => {},
    );
    slider(
      sEnv,
      'Key Light Azimuth',
      () => this.sunAzimuth,
      (v) => {
        this.sunAzimuth = v;
        this.stage.setLighting(this.sunAzimuth, this.sunElevation, this.exposure);
      },
      { min: -180, max: 180, step: 2, unit: '°' },
      () => {},
    );
    slider(
      sEnv,
      'Key Light Elevation',
      () => this.sunElevation,
      (v) => {
        this.sunElevation = v;
        this.stage.setLighting(this.sunAzimuth, this.sunElevation, this.exposure);
      },
      { min: 8, max: 85, step: 1, unit: '°' },
      () => {},
    );
    slider(
      sEnv,
      'ACES Exposure',
      () => this.exposure,
      (v) => {
        this.exposure = v;
        this.stage.setLighting(this.sunAzimuth, this.sunElevation, this.exposure);
      },
      { min: 0.5, max: 2.0, step: 0.02 },
      () => {},
    );
    check(
      sEnv,
      'Turntable Rotation',
      () => this.stage.getTurntable(),
      (v) => {
        this.stage.setTurntable(v);
        this.spinBtn.classList.toggle('on', v);
      },
      () => {},
    );

    const sExp = section('3D Asset & Image Export', this.inspBody, { hint: 'DCC ready' });
    const expActs = el('div', 'actions');
    expActs.append(
      button('Export GLB', () => this.requestExport('glb'), { icon: 'download', cls: 'primary', title: 'Binary glTF 2.0 with hierarchical named sub-nodes & vertex colors' }),
      button('Export OBJ (Quads)', () => this.requestExport('obj'), { icon: 'download', title: 'Quad-preserving Wavefront OBJ grouped by Outliner sub-parts' }),
      button('Save PNG', () => this.downloadScreenshot(), { icon: 'camera' }),
    );
    sExp.append(expActs);

    if (this.lastBuild) {
      const b = this.lastBuild;
      const sAud = section('Mesh Audit & Timings', this.inspBody, { hint: 'verified' });
      const kv = el('div', 'kvgrid');
      const addRow = (k: string, v: string, cls = '') => kv.append(el('span', '', k), el('b', cls, v));
      addRow('Rendered Triangles', b.topology.renderedTriangles.toLocaleString('en-US'));
      addRow('Native Quads', b.topology.quads.toLocaleString('en-US'));
      addRow('Cap Triangles', b.topology.tris.toLocaleString('en-US'));
      addRow('NaN / Inf Vertices', String(b.topology.nanVertices), b.topology.nanVertices === 0 ? 'ok' : 'warn');
      addRow('Degenerate Faces', String(b.topology.degenerateFaces), b.topology.degenerateFaces === 0 ? 'ok' : 'warn');
      sAud.append(kv);

      const bars = el('div', 'bars');
      const tot = Math.max(0.1, b.timings.totalMs);
      const mkBar = (label: string, ms: number) => {
        const bar = el('div', 'bar');
        const fill = el('i');
        fill.style.width = `${Math.min(100, (ms / tot) * 100)}%`;
        bar.append(fill);
        bars.append(el('span', '', label), bar, el('span', '', `${ms.toFixed(1)}ms`));
      };
      mkBar('Substrate', b.timings.substrateMs);
      mkBar('Generators', b.timings.generatorsMs);
      mkBar('Audit/Pack', b.timings.auditMs + b.timings.packMs);
      sAud.append(bars);
    }
  }

  // ===========================================================================
  // Display Mode, Export, CLI & Keyboard Shortcuts
  // ===========================================================================

  public setDisplayMode(mode: DisplayMode): void {
    this.stage.setDisplayMode(mode);
    for (const [m, btn] of this.modeButtons) btn.classList.toggle('on', m === mode);

    if (mode === 'anatomy') {
      this.legendEl.classList.add('show');
      this.legendEl.innerHTML =
        `<span><i style="background:#524d47"></i>Host</span>` +
        `<span><i style="background:#d67038"></i>Crown/Guides</span>` +
        `<span><i style="background:#ebc23d"></i>Crosier/Down</span>` +
        `<span><i style="background:#2ec770"></i>Pinnae/Guard</span>` +
        `<span><i style="background:#33adee"></i>Pinnule/Seta</span>` +
        `<span><i style="background:#eb4d8f"></i>Sori/Capsule</span>`;
    } else {
      this.legendEl.classList.remove('show');
    }
  }

  public requestExport(format: 'obj' | 'glb'): void {
    this.statusDot.className = 'sdot busy';
    this.statusText.textContent = `Packing .${format}…`;
    const req: WorkerReq = {
      type: 'export',
      id: this.nextReqId++,
      scene: this.sceneSpec,
      format,
      visiblePartIds: this.stage.getVisiblePartIds(),
    };
    this.worker.postMessage(req);
  }

  private downloadScreenshot(): void {
    const url = this.stage.captureScreenshotDataUrl();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(this.sceneSpec.presetName || 'frontier').toLowerCase().replace(/\s+/g, '_')}.png`;
    a.click();
    this.toast('Saved viewport PNG screenshot');
  }

  public executeCommand(raw: string): string {
    const parts = raw.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? '';
    const rest = parts.slice(1).join(' ');

    if (cmd === 'help' || cmd === '?') {
      const msg =
        'preset <name> · tier <1-4> · seed <n> · add <tree|palm|tropical|fern|moss|hair> · mode <shaded|clay|wire|anatomy|detail|wind> · wind <0-1.5> · macro · frame · export <glb|obj>';
      this.toast(msg);
      return msg;
    }
    if (cmd === 'preset') {
      const match = PRESETS.find((p) => p.name.toLowerCase().includes(rest.toLowerCase()));
      if (match) {
        this.loadPreset(match.name);
        return `Loaded ${match.name}`;
      }
      this.toast(`No preset matching "${rest}"`);
      return 'Not found';
    }
    if (cmd === 'tier') {
      const t = Math.max(1, Math.min(4, parseInt(rest, 10) || 3));
      const l = this.getActiveLayer();
      if (l?.tree) l.tree.detailTier = t;
      if (l?.palm) l.palm.detailTier = t;
      if (l?.flower) l.flower.detailTier = t;
      if (l?.fern) l.fern.detailTier = t;
      if (l?.tropical) l.tropical.detailTier = t;
      if (l?.moss) l.moss.detailTier = t;
      if (l?.hair) l.hair.detailTier = t;
      this.rebuildInspector();
      this.requestGenerate(false);
      this.toast(`Set detail tier = ${t}`);
      return `tier ${t}`;
    }
    if (cmd === 'seed') {
      const s = parseInt(rest, 10);
      const l = this.getActiveLayer();
      if (l && Number.isFinite(s)) {
        l.seed = s;
        this.rebuildInspector();
        this.requestGenerate(false);
        return `seed ${s}`;
      }
    }
    if (cmd === 'add') {
      const rawK = rest.toLowerCase();
      const k =
        rawK === 'sea' ||
        rawK === 'kelp' ||
        rawK === 'seaweed' ||
        rawK === 'seagrass' ||
        rawK === 'algae' ||
        rawK === 'coral'
          ? 'marine'
          : rawK;
      if (
        k === 'tree' ||
        k === 'palm' ||
        k === 'flower' ||
        k === 'marine' ||
        k === 'tropical' ||
        k === 'fern' ||
        k === 'moss' ||
        k === 'hair'
      ) {
        this.addLayer(k);
        return `added ${k}`;
      }
    }
    if (cmd === 'mode') {
      const m = rest.toLowerCase() as DisplayMode;
      if (this.modeButtons.has(m)) {
        this.setDisplayMode(m);
        return `mode ${m}`;
      }
    }
    if (cmd === 'wind') {
      const w = parseFloat(rest);
      if (Number.isFinite(w)) {
        this.windStrength = Math.max(0, Math.min(1.5, w));
        this.stage.setWind(this.windStrength, this.windAngle, this.windGust);
        return `wind ${this.windStrength}`;
      }
    }
    if (cmd === 'macro') {
      this.stage.frameMacro();
      return 'macro';
    }
    if (cmd === 'frame') {
      this.stage.frameAll();
      return 'frame';
    }
    if (cmd === 'solo') {
      if (rest === 'off' || rest === 'none') this.soloNodeId = null;
      else this.toggleSolo(this.selectedNodeId);
      this.applyVisibilityToStage();
      this.renderOutliner();
      return 'solo';
    }
    if (cmd === 'export') {
      const fmt = rest.toLowerCase() === 'obj' ? 'obj' : 'glb';
      this.requestExport(fmt);
      return `export ${fmt}`;
    }
    this.toast(`Unknown command "${cmd}" — try: help`);
    return 'unknown';
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (ev) => {
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

      const k = ev.key.toLowerCase();
      if (k === '1') this.setDisplayMode('shaded');
      else if (k === '2') this.setDisplayMode('clay');
      else if (k === '3') this.setDisplayMode('wire');
      else if (k === '4') this.setDisplayMode('anatomy');
      else if (k === '5') this.setDisplayMode('detail');
      else if (k === '6') this.setDisplayMode('wind');
      else if (k === 'f') this.stage.frameAll();
      else if (k === 'm') {
        this.stage.frameMacro();
        this.toast('Macro close-up');
      } else if (k === 'b') this.stage.frameBase();
      else if (k === 'r') this.randomizeSeed();
      else if (k === 't') {
        const next = !this.stage.getTurntable();
        this.stage.setTurntable(next);
        this.spinBtn.classList.toggle('on', next);
      } else if (k === 'g') {
        const next = !this.stage.getScaleVisible();
        this.stage.setScaleVisible(next);
        this.scaleBtn.classList.toggle('on', next);
      } else if (ev.code === 'Space') {
        ev.preventDefault();
        const next = !this.stage.isPaused();
        this.stage.setPaused(next);
        this.toast(next ? 'Wind paused' : 'Wind resumed');
      }
    });
  }

  private toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, 2400);
  }

  // ===========================================================================
  // Programmatic API (`window.frontier`)
  // ===========================================================================

  public exposeApi(): void {
    (window as unknown as Record<string, unknown>).frontier = {
      presets: () => PRESETS.map((p) => ({ name: p.name, group: p.group, subtitle: p.subtitle })),
      loadPreset: (name: string) => this.loadPreset(name),
      getScene: () => this.sceneSpec,
      getLastBuild: () => this.lastBuild,
      getOutliner: () => this.lastBuild?.outliner ?? [],
      selectNode: (id: string) => this.selectOutlinerNode(id),
      toggleVisibility: (id: string) => this.toggleNodeVisibility(id),
      toggleSolo: (id: string) => this.toggleSolo(id),
      addLayer: (kind: GeneratorKind) => this.addLayer(kind),
      setMode: (m: DisplayMode) => this.setDisplayMode(m),
      frameAll: () => this.stage.frameAll(),
      frameMacro: () => this.stage.frameMacro(),
      frameBase: () => this.stage.frameBase(),
      runCommand: (cmd: string) => this.executeCommand(cmd),
      capture: () => this.stage.captureScreenshotDataUrl(),
    };
  }
}

const appRoot = document.getElementById('app');
if (appRoot) {
  const studio = new FrontierStudio(appRoot);
  studio.exposeApi();
}
