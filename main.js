import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeHeroes } from './heroes.js?v=3';

/* =====================================================================
   ENDLESS — an infinite, procedural flight through the universe.
   Planets, ringed giants, moons, suns, nebulae, galaxies, star clusters
   and asteroid fields are generated ahead of you and recycled behind.
   URL options: ?low (force low quality)  ?seed=123  ?t=60 (skip ahead)
   ===================================================================== */

const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const CAPTURE = params.has('capture');
const CINEMA = !CAPTURE && !params.has('live') && !params.has('only');
const lowTier = !CAPTURE && (params.has('low') || coarse || Math.min(innerWidth, innerHeight) < 600 || (navigator.hardwareConcurrency || 8) <= 4);

const Q = lowTier
  ? { pr: Math.min(devicePixelRatio || 1, 1.25), stars: 6000, dust: 1200, galaxy: 22000, nebSprites: 10, asteroids: 140, skyOct: 4, objOct: 5, sphere: 96, bhSteps: 90 }
  : { pr: Math.min(devicePixelRatio || 1, 1.75), stars: 13000, dust: 2500, galaxy: 60000, nebSprites: 18, asteroids: 380, skyOct: 5, objOct: 6, sphere: 160, bhSteps: 150 };
if (CAPTURE) Object.assign(Q, { pr: devicePixelRatio || 1, stars: 20000, dust: 3000, galaxy: 120000, nebSprites: 26, asteroids: 600, skyOct: 6, objOct: 7, sphere: 256, bhSteps: 280 });

/* ---------- Seeded random ---------- */
let _s = params.get('seed') ? parseInt(params.get('seed'), 10) : (Math.random() * 2 ** 31) | 0;
function rnd() {
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const sideSign = () => (rnd() < 0.5 ? -1 : 1);
function gauss() {
  let u = 0, v = 0;
  while (!u) u = rnd();
  while (!v) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const col = (h) => new THREE.Color(h);

/* ---------- Renderer ---------- */
const canvas = document.getElementById('webgl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  document.documentElement.classList.add('ready');
  throw e;
}
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 260, 700); // only affects the rock (standard) materials
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 6000);

/* ---------- GLSL helpers ---------- */
const NOISE = (oct) => /* glsl */ `
  #ifndef NOISE_DEFINED
  #define NOISE_DEFINED
  #define OCT ${oct}
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  vec3 hash3(vec3 p) {
    return vec3(hash(p), hash(p + 17.31), hash(p + 41.97));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < OCT; i++) {
      s += a * noise(p);
      p = p * 2.02 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
  float ridged(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < OCT; i++) {
      float n = 1.0 - abs(noise(p) * 2.0 - 1.0);
      s += a * n * n;
      p = p * 2.05 + vec3(3.1, 1.7, 7.3);
      a *= 0.5;
    }
    return s;
  }
  #endif
`;

/* ---------- Path (camera flies along this forever) ---------- */
let zShift = 0; // accumulated floating-origin shift
const pathX = (z) => Math.sin((z + zShift) * 0.0031) * 16 + Math.sin((z + zShift) * 0.0009) * 26;
const pathY = (z) => Math.sin((z + zShift) * 0.0023 + 1.3) * 8 + Math.sin((z + zShift) * 0.0007) * 10;

/* =====================================================================
   SKY — distant Milky Way band, dust lanes, faint nebulosity, and
   thousands of pin-point background stars, computed per pixel.
   ===================================================================== */
const SKY_GLSL = /* glsl */ `
    vec3 starTemp(float t) {
      vec3 a = vec3(0.62, 0.72, 1.0);
      vec3 b = vec3(1.0, 0.96, 0.92);
      vec3 c = vec3(1.0, 0.78, 0.55);
      return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
    }
    vec3 starLayer(vec3 d, float scale, float density, float bright) {
      vec3 p = d * scale;
      vec3 id = floor(p);
      vec3 f = fract(p);
      float h = hash(id);
      if (h > density) return vec3(0.0);
      vec3 c = hash3(id + 3.1) * 0.6 + 0.2;
      float dist = length(f - c) / scale;          // angular distance (radians)
      float sigma = uPx * 0.55;
      float b = exp(-dist * dist / (sigma * sigma));
      float mag = pow(hash(id + 9.7), 6.0);
      return starTemp(hash(id + 5.3)) * b * (0.06 + mag * bright);
    }

    vec3 skyDir(vec3 d) {
      vec3 colr = vec3(0.0);

      // Milky Way band
      vec3 n = normalize(vec3(0.28, 0.9, 0.33));
      float lat = dot(d, n);
      float band = exp(-lat * lat / 0.028);
      float wide = exp(-lat * lat / 0.12);
      float cl = fbm(d * 3.5 + 2.0);
      float cl2 = fbm(d * 11.0 + 7.0);
      float dust = smoothstep(0.42, 0.72, fbm(d * 7.0 + vec3(cl * 1.5) + 11.0));
      vec3 mw = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.8, 1.0), smoothstep(0.3, 0.7, cl2));
      float mwI = band * (0.35 + cl * 1.2) * (0.6 + cl2 * 0.8) + wide * 0.15;
      mwI *= 1.0 - dust * 0.9 * band;
      colr += mw * mwI * 0.045;

      // faint, slowly changing nebulosity (shifts as you travel)
      vec3 q = d * 2.2 + vec3(0.0, 0.0, uTravel * 0.00004);
      float neb = smoothstep(0.45, 0.9, fbm(q + fbm(q * 2.0)));
      vec3 nebC = mix(vec3(0.55, 0.08, 0.18), vec3(0.06, 0.25, 0.4), fbm(q * 0.7 + 5.0));
      colr += nebC * neb * 0.02;

      // background stars (denser inside the band)
      colr += starLayer(d, 200.0, 0.02, 6.0);
      colr += starLayer(d, 460.0, 0.008 + band * 0.1, 2.0) * 0.45;
      colr += starLayer(d, 850.0, 0.002 + band * 0.18, 0.8) * 0.25;

      return colr;
    }
`;

const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    uInvProj: { value: new THREE.Matrix4() },
    uCamRot: { value: new THREE.Matrix3() },
    uTravel: { value: 0 },
    uPx: { value: 1 / innerHeight },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform mat4 uInvProj;
    uniform mat3 uCamRot;
    uniform float uTravel, uPx;
    varying vec2 vUv;
    ${NOISE(Q.skyOct)}

    ${SKY_GLSL}
    void main() {
      vec2 ndc = vUv * 2.0 - 1.0;
      vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
      vec3 d = normalize(uCamRot * normalize(v.xyz / v.w));

      vec3 colr = skyDir(d);
      gl_FragColor = vec4(colr, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});
const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
sky.frustumCulled = false;
sky.renderOrder = -100;
scene.add(sky);

/* =====================================================================
   WRAPPED STAR FIELDS — infinite stars and fine dust you fly through.
   ===================================================================== */
