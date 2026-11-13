import { ALL_ICONS, CATEGORIES, searchIcons, getIconById } from './icons/index.js';
import { ThreeIconViewer } from './three-viewer.js';
import { renderUVEditorMockup, renderSimulationMockup, renderModellingMockup } from './dcc-mockups.js';
import { 
  copyToClipboard, 
  downloadSvgFile, 
  downloadPngFromSvg, 
  generateReactComponent, 
  generateVueComponent, 
  downloadAllIconsZip, 
  downloadSpriteSheet 
} from './export-utils.js';

// Application State
const state = {
  viewMode: 'gallery', // 'gallery', 'vector', 'three', 'workspaces', 'references'
  activeCategory: 'all',
  searchQuery: '',
  iconSize: 96,
  accentColor: '#f59e0b',
  enableTilt: true,
  currentModalIcon: null,
  threeViewer: null,
  activeMockupTab: 'uv'
};

// DOM Elements
const navGallery = document.getElementById('nav-gallery');
const navVector = document.getElementById('nav-vector');
const navThree = document.getElementById('nav-three');
const navWorkspaces = document.getElementById('nav-workspaces');
const navReferences = document.getElementById('nav-references');

const sectionControls = document.getElementById('section-controls');
const sectionGallery = document.getElementById('section-gallery');
const sectionThree = document.getElementById('section-three');
const sectionWorkspaces = document.getElementById('section-workspaces');
const sectionReferences = document.getElementById('section-references');

const iconsGrid = document.getElementById('icons-grid');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const categoryPills = document.getElementById('category-pills');
const resultsCount = document.getElementById('results-count');
const activeStyleLabel = document.getElementById('active-style-label');

const iconModal = document.getElementById('icon-modal');
const modalClose = document.getElementById('modal-close');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Initialize
function init() {
  renderCategoryPills();
  renderIcons();
  setupNavigation();
  setupSearch();
  setupSizeControls();
  setupPaletteControls();
  setupModalActions();
  setupGlobalActions();
  setupMockupTabs();
  setupThemeToggle();

  // Keyboard shortcut '/' to search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      closeModal();
    }
  });
}

// Show Toast
function showToast(msg) {
  toastMessage.textContent = msg;
  toast.classList.remove('translate-y-24', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-24', 'opacity-0');
  }, 2600);
}

// Render Category Filter Pills
function renderCategoryPills() {
  categoryPills.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    const isActive = state.activeCategory === cat.id;
    btn.className = `px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
      isActive
        ? 'clay-button-amber text-studio-950 shadow-md'
        : 'bg-studio-900 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
    }`;
    btn.innerHTML = `<span>${cat.name}</span> <span class="px-1.5 py-0.2 rounded-full text-[10px] ${isActive ? 'bg-studio-950/20 text-studio-950 font-bold' : 'bg-studio-800 text-slate-400'}">${cat.count}</span>`;
    btn.addEventListener('click', () => {
      state.activeCategory = cat.id;
      renderCategoryPills();
      renderIcons();
    });
    categoryPills.appendChild(btn);
  });
}

