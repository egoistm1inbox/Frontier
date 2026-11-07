/**
 * Input abstraction. Merges keyboard and gamepad into one normalised state so
 * gameplay code never cares where the signal came from.
 */
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.gamepadIndex = null;
    this.analog = { x: 0, y: 0 };
    this.padPrev = {};

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.gamepadIndex = e.gamepad.index;
    });
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
  }

  readGamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    const pad = navigator.getGamepads()[this.gamepadIndex];
    if (!pad) return null;
    const dz = (v) => (Math.abs(v) < 0.14 ? 0 : v);
    const x = dz(pad.axes[0] ?? 0);
    const y = dz(pad.axes[1] ?? 0);
    const rt = pad.buttons[7]?.value ?? 0;
    const lt = pad.buttons[6]?.value ?? 0;
    return {
      steer: x,
      throttle: (pad.buttons[0]?.pressed ? 1 : 0) + Math.max(0, -y),
      brake: (pad.buttons[1]?.pressed ? 1 : 0) + Math.max(0, y) + lt,
      drift: !!(pad.buttons[5]?.pressed || pad.buttons[2]?.pressed),
      boost: !!(pad.buttons[4]?.pressed || pad.buttons[3]?.pressed || rt > 0.5),
      throttleAnalog: rt,
    };
  }

  get state() {
    let steer = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer += 1;
    let throttle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0;
    let brake = this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0;
    let drift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    let boost = this.keys.has('Space');

    const pad = this.readGamepad();
    if (pad) {
      if (Math.abs(pad.steer) > 0.02) steer = pad.steer;
      throttle = Math.max(throttle, Math.min(1, pad.throttle + pad.throttleAnalog * 0.4));
      brake = Math.max(brake, Math.min(1, pad.brake));
      drift = drift || pad.drift;
      boost = boost || pad.boost;
    }

    return {
      steer: Math.max(-1, Math.min(1, steer)),
      throttle: Math.max(0, Math.min(1, throttle)),
      brake: Math.max(0, Math.min(1, brake)),
      drift,
      boost,
    };
  }

  /* ------------------------------------------------------------- menu hooks */
  get menuStart() {
    return this.wasPressed('Enter') || this.wasPressed('KeyR') || this.wasPressed('Space');
  }

  get menuEscape() {
    return this.wasPressed('Escape');
  }

  get reset() {
    return this.wasPressed('KeyR');
  }

  get cameraToggle() {
    return this.wasPressed('KeyC');
  }

  get muteToggle() {
    return this.wasPressed('KeyM');
  }
}
