/**
 * Interactive DCC Workspace Mockups
 * Demonstrates the icons functioning in authentic 3D software layouts:
 * 1. UV Editor Workspace (UV unwrapping, seam editing, packing, checker grid)
 * 2. Simulation Node Graph (Forcefields & Vector Field operators with live particle canvas)
 * 3. 3D Modelling Viewport & Toolbar (Extrude, Bevel, Loop Cut, Sculpt HUD)
 */

export function renderUVEditorMockup(container) {
  container.innerHTML = `
    <div class="rounded-2xl border border-slate-700/60 bg-studio-900 shadow-2xl overflow-hidden flex flex-col h-[600px]">
      <!-- DCC Window Header -->
      <div class="h-10 bg-studio-850 border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-400 select-none">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-red-500/80 inline-block"></span>
          <span class="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
          <span class="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
          <span class="ml-2 font-semibold text-slate-200">Frontier 3D DCC — UV Mapping Workspace</span>
          <span class="px-2 py-0.5 rounded bg-studio-750 text-slate-400 text-[10px]">v4.2.0</span>
        </div>
        <div class="flex items-center gap-4 text-slate-400">
          <span>Target Mesh: <strong class="text-amber-400">Hero_Character_Armor.obj</strong></span>
          <span>Texels: <strong class="text-sky-400">4096 × 4096</strong></span>
          <span>Islands: <strong class="text-emerald-400">14</strong></span>
        </div>
      </div>

      <!-- Main Split Layout -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Left: UV Tool Palette Sidebar -->
        <div class="w-16 bg-studio-900 border-r border-slate-800 flex flex-col items-center py-3 gap-2 overflow-y-auto">
          <div class="text-[9px] uppercase font-bold text-slate-500 tracking-wider">UV Tools</div>
          <button id="mock-tool-unwrap" title="UV Unwrap (U)" class="w-11 h-11 rounded-xl clay-button-amber flex items-center justify-center p-1 text-studio-950 font-bold shadow">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6v4H9zM9 7h6v6H9zM9 13h6v4H9zM3 7h6v6H3zM15 7h6v6h-6z"/></svg>
          </button>
          <button id="mock-tool-pack" title="Pack Islands (Ctrl+P)" class="w-11 h-11 rounded-xl clay-button-dark flex items-center justify-center p-1 text-amber-400 hover:text-amber-300">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="6" y="6" width="6" height="6"/><rect x="14" y="6" width="4" height="6"/></svg>
          </button>
          <button id="mock-tool-seam" title="Mark Seam (Ctrl+E)" class="w-11 h-11 rounded-xl clay-button-dark flex items-center justify-center p-1 text-slate-300 hover:text-amber-400">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 4l5 5-9 9H5v-5l9-9z"/><path d="M4 18l8 3 8-3" stroke-dasharray="2 2"/></svg>
          </button>
          <button id="mock-tool-pin" title="Pin UVs (P)" class="w-11 h-11 rounded-xl clay-button-dark flex items-center justify-center p-1 text-slate-300 hover:text-amber-400">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 4h6l-1 7h3l-5 6-5-6h3L9 4z"/></svg>
          </button>
          <button id="mock-tool-relax" title="Relax UV (Shift+R)" class="w-11 h-11 rounded-xl clay-button-dark flex items-center justify-center p-1 text-slate-300 hover:text-amber-400">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 12h16M12 4v16"/></svg>
          </button>
          <button id="mock-tool-stitch" title="Stitch UV (Alt+V)" class="w-11 h-11 rounded-xl clay-button-dark flex items-center justify-center p-1 text-slate-300 hover:text-amber-400">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h5v12H4zM15 6h5v12h-5z"/><path d="M9 10l6 3M9 13l6-3"/></svg>
          </button>
          <button id="mock-tool-checker" title="Toggle UV Checker" class="w-11 h-11 rounded-xl clay-button-dark flex items-center justify-center p-1 text-sky-400 hover:text-sky-300">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 3h9v9H3zM12 12h9v9h-9z" fill="currentColor"/></svg>
          </button>
        </div>

        <!-- Center: UV 2D Coordinate Canvas (0..1 Space) -->
        <div class="flex-1 bg-studio-950 relative overflow-hidden flex flex-col">
          <!-- Top Canvas Control Bar -->
          <div class="h-9 bg-studio-850/80 border-b border-slate-800 px-3 flex items-center justify-between text-xs text-slate-400">
            <div class="flex items-center gap-3">
              <span class="text-slate-200 font-medium">UV Grid (0..1 UDIM 1001)</span>
              <div class="flex items-center gap-1 bg-studio-750 px-1.5 py-0.5 rounded text-[11px]">
                <button class="px-2 py-0.5 rounded bg-amber-500 text-studio-950 font-bold">Island (4)</button>
                <button class="px-2 py-0.5 text-slate-400 hover:text-slate-200">Face (3)</button>
                <button class="px-2 py-0.5 text-slate-400 hover:text-slate-200">Edge (2)</button>
                <button class="px-2 py-0.5 text-slate-400 hover:text-slate-200">Vertex (1)</button>
              </div>
            </div>
            <div class="flex items-center gap-3 text-xs">
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" id="mock-chk-distortion" class="accent-amber-500 rounded">
                <span>Distortion Heatmap</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" id="mock-chk-seams" checked class="accent-amber-500 rounded">
                <span>Show Seams</span>
              </label>
              <span class="text-slate-500">Zoom: 100%</span>
            </div>
          </div>

          <!-- Interactive 2D UV Space Viewport -->
          <div class="flex-1 relative flex items-center justify-center p-6 select-none" id="mock-uv-viewport">
            <!-- 0..1 UV Tile Frame -->
            <div id="mock-uv-box" class="w-[420px] h-[420px] rounded-xl border-2 border-amber-500/70 bg-studio-900/90 relative shadow-2xl overflow-hidden transition-all duration-300">
              <!-- Grid background -->
              <div class="absolute inset-0 grid grid-cols-8 grid-rows-8 divide-x divide-y divide-slate-800/80 pointer-events-none">
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
                <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
              </div>

              <!-- Checker overlay (toggleable) -->
              <div id="mock-uv-checker-layer" class="absolute inset-0 opacity-0 transition-opacity duration-200 pointer-events-none" style="background-image: conic-gradient(#1e222b 90deg, #f59e0b20 90deg 180deg, #1e222b 180deg 270deg, #f59e0b20 270deg); background-size: 40px 40px;"></div>

              <!-- UV Island 1: Chest Armor (Amber Selected Island) -->
              <div id="mock-island-1" class="absolute left-10 top-12 w-36 h-36 rounded-2xl bg-amber-500/25 border-2 border-amber-400 p-2 cursor-grab active:cursor-grabbing shadow-lg backdrop-blur-sm transition-all duration-300">
                <div class="w-full h-full rounded-xl border border-amber-300/40 flex flex-col items-center justify-center relative">
                  <span class="text-xs font-bold text-amber-200">Chest_Plate</span>
                  <span class="text-[10px] text-amber-300/80">48 Quads</span>
                  <!-- Corner Pins -->
                  <span class="w-2.5 h-2.5 rounded-full bg-red-500 border border-white absolute -top-1 -left-1 shadow"></span>
                  <span class="w-2.5 h-2.5 rounded-full bg-red-500 border border-white absolute -top-1 -right-1 shadow"></span>
                </div>
              </div>

              <!-- UV Island 2: Shoulder Pauldron (Cyan Island) -->
              <div id="mock-island-2" class="absolute right-12 top-10 w-28 h-44 rounded-2xl bg-sky-500/20 border-2 border-sky-400 p-2 cursor-grab active:cursor-grabbing shadow-lg backdrop-blur-sm transition-all duration-300">
                <div class="w-full h-full rounded-xl border border-sky-300/30 flex flex-col items-center justify-center">
                  <span class="text-xs font-bold text-sky-200">Pauldron_R</span>
                  <span class="text-[10px] text-sky-300/80">32 Quads</span>
                </div>
              </div>

              <!-- UV Island 3: Gauntlet (Slate/Emerald Island) -->
              <div id="mock-island-3" class="absolute left-14 bottom-10 w-44 h-24 rounded-2xl bg-emerald-500/20 border-2 border-emerald-400 p-2 cursor-grab active:cursor-grabbing shadow-lg backdrop-blur-sm transition-all duration-300">
                <div class="w-full h-full rounded-xl border border-emerald-300/30 flex flex-col items-center justify-center">
                  <span class="text-xs font-bold text-emerald-200">Gauntlet_L</span>
                  <span class="text-[10px] text-emerald-300/80">24 Quads</span>
                </div>
              </div>

              <!-- UV Island 4: Greaves (Orange Island) -->
              <div id="mock-island-4" class="absolute right-10 bottom-8 w-24 h-32 rounded-2xl bg-orange-500/20 border-2 border-orange-400 p-2 cursor-grab active:cursor-grabbing shadow-lg backdrop-blur-sm transition-all duration-300">
                <div class="w-full h-full rounded-xl border border-orange-300/30 flex flex-col items-center justify-center">
                  <span class="text-xs font-bold text-orange-200">Greave_R</span>
                  <span class="text-[10px] text-orange-300/80">18 Quads</span>
                </div>
              </div>

              <!-- Axis Origin 0,0 -->
              <div class="absolute bottom-1 left-2 text-[10px] font-mono text-slate-500">(0.0, 0.0)</div>
              <div class="absolute top-1 right-2 text-[10px] font-mono text-slate-500">(1.0, 1.0)</div>
            </div>
          </div>
        </div>

        <!-- Right: UV Inspector Properties -->
        <div class="w-72 bg-studio-900 border-l border-slate-800 p-4 flex flex-col gap-4 text-xs overflow-y-auto">
          <div class="font-bold text-slate-200 text-sm flex items-center justify-between border-b border-slate-800 pb-2">
            <span>Unwrap Properties</span>
            <span class="text-amber-400 text-xs">Conformal</span>
          </div>

          <div class="flex flex-col gap-1.5">
            <label class="text-slate-400 font-medium">Method</label>
            <select class="w-full bg-studio-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-amber-500">
              <option>Angle Based (ABF++)</option>
              <option>Conformal (LSCM)</option>
              <option>Pelt / Cylindrical Projection</option>
              <option>Smart Project by Angle</option>
            </select>
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="flex justify-between text-slate-400">
              <span>Packing Margin</span>
              <span class="text-amber-400 font-mono" id="mock-margin-val">0.024</span>
            </div>
            <input type="range" min="0" max="0.1" step="0.005" value="0.024" class="w-full accent-amber-500 bg-studio-800 h-1.5 rounded-lg">
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="flex justify-between text-slate-400">
              <span>Texel Density (px/m)</span>
              <span class="text-sky-400 font-mono">1024.0 px</span>
            </div>
            <input type="range" min="256" max="2048" step="128" value="1024" class="w-full accent-sky-500 bg-studio-800 h-1.5 rounded-lg">
          </div>

          <div class="p-3 rounded-xl bg-studio-800/80 border border-slate-700/60 flex flex-col gap-2">
            <div class="font-bold text-slate-300">Quick Actions</div>
            <div class="grid grid-cols-2 gap-2">
              <button id="mock-btn-pack-all" class="px-2.5 py-1.5 rounded-lg clay-button-amber text-studio-950 font-bold text-center">Pack All (P)</button>
              <button id="mock-btn-relax-pass" class="px-2.5 py-1.5 rounded-lg clay-button-dark text-slate-200 text-center hover:border-amber-500">Relax 10x</button>
            </div>
            <button id="mock-btn-straighten-edges" class="w-full px-2.5 py-1.5 rounded-lg bg-studio-700 text-slate-200 hover:bg-studio-600 transition">Straighten UV Border</button>
          </div>

          <div class="mt-auto text-[11px] text-slate-500 bg-studio-800/40 p-2.5 rounded-lg border border-slate-800">
            💡 <strong>Tip:</strong> Press <code>U</code> in the 3D viewport to unwrap along seams, or <code>Ctrl+P</code> to repack islands tightly.
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach interactive mockup listeners
  const chkChecker = container.querySelector('#mock-tool-checker');
  const checkerLayer = container.querySelector('#mock-uv-checker-layer');
  if (chkChecker && checkerLayer) {
    chkChecker.addEventListener('click', () => {
      const isVisible = checkerLayer.classList.contains('opacity-100');
      if (isVisible) {
        checkerLayer.classList.remove('opacity-100');
        checkerLayer.classList.add('opacity-0');
      } else {
        checkerLayer.classList.remove('opacity-0');
        checkerLayer.classList.add('opacity-100');
      }
    });
  }

  // Pack animation
  const btnPack = container.querySelector('#mock-btn-pack-all');
  const toolPack = container.querySelector('#mock-tool-pack');
  const doPack = () => {
    const is1 = container.querySelector('#mock-island-1');
    const is2 = container.querySelector('#mock-island-2');
    const is3 = container.querySelector('#mock-island-3');
    const is4 = container.querySelector('#mock-island-4');
    if (is1 && is2 && is3 && is4) {
      is1.style.left = '16px';
      is1.style.top = '16px';
      is2.style.left = '170px';
      is2.style.top = '16px';
      is3.style.left = '16px';
      is3.style.top = '170px';
      is4.style.left = '200px';
      is4.style.top = '200px';
    }
  };
  if (btnPack) btnPack.addEventListener('click', doPack);
  if (toolPack) toolPack.addEventListener('click', doPack);
}

export function renderSimulationMockup(container) {
  container.innerHTML = `
    <div class="rounded-2xl border border-slate-700/60 bg-studio-900 shadow-2xl overflow-hidden flex flex-col h-[600px]">
      <!-- Header -->
      <div class="h-10 bg-studio-850 border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-400 select-none">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-red-500/80 inline-block"></span>
          <span class="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
          <span class="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
          <span class="ml-2 font-semibold text-slate-200">Physics & Vector Field Simulation Graph</span>
          <span class="px-2 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800 text-[10px]">Real-Time Solver</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-slate-400">FPS: <strong class="text-emerald-400" id="sim-fps">60.0</strong></span>
          <span class="text-slate-400">Particles: <strong class="text-sky-400">1,200</strong></span>
        </div>
      </div>

      <!-- Main Layout: Left Node Graph, Right Live Physics Viewport -->
      <div class="flex-1 flex overflow-hidden">
        <!-- Left: Node Pipeline Graph -->
        <div class="w-1/2 bg-studio-950/90 border-r border-slate-800 p-4 relative overflow-hidden flex flex-col justify-between">
          <div class="text-xs text-slate-400 font-bold mb-2 flex items-center justify-between">
            <span>Simulation Nodes</span>
            <span class="text-[10px] text-slate-500">Shift+A to Add Field</span>
          </div>

          <!-- Connected Nodes Network -->
          <div class="relative flex-1 flex flex-col gap-4 justify-center items-center">
            <!-- Node 1: Particle Emitter -->
            <div class="w-64 p-3 rounded-xl bg-studio-850 border-2 border-slate-700 shadow-lg relative">
              <div class="flex items-center justify-between font-bold text-xs text-slate-200 border-b border-slate-700/70 pb-1 mb-2">
                <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> Point Emitter</span>
                <span class="text-[10px] text-emerald-400 font-mono">Out: Particles</span>
              </div>
              <div class="text-[11px] text-slate-400 flex justify-between">
                <span>Rate: 250/sec</span>
                <span>Speed: 3.5 m/s</span>
              </div>
            </div>

            <!-- SVG Connecting Noodles -->
            <svg class="w-64 h-12 pointer-events-none">
              <path d="M 128 0 C 128 20 128 30 128 48" stroke="#38bdf8" stroke-width="3" fill="none" stroke-dasharray="4 2"/>
            </svg>

            <!-- Node 2: Vortex & Turbulence Forcefield (Active) -->
            <div class="w-72 p-3.5 rounded-xl bg-studio-800 border-2 border-amber-500 shadow-xl relative">
              <div class="flex items-center justify-between font-bold text-xs text-amber-300 border-b border-amber-500/40 pb-1 mb-2">
                <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span> Vortex + Curl Field</span>
                <span class="text-[10px] text-amber-400 font-mono">Field In/Out</span>
              </div>
              <div class="flex flex-col gap-1 text-[11px] text-slate-300">
                <div class="flex justify-between"><span>Vorticity:</span> <span class="text-amber-400 font-mono">4.5 rad/s</span></div>
                <div class="flex justify-between"><span>Turbulence:</span> <span class="text-sky-400 font-mono">2.8 octaves</span></div>
                <div class="flex justify-between"><span>Damping:</span> <span class="text-slate-400 font-mono">0.05</span></div>
              </div>
            </div>

            <!-- SVG Connecting Noodles -->
            <svg class="w-64 h-12 pointer-events-none">
              <path d="M 128 0 C 128 20 128 30 128 48" stroke="#f59e0b" stroke-width="3" fill="none"/>
            </svg>

            <!-- Node 3: Vector Field Baker / Exporter -->
            <div class="w-64 p-3 rounded-xl bg-studio-850 border-2 border-slate-700 shadow-lg relative">
              <div class="flex items-center justify-between font-bold text-xs text-slate-200 border-b border-slate-700/70 pb-1 mb-2">
                <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-sky-400"></span> VDB / FGA Volume Out</span>
                <span class="text-[10px] text-sky-400 font-mono">Grid 64³</span>
              </div>
              <div class="text-[11px] text-slate-400 flex justify-between">
                <span>Format: .FGA (Unreal)</span>
                <span>Active Voxels: 94%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Live Canvas Particle Simulation Viewport -->
        <div class="w-1/2 bg-studio-950 relative flex flex-col">
          <div class="h-9 bg-studio-850/80 border-b border-slate-800 px-3 flex items-center justify-between text-xs text-slate-400">
            <span class="text-slate-200 font-medium">Particle Viewport (Real-time Solver)</span>
            <div class="flex items-center gap-2">
              <button id="sim-btn-reset" class="px-2 py-0.5 rounded bg-studio-700 hover:bg-studio-600 text-slate-200 text-xs">Reset</button>
              <button id="sim-btn-preset-tornado" class="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs">Vortex</button>
              <button id="sim-btn-preset-wind" class="px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 text-xs">Wind</button>
            </div>
          </div>

          <canvas id="sim-canvas" class="flex-1 w-full h-full bg-studio-950 block"></canvas>

          <!-- Overlay Field Controls -->
          <div class="p-3 bg-studio-900/90 border-t border-slate-800 flex items-center justify-between text-xs">
            <div class="flex items-center gap-4">
              <label class="flex items-center gap-2 text-slate-300">
                <span>Vortex Strength:</span>
                <input type="range" id="sim-slider-vortex" min="0" max="10" step="0.5" value="5" class="w-24 accent-amber-500">
              </label>
              <label class="flex items-center gap-2 text-slate-300">
                <span>Noise:</span>
                <input type="range" id="sim-slider-noise" min="0" max="10" step="0.5" value="3" class="w-20 accent-sky-500">
              </label>
            </div>
            <span class="text-slate-500 text-[10px]">Click & drag on canvas to deflect</span>
          </div>
        </div>
      </div>
    </div>
  `;

  // Start 2D Canvas Particle Simulation
  const canvas = container.querySelector('#sim-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let width = canvas.clientWidth || 300;
    let height = canvas.clientHeight || 300;
    canvas.width = width;
    canvas.height = height;

    const numParticles = 400;
    const particles = [];
    for (let i = 0; i < numParticles; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        life: Math.random() * 100,
        color: Math.random() > 0.4 ? '#f59e0b' : '#38bdf8'
      });
    }

    let vortexStrength = 0.05;
    let noiseStrength = 1.0;
    let mode = 'vortex';

    const sliderVortex = container.querySelector('#sim-slider-vortex');
    if (sliderVortex) {
      sliderVortex.addEventListener('input', e => {
        vortexStrength = parseFloat(e.target.value) * 0.01;
      });
    }

    const btnReset = container.querySelector('#sim-btn-reset');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        particles.forEach(p => {
          p.x = Math.random() * width;
          p.y = Math.random() * height;
        });
      });
    }

    const btnVortex = container.querySelector('#sim-btn-preset-tornado');
    if (btnVortex) {
      btnVortex.addEventListener('click', () => { mode = 'vortex'; });
    }
    const btnWind = container.querySelector('#sim-btn-preset-wind');
    if (btnWind) {
      btnWind.addEventListener('click', () => { mode = 'wind'; });
    }

    let animId;
    function renderSim() {
      ctx.fillStyle = 'rgba(15, 17, 22, 0.25)';
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;

      particles.forEach(p => {
        if (mode === 'vortex') {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          // Tangential vortex velocity
          p.vx += (-dy / dist) * vortexStrength * 15 - (dx / dist) * 0.2;
          p.vy += (dx / dist) * vortexStrength * 15 - (dy / dist) * 0.2;
        } else {
          // Wind blowing rightward with turbulence
          p.vx += 0.3;
          p.vy += (Math.random() - 0.5) * 0.8;
        }

        p.vx *= 0.96;
        p.vy *= 0.96;
        p.x += p.vx;
        p.y += p.vy;

        // Wrap around boundaries
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      });

      animId = requestAnimationFrame(renderSim);
    }
    renderSim();
  }
}

export function renderModellingMockup(container) {
  container.innerHTML = `
    <div class="rounded-2xl border border-slate-700/60 bg-studio-900 shadow-2xl overflow-hidden flex flex-col h-[600px]">
      <!-- Header -->
      <div class="h-10 bg-studio-850 border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-400 select-none">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full bg-red-500/80 inline-block"></span>
          <span class="w-3 h-3 rounded-full bg-amber-500/80 inline-block"></span>
          <span class="w-3 h-3 rounded-full bg-emerald-500/80 inline-block"></span>
          <span class="ml-2 font-semibold text-slate-200">Frontier 3D DCC — Polygon Modelling Viewport</span>
          <span class="px-2 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800 text-[10px]">Edit Mode</span>
        </div>
        <div class="flex items-center gap-3">
          <span>Verts: <strong class="text-slate-200">2,416</strong></span>
          <span>Edges: <strong class="text-slate-200">4,832</strong></span>
          <span>Faces: <strong class="text-amber-400">2,418 Quads</strong></span>
        </div>
      </div>

      <!-- Top Modelling Operation Ribbon -->
      <div class="h-14 bg-studio-800 border-b border-slate-700 px-4 flex items-center justify-between gap-3 overflow-x-auto select-none">
        <!-- Component Modes -->
        <div class="flex items-center gap-1 bg-studio-900 p-1 rounded-xl border border-slate-700">
          <button class="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-slate-400"></span> 1 Vertex
          </button>
          <button class="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-400 hover:text-slate-200 flex items-center gap-1.5">
            <span class="w-2 h-0.5 bg-slate-400"></span> 2 Edge
          </button>
          <button class="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-studio-950 shadow flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded bg-studio-950"></span> 3 Face
          </button>
        </div>

        <!-- Modelling Operations Toolbar -->
        <div class="flex items-center gap-1.5">
          <button class="px-3 py-1.5 rounded-xl clay-button-amber text-studio-950 font-bold text-xs flex items-center gap-1.5 shadow">
            <span>Extrude (E)</span>
          </button>
          <button class="px-3 py-1.5 rounded-xl clay-button-dark text-slate-200 text-xs font-medium hover:border-amber-500 flex items-center gap-1.5">
            <span>Inset (I)</span>
          </button>
          <button class="px-3 py-1.5 rounded-xl clay-button-dark text-slate-200 text-xs font-medium hover:border-amber-500 flex items-center gap-1.5">
            <span>Bevel (Ctrl+B)</span>
          </button>
          <button class="px-3 py-1.5 rounded-xl clay-button-dark text-slate-200 text-xs font-medium hover:border-amber-500 flex items-center gap-1.5">
            <span>Loop Cut (Ctrl+R)</span>
          </button>
          <button class="px-3 py-1.5 rounded-xl clay-button-dark text-slate-200 text-xs font-medium hover:border-amber-500 flex items-center gap-1.5">
            <span>Knife (K)</span>
          </button>
          <button class="px-3 py-1.5 rounded-xl clay-button-dark text-slate-200 text-xs font-medium hover:border-amber-500 flex items-center gap-1.5">
            <span>Subdivide (Ctrl+2)</span>
          </button>
        </div>

        <div class="flex items-center gap-2">
          <button class="px-2.5 py-1.5 rounded-lg bg-studio-700 hover:bg-studio-600 text-slate-300 text-xs">Symmetry [X]</button>
          <button class="px-2.5 py-1.5 rounded-lg bg-studio-700 hover:bg-studio-600 text-slate-300 text-xs">X-Ray (Alt+Z)</button>
        </div>
      </div>

      <!-- Center 3D Modelling Stage -->
      <div class="flex-1 bg-studio-950 relative flex items-center justify-center overflow-hidden">
        <!-- 3D Perspective Grid Background -->
        <div class="absolute inset-0 opacity-20 pointer-events-none" style="background-image: linear-gradient(#475569 1px, transparent 1px), linear-gradient(90deg, #475569 1px, transparent 1px); background-size: 32px 32px;"></div>

        <!-- 3D Polyhedral Mesh Subject with Highlighted Face -->
        <div class="relative w-80 h-80 flex items-center justify-center">
          <svg class="w-full h-full drop-shadow-2xl" viewBox="0 0 200 200" fill="none">
            <!-- Lower Base Block -->
            <polygon points="100,50 160,85 100,120 40,85" fill="#2d323f" stroke="#64748b" stroke-width="2"/>
            <polygon points="40,85 100,120 100,165 40,130" fill="#1e222a" stroke="#4b5563" stroke-width="2"/>
            <polygon points="100,120 160,85 160,130 100,165" fill="#171920" stroke="#4b5563" stroke-width="2"/>

            <!-- Active Selected Extruded Face (Amber Gold) -->
            <polygon points="100,20 150,50 100,80 50,50" fill="#f59e0b" stroke="#fef08a" stroke-width="3"/>
            <!-- Connecting Extruded quad walls -->
            <polygon points="50,50 100,80 100,120 40,85" fill="#3b4252" stroke="#64748b" stroke-width="1.5" opacity="0.8"/>
            <polygon points="100,80 150,50 160,85 100,120" fill="#2b303d" stroke="#64748b" stroke-width="1.5" opacity="0.8"/>

            <!-- 3D Transform Gizmo (RGB Axis Handles) -->
            <!-- Z Axis (Blue) -->
            <line x1="100" y1="50" x2="100" y2="0" stroke="#38bdf8" stroke-width="4" stroke-linecap="round"/>
            <polygon points="100,-5 95,5 105,5" fill="#38bdf8"/>
            <!-- X Axis (Red) -->
            <line x1="100" y1="50" x2="145" y2="75" stroke="#f43f5e" stroke-width="4" stroke-linecap="round"/>
            <polygon points="150,78 140,70 144,82" fill="#f43f5e"/>
            <!-- Y Axis (Green) -->
            <line x1="100" y1="50" x2="55" y2="75" stroke="#10b981" stroke-width="4" stroke-linecap="round"/>
            <polygon points="50,78 56,82 60,70" fill="#10b981"/>
            <!-- Center origin handle -->
            <circle cx="100" cy="50" r="5" fill="#ffffff" stroke="#000" stroke-width="1.5"/>
          </svg>

          <!-- Floating HUD Dimension Badge -->
          <div class="absolute top-8 right-6 bg-studio-850/90 border border-slate-700/80 px-3 py-1.5 rounded-xl text-xs text-slate-300 shadow-xl backdrop-blur-md">
            <span>Normal Offset: </span><strong class="text-amber-400 font-mono">+1.250 m</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}
