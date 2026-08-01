/* ============================================================
   fixa hero — WebGL2, no dependencies.

   The thesis of the page, rendered: a faceted solid that keeps
   breaking and healing. A gaussian "break wave" travels across
   the surface; shards inside it rotate and lift along their face
   normals, opening seams that expose a hot core. Behind the wave
   everything snaps back and the seams cool from amber to mint.

   Pipeline: shell + core + drift points -> HDR-ish scene FBO
             -> bright pass -> separable blur (quarter res)
             -> composite (bloom, chromatic aberration, vignette)
   ============================================================ */

window.FixaHero = (function () {
  'use strict';

  /* ---------- tiny mat4 ---------------------------------- */

  function ident() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  }

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ]);
  }

  function mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }

  function rotY(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);
  }

  function rotX(a) {
    const c = Math.cos(a), s = Math.sin(a);
    return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);
  }

  function translate(x, y, z) {
    const m = ident();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }

  /* upper-left 3x3 — model is rotation only, so it doubles as the normal matrix */
  function mat3of(m) {
    return new Float32Array([m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]]);
  }

  /* ---------- geometry ----------------------------------- */

  function icosphere(subdiv) {
    const t = (1 + Math.sqrt(5)) / 2;
    let pos = [
      [-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],
      [0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],
      [t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]
    ].map(normalize3);

    let faces = [
      [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
      [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
      [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
      [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
    ];

    for (let s = 0; s < subdiv; s++) {
      const cache = new Map();
      const next = [];
      const mid = (a, b) => {
        const key = a < b ? a + '_' + b : b + '_' + a;
        if (cache.has(key)) return cache.get(key);
        const p = normalize3([
          (pos[a][0] + pos[b][0]) / 2,
          (pos[a][1] + pos[b][1]) / 2,
          (pos[a][2] + pos[b][2]) / 2
        ]);
        pos.push(p);
        cache.set(key, pos.length - 1);
        return pos.length - 1;
      };
      for (const f of faces) {
        const a = mid(f[0], f[1]), b = mid(f[1], f[2]), c = mid(f[2], f[0]);
        next.push([f[0],a,c], [f[1],b,a], [f[2],c,b], [a,b,c]);
      }
      faces = next;
    }
    return { pos, faces };
  }

  function normalize3(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }

  /* flat, non-indexed shell: every triangle carries its own centroid,
     face normal, barycentric coords (for seam lines) and a stable seed */
  function shellMesh(subdiv, radius) {
    const { pos, faces } = icosphere(subdiv);
    const n = faces.length;
    const aPos = new Float32Array(n * 9);
    const aCen = new Float32Array(n * 9);
    const aNrm = new Float32Array(n * 9);
    const aBar = new Float32Array(n * 9);
    const aSeed = new Float32Array(n * 9);
    const BARY = [1,0,0, 0,1,0, 0,0,1];

    let rnd = 1337;
    const rand = () => {
      rnd = (rnd * 1664525 + 1013904223) % 4294967296;
      return rnd / 4294967296;
    };

    for (let f = 0; f < n; f++) {
      const [i0, i1, i2] = faces[f];
      const p = [pos[i0], pos[i1], pos[i2]];

      const cx = (p[0][0] + p[1][0] + p[2][0]) / 3;
      const cy = (p[0][1] + p[1][1] + p[2][1]) / 3;
      const cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
      const nrm = normalize3([cx, cy, cz]);   // sphere: centroid dir == face normal
      const s0 = rand(), s1 = rand(), s2 = rand();

      for (let v = 0; v < 3; v++) {
        const o = f * 9 + v * 3;
        aPos[o]     = p[v][0] * radius;
        aPos[o + 1] = p[v][1] * radius;
        aPos[o + 2] = p[v][2] * radius;
        aCen[o]     = cx * radius;
        aCen[o + 1] = cy * radius;
        aCen[o + 2] = cz * radius;
        aNrm[o]     = nrm[0];
        aNrm[o + 1] = nrm[1];
        aNrm[o + 2] = nrm[2];
        aBar[o]     = BARY[v * 3];
        aBar[o + 1] = BARY[v * 3 + 1];
        aBar[o + 2] = BARY[v * 3 + 2];
        aSeed[o]     = s0;
        aSeed[o + 1] = s1;
        aSeed[o + 2] = s2;
      }
    }
    return { aPos, aCen, aNrm, aBar, aSeed, count: n * 3 };
  }

  function uvSphere(radius, seg, ring) {
    const pos = [], idx = [];
    for (let y = 0; y <= ring; y++) {
      const v = y / ring, phi = v * Math.PI;
      for (let x = 0; x <= seg; x++) {
        const u = x / seg, th = u * Math.PI * 2;
        pos.push(
          Math.sin(phi) * Math.cos(th) * radius,
          Math.cos(phi) * radius,
          Math.sin(phi) * Math.sin(th) * radius
        );
      }
    }
    for (let y = 0; y < ring; y++) {
      for (let x = 0; x < seg; x++) {
        const a = y * (seg + 1) + x, b = a + seg + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return { pos: new Float32Array(pos), idx: new Uint16Array(idx) };
  }

  /* drifting field: each point orbits its own random axis */
  function driftField(n) {
    const base = new Float32Array(n * 3);
    const axis = new Float32Array(n * 3);
    const misc = new Float32Array(n * 3);   // speed, size, tint
    let rnd = 90210;
    const rand = () => {
      rnd = (rnd * 1664525 + 1013904223) % 4294967296;
      return rnd / 4294967296;
    };
    for (let i = 0; i < n; i++) {
      const dir = normalize3([rand() * 2 - 1, (rand() * 2 - 1) * 0.62, rand() * 2 - 1]);
      const r = 1.35 + Math.pow(rand(), 1.7) * 2.1;
      base[i * 3] = dir[0] * r;
      base[i * 3 + 1] = dir[1] * r * 0.7;
      base[i * 3 + 2] = dir[2] * r;
      const a = normalize3([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]);
      axis[i * 3] = a[0]; axis[i * 3 + 1] = a[1]; axis[i * 3 + 2] = a[2];
      misc[i * 3] = (rand() * 0.5 + 0.14) * (rand() > 0.5 ? 1 : -1);
      misc[i * 3 + 1] = rand();
      misc[i * 3 + 2] = rand();
    }
    return { base, axis, misc, count: n };
  }

  /* ---------- shaders ------------------------------------ */

  const ROT = `
mat3 rotAxis(vec3 a, float ang){
  a = normalize(a);
  float c = cos(ang), s = sin(ang), t = 1.0 - c;
  return mat3(
    t*a.x*a.x + c,     t*a.x*a.y + s*a.z, t*a.x*a.z - s*a.y,
    t*a.x*a.y - s*a.z, t*a.y*a.y + c,     t*a.y*a.z + s*a.x,
    t*a.x*a.z + s*a.y, t*a.y*a.z - s*a.x, t*a.z*a.z + c
  );
}`;

  /* the break wave — shared by shell and core so they stay in step */
  const WAVE = `
float breakAt(vec3 dirN, float time){
  vec3 sweep = normalize(vec3(sin(time*0.21), 0.34, cos(time*0.27)));
  float w = dot(dirN, sweep) * 0.5 + 0.5;
  float d = w - fract(time * 0.115);
  d -= floor(d + 0.5);                 // wrap to [-0.5, 0.5]
  float pulse = exp(-d * d * 88.0);    // narrow travelling band
  float breathe = 0.55 + 0.45 * sin(time * 0.37);
  return clamp(pulse * (0.62 + 0.38 * breathe), 0.0, 1.0);
}`;

  const SHELL_VS = `#version 300 es
precision highp float;
in vec3 aPos; in vec3 aCen; in vec3 aNrm; in vec3 aBar; in vec3 aSeed;
uniform mat4 uProj, uView, uModel;
uniform mat3 uNrmMat;
uniform float uTime, uAmp;
out vec3 vN; out vec3 vBar; out vec3 vView; out float vBreak; out float vSeed;
${ROT}
${WAVE}
void main(){
  vec3 dirN = normalize(aCen);
  float s = breakAt(dirN, uTime) * uAmp;
  float sj = s * (0.55 + 0.45 * aSeed.x);

  vec3 local = aPos - aCen;
  mat3 R = rotAxis(aSeed * 2.0 - 1.0 + vec3(0.001, 0.002, 0.003), sj * 1.9);

  vec3 p = aCen
         + R * local * (0.978 - 0.24 * sj)                       // shrink to open seams
         + aNrm * (0.16 + 0.44 * aSeed.y) * sj                   // lift along face normal
         + dirN * 0.04 * sin(uTime * 1.6 + aSeed.z * 6.283) * sj;

  vec3 fn = normalize(mat3(R) * aNrm);

  vec4 world = uModel * vec4(p, 1.0);
  vN = uNrmMat * fn;
  vBar = aBar;
  vView = -world.xyz;
  vBreak = s;
  vSeed = aSeed.z;
  gl_Position = uProj * uView * world;
}`;

  const SHELL_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vBar; in vec3 vView; in float vBreak; in float vSeed;
uniform vec3 uShell, uOk, uWarn;
uniform float uTime, uEmis, uAmb;
out vec4 fragColor;
void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(vView);

  vec3 key = normalize(vec3(-0.45, 0.78, 0.62));
  vec3 fill = normalize(vec3(0.72, -0.28, 0.34));

  float kd = max(dot(N, key), 0.0);
  float fd = max(dot(N, fill), 0.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);

  // uAmb lifts the facets off black; on paper it is what keeps the solid graphite
  vec3 base = uShell * (uAmb + 0.82 * kd) + uOk * 0.14 * fd * uEmis;
  base += uOk * fres * 0.42 * uEmis;

  // a tight machined highlight so the facets read as surfaces, not flat fill
  vec3 H = normalize(key + V);
  base += vec3(pow(max(dot(N, H), 0.0), 46.0) * 0.42 * uEmis);

  // seams: thin lines along every triangle edge, hot inside the break wave
  float e = min(min(vBar.x, vBar.y), vBar.z);
  float aa = fwidth(e) * 1.4;
  float line = 1.0 - smoothstep(0.0, aa, e);

  vec3 seamCol = mix(uOk, uWarn, smoothstep(0.12, 0.72, vBreak));
  // at rest the seams read as a mint lattice over graphite; inside the
  // break wave they flare amber, which is the whole two-state idea
  float seamI = (0.62 + 3.2 * vBreak) * uEmis;
  base += seamCol * line * seamI;

  // shards catch a little heat as they lift
  base += uWarn * vBreak * 0.14 * uEmis * (0.5 + 0.5 * sin(uTime * 2.0 + vSeed * 6.283));

  fragColor = vec4(base, 1.0);
}`;

  const CORE_VS = `#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uProj, uView, uModel;
uniform mat3 uNrmMat;
uniform float uTime;
out vec3 vN; out vec3 vView; out vec3 vLocal;
${WAVE}
void main(){
  vec3 dirN = normalize(aPos);
  float s = breakAt(dirN, uTime);
  // the core swells slightly under the wave, as if pressure escapes there
  vec3 p = aPos * (1.0 + 0.055 * s + 0.018 * sin(uTime * 0.9 + dirN.y * 4.0));
  vec4 world = uModel * vec4(p, 1.0);
  vN = uNrmMat * dirN;
  vView = -world.xyz;
  vLocal = dirN;
  gl_Position = uProj * uView * world;
}`;

  const CORE_FS = `#version 300 es
precision highp float;
in vec3 vN; in vec3 vView; in vec3 vLocal;
uniform vec3 uOk, uWarn;
uniform float uTime, uEmis;
out vec4 fragColor;

float hash(vec3 p){ return fract(sin(dot(p, vec3(17.1, 31.7, 53.3))) * 43758.5453); }
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                    mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                    mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  return n;
}

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(vView);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 1.7);

  vec3 q = vLocal * 3.1 + vec3(0.0, uTime * 0.32, uTime * 0.11);
  float f = noise(q) * 0.6 + noise(q * 2.3) * 0.3 + noise(q * 5.1) * 0.1;

  // embers, not a sun — the core is only ever glimpsed through the seams,
  // so it has to stay under the shell's own brightness
  vec3 col = mix(uWarn * 0.9, uOk, smoothstep(0.52, 0.9, f));
  col *= 0.04 + 0.95 * pow(f, 3.4);   // steep: filaments glow, the cavity stays dark
  col += uWarn * rim * 0.13;

  fragColor = vec4(col * uEmis, 1.0);
}`;

  const PT_VS = `#version 300 es
precision highp float;
in vec3 aBase; in vec3 aAxis; in vec3 aMisc;
uniform mat4 uProj, uView, uModel;
uniform float uTime, uPx;
out float vTint; out float vFade;
${ROT}
void main(){
  mat3 R = rotAxis(aAxis, uTime * aMisc.x * 0.42);
  vec3 p = R * aBase;
  p += aAxis * 0.09 * sin(uTime * 0.8 + aMisc.y * 6.283);

  vec4 world = uModel * vec4(p, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProj * eye;

  float dist = max(-eye.z, 0.001);
  gl_PointSize = clamp((0.9 + aMisc.y * 2.3) * uPx / dist, 1.0, 9.0);

  vTint = aMisc.z;
  vFade = smoothstep(11.0, 4.2, dist) * (0.30 + 0.70 * aMisc.y);
}`;

  const PT_FS = `#version 300 es
precision highp float;
in float vTint; in float vFade;
uniform vec3 uOk, uWarn;
uniform float uEmis;
out vec4 fragColor;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d);
  if (r > 0.25) discard;
  float a = smoothstep(0.25, 0.0, r);
  vec3 col = mix(uOk, uWarn, step(0.84, vTint));
  fragColor = vec4(col * a * vFade * 0.9 * uEmis, 1.0);
}`;

  /* fullscreen triangle — no attribute buffers needed */
  const FS_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uBg;
out vec4 fragColor;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  vec3 lifted = max(c - uBg, vec3(0.0));
  float l = dot(lifted, vec3(0.2126, 0.7152, 0.0722));
  // a high threshold keeps the bloom on the seams, where the story is,
  // instead of smearing the whole silhouette
  float k = smoothstep(0.42, 0.95, l);
  fragColor = vec4(lifted * k, 1.0);
}`;

  const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;      // texel-sized step
out vec4 fragColor;
void main(){
  vec3 s = texture(uTex, vUv).rgb * 0.2270270270;
  s += (texture(uTex, vUv + uDir * 1.3846153846).rgb +
        texture(uTex, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
  s += (texture(uTex, vUv + uDir * 3.2307692308).rgb +
        texture(uTex, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
  fragColor = vec4(s, 1.0);
}`;

  const COMP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene, uBloom;
uniform vec2 uRes;
uniform float uBloomAmt, uTime, uVig;
out vec4 fragColor;

float hash21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // chromatic aberration grows toward the frame edge
  float ca = (0.7 + 1.6 * r2) * 0.0016;
  vec3 col;
  col.r = texture(uScene, uv + c * ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - c * ca).b;

  col += texture(uBloom, uv).rgb * uBloomAmt;

  // vignette + a touch of dither so gradients stay clean on 8-bit
  col *= 1.0 - r2 * uVig;
  col += (hash21(uv * uRes + fract(uTime)) - 0.5) * 0.006;

  fragColor = vec4(col, 1.0);
}`;

  /* ---------- gl helpers --------------------------------- */

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('[fixa] shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[fixa] link:', gl.getProgramInfoLog(p));
      return null;
    }
    // cache uniform + attribute locations
    p.u = {};
    p.a = {};
    const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < nu; i++) {
      const info = gl.getActiveUniform(p, i);
      p.u[info.name] = gl.getUniformLocation(p, info.name);
    }
    const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
    for (let i = 0; i < na; i++) {
      const info = gl.getActiveAttrib(p, i);
      p.a[info.name] = gl.getAttribLocation(p, info.name);
    }
    return p;
  }

  function buffer(gl, data, target) {
    const b = gl.createBuffer();
    const t = target || gl.ARRAY_BUFFER;
    gl.bindBuffer(t, b);
    gl.bufferData(t, data, gl.STATIC_DRAW);
    return b;
  }

  function bindAttr(gl, prog, name, buf, size) {
    const loc = prog.a[name];
    if (loc === undefined || loc < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  }

  function makeTarget(gl, w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h, depth: null };
  }

  /* ---------- palette from CSS custom properties ---------- */

  function readTriplet(styles, name, fallback) {
    const raw = styles.getPropertyValue(name).trim();
    const parts = raw.split(',').map((n) => parseFloat(n));
    if (parts.length < 3 || parts.some(isNaN)) return fallback;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
  }

  /* ---------- main --------------------------------------- */

  function init(canvas) {
    if (!canvas) return null;

    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      powerPreference: 'high-performance'
    });
    if (!gl) return null;

    const shell = shellMesh(2, 1.0);         // 320 shards
    const core = uvSphere(0.845, 48, 32);
    const drift = driftField(1500);

    const pShell = program(gl, SHELL_VS, SHELL_FS);
    const pCore = program(gl, CORE_VS, CORE_FS);
    const pPts = program(gl, PT_VS, PT_FS);
    const pBright = program(gl, FS_VS, BRIGHT_FS);
    const pBlur = program(gl, FS_VS, BLUR_FS);
    const pComp = program(gl, FS_VS, COMP_FS);
    if (!pShell || !pCore || !pPts || !pBright || !pBlur || !pComp) return null;

    const buf = {
      sPos: buffer(gl, shell.aPos), sCen: buffer(gl, shell.aCen),
      sNrm: buffer(gl, shell.aNrm), sBar: buffer(gl, shell.aBar),
      sSeed: buffer(gl, shell.aSeed),
      cPos: buffer(gl, core.pos),
      cIdx: buffer(gl, core.idx, gl.ELEMENT_ARRAY_BUFFER),
      pBase: buffer(gl, drift.base), pAxis: buffer(gl, drift.axis), pMisc: buffer(gl, drift.misc)
    };

    const vaoShell = gl.createVertexArray();
    gl.bindVertexArray(vaoShell);
    bindAttr(gl, pShell, 'aPos', buf.sPos, 3);
    bindAttr(gl, pShell, 'aCen', buf.sCen, 3);
    bindAttr(gl, pShell, 'aNrm', buf.sNrm, 3);
    bindAttr(gl, pShell, 'aBar', buf.sBar, 3);
    bindAttr(gl, pShell, 'aSeed', buf.sSeed, 3);

    const vaoCore = gl.createVertexArray();
    gl.bindVertexArray(vaoCore);
    bindAttr(gl, pCore, 'aPos', buf.cPos, 3);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.cIdx);

    const vaoPts = gl.createVertexArray();
    gl.bindVertexArray(vaoPts);
    bindAttr(gl, pPts, 'aBase', buf.pBase, 3);
    bindAttr(gl, pPts, 'aAxis', buf.pAxis, 3);
    bindAttr(gl, pPts, 'aMisc', buf.pMisc, 3);

    const vaoNull = gl.createVertexArray();
    gl.bindVertexArray(null);

    let scene = null, bloomA = null, bloomB = null, depthRb = null;
    let W = 0, H = 0, bw = 0, bh = 0;

    const pal = {
      bg: [0.03, 0.04, 0.05], shell: [0.5, 0.6, 0.6],
      ok: [0.24, 0.92, 0.69], warn: [1, 0.63, 0.2],
      bloom: 1, emis: 1, amb: 0.055, vig: 0.55
    };

    function refreshTheme() {
      const st = getComputedStyle(document.documentElement);
      pal.bg = readTriplet(st, '--gl-bg', pal.bg);
      pal.shell = readTriplet(st, '--gl-shell', pal.shell);
      pal.ok = readTriplet(st, '--gl-ok', pal.ok);
      pal.warn = readTriplet(st, '--gl-warn', pal.warn);
      const num = (name, fallback) => {
        const v = parseFloat(st.getPropertyValue(name));
        return isNaN(v) ? fallback : v;
      };
      pal.bloom = num('--gl-bloom', pal.bloom);
      pal.emis = num('--gl-emis', pal.emis);
      pal.amb = num('--gl-amb', pal.amb);
      pal.vig = num('--gl-vig', pal.vig);
    }
    refreshTheme();

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (w === W && h === H) return;
      W = w; H = h;
      canvas.width = W; canvas.height = H;
      bw = Math.max(1, W >> 2); bh = Math.max(1, H >> 2);

      [scene, bloomA, bloomB].forEach((t) => {
        if (!t) return;
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      });
      if (depthRb) gl.deleteRenderbuffer(depthRb);

      scene = makeTarget(gl, W, H);
      depthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb);

      bloomA = makeTarget(gl, bw, bh);
      bloomB = makeTarget(gl, bw, bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* pointer parallax with inertia */
    const aim = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };

    function onPointer(e) {
      const r = canvas.getBoundingClientRect();
      aim.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      aim.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    }
    window.addEventListener('pointermove', onPointer, { passive: true });

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    let raf = 0;
    let t0 = 0;
    let clock = 0;

    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible && !raf && !reduced.matches) {
          t0 = 0;
          raf = requestAnimationFrame(frame);
        }
      }, { threshold: 0 }).observe(canvas);
    }

    function drawScene() {
      const aspect = W / H;
      // the object sits right-of-centre so the headline column stays clear.
      // positive x in eye space is screen-right, so the shift is added, not subtracted.
      const wide = aspect > 1.15;
      const shiftX = wide ? 1.50 : 0.0;
      const shiftY = wide ? -0.06 : -0.95;   // on narrow screens it sits low, behind the readout
      const dist = wide ? 7.0 : 8.6;

      const proj = perspective(0.62, aspect, 0.1, 60);
      const view = translate(shiftX, shiftY, -dist);
      const model = mul(rotY(clock * 0.17 + cur.x * 0.55), rotX(-0.18 + cur.y * 0.30));
      const nrm = mat3of(model);

      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
      gl.viewport(0, 0, W, H);
      gl.clearColor(pal.bg[0], pal.bg[1], pal.bg[2], 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);

      // core first — it is only ever seen through the seams
      gl.useProgram(pCore);
      gl.bindVertexArray(vaoCore);
      gl.uniformMatrix4fv(pCore.u.uProj, false, proj);
      gl.uniformMatrix4fv(pCore.u.uView, false, view);
      gl.uniformMatrix4fv(pCore.u.uModel, false, model);
      gl.uniformMatrix3fv(pCore.u.uNrmMat, false, nrm);
      gl.uniform1f(pCore.u.uTime, clock);
      gl.uniform1f(pCore.u.uEmis, pal.emis);
      gl.uniform3fv(pCore.u.uOk, pal.ok);
      gl.uniform3fv(pCore.u.uWarn, pal.warn);
      gl.drawElements(gl.TRIANGLES, core.idx.length, gl.UNSIGNED_SHORT, 0);

      gl.useProgram(pShell);
      gl.bindVertexArray(vaoShell);
      gl.uniformMatrix4fv(pShell.u.uProj, false, proj);
      gl.uniformMatrix4fv(pShell.u.uView, false, view);
      gl.uniformMatrix4fv(pShell.u.uModel, false, model);
      gl.uniformMatrix3fv(pShell.u.uNrmMat, false, nrm);
      gl.uniform1f(pShell.u.uTime, clock);
      gl.uniform1f(pShell.u.uAmp, reduced.matches ? 0.55 : 1.0);
      gl.uniform1f(pShell.u.uEmis, pal.emis);
      gl.uniform1f(pShell.u.uAmb, pal.amb);
      gl.uniform3fv(pShell.u.uShell, pal.shell);
      gl.uniform3fv(pShell.u.uOk, pal.ok);
      gl.uniform3fv(pShell.u.uWarn, pal.warn);
      gl.drawArrays(gl.TRIANGLES, 0, shell.count);

      // drift field: additive, depth-tested but not depth-writing
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(pPts);
      gl.bindVertexArray(vaoPts);
      gl.uniformMatrix4fv(pPts.u.uProj, false, proj);
      gl.uniformMatrix4fv(pPts.u.uView, false, view);
      gl.uniformMatrix4fv(pPts.u.uModel, false, model);
      gl.uniform1f(pPts.u.uTime, clock);
      gl.uniform1f(pPts.u.uPx, H * 0.0022);
      gl.uniform1f(pPts.u.uEmis, pal.emis);
      gl.uniform3fv(pPts.u.uOk, pal.ok);
      gl.uniform3fv(pPts.u.uWarn, pal.warn);
      gl.drawArrays(gl.POINTS, 0, drift.count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
    }

    function blit(prog, target, setup) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, target ? target.w : W, target ? target.h : H);
      gl.useProgram(prog);
      gl.bindVertexArray(vaoNull);
      if (setup) setup();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function postFx() {
      // bright pass -> quarter res
      blit(pBright, bloomA, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, scene.tex);
        gl.uniform1i(pBright.u.uTex, 0);
        gl.uniform3fv(pBright.u.uBg, pal.bg);
      });

      // separable blur, two iterations for a soft falloff
      for (let i = 0; i < 2; i++) {
        blit(pBlur, bloomB, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
          gl.uniform1i(pBlur.u.uTex, 0);
          gl.uniform2f(pBlur.u.uDir, (1 + i) / bw, 0);
        });
        blit(pBlur, bloomA, () => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, bloomB.tex);
          gl.uniform1i(pBlur.u.uTex, 0);
          gl.uniform2f(pBlur.u.uDir, 0, (1 + i) / bh);
        });
      }

      blit(pComp, null, () => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, scene.tex);
        gl.uniform1i(pComp.u.uScene, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bloomA.tex);
        gl.uniform1i(pComp.u.uBloom, 1);
        gl.uniform2f(pComp.u.uRes, W, H);
        gl.uniform1f(pComp.u.uBloomAmt, 0.62 * pal.bloom);
        gl.uniform1f(pComp.u.uVig, pal.vig);
        gl.uniform1f(pComp.u.uTime, clock);
      });
    }

    function render() {
      resize();
      cur.x += (aim.x - cur.x) * 0.045;
      cur.y += (aim.y - cur.y) * 0.045;
      drawScene();
      postFx();
    }

    function frame(now) {
      if (!t0) t0 = now;
      clock = (now - t0) / 1000;
      render();
      raf = visible ? requestAnimationFrame(frame) : 0;
    }

    function start() {
      canvas.dataset.live = 'true';
      if (reduced.matches) {
        // one considered still frame, mid-break, instead of a loop
        clock = 2.35;
        cur.x = cur.y = 0;
        render();
        return;
      }
      if (!raf) raf = requestAnimationFrame(frame);
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (visible && !reduced.matches) {
        t0 = 0;
        raf = requestAnimationFrame(frame);
      }
    });

    window.addEventListener('resize', () => {
      if (reduced.matches) render();
    }, { passive: true });

    reduced.addEventListener('change', () => {
      cancelAnimationFrame(raf);
      raf = 0;
      start();
    });

    return { start, refreshTheme, redraw: render };
  }

  return { init };
})();
