// Lobby places: where the five cars stand. Place 1 is the host's turntable (the Lobby's own); places 2–5 are guest
// discs in an arc behind it, each turned to face the centre so the cars gather around the host's car. A place is a
// holder group: disc, painted bay number, a soft shadow and — when a player is in it — that player's car, so moving
// or turning the place in the Level Designer carries the car with it.
import { THREE } from '../Shared/Studio/Render.js';
import { MAX_PLAYERS } from './Session.js';

export const GUEST_PLACES = MAX_PLAYERS - 1;
export const DEFAULT_LAYOUT = { radius: 10.5, spread: 132, discRadius: 3.2 };

// Arc behind the host turntable (toward −Z, away from the hero camera), evenly spread, every disc facing the centre.
export function arcLayout({ radius, spread }, centre = new THREE.Vector3()) {
  const out = [];
  for (let i = 0; i < GUEST_PLACES; i++) {
    const a = THREE.MathUtils.degToRad(-spread / 2 + (spread / (GUEST_PLACES - 1)) * i);
    const x = centre.x + Math.sin(a) * radius, z = centre.z - Math.cos(a) * radius;
    const dx = centre.x - x, dz = centre.z - z;
    out.push({ position: [+x.toFixed(3), 0, +z.toFixed(3)], rotationY: +Math.atan2(-dz, dx).toFixed(4) });
  }
  return out;
}

// Soft rectangular shadow under a parked car (the host car has the live contact shadow; guests get this).
let shadowTexture = null;
function carShadowTexture() {
  if (shadowTexture) return shadowTexture;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.roundRect(34, 30, 188, 68, 30); ctx.fill();
  shadowTexture = new THREE.CanvasTexture(c);
  return shadowTexture;
}

// Painted bay number on the floor, e.g. "02".
function numberTexture(n) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 96px "DM Sans", "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n).padStart(2, '0'), 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// One guest place. `lobby` provides the disc / band / ring materials so guest discs match the host turntable.
export function buildPlace(index, lobby, { discRadius = DEFAULT_LAYOUT.discRadius } = {}) {
  const holder = new THREE.Group();
  holder.name = `Place ${index + 1}`;
  const h = lobby.turntableHeight;
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96), lobby.discMat);
  disc.receiveShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 96, 1, true), lobby.bandMat);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 160), lobby.ringMat);
  ring.rotation.x = -Math.PI / 2;
  // Bay outline: a thin painted circle on the floor around the disc, and the number in front of it (toward the host).
  const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const outline = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128).rotateX(-Math.PI / 2), lineMat);
  outline.position.y = 0.004;
  const number = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: numberTexture(index + 1), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  number.rotation.y = Math.PI / 2;      // reads from the host side (+X of the place points at the centre)
  number.position.y = 0.005;
  const seat = new THREE.Group();       // the guest car goes in here
  seat.name = 'Seat';
  seat.position.y = h;
  holder.add(disc, band, ring, outline, number, seat);
  holder.userData.place = { disc, band, ring, outline, number, seat, lineMat };
  sizePlace(holder, discRadius, h);
  return holder;
}

export function sizePlace(holder, radius, h) {
  const { disc, band, ring, outline, number } = holder.userData.place;
  disc.scale.set(radius, h, radius); disc.position.y = h / 2;
  band.scale.set(radius + 0.004, h * 0.8, radius + 0.004); band.position.y = h * 0.45;
  ring.scale.setScalar(radius - 0.16); ring.position.y = h + 0.002;
  outline.scale.setScalar(radius + 0.45);
  number.position.x = radius + 1.05;
  holder.userData.radius = radius;
}

export function carShadow() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#000000', alphaMap: carShadowTexture(), transparent: true, opacity: 0.72, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.position.set(-0.05, 0.004, 0);
  m.renderOrder = 1;
  m.name = 'Car shadow';
  return m;
}

export function disposePlace(holder) {
  const { disc, band, ring, outline, number } = holder.userData.place;
  for (const m of [disc, band, ring, outline, number]) m.geometry.dispose();
  number.material.map.dispose(); number.material.dispose(); outline.material.dispose();
}