// Render Icons Grid
function renderIcons() {
  const filtered = searchIcons(state.searchQuery, state.activeCategory);
  resultsCount.innerHTML = `Showing <strong>${filtered.length}</strong> of ${ALL_ICONS.length} icons`;

  iconsGrid.innerHTML = '';

  if (filtered.length === 0) {
    iconsGrid.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center text-center">
        <div class="w-16 h-16 rounded-2xl bg-studio-900 border border-slate-800 flex items-center justify-center text-amber-500 mb-3 text-2xl">
          🔍
        </div>
        <h4 class="text-base font-bold text-slate-200">No matching icons found</h4>
        <p class="text-xs text-slate-400 mt-1 max-w-sm">Try searching for generic terms like "unwrap", "vortex", "seam", "extrude", "curl", or "subdivide".</p>
        <button id="btn-reset-filter" class="mt-4 px-3.5 py-1.5 rounded-xl clay-button-amber text-studio-950 font-bold text-xs">Reset All Filters</button>
      </div>
    `;
    const btnReset = document.getElementById('btn-reset-filter');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        state.searchQuery = '';
        state.activeCategory = 'all';
        searchInput.value = '';
        searchClear.classList.add('hidden');
        renderCategoryPills();
        renderIcons();
      });
    }
    return;
  }

  const is3D = state.viewMode === 'gallery';

  filtered.forEach(icon => {
    const card = document.createElement('div');
    card.className = 'clay-card rounded-2xl p-3 flex flex-col items-center justify-between group cursor-pointer relative overflow-hidden text-center transition-all';
    card.setAttribute('data-id', icon.id);

    // Dynamic Icon Render
    const svgContent = is3D ? icon.svg3d : icon.svg2d;

    // Category styling badge
    let catBadgeColor = 'text-amber-400 border-amber-500/30 bg-amber-500/10';
    if (icon.category === 'Forcefield') catBadgeColor = 'text-sky-400 border-sky-500/30 bg-sky-500/10';
    if (icon.category === 'Vector Fields') catBadgeColor = 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (icon.category === 'Modelling') catBadgeColor = 'text-orange-400 border-orange-500/30 bg-orange-500/10';

    card.innerHTML = `
      <!-- Category Micro Tag -->
      <div class="w-full flex items-center justify-between text-[10px] mb-1 pointer-events-none">
        <span class="px-2 py-0.5 rounded-full border ${catBadgeColor} font-semibold">${icon.category}</span>
        <span class="text-slate-500 font-mono text-[9px]">${icon.hotkeys?.blender ? icon.hotkeys.blender.split('>')[0].trim() : ''}</span>
      </div>

      <!-- Icon SVG Canvas / Box -->
      <div class="icon-render-box relative flex items-center justify-center p-2 my-auto" style="width: ${state.iconSize}px; height: ${state.iconSize}px;">
        ${svgContent}
      </div>

      <!-- Icon Title & Details -->
      <div class="w-full mt-2 pt-2 border-t border-slate-800/80 flex flex-col items-center gap-0.5">
        <div class="text-xs font-bold text-slate-100 group-hover:text-amber-300 transition-colors truncate max-w-[150px]">${icon.name}</div>
        <div class="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">${icon.id}</div>
      </div>

      <!-- Quick Action Hover Bar -->
      <div class="absolute inset-x-2 bottom-2 bg-studio-900/95 backdrop-blur-md rounded-xl p-1.5 flex items-center justify-around opacity-0 group-hover:opacity-100 transition-opacity border border-slate-700 shadow-xl">
        <button title="Copy SVG" class="btn-quick-copy p-1.5 hover:bg-studio-750 rounded-lg text-slate-300 hover:text-amber-400 transition" data-id="${icon.id}">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button title="Download SVG" class="btn-quick-download p-1.5 hover:bg-studio-750 rounded-lg text-slate-300 hover:text-sky-400 transition" data-id="${icon.id}">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button title="Inspect Details" class="btn-quick-inspect p-1.5 hover:bg-studio-750 rounded-lg text-slate-300 hover:text-emerald-400 transition" data-id="${icon.id}">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
      </div>
    `;

    // 3D Parallax Tilt Effect on Hover
    if (state.enableTilt && is3D) {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -12;
        const rotateY = ((x - centerX) / centerX) * 12;
        card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.04, 1.04, 1.04)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'perspective(600px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      });
    }

    // Click handler for modal inspection
    card.addEventListener('click', (e) => {
      // Don't open if clicked on quick copy/download button
      if (e.target.closest('.btn-quick-copy')) {
        e.stopPropagation();
        const iconData = getIconById(icon.id);
        const svg = is3D ? iconData.svg3d : iconData.svg2d;
        copyToClipboard(svg).then(() => showToast(`Copied ${iconData.name} SVG to clipboard!`));
        return;
      }
      if (e.target.closest('.btn-quick-download')) {
        e.stopPropagation();
        const iconData = getIconById(icon.id);
        const svg = is3D ? iconData.svg3d : iconData.svg2d;
        downloadSvgFile(svg, `${iconData.id}-${is3D ? '3d' : '2d'}`);
        showToast(`Downloaded ${iconData.name}.svg`);
        return;
      }
      openModal(icon);
    });

    iconsGrid.appendChild(card);
  });
}

// Navigation Tab Switching
function setupNavigation() {
  const tabs = [
    { btn: navGallery, mode: 'gallery', sec: sectionGallery, label: '3D Stylized Clay / Matte Plastic' },
    { btn: navVector, mode: 'vector', sec: sectionGallery, label: '2D Production Vector (DCC Toolbar)' },
    { btn: navThree, mode: 'three', sec: sectionThree, label: 'Real-time WebGL 3D Inspector' },
    { btn: navWorkspaces, mode: 'workspaces', sec: sectionWorkspaces, label: 'DCC Integrated Workspaces' },
    { btn: navReferences, mode: 'references', sec: sectionReferences, label: 'Reference Style Inspiration' }
  ];

  tabs.forEach(t => {
    t.btn.addEventListener('click', () => {
      state.viewMode = t.mode;
      activeStyleLabel.textContent = t.label;

      // Reset button styles
      [navGallery, navVector, navThree, navWorkspaces, navReferences].forEach(b => {
        b.className = 'px-3.5 py-1.5 rounded-xl font-medium text-slate-400 hover:text-slate-200 hover:bg-studio-800/60 transition-all flex items-center gap-1.5';
      });
      t.btn.className = 'px-3.5 py-1.5 rounded-xl font-semibold bg-amber-500 text-studio-950 shadow transition-all flex items-center gap-1.5';

      // Toggle sections
      [sectionGallery, sectionThree, sectionWorkspaces, sectionReferences].forEach(s => s.classList.add('hidden'));
      t.sec.classList.remove('hidden');

      // Hide or show search controls bar
      if (t.mode === 'gallery' || t.mode === 'vector') {
        sectionControls.classList.remove('hidden');
        renderIcons();
      } else {
        sectionControls.classList.add('hidden');
      }

      // Initialize 3D viewer if switching to three tab
      if (t.mode === 'three') {
        initThreeViewer();
      }

      // Initialize workspace if switching to workspaces tab
      if (t.mode === 'workspaces') {
        switchMockupTab(state.activeMockupTab);
      }
    });
  });
}

// Search Logic
function setupSearch() {
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    if (state.searchQuery.length > 0) {
      searchClear.classList.remove('hidden');
    } else {
      searchClear.classList.add('hidden');
    }
    renderIcons();
  });

  searchClear.addEventListener('click', () => {
    state.searchQuery = '';
    searchInput.value = '';
    searchClear.classList.add('hidden');
    renderIcons();
  });
}

// Size Controls
function setupSizeControls() {
  const sizeBtns = document.querySelectorAll('.btn-size');
  sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sizeBtns.forEach(b => {
        b.className = 'btn-size px-2 py-0.5 rounded text-slate-400 hover:text-slate-200';
      });
      btn.className = 'btn-size px-2 py-0.5 rounded bg-amber-500 text-studio-950 font-bold';
      state.iconSize = parseInt(btn.dataset.size, 10);
      renderIcons();
    });
  });

  const chkTilt = document.getElementById('chk-3d-tilt');
  if (chkTilt) {
    chkTilt.addEventListener('change', (e) => {
      state.enableTilt = e.target.checked;
      renderIcons();
    });
  }
}

// Palette Controls
function setupPaletteControls() {
  const paletteBtns = document.querySelectorAll('.btn-palette');
  paletteBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      state.accentColor = btn.dataset.color;
      paletteBtns.forEach(b => {
        b.classList.remove('ring-2', 'ring-offset-2', 'ring-offset-studio-950');
      });
      btn.classList.add('ring-2', 'ring-offset-2', 'ring-offset-studio-950');
      if (state.threeViewer) {
        state.threeViewer.setMaterialParams(null, state.accentColor);
      }
      showToast(`Updated theme accent: ${btn.title}`);
    });
  });
}

// Modal Inspection
function openModal(icon) {
  state.currentModalIcon = icon;
  const is3D = state.viewMode !== 'vector';

  document.getElementById('modal-title').textContent = icon.name;
  document.getElementById('modal-id-badge').textContent = icon.id;
  document.getElementById('modal-category-badge').textContent = icon.category;
  document.getElementById('modal-description').textContent = icon.description;

  document.getElementById('modal-hotkey-blender').textContent = icon.hotkeys?.blender || 'N/A';
  document.getElementById('modal-hotkey-maya').textContent = icon.hotkeys?.maya || 'N/A';
  document.getElementById('modal-hotkey-c4d').textContent = icon.hotkeys?.c4d || 'N/A';
  document.getElementById('modal-hotkey-max').textContent = icon.hotkeys?.max || icon.hotkeys?.unreal || 'N/A';

  const modalPreview = document.getElementById('modal-icon-preview');
  modalPreview.innerHTML = is3D ? icon.svg3d : icon.svg2d;

  const tagsContainer = document.getElementById('modal-tags');
  tagsContainer.innerHTML = '';
  icon.tags.forEach(t => {
    const span = document.createElement('span');
    span.className = 'px-2 py-0.5 rounded-lg bg-studio-800 text-[10px] text-slate-300 font-mono border border-slate-700';
    span.textContent = `#${t}`;
    tagsContainer.appendChild(span);
  });

  iconModal.classList.remove('hidden');
  iconModal.classList.add('flex');
}