function wrappedPoints(count, depth, spread, sizeFn, colorFn, bright) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  const color = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 4 + Math.pow(rnd(), 0.7) * spread;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = Math.sin(a) * r;
    pos[i * 3 + 2] = rnd() * depth;
    size[i] = sizeFn();
    seed[i] = rnd();
    const c = colorFn();
    color.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uDepth: { value: depth },
      uPR: { value: Q.pr },
      uTime: { value: 0 },
      uBright: { value: bright },
    },
    vertexShader: /* glsl */ `
      attribute float aSize, aSeed;
      attribute vec3 aColor;
      uniform vec3 uCam;
      uniform float uDepth, uPR, uTime, uBright;
      varying vec3 vColor;
      varying float vB;
      void main() {
        vec3 p = position;
        float rel = mod(p.z - uCam.z, uDepth) - uDepth + 6.0;
        p.z = uCam.z + rel;
        p.xy += uCam.xy * 0.85;      // keep the field centred on the path
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = max(-mv.z, 0.05);
        float fade = smoothstep(uDepth, uDepth * 0.7, -rel) * smoothstep(0.5, 4.0, dist);
        float size = aSize * uPR * 70.0 / dist;
        float tw = 0.85 + 0.15 * sin(uTime * (0.7 + aSeed * 3.0) + aSeed * 50.0);
        float b = fade * tw * uBright;
        if (size < 1.0) { b *= size * size; size = 1.0; }
        gl_PointSize = min(size, 10.0 * uPR);
        vB = b;
        vColor = aColor;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vB;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d2 = dot(c, c);
        if (d2 > 0.25) discard;
        float core = exp(-d2 * 40.0);
        gl_FragColor = vec4(vColor * core * vB, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

const STAR_COLORS = ['#9db4ff', '#aabfff', '#cad8ff', '#f4f2ff', '#fff4e8', '#ffe2bd', '#ffc98a', '#ffad6b'].map(col);
const pickStarColor = () => STAR_COLORS[Math.min(STAR_COLORS.length - 1, Math.floor(Math.pow(rnd(), 0.9) * STAR_COLORS.length))];

const stars = wrappedPoints(Q.stars, 625, 240, () => 0.12 + Math.pow(rnd(), 9) * 1.6, pickStarColor, 3.0);
const spaceDust = wrappedPoints(Q.dust, 125, 26, () => 0.05 + rnd() * 0.06, () => col('#8a93a8'), 0.6);
scene.add(stars, spaceDust);

/* =====================================================================
   SHARED MATERIALS / GEOMETRY
   ===================================================================== */
const sphereGeo = new THREE.SphereGeometry(1, Q.sphere, Math.round(Q.sphere * 0.7));

// Local (non-wrapped) point stars: used inside galaxies, clusters and nebulae.
function localPointsMaterial(blending = THREE.AdditiveBlending, dark = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPR: { value: Q.pr },
      uScale: { value: 1 },
      uFade: { value: 1 },
      uBright: { value: 1 },
      uSizeK: { value: 2.0 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPR, uScale, uFade, uBright, uSizeK;
      varying vec3 vColor;
      varying float vB;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float dist = max(-mv.z, 0.05);
        float size = aSize * uPR * uScale * uSizeK / dist;
        float b = uFade * uBright;
        if (size < 1.0) { b *= size * size; size = 1.0; }
        gl_PointSize = min(size, 14.0 * uPR);
        vColor = aColor;
        vB = b;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: dark
      ? /* glsl */ `
        varying vec3 vColor;
        varying float vB;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float a = exp(-d2 * 12.0) * min(vB, 1.0);
          gl_FragColor = vec4(vColor, a);
        }`
      : /* glsl */ `
        varying vec3 vColor;
        varying float vB;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d2 = dot(c, c);
          if (d2 > 0.25) discard;
          float core = exp(-d2 * 30.0);
          gl_FragColor = vec4(vColor * core * vB, 1.0);
        }`,
    transparent: true,
    depthWrite: false,
    blending,
  });
}

function pointsGeometry(count, fill) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const color = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  const s = { size: 1 };
  for (let i = 0; i < count; i++) {
    fill(i, v, c, s);
    pos.set([v.x, v.y, v.z], i * 3);
    color.set([c.r, c.g, c.b], i * 3);
    size[i] = s.size;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  return g;
}

/* ---------- Sun / star sprite ---------- */
const sunGeo = new THREE.PlaneGeometry(1, 1);
function makeSunSprite() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 0.95, 0.85) }, uFade: { value: 1 }, uTime: { value: 0 }, uSpikes: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade, uTime, uSpikes;
      varying vec2 vUv;
      void main() {
        vec2 c = (vUv - 0.5) * 2.0;
        float r = length(c);
        float core = exp(-r * r * 900.0) * 7.0;
        float inner = exp(-r * 38.0) * 1.6;
        float glow = exp(-r * 9.0) * 0.35 + exp(-r * 3.5) * 0.05;
        float sx = exp(-abs(c.y) * 300.0) * exp(-abs(c.x) * 6.0);
        float sy = exp(-abs(c.x) * 300.0) * exp(-abs(c.y) * 6.0);
        float spikes = (sx + sy) * 1.4 * uSpikes;
        float flick = 1.0 + 0.03 * sin(uTime * 3.0);
        vec3 colr = uColor * (inner + glow + spikes) * flick + vec3(1.0) * core;
        float edge = smoothstep(1.0, 0.7, r);
        gl_FragColor = vec4(colr * uFade * edge, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(sunGeo, mat);
  m.userData.billboard = true;
  m.frustumCulled = false;
  return m;
}

/* =====================================================================
   PLANET SHADER — gas giants, rocky worlds, ocean worlds, ring shadows,
   bump-mapped craters, thin atmospheric limb, ocean specular.
   ===================================================================== */
const RING_FN = /* glsl */ `
  float ringDensity(float r, float rin, float rout, float seed) {
    float t = (r - rin) / (rout - rin);
    if (t < 0.0 || t > 1.0) return 0.0;
    float d = 0.55 + 0.2 * sin(t * 71.0 + seed) + 0.12 * sin(t * 197.0 + seed * 2.0) + 0.08 * sin(t * 563.0 + 1.3);
    d *= 0.7 + 0.3 * sin(t * 13.0 + seed * 3.0);
    d *= smoothstep(0.0, 0.05, t) * smoothstep(1.0, 0.86, t);
    d *= 1.0 - (smoothstep(0.55, 0.57, t) * (1.0 - smoothstep(0.62, 0.64, t))) * 0.92;
    return clamp(d, 0.0, 1.0);
  }
