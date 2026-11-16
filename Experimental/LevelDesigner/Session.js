// Lobby session: who is in the lobby and which place each car stands on. Five places — the host's turntable (place 1)
// and four guest places. The session itself knows nothing about networking: it talks to a transport with two methods,
//
//   transport.send(message)          — called with this player's own messages
//   transport.onMessage(handler)     — the transport calls handler(message) for every message from other players
//
// Messages are plain JSON:
//   { type: 'hello',  player: { id, name, config } }   a player arrives (or announces itself to a newcomer)
//   { type: 'config', id, config }                     a player repainted their car (configOf() in Configurator.js)
//   { type: 'bye',    id }                             a player left
//   { type: 'full',   id }                             the host turned a player away: all five places are taken
//
// SimulatedTransport stands in for the network until there is a server: it invents guests that walk in, repaint and
// leave, so the lobby can be designed and tested with company. A WebSocket / WebRTC transport only has to implement
// the same two methods.
import { randomConfig } from './Configurator.js';

export const MAX_PLAYERS = 5;

export class LobbySession {
  constructor({ self, transport = null }) {
    this.self = { ...self, place: 0, host: true };
    this.players = new Map([[this.self.id, this.self]]);
    this.listeners = new Set();
    this.placeOpen = () => true;     // the level can close places (a hidden place takes no car)
    this.transport = null;
    if (transport) this.connect(transport);
  }

  connect(transport) {
    this.transport = transport;
    transport.onMessage((m) => this.receive(m));
    transport.send({ type: 'hello', player: this.publicOf(this.self) });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify(type, player) { for (const fn of this.listeners) fn({ type, player }); }

  get count() { return this.players.size; }
  get capacity() { let n = 1; for (let i = 1; i < MAX_PLAYERS; i++) if (this.placeOpen(i)) n++; return n; }
  get full() { return this.players.size >= this.capacity; }
  get guests() { return [...this.players.values()].filter((p) => !p.host); }
  playerAt(place) { return [...this.players.values()].find((p) => p.place === place) || null; }
  freePlace() { for (let i = 1; i < MAX_PLAYERS; i++) if (this.placeOpen(i) && !this.playerAt(i)) return i; return -1; }
  publicOf(p) { return { id: p.id, name: p.name, config: p.config }; }

  // This player repainted their car.
  publish(config) {
    this.self.config = config;
    if (this.transport) this.transport.send({ type: 'config', id: this.self.id, config });
  }

  receive(m) {
    if (!m || !m.type) return;
    if (m.type === 'hello' && m.player && !this.players.has(m.player.id)) {
      const place = this.freePlace();
      if (place < 0) { if (this.transport) this.transport.send({ type: 'full', id: m.player.id }); this.notify('turned-away', m.player); return; }
      const player = { ...m.player, place, host: false };
      this.players.set(player.id, player);
      this.notify('join', player);
    } else if (m.type === 'config' && this.players.has(m.id)) {
      const player = this.players.get(m.id);
      player.config = m.config;
      this.notify('config', player);
    } else if (m.type === 'bye' && this.players.has(m.id) && m.id !== this.self.id) {
      const player = this.players.get(m.id);
      this.players.delete(m.id);
      this.notify('leave', player);
    }
  }

  // Host tools.
  kick(id) { if (id !== this.self.id) this.receive({ type: 'bye', id }); }
  // Place numbers follow the layout; if the designer hides a place, its player moves to the next free one.
  move(id, place) {
    const p = this.players.get(id);
    if (!p || p.host || this.playerAt(place)) return false;
    p.place = place;
    this.notify('move', p);
    return true;
  }
}

// ---------------------------------------------------------------------------------------- simulated players
const NAMES = ['Mara', 'Theo', 'Ines', 'Kofi', 'Lena', 'Ravi', 'Noor', 'Jonas', 'Aiko', 'Sami', 'Elif', 'Bruno', 'Zara', 'Owen'];

export class SimulatedTransport {
  constructor({ seed = 7 } = {}) {
    let s = seed >>> 0;
    this.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    this.handler = () => {};
    this.present = new Map();        // id → name
    this.auto = false;
    this.timer = 0;
    this.serial = 0;
  }

  onMessage(handler) { this.handler = handler; }
  send(message) {
    // A real server would relay this. Here the only reply worth simulating: a turned-away guest stops trying.
    if (message.type === 'full') this.present.delete(message.id);
  }

  nextName() {
    const taken = new Set(this.present.values());
    const free = NAMES.filter((n) => !taken.has(n));
    return free.length ? free[Math.floor(this.random() * free.length)] : `Guest ${++this.serial}`;
  }

  join() {
    const id = `sim-${Date.now().toString(36)}-${++this.serial}`;
    const name = this.nextName();
    this.present.set(id, name);
    this.handler({ type: 'hello', player: { id, name, config: randomConfig(this.random) } });
    return id;
  }
  leave(id) { if (!this.present.has(id)) return; this.present.delete(id); this.handler({ type: 'bye', id }); }
  repaint(id) { if (this.present.has(id)) this.handler({ type: 'config', id, config: randomConfig(this.random) }); }
  clear() { for (const id of [...this.present.keys()]) this.leave(id); }

  // Automatic company: guests drift in until the lobby holds two to four of them, sometimes repaint, rarely leave.
  tick(dt, session) {
    if (!this.auto) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 5 + this.random() * 9;
    const n = session.guests.length;
    const want = 2 + Math.floor(this.random() * 3);
    const roll = this.random();
    if (n < want && !session.full) this.join();
    else if (n && roll < 0.55) this.repaint(session.guests[Math.floor(this.random() * n)].id);
    else if (n && roll < 0.7) this.leave(session.guests[Math.floor(this.random() * n)].id);
  }
}