function closeModal() {
  iconModal.classList.add('hidden');
  iconModal.classList.remove('flex');
}

function setupModalActions() {
  modalClose.addEventListener('click', closeModal);
  iconModal.addEventListener('click', (e) => {
    if (e.target === iconModal) closeModal();
  });

  // Copy SVG
  document.getElementById('modal-btn-copy-svg').addEventListener('click', () => {
    if (!state.currentModalIcon) return;
    const is3D = state.viewMode !== 'vector';
    const svg = is3D ? state.currentModalIcon.svg3d : state.currentModalIcon.svg2d;
    copyToClipboard(svg).then(() => showToast(`Copied ${state.currentModalIcon.name} SVG!`));
  });

  // Download SVG
  document.getElementById('modal-btn-download-svg').addEventListener('click', () => {
    if (!state.currentModalIcon) return;
    const is3D = state.viewMode !== 'vector';
    const svg = is3D ? state.currentModalIcon.svg3d : state.currentModalIcon.svg2d;
    downloadSvgFile(svg, `${state.currentModalIcon.id}-${is3D ? '3d' : '2d'}`);
    showToast(`Downloaded ${state.currentModalIcon.name}.svg`);
  });

  // Download High-Res PNG
  document.getElementById('modal-btn-download-png').addEventListener('click', () => {
    if (!state.currentModalIcon) return;
    const is3D = state.viewMode !== 'vector';
    const svg = is3D ? state.currentModalIcon.svg3d : state.currentModalIcon.svg2d;
    showToast(`Rendering 1024x1024 PNG...`);
    downloadPngFromSvg(svg, `${state.currentModalIcon.id}-${is3D ? '3d' : '2d'}@2x`, 1024)
      .then(() => showToast(`Downloaded high-res PNG for ${state.currentModalIcon.name}!`))
      .catch((err) => showToast(`Export failed: ${err.message}`));
  });

  // Copy React JSX
  document.getElementById('modal-btn-copy-react').addEventListener('click', () => {
    if (!state.currentModalIcon) return;
    const is3D = state.viewMode !== 'vector';
    const code = generateReactComponent(state.currentModalIcon, is3D);
    copyToClipboard(code).then(() => showToast(`Copied React Component to clipboard!`));
  });

  // Copy Vue 3
  document.getElementById('modal-btn-copy-vue').addEventListener('click', () => {
    if (!state.currentModalIcon) return;
    const is3D = state.viewMode !== 'vector';
    const code = generateVueComponent(state.currentModalIcon, is3D);
    copyToClipboard(code).then(() => showToast(`Copied Vue 3 Component to clipboard!`));
  });
}

