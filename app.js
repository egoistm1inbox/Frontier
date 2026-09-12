const species = {
  saguaro: {
    name: 'Saguaro', latin: 'Carnegiea gigantea', id: 'DES-SAG-001', group: 'CACTUS', icon: '♧', poly: '18,420', instances: '01', height: '4.8M', wind: 'HIGH', previewClass: 'image-saguaro',
    description: 'Ribbed columnar cactus', defaults: { height: 72, spread: 48, density: 64, maturity: 58, spines: 56, weathering: 31, bloom: true }
  },
  barrel: {
    name: 'Barrel Cactus', latin: 'Ferocactus wislizenii', id: 'DES-BAR-014', group: 'CACTUS', icon: '◉', poly: '12,860', instances: '03', height: '0.9M', wind: 'HIGH',
    description: 'Ribbed solitary cactus', defaults: { height: 47, spread: 63, density: 72, maturity: 66, spines: 76, weathering: 42, bloom: true }
  },
  ocotillo: {
    name: 'Ocotillo', latin: 'Fouquieria splendens', id: 'DES-OCO-007', group: 'SHRUB', icon: '⌁', poly: '21,340', instances: '02', height: '3.1M', wind: 'MEDIUM', previewClass: 'image-ocotillo',
    description: 'Deciduous thornscrub shrub', defaults: { height: 67, spread: 62, density: 71, maturity: 52, spines: 45, weathering: 27, bloom: true }
  },
  agave: {
    name: 'Agave', latin: 'Agave americana', id: 'DES-AGA-022', group: 'SUCCULENT', icon: '✺', poly: '14,680', instances: '04', height: '1.2M', wind: 'HIGH',
    description: 'Blue-gray rosette succulent', defaults: { height: 43, spread: 76, density: 81, maturity: 61, spines: 63, weathering: 36, bloom: false }
  },
  aloe: {
    name: 'Desert Aloe', latin: 'Aloe ferox', id: 'DES-ALO-018', group: 'SUCCULENT', icon: '✦', poly: '10,920', instances: '06', height: '1.4M', wind: 'MEDIUM',
    description: 'Serrated leaf rosette', defaults: { height: 48, spread: 67, density: 76, maturity: 47, spines: 39, weathering: 22, bloom: true }
  },
  yucca: {
    name: 'Joshua Tree', latin: 'Yucca brevifolia', id: 'DES-YUC-031', group: 'SHRUB', icon: '♨', poly: '24,760', instances: '01', height: '5.6M', wind: 'HIGH',
    description: 'Branched yucca tree', defaults: { height: 78, spread: 54, density: 60, maturity: 73, spines: 32, weathering: 49, bloom: false }
  }
};

const state = {
  selected: 'saguaro',
  seed: 482913,
  generated: 1,
  view: 'render',
  params: { ...species.saguaro.defaults }
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function seeded(seed) {
  let t = Number(seed) || 1;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ x >>> 15, x | 1);
    x ^= x + Math.imul(x ^ x >>> 7, x | 61);
    return ((x ^ x >>> 14) >>> 0) / 4294967296;
  };
}

function svg(tag, attrs = {}, children = '') {
  const attrString = Object.entries(attrs).map(([key, value]) => `${key}="${esc(value)}"`).join(' ');
  return `<${tag}${attrString ? ` ${attrString}` : ''}>${children}</${tag}>`;
}