`;

function makePlanetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uType: { value: 0 },
      uSeed: { value: 0 },
      uColA: { value: new THREE.Color() },
      uColB: { value: new THREE.Color() },
      uColC: { value: new THREE.Color() },
      uAtmo: { value: new THREE.Color() },
      uLight: { value: new THREE.Vector3(1, 0, 0) },
      uSunI: { value: 2.4 },
      uFade: { value: 1 },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uHasRing: { value: 0 },
      uRingN: { value: new THREE.Vector3(0, 1, 0) },
      uRingIn: { value: 1.4 },
      uRingOut: { value: 2.4 },
      uBump: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN, vW, vObj;
      void main() {
        vObj = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uType, uSeed, uSunI, uFade, uTime, uRadius, uHasRing, uRingIn, uRingOut, uBump;
      uniform vec3 uColA, uColB, uColC, uAtmo, uLight, uCenter, uRingN;
      varying vec3 vN, vW, vObj;
      ${NOISE(Q.objOct)}
      ${RING_FN}

      vec3 bumpNormal(vec3 pos, vec3 n, float h, float k) {
        vec3 dpdx = dFdx(pos), dpdy = dFdy(pos);
        float dhx = dFdx(h), dhy = dFdy(h);
        vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
        float det = dot(dpdx, r1);
        vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
        return normalize(abs(det) * n - k * grad);
      }

      float craters(vec3 p) {
        vec3 g = p * 4.0;
        vec3 id = floor(g);
        float c = 0.0;
        for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
        for (int z = -1; z <= 1; z++) {
          vec3 cell = id + vec3(x, y, z);
          float h = hash(cell + uSeed);
          if (h < 0.45) continue;
          vec3 ctr = cell + hash3(cell + uSeed * 1.7);
          float rad = 0.15 + 0.35 * hash(cell + 4.2);
          float d = length(g - ctr) / rad;
          float bowl = smoothstep(1.0, 0.0, d);
          float rim = exp(-pow((d - 1.0) * 4.0, 2.0));
          c += rim * 0.5 - bowl * bowl * 0.7;
        }
        return c;
      }

      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 L = normalize(uLight);
        vec3 p = normalize(vObj);
        vec3 albedo;
        float specMask = 0.0;
        float clouds = 0.0;

        if (uType < 0.5) {
          // ---------- Gas giant ----------
          float t1 = fbm(p * 2.5 + vec3(uSeed));
          float t2 = fbm(vec3(p.x * 6.0, p.y * 26.0, p.z * 6.0) + uSeed * 3.0 + vec3(uTime * 0.004, 0.0, 0.0));
          float lat = p.y + (t1 - 0.5) * 0.16 + (t2 - 0.5) * 0.03;
          float b1 = 0.5 + 0.5 * sin(lat * 26.0 + uSeed);
          float b2 = 0.5 + 0.5 * sin(lat * 61.0 + uSeed * 2.0);
          float b3 = 0.5 + 0.5 * sin(lat * 140.0);
          albedo = mix(uColA, uColB, b1);
          albedo = mix(albedo, uColC, b2 * 0.45);
          albedo *= 0.88 + 0.12 * b3;
          albedo *= 0.85 + 0.3 * t2;
          vec3 sc = normalize(vec3(0.7, -0.32, 0.64));
          float sd = distance(p, sc) + (t2 - 0.5) * 0.06;
          float storm = smoothstep(0.17, 0.09, sd);
          albedo = mix(albedo, uColC * vec3(1.15, 0.75, 0.6), storm * 0.75);
          albedo *= 1.0 - 0.18 * smoothstep(0.7, 1.0, abs(p.y));
        } else if (uType < 1.5) {
          // ---------- Rocky / desert / moon ----------
          float h = fbm(p * 2.2 + uSeed);
          float dtl = fbm(p * 14.0 + uSeed * 2.0);
          float cr = craters(p) + craters(p * 2.7 + 3.0) * 0.5;
          float height = h * 0.7 + dtl * 0.3 + cr * 0.18;
          albedo = mix(uColA, uColB, smoothstep(0.3, 0.7, h + cr * 0.05));
          albedo = mix(albedo, uColC, smoothstep(0.55, 0.8, dtl) * 0.45);
          albedo *= 0.8 + 0.35 * dtl;
          N = bumpNormal(vW, N, height, uBump * uRadius * 0.035);
        } else {
          // ---------- Ocean world ----------
          float h = fbm(p * 1.8 + uSeed);
          float land = smoothstep(0.52, 0.56, h);
          float dtl = fbm(p * 12.0 + uSeed);
          vec3 ocean = mix(uColA * 0.6, uColA, smoothstep(0.3, 0.52, h));
          vec3 ground = mix(uColB, uColC, smoothstep(0.55, 0.75, h + dtl * 0.2));
          float polar = smoothstep(0.78, 0.86, abs(p.y) + dtl * 0.08);
          albedo = mix(ocean, ground, land);
          albedo = mix(albedo, vec3(0.92), polar);
          specMask = (1.0 - land) * (1.0 - polar);
          vec3 cq = p * 3.0 + vec3(uTime * 0.006, 0.0, uSeed);
          float sw = fbm(cq + fbm(cq * 2.0) * 1.5);
          clouds = smoothstep(0.5, 0.75, sw);
          albedo = mix(albedo, vec3(1.0), clouds * 0.92);
          if (land > 0.5) N = bumpNormal(vW, N, dtl, uRadius * 0.02);
        }

        float NdL = dot(N, L);
        float diff = max(NdL, 0.0);
        float term = smoothstep(-0.08, 0.3, dot(normalize(vN), L));
        vec3 lit = albedo * diff * uSunI * term;

        // ocean glint
        vec3 H = normalize(L + V);
        lit += vec3(1.0, 0.95, 0.85) * pow(max(dot(normalize(vN), H), 0.0), 90.0) * specMask * (1.0 - clouds) * 1.6 * term;

        // ring shadow on the planet
        if (uHasRing > 0.5) {
          float denom = dot(L, uRingN);
          if (abs(denom) > 0.001) {
            float t = dot(uCenter - vW, uRingN) / denom;
            if (t > 0.0) {
              float r = distance(vW + L * t, uCenter) / uRadius;
              lit *= 1.0 - ringDensity(r, uRingIn, uRingOut, uSeed) * 0.8;
            }
          }
        }

        // atmospheric limb scattering on the lit side
        float NdV = max(dot(normalize(vN), V), 0.0);
        float rim = pow(1.0 - NdV, 4.0);
        vec3 atmo = uAtmo * rim * smoothstep(-0.25, 0.45, dot(normalize(vN), L)) * 1.4;

        gl_FragColor = vec4((lit + atmo) * uFade, 1.0);
      }
    `,
  });
}

function makeAtmoMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uAtmo: { value: new THREE.Color() }, uLight: { value: new THREE.Vector3() }, uFade: { value: 1 }, uInner: { value: 0.3 } },
    vertexShader: /* glsl */ `
      varying vec3 vN, vW;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAtmo, uLight;
      uniform float uFade, uInner;
      varying vec3 vN, vW;
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        float d = clamp(-dot(N, V), 0.0, 1.0);
        float i = smoothstep(0.0, uInner, d);
        i = pow(i, 2.2);
        float lit = smoothstep(-0.35, 0.4, dot(-N, normalize(uLight)) * -1.0);
        gl_FragColor = vec4(uAtmo * i * lit * 1.6 * uFade, 1.0);
      }
    `,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