// Global Batch Actions (ZIP, Spritesheet, Manifest)
function setupGlobalActions() {
  document.getElementById('btn-batch-zip').addEventListener('click', async () => {
    showToast('Packaging 62 icons into ZIP archive...');
    await downloadAllIconsZip(ALL_ICONS, 'both');
    showToast('Download complete: Frontier-DCC-Icon-Set.zip');
  });

  document.getElementById('btn-spritesheet').addEventListener('click', () => {
    const is3D = state.viewMode !== 'vector';
    downloadSpriteSheet(ALL_ICONS, is3D);
    showToast(`Downloaded SVG Sprite Sheet (${is3D ? '3D' : '2D'})!`);
  });

  document.getElementById('footer-btn-download-all').addEventListener('click', async () => {
    showToast('Packaging 62 icons into ZIP archive...');
    await downloadAllIconsZip(ALL_ICONS, 'both');
  });

  document.getElementById('footer-btn-copy-manifest').addEventListener('click', () => {
    const manifest = ALL_ICONS.map(i => ({
      id: i.id,
      name: i.name,
      category: i.category,
      tags: i.tags,
      description: i.description,
      hotkeys: i.hotkeys
    }));
    copyToClipboard(JSON.stringify(manifest, null, 2)).then(() => {
      showToast('Copied JSON manifest to clipboard!');
    });
  });
}