function defs(kind, palette) {
  return `<defs>
    <linearGradient id="${kind}-body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${palette.dark}"/><stop offset=".22" stop-color="${palette.mid}"/><stop offset=".52" stop-color="${palette.light}"/><stop offset=".77" stop-color="${palette.mid}"/><stop offset="1" stop-color="${palette.dark}"/></linearGradient>
    <linearGradient id="${kind}-leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.light}"/><stop offset=".55" stop-color="${palette.mid}"/><stop offset="1" stop-color="${palette.dark}"/></linearGradient>
    <radialGradient id="${kind}-rock" cx="35%" cy="25%"><stop offset="0" stop-color="#8d7658"/><stop offset="1" stop-color="#332d25"/></radialGradient>
    <filter id="${kind}-shadow" x="-30%" y="-30%" width="160%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="9"/><feOffset dy="9"/><feComponentTransfer><feFuncA type="linear" slope=".35"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;
}

function terrain(rng, compact = false, kind = `${state.selected}-main`) {
  let result = `<ellipse cx="400" cy="638" rx="${compact ? 106 : 150}" ry="${compact ? 15 : 20}" fill="#080b08" opacity=".52"/>`;
  const count = compact ? 10 : 25;
  for (let i = 0; i < count; i++) {
    const x = 400 + (rng() - .5) * (compact ? 210 : 300);
    const y = 633 + rng() * 17;
    const rx = 3 + rng() * (compact ? 7 : 13);
    const ry = 2 + rng() * 5;
    const rot = Math.round((rng() - .5) * 80);
    result += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${rot} ${x.toFixed(1)} ${y.toFixed(1)})" fill="url(#${kind}-rock)" opacity="${(.55 + rng() * .4).toFixed(2)}"/>`;
  }
  return result;
}

function spinesForColumn(rng, x, top, bottom, width, amount, color = '#e5c998') {
  const count = Math.max(4, Math.floor(7 + amount * .16));
  let out = '';
  for (let i = 0; i < count; i++) {
    const y = top + (bottom - top) * ((i + .5) / count);
    const jitter = (rng() - .5) * 5;
    const side = i % 2 === 0 ? -1 : 1;
    out += `<path d="M ${x + side * (width * .45)} ${y + jitter} l ${side * (3 + amount * .035)} ${(rng() - .5) * 2}" stroke="${color}" stroke-width="1" opacity="${(.28 + amount / 210).toFixed(2)}"/>`;
  }
  return out;
}

function makeSaguaro(rng, p, kind) {
  const spread = p.spread / 60;
  const height = .75 + p.height / 280;
  const centerTop = 106 + (1 - height) * 60;
  const base = 630;
  const width = 55 + p.maturity * .13;
  const leftX = 400 - width / 2;
  const rightX = 400 + width / 2;
  const armY = 392 - p.maturity * .55;
  const armLength = 84 + p.spread * 1.15;
  const armHeight = armY - 115;
  let out = `<g filter="url(#${kind}-shadow)">
    <path d="M ${leftX} ${base} C ${leftX - 4} 557 ${leftX + 2} 500 ${leftX + 1} ${centerTop + 30} C ${leftX + 1} ${centerTop + 8} ${leftX + 12} ${centerTop} 400 ${centerTop} C ${rightX - 12} ${centerTop} ${rightX - 1} ${centerTop + 8} ${rightX - 1} ${centerTop + 30} C ${rightX - 2} 500 ${rightX + 4} 557 ${rightX} ${base} Z" fill="url(#${kind}-body)" stroke="#19251a" stroke-width="3"/>
    <path d="M ${leftX + 12} ${base - 5} C ${leftX + 8} 520 ${leftX + 12} ${centerTop + 46} ${leftX + 18} ${centerTop + 28} M ${leftX + 28} ${base} C ${leftX + 23} 475 ${leftX + 27} ${centerTop + 30} ${leftX + 31} ${centerTop + 11} M 400 ${base} C 396 480 400 ${centerTop + 42} 400 ${centerTop + 2} M ${rightX - 28} ${base} C ${rightX - 23} 475 ${rightX - 27} ${centerTop + 30} ${rightX - 31} ${centerTop + 11} M ${rightX - 12} ${base - 5} C ${rightX - 8} 520 ${rightX - 12} ${centerTop + 46} ${rightX - 18} ${centerTop + 28}" fill="none" stroke="#a7bd83" stroke-opacity=".34" stroke-width="5"/>
    <path d="M ${leftX + 7} ${base - 3} C ${leftX + 3} 510 ${leftX + 7} ${centerTop + 62} ${leftX + 12} ${centerTop + 34} M ${rightX - 7} ${base - 3} C ${rightX - 3} 510 ${rightX - 7} ${centerTop + 62} ${rightX - 12} ${centerTop + 34}" fill="none" stroke="#0d170f" stroke-opacity=".4" stroke-width="3"/>
  </g>`;
  const leftArm = `M ${leftX + 8} ${armY + 80} C ${leftX - 23} ${armY + 76} ${leftX - 34} ${armY + 46} ${leftX - 30} ${armY + 22} C ${leftX - 27} ${armY + 4} ${leftX - 18} ${armY - 12} ${leftX - 18} ${armY - 38}`;
  const rightArm = `M ${rightX - 8} ${armY + 135} C ${rightX + 28} ${armY + 129} ${rightX + 38} ${armY + 99} ${rightX + 31} ${armY + 72} C ${rightX + 27} ${armY + 53} ${rightX + 15} ${armY + 40} ${rightX + 16} ${armY + 15}`;
  const armStroke = 25 + p.maturity * .055;
  out = `<g fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#${kind}-shadow)">
    <path d="${leftArm}" stroke="#142017" stroke-width="${armStroke + 7}"/><path d="${leftArm}" stroke="url(#${kind}-body)" stroke-width="${armStroke}"/>
    <path d="${rightArm}" stroke="#142017" stroke-width="${armStroke + 7}"/><path d="${rightArm}" stroke="url(#${kind}-body)" stroke-width="${armStroke}"/>
  </g>` + out;
  out += spinesForColumn(rng, 400, centerTop + 22, base - 15, width, p.spines);
  for (let i = 0; i < 13; i++) {
    const y = centerTop + 43 + i * ((base - centerTop - 70) / 13);
    const x = 400 + (rng() - .5) * width * .75;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.1" fill="#dcc28f" opacity=".65"/>`;
    if (p.spines > 35) out += `<path d="M ${x} ${y} l ${(rng() > .5 ? 5 : -5).toFixed(1)} ${(rng() - .5).toFixed(1)}" stroke="#ecd4a6" stroke-width=".8" opacity=".8"/>`;
  }
  if (p.bloom) {
    out += `<g fill="#f4c78b" stroke="#d58b5d" stroke-width="1" opacity=".92"><path d="M 400 ${centerTop - 2} q -9 -12 -2 -21 q 8 8 2 21Z"/><path d="M 400 ${centerTop - 2} q 9 -12 2 -21 q -8 8 -2 21Z"/><circle cx="400" cy="${centerTop - 4}" r="3" fill="#ece48c"/></g>`;
  }
  return out;
}

