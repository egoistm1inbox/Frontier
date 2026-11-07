const fmtTime = (t) => {
  if (!isFinite(t) || t <= 0) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = {
      speed: root.querySelector('#speed-val'),
      speedBar: root.querySelector('#speed-bar'),
      boost: root.querySelector('#boost-bar'),
      hull: root.querySelector('#hull-bar'),
      lap: root.querySelector('#lap-val'),
      pos: root.querySelector('#pos-val'),
      time: root.querySelector('#time-val'),
      best: root.querySelector('#best-val'),
      drifting: root.querySelector('#drift-tag'),
      boosting: root.querySelector('#boost-tag'),
      splash: root.querySelector('#splash'),
      toast: root.querySelector('#toast'),
      shards: root.querySelector('#shard-val'),
      minimap: root.querySelector('#minimap'),
      rivals: root.querySelector('#rivals'),
      finalPanel: root.querySelector('#final'),
      camMode: root.querySelector('#cam-mode'),
      tacho: root.querySelector('#tacho-needle'),
    };
    this.splashTimer = 0;
    this.toastTimer = 0;
    this.lastSplash = '';
  }

  splash(text, ms = 1200, cls = '') {
    // allow the same text to re-fire once the previous one has faded out
    if (this.lastSplash === text && this.splashTimer > 0) return;
    this.lastSplash = text;
    this.el.splash.textContent = text;
    this.el.splash.className = `splash show ${cls}`;
    this.splashTimer = ms / 1000;
  }

  toast(text, ms = 1400) {
    this.el.toast.textContent = text;
    this.el.toast.className = 'toast show';
    this.toastTimer = ms / 1000;
  }

  update(dt, state) {
    const { ship, race, track } = state;

    this.el.speed.textContent = Math.round(Math.abs(ship.speed) * 3.6);
    const speedPct = Math.min(100, (Math.abs(ship.speed) / 165) * 100);
    this.el.speedBar.style.width = `${speedPct}%`;
    this.el.boost.style.width = `${Math.round(ship.boost * 100)}%`;
    this.el.hull.style.width = `${Math.round(Math.max(0, ship.hull))}%`;
    this.el.hull.style.background =
      ship.hull > 60 ? 'linear-gradient(90deg,#22e6ff,#5cff9d)' : ship.hull > 30 ? 'linear-gradient(90deg,#ffb020,#ffd76a)' : 'linear-gradient(90deg,#ff2fbf,#ff6a5c)';

    this.el.lap.textContent = `${Math.min(race.lap + 1, race.totalLaps)}/${race.totalLaps}`;
    this.el.pos.textContent = `P${race.position}`;
    this.el.time.textContent = fmtTime(race.raceTime);
    this.el.best.textContent = fmtTime(race.bestLap);
    this.el.shards.textContent = race.shards;
    this.el.camMode.textContent = state.camMode;

    this.el.drifting.style.opacity = ship.drifting ? 1 : 0;
    this.el.boosting.style.opacity = ship.boosting ? 1 : 0;

    // tachometer needle
    const tach = -120 + Math.min(1, Math.abs(ship.speed) / 165) * 240;
    this.el.tacho.style.transform = `rotate(${tach}deg)`;

    // rival list
    if (race.standings) {
      this.el.rivals.innerHTML = race.standings
        .slice(0, 6)
        .map(
          (s, i) =>
            `<li class="${s.isPlayer ? 'me' : ''}"><span class="p">${i + 1}</span><span class="n">${s.name}</span><span class="g">${s.isPlayer || i === 0 ? '' : `+${Math.max(0, Math.round(-s.gap))}m`}</span></li>`
        )
        .join('');
    }

    if (this.splashTimer > 0) {
      this.splashTimer -= dt;
      if (this.splashTimer <= 0) this.el.splash.className = 'splash';
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.className = 'toast';
    }
  }

  drawMinimap(track, ships) {
    const canvas = this.el.minimap;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // fit track bounds once
    if (!this._bounds) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const s of track.samples) {
        minX = Math.min(minX, s.pos.x);
        maxX = Math.max(maxX, s.pos.x);
        minZ = Math.min(minZ, s.pos.z);
        maxZ = Math.max(maxZ, s.pos.z);
      }
      const pad = 14;
      const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
      this._bounds = {
        minX, maxZ, scale,
        ox: pad + ((W - pad * 2) - (maxX - minX) * scale) / 2,
        oy: pad + ((H - pad * 2) - (maxZ - minZ) * scale) / 2,
      };
    }
    const b = this._bounds;
    const toXY = (v) => [b.ox + (v.x - b.minX) * b.scale, b.oy + (b.maxZ - v.z) * b.scale];

    ctx.beginPath();
    for (let i = 0; i <= track.N; i += 8) {
      const s = track.samples[i % track.N];
      const [x, y] = toXY(s.pos);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(34,230,255,0.35)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(180,240,255,0.9)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // start line
    const [sx, sy] = toXY(track.samples[0].pos);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);

    for (const ship of ships) {
      const [x, y] = toXY(ship.pos);
      ctx.beginPath();
      ctx.arc(x, y, ship.isPlayer ? 4.4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = ship.isPlayer ? '#5cff9d' : `#${ship.color.toString(16).padStart(6, '0')}`;
      ctx.fill();
      if (ship.isPlayer) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
  }

  showFinal(data) {
    const el = this.el.finalPanel;
    el.querySelector('#final-pos').textContent = `P${data.position}`;
    el.querySelector('#final-time').textContent = fmtTime(data.time);
    el.querySelector('#final-best').textContent = fmtTime(data.bestLap);
    el.querySelector('#final-shards').textContent = data.shards;
    el.querySelector('#final-title').textContent =
      data.position === 1 ? 'VICTORY' : data.position <= 3 ? 'PODIUM' : 'RACE COMPLETE';
    el.classList.add('show');
  }

  hideFinal() {
    this.el.finalPanel.classList.remove('show');
  }
}