function makeRing() {
  const geo = new THREE.RingGeometry(1, 2, 256, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uIn: { value: 1.4 }, uOut: { value: 2.4 }, uSeed: { value: 0 },
      uColA: { value: new THREE.Color() }, uColB: { value: new THREE.Color() },
      uLight: { value: new THREE.Vector3() }, uCenter: { value: new THREE.Vector3() }, uRadius: { value: 1 },
      uN: { value: new THREE.Vector3(0, 1, 0) }, uFade: { value: 1 }, uSunI: { value: 2.4 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uIn, uOut, uSeed, uRadius, uFade, uSunI;
      uniform vec3 uColA, uColB, uLight, uCenter, uN;
      varying vec3 vW;
      ${RING_FN}
      float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
      void main() {
        float r = distance(vW, uCenter) / uRadius;
        float dens = ringDensity(r, uIn, uOut, uSeed);
        float t = (r - uIn) / (uOut - uIn);
        float fine = 0.75 + 0.25 * h1(floor(t * 900.0));
        dens *= fine;
        if (dens < 0.01) discard;
        vec3 L = normalize(uLight);
        vec3 albedo = mix(uColA, uColB, 0.5 + 0.5 * sin(t * 40.0 + uSeed));
        float light = 0.15 + 0.85 * abs(dot(L, uN));
        vec3 V = normalize(cameraPosition - vW);
        bool sameSide = dot(V, uN) * dot(L, uN) > 0.0;
        if (!sameSide) light *= 0.35 + 0.4 * (1.0 - dens);  // back-lit ring is dimmer
        // planet shadow
        vec3 oc = uCenter - vW;
        float tca = dot(oc, L);
        if (tca > 0.0) {
          float d2 = dot(oc, oc) - tca * tca;
          float rr = uRadius * uRadius;
          light *= smoothstep(rr * 0.97, rr * 1.03, d2);
        }
        gl_FragColor = vec4(albedo * light * uSunI * 0.9 * uFade, dens * 0.92);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(geo, mat);
}

/* =====================================================================
   PALETTES
   ===================================================================== */
const GAS = [
  { a: '#c9a27a', b: '#e9d9bf', c: '#9b6b46', atmo: '#e8c99a' },     // Jupiter-like
  { a: '#d8c79a', b: '#f1e6c8', c: '#b59a66', atmo: '#f0e0b0' },     // Saturn-like
  { a: '#7fb3c8', b: '#a9d3e0', c: '#5c8fa8', atmo: '#9fd6ff' },     // ice giant
  { a: '#3f5fb8', b: '#6f8ee0', c: '#2b3f80', atmo: '#7fa6ff' },     // Neptune-like
  { a: '#a8735a', b: '#d9b49a', c: '#6e4535', atmo: '#e0a080' },     // rust giant
];
const ROCK = [
  { a: '#6e655c', b: '#9a9087', c: '#4a433d', atmo: '#000000' },     // grey moon
  { a: '#8a4b2e', b: '#c07a4f', c: '#5a2f1e', atmo: '#e08a60' },     // Mars-like
  { a: '#b49a72', b: '#d8c39b', c: '#7a6448', atmo: '#e8cf9a' },     // desert
  { a: '#4b4b52', b: '#78757a', c: '#2d2c31', atmo: '#000000' },     // basalt
];
const OCEAN = [
  { a: '#123a6b', b: '#4d6b35', c: '#9b8a62', atmo: '#5fa2ff' },     // Earth-like
  { a: '#0f4a5a', b: '#7a7458', c: '#c8b98a', atmo: '#6fd0ff' },     // teal ocean
];
const RINGC = [
  ['#c9b89a', '#8f7d63'], ['#b8b3aa', '#6d6a66'], ['#d7c7a5', '#a48f6c'], ['#a9b8c4', '#6b7a88'],
];
const SUN_COLORS = ['#ffd2a1', '#fff1de', '#ffe6c4', '#cbd9ff', '#ffb98a'];

/* =====================================================================
   ENCOUNTERS — each type is pooled and re-randomised when re-used.
   ===================================================================== */
const sunDir = new THREE.Vector3(0.5, 0.3, 0.8).normalize();
const dirLight = new THREE.DirectionalLight(0xfff0dd, 2.6);
scene.add(dirLight);
scene.add(new THREE.AmbientLight(0x1a1f2b, 0.25));

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/* ---------- Planet system ---------- */
function buildPlanetSystem() {
  const group = new THREE.Group();
  const planetMat = makePlanetMaterial();
  const planet = new THREE.Mesh(sphereGeo, planetMat);
  const atmoMat = makeAtmoMaterial();
  const atmo = new THREE.Mesh(sphereGeo, atmoMat);
  const ring = makeRing();
  const sun = makeSunSprite();
  const moons = [0, 1].map(() => new THREE.Mesh(sphereGeo, makePlanetMaterial()));
  group.add(planet, atmo, ring, sun, ...moons);
  scene.add(group);

  const st = { R: 10, spin: 0.02, moonData: [] };
  const obj = {
    type: 'planet', group, active: false, anchor: 0, behind: 60,
    place(z) {
      const kind = rnd() < 0.5 ? 0 : rnd() < 0.5 ? 1 : 2;
      const pal = kind === 0 ? pick(GAS) : kind === 1 ? pick(ROCK) : pick(OCEAN);
      const R = kind === 0 ? range(16, 30) : kind === 1 ? range(6, 12) : range(8, 14);
      st.R = R;
      const side = sideSign();
      const pos = new THREE.Vector3(pathX(z) + side * (R + range(12, 30)), pathY(z) + range(-0.6, 0.6) * R, z);
      group.position.copy(pos);
      group.rotation.set(0, 0, 0);
      obj.anchor = z;
      obj.behind = R * 3 + 40;

      // light direction: from beside/behind so we see crescents and full phases
      const L = new THREE.Vector3(-side * range(0.2, 1.0), range(-0.35, 0.5), range(-0.8, 0.9)).normalize();
      const sunI = range(2.0, 2.8);
      const u = planetMat.uniforms;
      u.uType.value = kind;
      u.uSeed.value = range(0, 100);
      u.uColA.value.set(pal.a); u.uColB.value.set(pal.b); u.uColC.value.set(pal.c);
      u.uAtmo.value.set(pal.atmo).multiplyScalar(kind === 1 && pal.atmo === '#000000' ? 0 : 0.6);
      u.uLight.value.copy(L);
      u.uSunI.value = sunI;
      u.uRadius.value = R;
      u.uBump.value = 1;
      planet.scale.setScalar(R);
      st.spin = range(0.01, 0.04) * (kind === 0 ? 2 : 1);

      // atmosphere shell
      const hasAtmo = !(kind === 1 && pal.atmo === '#000000');
      atmo.visible = hasAtmo;
      const k = kind === 0 ? 1.035 : 1.025;
      atmo.scale.setScalar(R * k);
      atmoMat.uniforms.uAtmo.value.set(pal.atmo).multiplyScalar(0.7);
      atmoMat.uniforms.uLight.value.copy(L);
      atmoMat.uniforms.uInner.value = Math.sqrt(1 - 1 / (k * k));

      // rings
      const hasRing = kind === 0 && rnd() < 0.75;
      ring.visible = hasRing;
      u.uHasRing.value = hasRing ? 1 : 0;
      if (hasRing) {
        const rin = range(1.25, 1.5), rout = rin + range(0.7, 1.3);
        const rc = pick(RINGC);
        const tilt = new THREE.Euler(range(-0.5, 0.5) + Math.PI / 2, range(-0.4, 0.4), range(-0.5, 0.5));
        ring.rotation.copy(tilt);
        ring.scale.setScalar(R);
        // RingGeometry spans radius 1..2 in its own units; reshape via shader radius limits
        ring.geometry.dispose();
        ring.geometry = new THREE.RingGeometry(rin, rout, 256, 1);
        const n = new THREE.Vector3(0, 0, 1).applyEuler(tilt).normalize();
        const ru = ring.material.uniforms;
        ru.uIn.value = rin; ru.uOut.value = rout; ru.uSeed.value = range(0, 10);
        ru.uColA.value.set(rc[0]); ru.uColB.value.set(rc[1]);
        ru.uLight.value.copy(L); ru.uRadius.value = R; ru.uN.value.copy(n); ru.uSunI.value = sunI;
        u.uRingN.value.copy(n); u.uRingIn.value = rin; u.uRingOut.value = rout;
        planet.rotation.copy(tilt);
        planet.rotateX(-Math.PI / 2);
      } else {
        planet.rotation.set(range(-0.4, 0.4), 0, range(-0.4, 0.4));
      }

      // sun far away along the light direction
      const sunDist = 1800;
      sun.position.copy(L).multiplyScalar(sunDist);
      sun.scale.setScalar(range(260, 420));
      sun.material.uniforms.uColor.value.set(pick(SUN_COLORS));

      // moons
      st.moonData = [];
      moons.forEach((m, i) => {
        const show = i === 0 ? rnd() < 0.8 : rnd() < 0.4;
        m.visible = show;
        if (!show) return;
        const mr = R * range(0.12, 0.25);
        const mpal = pick(ROCK);
        const mu = m.material.uniforms;
        mu.uType.value = 1; mu.uSeed.value = range(0, 100);
        mu.uColA.value.set(mpal.a); mu.uColB.value.set(mpal.b); mu.uColC.value.set(mpal.c);
        mu.uAtmo.value.set(0x000000); mu.uLight.value.copy(L); mu.uSunI.value = sunI; mu.uRadius.value = mr; mu.uHasRing.value = 0;
        m.scale.setScalar(mr);
        st.moonData.push({ m, dist: R * range(2.6, 4.5), ang: range(0, Math.PI * 2), speed: range(0.01, 0.03) * sideSign(), incl: range(-0.3, 0.3) });
      });
      obj.light = L;
    },
    update(dt, t) {
      const d = camera.position.distanceTo(group.position);
      const fade = 1 - THREE.MathUtils.smoothstep(d, 1600, 2600);
      planet.rotateY(st.spin * dt);
      const u = planetMat.uniforms;
      u.uFade.value = fade; u.uTime.value = t;
      u.uCenter.value.copy(group.position);
      atmoMat.uniforms.uFade.value = fade;
      ring.material.uniforms.uFade.value = fade;
      ring.material.uniforms.uCenter.value.copy(group.position);
      sun.material.uniforms.uFade.value = fade;
      sun.material.uniforms.uTime.value = t;
      st.moonData.forEach((md) => {
        md.ang += md.speed * dt;
        md.m.position.set(Math.cos(md.ang) * md.dist, Math.sin(md.ang) * md.dist * md.incl, Math.sin(md.ang) * md.dist);
        md.m.rotation.y += 0.02 * dt;
        const mu = md.m.material.uniforms;
        mu.uFade.value = fade;
        mu.uCenter.value.copy(md.m.position).add(group.position);
      });
    },
  };
  return obj;
}

/* ---------- Galaxy ---------- */
function buildGalaxy() {
  const group = new THREE.Group();
  const arms = 2;
  const twist = 2.6;
  const n = Q.galaxy;
  const warm = col('#ffd9a8'), blue = col('#a9c3ff'), white = col('#e9eeff'), pink = col('#ff6f9c'), old = col('#ffe7c4');
  const starsGeo = pointsGeometry(n, (i, v, c, s) => {
    const kind = rnd();
    if (kind < 0.25) {
      // bulge
      const r = Math.abs(gauss()) * 0.11;
      const a = rnd() * Math.PI * 2;
      const e = gauss() * 0.6;
      v.set(Math.cos(a) * r, e * r * 0.7, Math.sin(a) * r);
      c.copy(warm).lerp(old, rnd());
      s.size = range(0.25, 0.6);
    } else if (kind < 0.4) {
      // inter-arm disc (older stars)
      const r = 0.05 + Math.pow(rnd(), 0.8) * 0.95;
      const a = rnd() * Math.PI * 2;
      v.set(Math.cos(a) * r, gauss() * 0.015, Math.sin(a) * r);
      c.copy(old).lerp(white, rnd() * 0.5);
      s.size = range(0.2, 0.45);
    } else {
      // spiral arms
      const r = 0.07 + Math.pow(rnd(), 0.85) * 0.93;
      const arm = Math.floor(rnd() * arms);
      let a = (arm / arms) * Math.PI * 2 + Math.log(r / 0.07) * twist;
      a += gauss() * (0.18 + 0.12 * r);
      const rr = r + gauss() * 0.025;
      v.set(Math.cos(a) * rr, gauss() * 0.01, Math.sin(a) * rr);
      const k = rnd();
      if (k < 0.05) { c.copy(pink); s.size = range(0.6, 1.1); }
      else { c.copy(blue).lerp(white, rnd() * 0.7); s.size = range(0.25, 0.6); }
    }
  });
  const starsMat = localPointsMaterial();
  const starPts = new THREE.Points(starsGeo, starsMat);
  starPts.frustumCulled = false;

  const dustGeo = pointsGeometry(Math.floor(n * 0.35), (i, v, c, s) => {
    const r = 0.1 + Math.pow(rnd(), 0.9) * 0.85;
    const arm = Math.floor(rnd() * arms);
    let a = (arm / arms) * Math.PI * 2 + Math.log(r / 0.07) * twist - 0.22;
    a += gauss() * 0.08;
    v.set(Math.cos(a) * r, gauss() * 0.004, Math.sin(a) * r);
    c.set(0.012, 0.008, 0.006);
    s.size = range(0.6, 1.2);
  });
  const dustMat = localPointsMaterial(THREE.NormalBlending, true);
  const dustPts = new THREE.Points(dustGeo, dustMat);
  dustPts.frustumCulled = false;
  dustPts.renderOrder = 5;

  const discMat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 1 }, uTwist: { value: twist }, uArms: { value: arms }, uI: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uFade, uTwist, uArms, uI;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float arm = 0.5 + 0.5 * cos(uArms * (a - log(max(r, 0.02) / 0.07) * uTwist));
        arm = pow(arm, 3.0);
        float disc = exp(-r * 4.2) * (0.35 + 0.9 * arm * smoothstep(0.04, 0.25, r));
        float core = exp(-r * r * 180.0) * 2.2 + exp(-r * 18.0) * 0.6;
        vec3 c = mix(vec3(1.0, 0.82, 0.6), vec3(0.62, 0.74, 1.0), smoothstep(0.05, 0.5, r));
        vec3 colr = c * disc * 0.16 + vec3(1.0, 0.86, 0.66) * core * 0.5;
        colr *= smoothstep(1.0, 0.8, r);
        gl_FragColor = vec4(colr * uFade * uI, 1.0);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.frustumCulled = false;

  const inner = new THREE.Group();
  inner.add(disc, starPts, dustPts);
  group.add(inner);
  scene.add(group);

  const st = { scale: 150, spin: 0.002 };
  return {
    type: 'galaxy', group, active: false, anchor: 0, behind: 300,
    place(z) {
      const side = sideSign();
      st.scale = range(160, 300);
      group.position.set(pathX(z) + side * (st.scale * 1.15 + range(60, 220)), pathY(z) + range(-120, 120), z);
      group.scale.setScalar(st.scale);
      const normal = new THREE.Vector3(range(-0.6, 0.6), range(0.2, 1.0) * sideSign(), range(0.4, 1.0)).normalize();
      group.quaternion.setFromUnitVectors(UP, normal);
      inner.rotation.y = range(0, Math.PI * 2);
      st.spin = range(0.004, 0.01) * sideSign();
      [starsMat, dustMat].forEach((m) => { m.uniforms.uScale.value = st.scale; });
      starsMat.uniforms.uBright.value = 0.55;
      dustMat.uniforms.uBright.value = 0.55;
      discMat.uniforms.uI.value = range(0.8, 1.2);
      this.anchor = z;
      this.behind = st.scale + 200;
    },
    update(dt) {
      const d = camera.position.distanceTo(group.position);
      const fade = (1 - THREE.MathUtils.smoothstep(d, 1800, 3000)) * THREE.MathUtils.smoothstep(d, st.scale * 0.35, st.scale * 0.9);
      starsMat.uniforms.uFade.value = fade;
      dustMat.uniforms.uFade.value = fade;
      discMat.uniforms.uFade.value = fade;
      inner.rotation.y += st.spin * dt;
    },
  };
}

/* ---------- Nebula ---------- */
const NEB_PALETTES = [
  { c1: '#a3102f', c2: '#1d7f86', c3: '#ff7d5e' },  // H-alpha + OIII
  { c1: '#7a3410', c2: '#24607f', c3: '#ffc27a' },  // pillars
  { c1: '#1a2f7a', c2: '#3a64c8', c3: '#a8c6ff' },  // reflection
  { c1: '#5c1060', c2: '#b0204a', c3: '#ff9fc0' },  // magenta emission
  { c1: '#0d5a4a', c2: '#2a8f6a', c3: '#b8ffd8' },  // oxygen green
];
function buildNebula() {
  const group = new THREE.Group();
  const n = Q.nebSprites;
  const geo = new THREE.PlaneGeometry(1, 1);
  const seeds = new Float32Array(n);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const vert = /* glsl */ `
    attribute float aSeed;
    uniform vec3 uCamPos;
    varying vec2 vUv;
    varying float vSeed, vFade;
    void main() {
      vUv = uv; vSeed = aSeed;
      vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float scale = length((modelMatrix * instanceMatrix)[0].xyz);
      vec4 mv = center + vec4(position.xy * scale, 0.0, 0.0);
      float d = -center.z;
      vFade = smoothstep(scale * 0.15, scale * 0.6, d);
      gl_Position = projectionMatrix * mv;
    }
  `;
  const emissMat = new THREE.ShaderMaterial({
    uniforms: { uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() }, uI: { value: 1 }, uFade: { value: 1 }, uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() } },
    vertexShader: vert,
    fragmentShader: /* glsl */ `
      uniform vec3 uC1, uC2, uC3;
      uniform float uI, uFade, uTime;
      varying vec2 vUv;
      varying float vSeed, vFade;
      ${NOISE(Q.objOct)}
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        float fall = pow(1.0 - r, 1.6);
        float a = vSeed * 6.2831;
        mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
        vec3 q = vec3(R * c * 2.4, vSeed * 13.0 + uTime * 0.004);
        vec3 w = vec3(fbm(q), fbm(q + 5.2), 0.0);
        float base = fbm(q + w * 1.4);
        float fil = ridged(q * 1.6 + w * 2.0 + 4.0);
        float dens = smoothstep(0.32, 0.8, base) * fall;
        vec3 colr = mix(uC1, uC2, smoothstep(0.35, 0.7, w.x));
        colr = colr * dens * 0.9 + uC3 * pow(fil, 3.0) * dens * 1.4;
        gl_FragColor = vec4(colr * uI * uFade * vFade, 1.0);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const dustMat = new THREE.ShaderMaterial({
    uniforms: { uFade: { value: 1 }, uTime: { value: 0 }, uCamPos: { value: new THREE.Vector3() } },
    vertexShader: vert,
    fragmentShader: /* glsl */ `
      uniform float uFade, uTime;
      varying vec2 vUv;
      varying float vSeed, vFade;
      ${NOISE(Q.objOct)}
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c) * 2.0;
        if (r > 1.0) discard;
        float fall = pow(1.0 - r, 1.2);
        vec3 q = vec3(c * 3.0, vSeed * 7.0 + 40.0);
        float d = fbm(q + fbm(q * 1.7));
        float a = smoothstep(0.42, 0.7, d) * fall * 0.85;
        gl_FragColor = vec4(vec3(0.006, 0.004, 0.003), a * uFade * vFade);
      }
    `,
    transparent: true, depthWrite: false,
  });
  const emiss = new THREE.InstancedMesh(geo, emissMat, n);
  const dustCount = Math.ceil(n * 0.5);
  const dustGeo = new THREE.PlaneGeometry(1, 1);
  const dSeeds = new Float32Array(dustCount);
  dustGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(dSeeds, 1));
  const dust = new THREE.InstancedMesh(dustGeo, dustMat, dustCount);
  emiss.frustumCulled = false; dust.frustumCulled = false;
  emiss.renderOrder = 6; dust.renderOrder = 7;

  const clusterMat = localPointsMaterial();
  const cluster = new THREE.Points(
    pointsGeometry(lowTier ? 250 : 600, (i, v, c, s) => {
      v.set(gauss() * 30, gauss() * 22, gauss() * 30);
      c.copy(pickStarColor());
      s.size = 0.25 + Math.pow(rnd(), 6) * 1.6;
    }),
    clusterMat
  );
  cluster.frustumCulled = false;
  group.add(emiss, dust, cluster);
  scene.add(group);

  const st = { size: 120 };
  return {
    type: 'nebula', group, active: false, anchor: 0, behind: 200,
    place(z) {
      const side = sideSign();
      st.size = range(110, 200);
      group.position.set(pathX(z) + side * range(st.size * 0.35, st.size * 0.8), pathY(z) + range(-40, 40), z);
      const pal = pick(NEB_PALETTES);
      emissMat.uniforms.uC1.value.set(pal.c1);
      emissMat.uniforms.uC2.value.set(pal.c2);
      emissMat.uniforms.uC3.value.set(pal.c3);
      emissMat.uniforms.uI.value = range(0.35, 0.55);
      const m = new THREE.Matrix4();
      const p = new THREE.Vector3();
      const s = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        p.set(gauss() * st.size * 0.35, gauss() * st.size * 0.22, gauss() * st.size * 0.35);
        const sc = st.size * range(0.35, 0.8);
        s.set(sc, sc, sc);
        m.compose(p, tmpQ.identity(), s);
        emiss.setMatrixAt(i, m);
        seeds[i] = rnd();
      }
      for (let i = 0; i < dustCount; i++) {
        p.set(gauss() * st.size * 0.3, gauss() * st.size * 0.2, gauss() * st.size * 0.3 + st.size * 0.1);
        const sc = st.size * range(0.25, 0.6);
        s.set(sc, sc, sc);
        m.compose(p, tmpQ.identity(), s);
        dust.setMatrixAt(i, m);
        dSeeds[i] = rnd();
      }
      emiss.instanceMatrix.needsUpdate = true;
      dust.instanceMatrix.needsUpdate = true;
      geo.attributes.aSeed.needsUpdate = true;
      dustGeo.attributes.aSeed.needsUpdate = true;
      clusterMat.uniforms.uScale.value = 60;
      clusterMat.uniforms.uBright.value = 1.6;
      this.anchor = z;
      this.behind = st.size + 60;
    },
    update(dt, t) {
      const d = camera.position.distanceTo(group.position);
      const fade = 1 - THREE.MathUtils.smoothstep(d, 1200, 2000);
      emissMat.uniforms.uFade.value = fade;
      emissMat.uniforms.uTime.value = t;
      dustMat.uniforms.uFade.value = fade;
      clusterMat.uniforms.uFade.value = fade;
    },
  };
}

/* ---------- Star (binary or lone sun with a cluster) ---------- */
function buildStar() {
  const group = new THREE.Group();
  const a = makeSunSprite();
  const b = makeSunSprite();
  const clusterMat = localPointsMaterial();
  const cluster = new THREE.Points(
    pointsGeometry(lowTier ? 400 : 1200, (i, v, c, s) => {
      const r = Math.pow(rnd(), 1.8) * 90;
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
      const k = Math.sqrt(1 - u * u);
      v.set(k * Math.cos(th) * r, u * r * 0.8, k * Math.sin(th) * r);
      c.copy(pickStarColor());
      s.size = 0.25 + Math.pow(rnd(), 5) * 1.8;
    }),
    clusterMat
  );
  cluster.frustumCulled = false;
  group.add(a, b, cluster);
  scene.add(group);
  const st = { orbit: 0, sep: 0, binary: false };
  return {
    type: 'star', group, active: false, anchor: 0, behind: 160,
    place(z) {
      const side = sideSign();
      group.position.set(pathX(z) + side * range(60, 140), pathY(z) + range(-50, 50), z);
      a.scale.setScalar(range(90, 160));
      a.material.uniforms.uColor.value.set(pick(SUN_COLORS));
      st.binary = rnd() < 0.5;
      b.visible = st.binary;
      b.scale.setScalar(range(50, 90));
      b.material.uniforms.uColor.value.set(pick(SUN_COLORS));
      st.sep = range(8, 18);
      st.orbit = range(0, Math.PI * 2);
      clusterMat.uniforms.uScale.value = 80;
      clusterMat.uniforms.uBright.value = 1.4;
      this.anchor = z;
    },
    update(dt, t) {
      const d = camera.position.distanceTo(group.position);
      const fade = 1 - THREE.MathUtils.smoothstep(d, 1400, 2400);
      st.orbit += dt * 0.15;
      const ox = Math.cos(st.orbit) * st.sep, oz = Math.sin(st.orbit) * st.sep;
      a.position.set(st.binary ? -ox * 0.35 : 0, 0, st.binary ? -oz * 0.35 : 0);
      b.position.set(ox, 0, oz);
      a.material.uniforms.uFade.value = fade;
      b.material.uniforms.uFade.value = fade;
      a.material.uniforms.uTime.value = t;
      b.material.uniforms.uTime.value = t + 1.7;
      clusterMat.uniforms.uFade.value = fade;
    },
  };
}

/* ---------- Asteroid field (you fly through it) ---------- */
function rockGeometry(seedOffset) {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const stretch = new THREE.Vector3(range(0.6, 1.0), range(0.5, 0.9), range(0.8, 1.3));
  const k1 = range(1.5, 3), k2 = range(4, 7);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n1 = Math.sin(v.x * k1 + seedOffset) * Math.cos(v.y * k1 * 1.3 + seedOffset * 2) * Math.sin(v.z * k1 * 0.7);
    const n2 = Math.sin(v.x * k2 + 1.3) * Math.sin(v.y * k2 + seedOffset) * Math.sin(v.z * k2 + 2.1);
    const r = 1 + n1 * 0.22 + n2 * 0.08;
    v.multiplyScalar(r).multiply(stretch);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function buildAsteroids() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.96, metalness: 0.0, flatShading: true });
  const types = 3;
  const per = Math.ceil(Q.asteroids / types);
  const meshes = [];
  for (let k = 0; k < types; k++) {
    const m = new THREE.InstancedMesh(rockGeometry(k * 3.7), mat, per);
    m.frustumCulled = false;
    meshes.push(m);
    group.add(m);
  }
  scene.add(group);
  const rocks = [];
  const dummy = new THREE.Object3D();
  return {
    type: 'asteroids', group, active: false, anchor: 0, behind: 80,
    place(z) {
      group.position.set(0, 0, 0);
      rocks.length = 0;
      const len = 380;
      const tint = new THREE.Color().setHSL(range(0.05, 0.1), range(0.05, 0.2), range(0.35, 0.5));
      mat.color.copy(tint);
      meshes.forEach((m) => {
        for (let i = 0; i < per; i++) {
          const rz = z - rnd() * len;
          const ang = rnd() * Math.PI * 2;
          const big = rnd() < 0.04;
          const rad = big ? range(28, 80) : 6 + Math.pow(rnd(), 0.7) * 70;
          rocks.push({
            m, i,
            pos: new THREE.Vector3(pathX(rz) + Math.cos(ang) * rad, pathY(rz) + Math.sin(ang) * rad * 0.6, rz),
            rot: new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6),
            spin: new THREE.Vector3(range(-0.4, 0.4), range(-0.4, 0.4), range(-0.4, 0.4)),
            scale: big ? range(4, 9) : 0.2 + Math.pow(rnd(), 3) * 2.6,
          });
        }
      });
      // light from a random sun direction
      this.light = new THREE.Vector3(range(-1, 1), range(-0.2, 0.8), range(-1, 0.6)).normalize();
      this.anchor = z;
      this.behind = len + 60;
    },
    update(dt) {
      for (const r of rocks) {
        r.rot.x += r.spin.x * dt; r.rot.y += r.spin.y * dt; r.rot.z += r.spin.z * dt;
        dummy.position.copy(r.pos);
        dummy.rotation.copy(r.rot);
        dummy.scale.setScalar(r.scale);
        dummy.updateMatrix();
        r.m.setMatrixAt(r.i, dummy.matrix);
      }
      meshes.forEach((m) => (m.instanceMatrix.needsUpdate = true));
    },
  };
}


/* =====================================================================
   SCHEDULER — keeps the universe going forever
   ===================================================================== */
const HERO = CINEMA ? {} : makeHeroes({
  THREE, NOISE, SKY_GLSL, rnd, range, pick, sideSign, gauss, pathX, pathY,
  makeSunSprite, rockGeometry, Q, lowTier, scene, camera, skyUniforms: skyMat.uniforms,
});
const HERO_TYPES = ['blackhole', 'comet', 'dyson', 'pulsar', 'pillars', 'supernova', 'cannibal', 'rogue', 'crystals'];
const pools = CINEMA ? {} : {
  planet: [buildPlanetSystem(), buildPlanetSystem(), buildPlanetSystem(), buildPlanetSystem()],
  galaxy: [buildGalaxy(), buildGalaxy()],
  nebula: [buildNebula(), buildNebula(), buildNebula()],
  star: [buildStar(), buildStar()],
  asteroids: [buildAsteroids()],
};
if (!CINEMA) HERO_TYPES.forEach((t) => { pools[t] = [HERO[t]()]; });
Object.values(pools).flat().forEach((o) => (o.group.visible = false));

const ONLY = params.get('only');
const WEIGHTS = [['planet', 0.36], ['nebula', 0.22], ['galaxy', 0.16], ['star', 0.14], ['asteroids', 0.12]];
let lastType = '';
// heroes come in a shuffled cycle so every one appears before any repeats
let heroQueue = [];
function nextHero() {
  if (!heroQueue.length) {
    heroQueue = HERO_TYPES.slice();
    for (let i = heroQueue.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [heroQueue[i], heroQueue[j]] = [heroQueue[j], heroQueue[i]]; }
    if (heroQueue[0] === lastType) heroQueue.push(heroQueue.shift());
  }
  return heroQueue.shift();
}
let sinceHero = 1;
const HERO_EVERY = 2;
function chooseType() {
  if (ONLY) return pools[ONLY] && pools[ONLY].some((o) => !o.active) ? ONLY : null;
  if (!CINEMA && sinceHero >= HERO_EVERY) {
    for (let k = 0; k < HERO_TYPES.length; k++) {
      const h = nextHero();
      if (pools[h].some((o) => !o.active)) return h;
    }
  }
  for (let tries = 0; tries < 10; tries++) {
    let r = rnd(), acc = 0, type = 'planet';
    for (const [t, w] of WEIGHTS) { acc += w; if (r <= acc) { type = t; break; } }
    if (type === lastType) continue;
    if (pools[type].some((o) => !o.active)) return type;
  }
  return Object.keys(pools).find((t) => !HERO_TYPES.includes(t) && pools[t].some((o) => !o.active)) || null;
}

const active = [];
let camZ = 0;
let nextZ = -320;
const AHEAD = CINEMA ? 1800 : 2600;
const BASE_SPEED = params.has('speed') ? parseFloat(params.get('speed')) : reduceMotion ? 6 : 42;
const SPACING = { planet: [280, 420], nebula: [300, 460], galaxy: [240, 380], star: [220, 320], asteroids: [440, 560] };
const HERO_SPACING = [900, 1150];

function spawn(type, z) {
  const obj = pools[type].find((o) => !o.active);
  if (!obj) return false;
  obj.place(z);
  obj.active = true;
  obj.group.visible = true;
  active.push(obj);
  lastType = type;
  const isHero = HERO_TYPES.includes(type);
  sinceHero = isHero ? 0 : sinceHero + 1;
  const sp = isHero ? HERO_SPACING : SPACING[type];
  nextZ = z - range(sp[0], sp[1]);
  return true;
}

// Opening: a ringed giant up close, then the black hole as the first set-piece.
(function opening() {
  if (ONLY || CINEMA) { nextZ = -400; return; }
  const p = pools.planet[0];
  let guard = 0;
  do { p.place(-260); guard++; } while ((p.group.children[2].visible === false) && guard < 30);
  p.active = true; p.group.visible = true; active.push(p); lastType = 'planet';
  heroQueue = ['blackhole'];
  sinceHero = HERO_EVERY;
  nextZ = -260 - 600;
})();

function schedule() {
  for (let i = active.length - 1; i >= 0; i--) {
    const o = active[i];
    if (o.anchor - camZ > o.behind + 900) {
      o.active = false;
      o.group.visible = false;
      active.splice(i, 1);
    }
  }
  if (CINEMA) return;
  let guard = 0;
  while (nextZ > camZ - AHEAD && guard++ < 4) {
    const t = chooseType();
    if (!t || !spawn(t, nextZ)) { nextZ -= 150; break; }
  }
}

/* ---------- Floating origin: keep numbers small forever ---------- */
const REBASE = 5000; // multiple of both wrap depths (625, 125)
function rebase() {
  camZ += REBASE;
  nextZ += REBASE;
  zShift -= REBASE;
  for (const o of active) {
    o.anchor += REBASE;
    if (o.type === 'asteroids') {
      o.group.position.z += REBASE;
    } else {
      o.group.position.z += REBASE;
    }
  }
}

/* =====================================================================
   POST-PROCESSING
   ===================================================================== */
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Q.pr);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.55, 0.92);
composer.addPass(bloom);
const finalPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2() } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      vec2 off = c * d * 0.012;
      vec3 colr = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      colr *= 1.0 - d * 0.9;
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 61.7, vec2(12.9898, 78.233))) * 43758.5453);
      colr += (g - 0.5) * 0.006;
      gl_FragColor = vec4(max(colr, 0.0), 1.0);
    }
  `,
});
composer.addPass(finalPass);
composer.addPass(new OutputPass());