function makeBarrel(rng, p, kind) {
  const scale = .72 + p.height / 290;
  const rx = 92 * (.74 + p.spread / 150);
  const ry = 122 * scale;
  const cx = 400;
  const cy = 508;
  let out = `<g filter="url(#${kind}-shadow)"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${kind}-body)" stroke="#1b261a" stroke-width="4"/>`;
  const ribs = Math.round(7 + p.density / 13);
  for (let i = 0; i < ribs; i++) {
    const x = cx - rx * .76 + i * (rx * 1.52 / (ribs - 1));
    out += `<path d="M ${x} ${cy + ry * .8} C ${x - 21} ${cy + ry * .2} ${x - 20} ${cy - ry * .55} ${cx + (x - cx) * .62} ${cy - ry * .93}" fill="none" stroke="#b5c78d" stroke-opacity=".28" stroke-width="5"/>`;
    if (p.spines > 15) {
      for (let j = 0; j < 5; j++) {
        const yy = cy - ry * .65 + j * ry * .3;
        out += `<path d="M ${x} ${yy} l ${(x < cx ? -1 : 1) * (4 + p.spines / 22)} ${(rng() - .5) * 4}" stroke="#edd3a0" stroke-width="1" opacity=".75"/>`;
      }
    }
  }
  if (p.bloom) out += `<g fill="#e2a15c" stroke="#bb6747" stroke-width="1"><path d="M ${cx - 3} ${cy - ry + 5} q -13 -18 -4 -27 q 11 7 7 26Z"/><path d="M ${cx + 3} ${cy - ry + 5} q 13 -18 4 -27 q -11 7 -7 26Z"/><circle cx="${cx}" cy="${cy - ry + 3}" r="3" fill="#f5d57e"/></g>`;
  return out + '</g>';
}