// Three.js Interactive Viewer Setup
function initThreeViewer() {
  if (state.threeViewer) return;

  const container = document.getElementById('three-canvas-container');
  state.threeViewer = new ThreeIconViewer(container);

  // Turntable toggle
  const btnTurntable = document.getElementById('three-btn-turntable');
  const labelTurntable = document.getElementById('three-turntable-status');
  btnTurntable.addEventListener('click', () => {
    const isOn = state.threeViewer.toggleTurntable();
    labelTurntable.textContent = isOn ? 'ON' : 'OFF';
    labelTurntable.className = isOn ? 'text-amber-400 font-bold' : 'text-slate-400 font-bold';
  });

  // Wireframe toggle
  const btnWireframe = document.getElementById('three-btn-wireframe');
  btnWireframe.addEventListener('click', () => {
    const isWired = state.threeViewer.toggleWireframe();
    btnWireframe.className = isWired
      ? 'px-2.5 py-1 rounded-lg bg-amber-500 text-studio-950 font-bold text-xs'
      : 'px-2.5 py-1 rounded-lg bg-studio-800 hover:bg-studio-700 text-slate-200 text-xs';
  });

  // Model Presets buttons
  const modelPicks = document.querySelectorAll('.three-model-pick');
  modelPicks.forEach(btn => {
    btn.addEventListener('click', () => {
      modelPicks.forEach(b => {
        b.className = 'three-model-pick p-3 rounded-xl bg-studio-800 border border-slate-700 text-slate-300 hover:border-amber-500 text-left flex flex-col gap-1';
      });
      btn.className = 'three-model-pick p-3 rounded-xl bg-studio-800 border-2 border-amber-500 font-bold text-amber-300 text-left flex flex-col gap-1 shadow';
      state.threeViewer.loadModel(btn.dataset.model);
    });
  });

  // Roughness & Metalness Sliders
  const sliderRoughness = document.getElementById('slider-roughness');
  const labelRoughness = document.getElementById('label-roughness');
  sliderRoughness.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    labelRoughness.textContent = val.toFixed(2);
    state.threeViewer.setMaterialParams(null, null, val, undefined);
  });

  const sliderMetalness = document.getElementById('slider-metalness');
  const labelMetalness = document.getElementById('label-metalness');
  sliderMetalness.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    labelMetalness.textContent = val.toFixed(2);
    state.threeViewer.setMaterialParams(null, null, undefined, val);
  });
}

// DCC Workspace Mockups Setup
function setupMockupTabs() {
  const tabUV = document.getElementById('tab-mockup-uv');
  const tabSim = document.getElementById('tab-mockup-sim');
  const tabModel = document.getElementById('tab-mockup-model');

  const updateTabs = (activeTab) => {
    [tabUV, tabSim, tabModel].forEach(t => {
      t.className = 'px-4 py-2 rounded-xl bg-studio-800 text-slate-300 hover:text-white font-medium text-xs';
    });
    if (activeTab === 'uv') tabUV.className = 'px-4 py-2 rounded-xl bg-amber-500 text-studio-950 font-bold text-xs shadow';
    if (activeTab === 'sim') tabSim.className = 'px-4 py-2 rounded-xl bg-sky-500 text-studio-950 font-bold text-xs shadow';
    if (activeTab === 'model') tabModel.className = 'px-4 py-2 rounded-xl bg-orange-500 text-studio-950 font-bold text-xs shadow';
  };

  tabUV.addEventListener('click', () => {
    state.activeMockupTab = 'uv';
    updateTabs('uv');
    switchMockupTab('uv');
  });

  tabSim.addEventListener('click', () => {
    state.activeMockupTab = 'sim';
    updateTabs('sim');
    switchMockupTab('sim');
  });

  tabModel.addEventListener('click', () => {
    state.activeMockupTab = 'model';
    updateTabs('model');
    switchMockupTab('model');
  });
}

function switchMockupTab(tab) {
  const container = document.getElementById('mockup-container');
  if (tab === 'uv') {
    renderUVEditorMockup(container);
  } else if (tab === 'sim') {
    renderSimulationMockup(container);
  } else if (tab === 'model') {
    renderModellingMockup(container);
  }
}

// Dark/Light Theme Toggle
function setupThemeToggle() {
  const btn = document.getElementById('btn-theme-toggle');
  const iconSun = document.getElementById('theme-icon-sun');
  const iconMoon = document.getElementById('theme-icon-moon');

  btn.addEventListener('click', () => {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    if (isDark) {
      iconMoon.classList.remove('hidden');
      iconSun.classList.add('hidden');
      showToast('Switched to Dark Studio Theme');
    } else {
      iconSun.classList.remove('hidden');
      iconMoon.classList.add('hidden');
      showToast('Switched to Ceramic Light Theme');
    }
  });
}

// Launch application on DOM ready
document.addEventListener('DOMContentLoaded', init);
