import * as THREE from 'three';
import { Track, PALETTE } from './track.js';
import { Ship, AIDriver, TUNING } from './ships.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { ParticleSystem, SpeedLines, CameraRig, EnergyGates } from './effects.js';
import './style.css';

const TOTAL_LAPS = 3;
const RIVAL_DEFS = [
  { name: 'NOVA-7', color: PALETTE.magenta, accent: 0xff8fe0, skill: 1.0 },
  { name: 'VOLT', color: PALETTE.violet, accent: 0xc9a6ff, skill: 0.98 },
  { name: 'SABLE', color: PALETTE.amber, accent: 0xffd97a, skill: 0.965 },
  { name: 'KITE', color: PALETTE.lime, accent: 0xb6ffcf, skill: 0.95 },
  { name: 'ORACLE', color: 0x3f7bff, accent: 0x9bc0ff, skill: 0.94 },
];

class Game {
  constructor() {
    this.canvas = document.querySelector('#gl');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x05070f, 0.0016);
    this.scene.background = new THREE.Color(0x05070f);

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.6, 4200);
    this.scene.add(this.camera);

    this._buildLights();

    this.track = new Track(this.scene);
    this.input = new Input();
    this.audio = new AudioEngine();
    this.hud = new HUD(document.querySelector('#hud'));
    this.particles = new ParticleSystem(this.scene);
    this.speedLines = new SpeedLines(this.scene, this.camera);
    this.camRig = new CameraRig(this.camera);
    this.gates = new EnergyGates(this.scene, this.track, 28);

    this.state = 'menu'; // menu | countdown | racing | finished | paused
    this.elapsed = 0;
    this.countdown = 0;
    this.time = 0;
    this.clock = new THREE.Clock();
    this.weatherStreakTimer = 0;

    this._buildShips();
    this._bindUI();

    window.addEventListener('resize', () => this._onResize());
    this._onResize();

    document.querySelector('#loading')?.classList.add('hidden');
    this._animate();
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0x88bbff, 0x140a26, 0.85);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xa8d8ff, 1.5);
    key.position.set(180, 260, 120);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xff3fbf, 0.9);
    rim.position.set(-220, 90, -180);
    this.scene.add(rim);

    // neon light rigs along the track for colour variation while moving
    const lightA = new THREE.PointLight(PALETTE.cyan, 90, 130, 2);
    const lightB = new THREE.PointLight(PALETTE.magenta, 90, 130, 2);
    this.scene.add(lightA, lightB);
    this.rigLights = [lightA, lightB];
  }

  _buildShips() {
    this.ships = [];
    this.aiDrivers = [];

    this.player = new Ship({
      scene: this.scene,
      track: this.track,
      color: PALETTE.cyan,
      accent: 0x9ff5ff,
      name: 'YOU',
      isPlayer: true,
    });
    this.player.onLap = () => this._onPlayerLap();
    this.player.onWall = (ship, impact) => {
      if (impact > 5) {
        this.audio.impact(impact / 8);
        this.camRig.addShake(Math.min(0.9, impact / 26));
        this.particles.burst(ship.pos, 0xffb020, 10, 7, 0.7);
        ship.hull = Math.max(0, ship.hull - impact * 0.22);
      }
    };
    this.ships.push(this.player);

    // grid: player starts at the back of a 6-ship field
    const N = this.track.N;
    RIVAL_DEFS.forEach((def, i) => {
      const ship = new Ship({
        scene: this.scene,
        track: this.track,
        color: def.color,
        accent: def.accent,
        name: def.name,
        skill: def.skill,
      });
      const driver = new AIDriver(ship, this.track, {
        lane: (i % 2 === 0 ? -1 : 1) * (0.16 + i * 0.11),
        aggression: def.skill,
      });
      this.aiDrivers.push(driver);
      this.ships.push(ship);
    });

    this._resetGrid();
  }

  _resetGrid() {
    const N = this.track.N;
    const rowGap = 9;
    // Staggered grid just past the start/finish line (so lap 1 is a full lap).
    // Player takes the last slot, which means starting P6 and having to overtake.
    this.ships.forEach((ship, i) => {
      const slot = ship.isPlayer ? this.ships.length - 1 : i - 1;
      const side = slot % 2 === 0 ? -0.3 : 0.3;
      const offset = 18 + slot * rowGap;
      ship.placeAt(offset % N, side);
      ship.hull = TUNING.hull;
      ship.boost = 0.65;
      ship.lap = 0;
      ship.progress = ship.sampleIndex;
      ship.finished = false;
      ship.finishTime = 0;
    });
    this.race = {
      lap: 0,
      totalLaps: TOTAL_LAPS,
      raceTime: 0,
      bestLap: 0,
      lastLapStart: 0,
      position: 6,
      shards: 0,
      standings: [],
    };
    this.hud.hideFinal();
    this.gates.items.forEach((g) => {
      g.active = true;
      g.group.visible = true;
    });
  }

  _bindUI() {
    document.querySelector('#btn-start')?.addEventListener('click', () => this._startRace());
    document.querySelector('#btn-again')?.addEventListener('click', () => {
      this._resetGrid();
      this._startRace();
    });
    document.querySelector('#btn-menu')?.addEventListener('click', () => {
      this.hud.hideFinal();
      this._showMenu();
    });
    document.querySelector('#btn-mute')?.addEventListener('click', () => {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      document.querySelector('#btn-mute').textContent = this.muted ? 'SOUND OFF' : 'SOUND ON';
    });
    document.querySelector('#btn-cam')?.addEventListener('click', () => {
      const mode = this.camRig.cycle();
      this.hud.toast(`CAMERA: ${mode}`, 900);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'racing') this._pause();
      else if (e.code === 'Escape' && this.state === 'paused') this._resume();
      if (e.code === 'KeyC') this.hud.toast(`CAMERA: ${this.camRig.cycle()}`, 900);
      if (e.code === 'KeyM') {
        this.muted = !this.muted;
        this.audio.setMuted(this.muted);
      }
      if (e.code === 'Enter' && this.state === 'menu') this._startRace();
      if (e.code === 'KeyR' && (this.state === 'racing' || this.state === 'finished')) {
        this._resetGrid();
        this._startRace();
      }
    });
  }

  _showMenu() {
    this.state = 'menu';
    this.audio.blip(220, 0.2);
    document.querySelector('#menu').classList.add('show');
    document.querySelector('#btn-start').style.display = '';
    this._resetGrid();
  }

  _startRace() {
    this.audio.init();
    this.audio.resume();
    document.querySelector('#menu').classList.remove('show');
    this._resetGrid();
    this.state = 'countdown';
    this.countdown = 3.6;
    this.race.raceTime = 0;
    this.race.lastLapStart = 0;
    this.lastCountdownBeep = 4;
    this.elapsed = 0;
    this.hud.hideFinal();
  }

  _pause() {
    this.state = 'paused';
    document.querySelector('#pause').classList.add('show');
  }

  _resume() {
    this.state = 'racing';
    document.querySelector('#pause').classList.remove('show');
  }

  _onPlayerLap() {
    if (this.state !== 'racing') return;
    const lapTime = this.race.raceTime - this.race.lastLapStart;
    this.race.lastLapStart = this.race.raceTime;
    this.race.lap += 1;
    if (lapTime > 0 && (this.race.bestLap === 0 || lapTime < this.race.bestLap)) {
      this.race.bestLap = lapTime;
      this.hud.toast(`BEST LAP  ${formatLap(lapTime)}`, 2000);
    } else {
      this.hud.toast(`LAP ${formatLap(lapTime)}`, 1500);
    }
    this.audio.pickup();
    if (this.race.lap >= TOTAL_LAPS) {
      this._finishRace();
    } else {
      this.hud.splash(`LAP ${this.race.lap + 1} / ${TOTAL_LAPS}`, 1500, 'small');
    }
  }

  _finishRace() {
    this.state = 'finished';
    this.hud.splash('FINISH', 2400, 'big');
    this.audio.blip(880, 0.4, 'triangle', 0.2);
    setTimeout(() => {
      this.hud.showFinal({
        position: this.race.position,
        time: this.race.raceTime,
        bestLap: this.race.bestLap,
        shards: this.race.shards,
      });
    }, 1400);
  }

  /* ------------------------------------------------------------------ loop */

  _animate = () => {
    requestAnimationFrame(this._animate);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(0.05, rawDt);
    this._fpsAcc = (this._fpsAcc || 0) + rawDt;
    this._fpsFrames = (this._fpsFrames || 0) + 1;
    if (this._fpsAcc > 0.4) {
      const el = document.querySelector('#fps-val');
      if (el) el.textContent = `${Math.round(this._fpsFrames / this._fpsAcc)}`;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
    this.elapsed += dt;
    this._update(dt);
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  };

  _update(dt) {
    const inp = this.input.state;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCountdownBeep) {
        this.lastCountdownBeep = n;
        if (n > 0) this.audio.blip(440 + (4 - n) * 110, 0.16, 'square', 0.12);
      }
      this.hud.splash(
        this.countdown > 0.6 ? String(Math.max(1, Math.ceil(this.countdown - 0.6))) : 'GO',
        600,
        'big'
      );
      if (this.countdown <= 0) {
        this.state = 'racing';
        this.hud.splash('GO', 700, 'big');
        this.audio.blip(1200, 0.3, 'triangle', 0.2);
      }
    }

    const racing = this.state === 'racing';

    if (racing) {
      this.race.raceTime += dt;
    }

    // ---- player control
    if (this.state === 'racing' || this.state === 'countdown') {
      const inputs = racing
        ? inp
        : { steer: 0, throttle: 0, brake: 0, drift: false, boost: false };
      this.player.update(dt, inputs, this.elapsed);
    } else if (this.state === 'finished') {
      // autopilot the player after the flag so the moment keeps moving
      const ai = this._autopilot ?? (this._autopilot = new AIDriver(this.player, this.track, {}));
      ai.update(dt, { elapsed: this.elapsed, ships: this.ships });
    }

    // ---- AI
    if (this.state !== 'menu' && this.state !== 'paused') {
      for (const d of this.aiDrivers) {
        // simple rubber band so the field stays lively
        const gap = this.player.progress - d.ship.progress;
        d.rubber = THREE.MathUtils.clamp(1 + gap * 0.00016, 0.9, 1.07);
        d.update(dt, { elapsed: this.elapsed, ships: this.ships });
      }
    }

    // ---- track + world
    this.track.update(dt, this.elapsed);

    // move the neon light rigs with the player
    const ahead = this.track.samples[(this.player.sampleIndex + 40) % this.track.N];
    const behind = this.track.samples[(this.player.sampleIndex - 20 + this.track.N) % this.track.N];
    this.rigLights[0].position.copy(ahead.pos).add(new THREE.Vector3(0, 12, 0));
    this.rigLights[1].position.copy(behind.pos).add(new THREE.Vector3(0, 10, 0));

    // ---- pickups & effects
    if (racing) {
      this.gates.update(dt, this.elapsed, this.player, (item) => {
        this.race.shards += 1;
        this.player.boost = Math.min(1, this.player.boost + 0.28);
        this.player.speed += 5;
        this.audio.pickup();
        this.particles.burst(item.group.position, PALETTE.lime, 22, 12, 1.1);
        this.camRig.addShake(0.12);
      });

      // boost pads
      for (const pad of this.track.boostPads) {
        const s = this.track.samples[pad.index];
        if (pad.cooldown <= 0 && Math.abs(this.player.sampleIndex - pad.index) < 4) {
          const p = this.track.surfacePoint(pad.index, 0, new THREE.Vector3());
          const info = this.track.lateralAt(pad.index, this.player.pos);
          if (this.player.pos.distanceTo(s.pos) < s.hw * 0.75) {
            void p;
            void info;
            pad.cooldown = 1.5;
            this.player.speed += 14;
            this.player.boost = Math.min(1, this.player.boost + 0.18);
            this.audio.whoosh();
            this.particles.burst(this.player.pos, PALETTE.lime, 18, 10, 0.9);
          }
        }
      }

      // spark trail while boosting / scraping
      this._emitFx(dt);
    }

    this.particles.update(dt);

    // ---- camera
    if (this.state === 'menu') {
      const t = this.elapsed * 0.16;
      const idx = Math.floor((t * 0.6 % 1) * this.track.N);
      const s = this.track.samples[idx];
      this.camera.position.lerp(
        s.pos.clone().addScaledVector(s.tangent, -26).add(new THREE.Vector3(0, 14, 0)),
        1 - Math.exp(-2 * dt)
      );
      const look = this.track.samples[(idx + 90) % this.track.N].pos;
      this.camera.lookAt(look);
      this.camera.fov += (78 - this.camera.fov) * (1 - Math.exp(-2 * dt));
      this.camera.updateProjectionMatrix();
    } else {
      this.camRig.update(dt, this.player, this.elapsed);
    }

    // speed lines intensify with speed / boost
    const speedN = this.player.speed / TUNING.maxSpeed;
    this.speedLines.update(dt, Math.max(0, speedN - 0.75) * 1.6 + (this.player.boosting ? 0.9 : 0), this.elapsed);

    // ---- race bookkeeping
    if (racing) this._updateStandings();

    // ---- audio
    if (this.state !== 'paused') {
      this.audio.updateEngine(
        Math.min(1.3, Math.abs(this.player.speed) / TUNING.maxSpeed),
        this.player.throttle,
        this.player.boosting,
        this.player.drifting
      );
    }

    // ---- hud
    this.hud.update(dt, { ship: this.player, race: this.race, track: this.track, camMode: this.camRig.modes[this.camRig.mode] });
    this.hud.drawMinimap(this.track, this.ships);
  }

  _emitFx(dt) {
    const p = this.player;
    this.weatherStreakTimer -= dt;
    if (p.boosting && this.weatherStreakTimer <= 0) {
      this.weatherStreakTimer = 0.02;
      const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      for (const side of [-1.3, 1.3]) {
        const pos = p.pos.clone().addScaledVector(right, side).addScaledVector(fwd, -2);
        this.particles.spawn(
          pos,
          fwd.clone().multiplyScalar(-14).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)),
          p.boosting ? 0xbdf3ff : PALETTE.cyan,
          0.8 + Math.random() * 0.5,
          0.35
        );
      }
    }
    if (p.scrape > 0.1 && Math.random() < 0.7) {
      const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const pos = p.pos.clone().addScaledVector(right, Math.sign(p.lateral || 1) * 1.5);
      this.particles.spawn(
        pos,
        new THREE.Vector3((Math.random() - 0.5) * 10, 4 + Math.random() * 6, (Math.random() - 0.5) * 10),
        0xffb020,
        0.7,
        0.5
      );
    }
  }

  _updateStandings() {
    const list = this.ships.map((s) => ({
      name: s.name,
      isPlayer: s.isPlayer,
      progress: s.progress,
      color: s.color,
    }));
    list.sort((a, b) => b.progress - a.progress);
    const playerIdx = list.findIndex((s) => s.isPlayer);
    this.race.position = playerIdx + 1;
    const leadProgress = list[0].progress;
    const metersPerSample = this.track.length / this.track.N;
    this.race.standings = list.map((s) => ({
      ...s,
      gap: (s.progress - leadProgress) * metersPerSample,
    }));
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }
}

function formatLap(t) {
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    window.__game = new Game();
  } catch (err) {
    console.error(err);
    const el = document.querySelector('#error');
    if (el) {
      el.style.display = 'block';
      el.textContent = `Failed to boot: ${err.message}`;
    }
  }
});