function makeOcotillo(rng, p, kind) {
  const count = Math.round(9 + p.density / 7);
  const base = 625;
  let branches = '';
  let leaves = '';
  for (let i = 0; i < count; i++) {
    const angle = -2.78 + (i / Math.max(1, count - 1)) * 5.55 + (rng() - .5) * .3;
    const spread = 95 + p.spread * 1.7;
    const x = 400 + Math.sin(angle) * spread;
    const top = 128 + rng() * 130 + (1 - p.height / 100) * 50;
    const curve = 20 + rng() * 34;
    const c1x = 400 + (x - 400) * .18;
    const c2x = 400 + (x - 400) * .76 + (rng() - .5) * 30;
    const d = `M 400 ${base} C ${c1x.toFixed(1)} ${(base - 112 - rng() * 30).toFixed(1)} ${c2x.toFixed(1)} ${(top + curve).toFixed(1)} ${x.toFixed(1)} ${top.toFixed(1)}`;
    branches += `<path d="${d}" fill="none" stroke="#1b2118" stroke-width="${7 + p.maturity * .025}" stroke-linecap="round" opacity=".85"/><path d="${d}" fill="none" stroke="url(#${kind}-body)" stroke-width="${3.5 + p.maturity * .015}" stroke-linecap="round"/>`;
    const leavesCount = Math.round(2 + p.density / 17);
    for (let j = 0; j < leavesCount; j++) {
      const t = .2 + j / (leavesCount + 1) * .68;
      const lx = 400 + (x - 400) * t + (rng() - .5) * 6;
      const ly = base + (top - base) * t + (rng() - .5) * 6;
      const side = rng() > .5 ? 1 : -1;
      leaves += `<ellipse cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" rx="${4 + p.maturity / 26}" ry="${2.5 + p.maturity / 38}" transform="rotate(${side * (24 + rng() * 25)} ${lx.toFixed(1)} ${ly.toFixed(1)})" fill="#789155" opacity="${(.45 + p.density / 190).toFixed(2)}"/>`;
    }
    if (p.bloom) {
      const flowerX = x + (rng() - .5) * 5;
      for (let k = 0; k < 3; k++) leaves += `<circle cx="${flowerX + (rng() - .5) * 8}" cy="${top + k * 7}" r="${2.1 + rng() * 1.2}" fill="#c95f4f" opacity=".95"/>`;
    }
  }
  return `<g filter="url(#${kind}-shadow)">${branches}${leaves}</g>`;
}

function makeRosette(rng, p, kind, aloe = false) {
  const leavesCount = Math.round((aloe ? 18 : 16) + p.density / 3.8);
  const cx = 400;
  const cy = aloe ? 515 : 532;
  const radius = (aloe ? 130 : 155) * (.7 + p.spread / 180);
  let out = '<g filter="url(#' + kind + '-shadow)">';
  for (let i = 0; i < leavesCount; i++) {
    const a = -Math.PI + (i / leavesCount) * Math.PI * 2 + (rng() - .5) * .12;
    const r = radius * (.78 + rng() * .25);
    const tipX = cx + Math.cos(a) * r;
    const tipY = cy + Math.sin(a) * r * (aloe ? .57 : .48) - (Math.sin(a) < 0 ? 20 : 0);
    const bend = (rng() - .5) * 24;
    const half = aloe ? 10 : 17;
    const sideX = Math.cos(a + Math.PI / 2) * half;
    const sideY = Math.sin(a + Math.PI / 2) * half * .5;
    out += `<path d="M ${cx - sideX} ${cy - sideY} Q ${cx + Math.cos(a) * r * .45 + bend} ${cy + Math.sin(a) * r * .25} ${tipX} ${tipY} Q ${cx + Math.cos(a) * r * .45 - bend} ${cy + Math.sin(a) * r * .25} ${cx + sideX} ${cy + sideY} Q ${cx + Math.cos(a) * 25} ${cy - Math.sin(a) * 8} ${cx - sideX} ${cy - sideY} Z" fill="url(#${kind}-leaf)" stroke="#233025" stroke-width="2"/>
      <path d="M ${cx} ${cy} Q ${cx + Math.cos(a) * r * .5} ${cy + Math.sin(a) * r * .25} ${tipX} ${tipY}" fill="none" stroke="#c1cc9b" stroke-width="1.2" stroke-opacity=".44"/>`;
    if (p.spines > 30 && !aloe) {
      for (let q = .35; q < .88; q += .18) {
        const sx = cx + (tipX - cx) * q;
        const sy = cy + (tipY - cy) * q;
        out += `<path d="M ${sx} ${sy} l ${Math.cos(a + Math.PI / 2) * 5} ${Math.sin(a + Math.PI / 2) * 4}" stroke="#ded4a7" stroke-width="1" opacity=".7"/>`;
      }
    }
  }
  if (!aloe) {
    out += `<path d="M 365 582 Q 400 556 435 582 L 426 620 Q 400 628 374 620Z" fill="#4b3a28" opacity=".9"/>`;
    for (let i = 0; i < 6; i++) out += `<path d="M ${373 + i * 10} 590 l ${-7 + i * 2} 24" stroke="#96724d" stroke-width="3" opacity=".6"/>`;
  }
  if (p.bloom) {
    out += `<path d="M 400 ${cy - 5} C 399 ${cy - 70} 404 ${cy - 111} 414 ${cy - 150}" fill="none" stroke="#617c49" stroke-width="5"/>`;
    for (let i = 0; i < 5; i++) out += `<circle cx="${414 + (rng() - .5) * 12}" cy="${cy - 150 + i * 7}" r="${3 + rng() * 2}" fill="#d58c5c"/>`;
  }
  return out + '</g>';
}