/* ---------- Tap / click anywhere: go full screen ---------- */
function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' })
      : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null;
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* not supported (e.g. iPhone Safari) */ }
}
addEventListener('click', goFullscreen);
addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'Enter') goFullscreen(); });

/* =====================================================================
   INPUT & RESIZE
   ===================================================================== */
const mouse = new THREE.Vector2();
const mouseS = new THREE.Vector2();
addEventListener('pointermove', (e) => mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1));
// Scroll / swipe / keys drive the flight: down = rush forward, up = brake and drift back.
let impulse = 0;
const clampImpulse = () => { impulse = Math.max(-BASE_SPEED - 170, Math.min(impulse, 320)); };
addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  impulse += e.deltaY * unit * 0.32;
  clampImpulse();
}, { passive: false });
let touchY = null;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (touchY === null) return;
  const y = e.touches[0].clientY;
  impulse += (touchY - y) * 1.3;
  touchY = y;
  clampImpulse();
}, { passive: true });
addEventListener('touchend', () => { touchY = null; }, { passive: true });
addEventListener('keydown', (e) => {
  if (['ArrowDown', 'PageDown', ' ', 'ArrowRight'].includes(e.key)) impulse += 70;
  if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key)) impulse -= 70;
  clampImpulse();
});

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  finalPass.uniforms.uRes.value.set(innerWidth * Q.pr, innerHeight * Q.pr);
  skyMat.uniforms.uPx.value = (camera.fov * Math.PI / 180) / (innerHeight * renderer.getPixelRatio());
}
addEventListener('resize', resize);
resize();

