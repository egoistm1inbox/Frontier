// WebGL heightfield preview: raymarches the heightmap from an orbiting
// camera and shades it with the satmap colors. Framework-free so it can be
// driven from React or standalone.

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main(){ vUv = aPos*0.5+0.5; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uHeight;
uniform sampler2D uColor;
uniform vec2 uCanvas;
uniform float uWater;
uniform float uExag;
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
uniform vec3 uSun;

float heightAt(vec2 p){ return texture2D(uHeight, clamp(p, 0.0, 1.0)).r; }

vec3 sky(vec3 rd){
  float t = clamp(rd.y*0.5+0.5, 0.0, 1.0);
  vec3 horizon = vec3(0.74, 0.79, 0.87);
  vec3 zenith = vec3(0.34, 0.54, 0.82);
  vec3 c = mix(horizon, zenith, pow(t, 0.65));
  float s = max(dot(rd, uSun), 0.0);
  c += vec3(1.0, 0.92, 0.74) * pow(s, 32.0) * 0.7;
  return c;
}

void main(){
  vec3 ro = uCamPos;
  vec3 fwd = normalize(uCamTarget - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  float aspect = uCanvas.x / max(1.0, uCanvas.y);
  vec2 uv = vUv;
  vec3 rd = normalize(fwd + (uv.x*2.0-1.0)*aspect*0.66*right + (uv.y*2.0-1.0)*0.66*up);

  float waterY = uWater * uExag;
  float t = 0.15;
  bool hit = false;
  bool hitWater = false;
  vec3 pos = ro;
  for(int i=0;i<200;i++){
    pos = ro + rd*t;
    if(pos.x < -0.08 || pos.x > 1.08 || pos.z < -0.08 || pos.z > 1.08) break;
    float th = heightAt(pos.xz) * uExag;
    float gap = pos.y - th;
    if(gap < 0.0){ hit = true; break; }
    if(pos.y <= waterY && th <= waterY){ hitWater = true; break; }
    t += max(0.004, gap*0.32);
    if(t > 8.0) break;
  }

  vec3 col;
  if(hit || hitWater){
    vec2 p = pos.xz;
    float h0 = heightAt(p) * uExag;
    if(hitWater && !hit){
      col = mix(vec3(0.09, 0.26, 0.4), vec3(0.4, 0.66, 0.78), clamp((waterY - h0) / (uExag*0.3), 0.0, 1.0));
      float fres = pow(1.0 - clamp(dot(normalize(vec3(0.0,1.0,0.0)), -rd), 0.0, 1.0), 3.0);
      col = mix(col, vec3(0.85, 0.92, 0.98), fres*0.35);
    } else {
      float e = 0.004;
      float hx = heightAt(p + vec2(e, 0.0)) * uExag;
      float hz = heightAt(p + vec2(0.0, e)) * uExag;
      vec3 nrm = normalize(vec3((h0-hx)/e, 1.0, (h0-hz)/e));
      float diff = max(dot(nrm, uSun), 0.0);
      float amb = 0.36 + 0.24*max(nrm.y, 0.0);
      vec3 base = texture2D(uColor, p).rgb;
      if(h0 < waterY){
        float depth = clamp((waterY - h0)/(uExag*0.25), 0.0, 1.0);
        base = mix(vec3(0.10, 0.28, 0.42), vec3(0.35, 0.62, 0.75), 1.0-depth);
        nrm = vec3(0.0, 1.0, 0.0);
        diff = 0.55 + 0.45*max(dot(nrm, uSun), 0.0);
        amb = 0.5;
      }
      col = base * (amb + diff*0.78);
    }
  } else {
    col = sky(rd);
  }

  float fog = 1.0 - exp(-t*t*0.05);
  vec3 fogCol = vec3(0.74, 0.79, 0.87);
  col = mix(col, fogCol, clamp(fog, 0.0, 0.85));
  float vig = 1.0 - 0.22*dot(uv-0.5, uv-0.5)*2.0;
  col *= vig;
  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || 'shader compile failed');
  }
  return sh;
}

export class Preview3D {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false })
      || canvas.getContext('experimental-webgl', { antialias: true, alpha: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.canvas = canvas;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.loc = {};
    for (const name of ['uHeight', 'uColor', 'uCanvas', 'uWater', 'uExag', 'uCamPos', 'uCamTarget', 'uSun']) {
      this.loc[name] = gl.getUniformLocation(prog, name);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.vao = gl.createVertexArray ? (() => { const v = gl.createVertexArray(); gl.bindVertexArray(v); return v; })() : null;
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

    this.texHeight = this.makeTexture(gl.LUMINANCE, gl.LINEAR);
    this.texColor = this.makeTexture(gl.RGBA, gl.LINEAR);
    this.size = 0;
    this.heightU8 = null;
    this.color = null;
    this.exag = 0.12;
    this.waterN = 0.1;
    this.cam = { az: 55, el: 34, dist: 2.1 };
    this.sun = [Math.cos(0.9) * Math.cos(0.785), Math.sin(0.9), Math.sin(0.785) * Math.cos(0.9)];
    this.sun = normalize3(this.sun);
    this.resize();
  }

  makeTexture(format, filter) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  setData(heightN, colorRGBA, size) {
    const gl = this.gl;
    this.size = size;
    this.heightU8 = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) this.heightU8[i] = Math.max(0, Math.min(255, Math.round(heightN[i] * 255)));
    this.color = colorRGBA;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texHeight);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, size, size, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.heightU8);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texColor);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, colorRGBA);
  }

  setWater(waterN) { this.waterN = waterN; }
  setExaggeration(v) { this.exag = v; }
  setCamera(cam) { Object.assign(this.cam, cam); }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round((this.canvas.clientWidth || 300) * dpr));
    const h = Math.max(2, Math.round((this.canvas.clientHeight || 300) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  render() {
    const gl = this.gl;
    if (!this.size || !this.color) return;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.05, 0.05, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    if (this.vao) gl.bindVertexArray(this.vao);

    const { az, el, dist } = this.cam;
    const target = [0.5, Math.min(0.25, this.exag * 0.6), 0.5];
    const phi = el * Math.PI / 180, theta = az * Math.PI / 180;
    const camPos = [
      target[0] + dist * Math.cos(phi) * Math.sin(theta),
      target[1] + dist * Math.sin(phi),
      target[2] + dist * Math.cos(phi) * Math.cos(theta),
    ];

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texHeight);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texColor);
    gl.uniform1i(this.loc.uHeight, 0);
    gl.uniform1i(this.loc.uColor, 1);
    gl.uniform2f(this.loc.uCanvas, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.loc.uWater, this.waterN);
    gl.uniform1f(this.loc.uExag, this.exag);
    gl.uniform3f(this.loc.uCamPos, camPos[0], camPos[1], camPos[2]);
    gl.uniform3f(this.loc.uCamTarget, target[0], target[1], target[2]);
    gl.uniform3f(this.loc.uSun, this.sun[0], this.sun[1], this.sun[2]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.texHeight);
    gl.deleteTexture(this.texColor);
    gl.deleteProgram(this.prog);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  }
}

function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