function makeYucca(rng, p, kind) {
  const scale = .72 + p.height / 260;
  const trunkX = 400;
  const top = 145 + (1 - scale) * 45;
  let out = `<g filter="url(#${kind}-shadow)"><path d="M 381 631 C 376 550 384 462 389 369 L 413 369 C 418 467 425 554 419 631Z" fill="url(#${kind}-body)" stroke="#202a1e" stroke-width="3"/>`;
  const branches = p.maturity > 43 ? 3 + Math.floor(p.maturity / 23) : 2;
  for (let b = 0; b < branches; b++) {
    const bx = trunkX + (b - (branches - 1) / 2) * (32 + p.spread * .08);
    const by = 255 + Math.abs(b - branches / 2) * 37;
    const crownX = bx + (rng() - .5) * 28;
    const crownY = top + b * 38;
    out += `<path d="M ${trunkX} ${by + 100} C ${bx - 2} ${by + 40} ${bx} ${crownY + 38} ${crownX} ${crownY}" fill="none" stroke="#303a28" stroke-width="19" stroke-linecap="round"/><path d="M ${trunkX} ${by + 100} C ${bx - 2} ${by + 40} ${bx} ${crownY + 38} ${crownX} ${crownY}" fill="none" stroke="url(#${kind}-body)" stroke-width="14" stroke-linecap="round"/>`;
    const leafCount = 9 + Math.floor(p.density / 8);
    for (let i = 0; i < leafCount; i++) {
      const a = -2.95 + i / (leafCount - 1) * 5.9 + (rng() - .5) * .12;
      const len = 42 + p.spread * .42 + rng() * 25;
      const tx = crownX + Math.cos(a) * len;
      const ty = crownY + Math.sin(a) * len * .38;
      out += `<path d="M ${crownX} ${crownY} Q ${crownX + Math.cos(a) * len * .55} ${crownY + Math.sin(a) * len * .22 - 7} ${tx} ${ty}" fill="none" stroke="#768e54" stroke-width="${4 + p.maturity * .018}" stroke-linecap="round"/>`;
    }
  }
  return out + '</g>';
}

function makePlantMarkup(key, p, compact = false) {
  const rng = seeded(state.seed + key.length * 117);
  const paletteMap = {
    saguaro: { dark: '#27412a', mid: '#54774c', light: '#9aaa70' },
    barrel: { dark: '#344b2d', mid: '#718d50', light: '#b3bd7c' },
    ocotillo: { dark: '#4e3528', mid: '#766646', light: '#9aa46a' },
    agave: { dark: '#36504a', mid: '#6e9186', light: '#b3c7b2' },
    aloe: { dark: '#3c583b', mid: '#71915b', light: '#b2c187' },
    yucca: { dark: '#3f4d2e', mid: '#6d7f4d', light: '#a6ad72' }
  };
  const kind = `${key}-${compact ? 'mini' : 'main'}`;
  const palette = paletteMap[key];
  let plant = '';
  if (key === 'saguaro') plant = makeSaguaro(rng, p, kind);
  if (key === 'barrel') plant = makeBarrel(rng, p, kind);
  if (key === 'ocotillo') plant = makeOcotillo(rng, p, kind);
  if (key === 'agave') plant = makeRosette(rng, p, kind, false);
  if (key === 'aloe') plant = makeRosette(rng, p, kind, true);
  if (key === 'yucca') plant = makeYucca(rng, p, kind);
  const transform = compact ? 'translate(0 35) scale(.78)' : '';
  return `${defs(kind, palette)}<g transform="${transform}">${terrain(rng, compact, kind)}${plant}</g>`;
}

function makeSpeciesList() {
  const list = $('#species-list');
  list.innerHTML = Object.entries(species).map(([key, item]) => `<button class="species-option ${key === state.selected ? 'is-selected' : ''}" data-species="${key}"><span class="species-icon">${item.icon}</span><span class="species-copy"><b>${item.name}</b><small>${item.description}</small></span><span class="species-arrow">${key === state.selected ? '›' : ''}</span></button>`).join('');
  $$('.species-option', list).forEach(button => button.addEventListener('click', () => selectSpecies(button.dataset.species)));
}

function makeLibrary() {
  const grid = $('#library-grid');
  grid.innerHTML = Object.entries(species).map(([key, item]) => `<article class="library-card ${key === state.selected ? 'is-selected' : ''}" data-library-species="${key}">
    <div class="card-art ${item.previewClass || ''}">${item.previewClass ? '' : `<svg viewBox="0 0 800 680" aria-hidden="true">${makePlantMarkup(key, { ...item.defaults }, true)}</svg>`}<span class="card-tag">${item.group}</span></div>
    <div class="card-body"><div class="card-copy"><b>${item.name}</b><i>${item.latin}</i></div><span class="card-state">${key === state.selected ? 'ACTIVE' : 'READY'}</span></div>
  </article>`).join('');
  $$('.library-card', grid).forEach(card => card.addEventListener('click', () => selectSpecies(card.dataset.librarySpecies)));
}

function updateRangeVisual(input) {
  const percentage = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty('--range', `${percentage}%`);
}

function updateControls() {
  const controlMap = { height: 'height-range', spread: 'spread-range', density: 'density-range', maturity: 'maturity-range', spines: 'spines-range', weathering: 'weathering-range' };
  Object.entries(controlMap).forEach(([key, id]) => {
    const input = document.getElementById(id);
    input.value = state.params[key];
    $(`#${key}-value`).textContent = state.params[key];
    updateRangeVisual(input);
  });
  $('#seed-input').value = state.seed;
  $('#bloom-toggle').classList.toggle('is-on', state.params.bloom);
  $('#bloom-toggle').setAttribute('aria-pressed', String(state.params.bloom));
}

function updateMeta() {
  const item = species[state.selected];
  $('#preview-name').textContent = item.name;
  $('#preview-latin').textContent = item.latin;
  $('#botanical-id').textContent = item.id;
  $('#polycount').textContent = item.poly;
  $('#instances').textContent = item.instances;
  $('#spec-tris').textContent = item.poly;
  $('#spec-height').textContent = `${(0.8 + state.params.height / 18).toFixed(1)}M`;
  $('#wind-resistance').textContent = item.wind;
  $('#plant-svg').setAttribute('aria-label', `Generated ${item.name} plant preview`);
}

function updateQC() {
  const p = state.params;
  const warnings = [p.density < 24 || p.density > 94, p.spread < 18 || p.spread > 87, p.spines < 5 && (state.selected === 'saguaro' || state.selected === 'barrel')];
  const hasReview = warnings.some(Boolean);
  const rows = $$('.check-row');
  rows.forEach((row, index) => {
    const shouldReview = index === 0 ? warnings[1] : index === 2 ? warnings[0] : index === 1 ? warnings[2] : false;
    row.classList.toggle('is-review', shouldReview);
    row.querySelector('.check-icon').textContent = shouldReview ? '!' : '✓';
    row.querySelector('.check-icon').classList.toggle('is-review', shouldReview);
    row.querySelector('em').textContent = shouldReview ? 'REVIEW' : 'PASS';
    row.querySelector('em').classList.toggle('is-review', shouldReview);
  });
  const score = 5 - warnings.filter(Boolean).length;
  $('#qc-score').textContent = score;
  const badge = $('.qc-badge');
  badge.classList.toggle('is-review', hasReview);
  badge.innerHTML = `<i></i> ${hasReview ? 'REVIEW' : 'PASSED'}`;
  $('.qc-caption').innerHTML = hasReview ? 'CHECK PARAMETER<br/>RANGES' : 'SPECIMEN IS<br/>PRODUCTION READY';
}

function render() {
  $('#plant-svg').innerHTML = makePlantMarkup(state.selected, state.params);
  updateMeta();
  updateQC();
}

function selectSpecies(key) {
  if (!species[key]) return;
  state.selected = key;
  state.params = { ...species[key].defaults };
  state.seed = Math.floor(100000 + Math.random() * 899999);
  makeSpeciesList();
  makeLibrary();
  updateControls();
  render();
}

function regenerate(showLoading = true) {
  const loading = $('#stage-loading');
  if (showLoading) {
    loading.classList.add('is-visible');
    setTimeout(() => { render(); loading.classList.remove('is-visible'); }, 280);
  } else render();
}

function showToast(title = 'Version saved', subtitle = 'Added to your local collection') {
  const toast = $('#toast');
  toast.querySelector('b').textContent = title;
  toast.querySelector('small').textContent = subtitle;
  toast.classList.add('is-visible');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function setDefaults() {
  state.params = { ...species[state.selected].defaults };
  state.seed = 482913;
  updateControls();
  regenerate(false);
}

function wireInteractions() {
  const ids = ['height', 'spread', 'density', 'maturity', 'spines', 'weathering'];
  ids.forEach(key => {
    const input = $(`#${key}-range`);
    input.addEventListener('input', event => {
      state.params[key] = Number(event.target.value);
      $(`#${key}-value`).textContent = event.target.value;
      updateRangeVisual(input);
      render();
    });
  });
  $('#seed-input').addEventListener('change', event => {
    const value = parseInt(event.target.value.replace(/\D/g, ''), 10);
    state.seed = Number.isFinite(value) ? clamp(value, 1, 99999999) : state.seed;
    updateControls();
    render();
  });
  $('#random-seed').addEventListener('click', () => {
    state.seed = Math.floor(100000 + Math.random() * 899999);
    updateControls();
    regenerate();
  });
  $('#bloom-toggle').addEventListener('click', () => {
    state.params.bloom = !state.params.bloom;
    updateControls();
    render();
  });
  $('#generate-button').addEventListener('click', () => {
    state.generated += 1;
    state.seed = Math.floor(100000 + Math.random() * 899999);
    updateControls();
    regenerate();
  });
  $('#reset-button').addEventListener('click', setDefaults);
  $('#save-button').addEventListener('click', () => showToast('Version saved', `${species[state.selected].name} added to your local collection`));
  $('#fullscreen-button').addEventListener('click', () => {
    const preview = $('.preview-panel');
    if (!document.fullscreenElement && preview.requestFullscreen) preview.requestFullscreen();
    else if (document.fullscreenElement) document.exitFullscreen();
    else showToast('Preview focused', 'Fullscreen is not available in this browser');
  });
  $('#more-button').addEventListener('click', () => showToast('More options', 'Export and camera controls are coming next'));
  $$('.view-tab').forEach(button => button.addEventListener('click', () => {
    $$('.view-tab').forEach(tab => tab.classList.remove('is-active'));
    button.classList.add('is-active');
    state.view = button.dataset.view;
    $('#plant-svg').classList.toggle('wireframe', state.view === 'wire');
    $('#plant-svg').classList.toggle('silhouette', state.view === 'silhouette');
  }));
  $$('.library-filter').forEach(filter => filter.addEventListener('click', () => {
    $$('.library-filter').forEach(item => item.classList.remove('is-active'));
    filter.classList.add('is-active');
    const group = filter.textContent.trim();
    $$('.library-card').forEach(card => {
      const key = card.dataset.librarySpecies;
      card.style.display = group === 'ALL SPECIES' || species[key].group === group.slice(0, -1) || (group === 'CACTI' && species[key].group === 'CACTUS') ? '' : 'none';
    });
  }));
  window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') $('#generate-button').click();
  });
}

makeSpeciesList();
makeLibrary();
updateControls();
wireInteractions();
render();