/* =====================================================================
   LOOP
   ===================================================================== */
const cinema = CINEMA ? (await import('./cinema.js?v=1')).makeCinema() : null;
let cover = 0;
let time = 0;
let travel = 0;
let speed = BASE_SPEED;
const look = new THREE.Vector3();
const focusLook = new THREE.Vector3();
const focusTarget = new THREE.Vector3();
let focusW = 0;

function step(dt) {
  time += dt;
  impulse *= Math.exp(-dt * 1.1);
  speed += (BASE_SPEED * (1 - 0.35 * focusW) + impulse - speed) * Math.min(1, dt * 4);
  const fovT = 60 + THREE.MathUtils.clamp((speed - BASE_SPEED) * 0.07, -5, 22);
  if (Math.abs(camera.fov - fovT) > 0.01) { camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  camZ -= speed * dt;
  travel += Math.abs(speed) * dt;
  if (camZ < -REBASE) rebase();
  schedule();

  mouseS.lerp(mouse, reduceMotion ? 0 : 0.03);
  const x = pathX(camZ), y = pathY(camZ);
  camera.position.set(x, y, camZ);
  const ahead = camZ - 60;
  look.set(pathX(ahead) + mouseS.x * 14, pathY(ahead) + mouseS.y * 8, ahead);
  // turn toward the set-piece we're passing, then settle back onto the path
  let wT = 0;
  for (const o of active) {
    if (!o.hero || !o.focus || !o.focus.strength) continue;
    const relZ = camZ - o.anchor;
    const f = o.focus;
    const w = (1 - THREE.MathUtils.smoothstep(relZ, f.near, f.far)) * THREE.MathUtils.smoothstep(relZ, -f.after, f.near * 0.15) * f.strength;
    if (w > wT) { wT = w; o.focusPoint(focusTarget); }
  }
  if (wT > 0.001) focusLook.lerp(focusTarget, focusW < 0.01 ? 1 : Math.min(1, dt * 3));
  focusW += (wT - focusW) * Math.min(1, dt * 2.5);
  if (focusW > 0.001) look.lerp(focusLook, focusW);
  camera.lookAt(look);
  const bank = (pathX(camZ - 30) - x) * 0.012;
  camera.rotateZ(-bank);

  for (const o of active) o.update(dt, time);
  if (cinema) cover = cinema.update(dt, speed / BASE_SPEED);

  // lights for the rocks follow the nearest light source
  let nearest = null, nd = Infinity;
  for (const o of active) {
    if (!o.light) continue;
    const dd = Math.abs(o.anchor - camZ);
    if (dd < nd) { nd = dd; nearest = o; }
  }
  if (nearest) dirLight.position.copy(nearest.light);
}

function render() {
  camera.updateMatrixWorld();
  skyMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
  skyMat.uniforms.uCamRot.value.setFromMatrix4(camera.matrixWorld);
  skyMat.uniforms.uTravel.value = travel;
  [stars, spaceDust].forEach((s) => {
    s.material.uniforms.uCam.value.copy(camera.position);
    s.material.uniforms.uTime.value = time;
  });
  scene.traverse((o) => { if (o.userData.billboard && o.visible) o.quaternion.copy(camera.quaternion); });
  // billboards inside rotated groups need the parent's rotation removed
  scene.traverse((o) => {
    if (o.userData.billboard && o.parent && o.parent !== scene) {
      o.parent.getWorldQuaternion(tmpQ);
      o.quaternion.copy(tmpQ.invert().multiply(camera.quaternion));
    }
  });
  finalPass.uniforms.uTime.value = time;
  composer.render();
}

// optional fast-forward for previews: ?t=seconds
const skip = parseFloat(params.get('t') || '0');
for (let s = 0; s < skip * 20; s++) step(0.05);
step(0);

const clock = new THREE.Clock();
let frames = 0, acc = 0, adapted = false, prNow = Q.pr;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  step(dt);
  if (!(cover > 0.995 && innerHeight > innerWidth)) render();
  if (!adapted) {
    frames++; acc += dt;
    if (frames === 120) {
      adapted = true;
      if (acc / frames > 0.024 && prNow > 0.8) {
        prNow = Math.max(0.75, prNow * 0.75);
        renderer.setPixelRatio(prNow);
        composer.setPixelRatio(prNow);
        resize();
      }
    }
  }
  requestAnimationFrame(frame);
}
try { renderer.compile(scene, camera); } catch (e) { /* ignore */ }
if (CAPTURE) {
  document.documentElement.classList.add('ready');
  const fade = document.getElementById('fade'); if (fade) fade.style.display = 'none';
  window.__cap = { frame(dt) { step(dt); render(); return true; } };
} else {
  requestAnimationFrame(() => {
    frame();
    setTimeout(() => document.documentElement.classList.add('ready'), 300);
  });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });
