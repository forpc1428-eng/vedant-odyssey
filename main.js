import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { makeExtraScenes } from './extra.js?v=4';

/* =====================================================================
   ODYSSEY — Vedant's journey through space.
   1 Earth orbit · 2 Ring skim · 3 Gargantua · 4 Red eclipse
   5 Blue vortex · 6 Galaxy fall · then back to Earth, forever.
   URL options: ?scene=0..5  ?t=0..1  ?low
   ===================================================================== */

const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const lowTier = params.has('low') || coarse || Math.min(innerWidth, innerHeight) < 600 || (navigator.hardwareConcurrency || 8) <= 4;
const Q = lowTier
  ? { pr: Math.min(devicePixelRatio || 1, 1.0), bhSteps: 110, oct: 4, rocks: 220, steps: 30 }
  : { pr: Math.min(devicePixelRatio || 1, 1.5), bhSteps: 200, oct: 5, rocks: 520, steps: 52 };

const HIDE = (params.get('hide') || '').split(',');
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const C3 = (r, g, b) => new THREE.Color(r, g, b);

/* ---------- Renderer ---------- */
const canvas = document.getElementById('webgl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.autoClear = true;

/* ---------- GLSL helpers ---------- */
const NOISE = (oct) => /* glsl */ `
  #define OCT ${oct}
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  vec3 hash3(vec3 p) { return vec3(hash(p), hash(p + 17.31), hash(p + 41.97)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < OCT; i++) { s += a * noise(p); p = p * 2.02 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
`;

// Background stars + faint Milky Way, as a function of view direction.
const SKY_FN = /* glsl */ `
  vec3 starTemp(float t) {
    vec3 a = vec3(0.62, 0.72, 1.0), b = vec3(1.0, 0.96, 0.92), c = vec3(1.0, 0.78, 0.55);
    return t < 0.5 ? mix(a, b, t * 2.0) : mix(b, c, t * 2.0 - 1.0);
  }
  vec3 starLayer(vec3 d, float scale, float density, float bright, float px) {
    vec3 p = d * scale; vec3 id = floor(p); vec3 f = fract(p);
    float h = hash(id);
    if (h > density) return vec3(0.0);
    vec3 c = hash3(id + 3.1) * 0.6 + 0.2;
    float dist = length(f - c) / scale;
    float sigma = px * 0.6;
    float b = exp(-dist * dist / (sigma * sigma));
    float mag = pow(hash(id + 9.7), 6.0);
    return starTemp(hash(id + 5.3)) * b * (0.05 + mag * bright);
  }
  vec3 skyColor(vec3 d, float px, float milky) {
    vec3 col = vec3(0.0);
    vec3 n = normalize(vec3(0.28, 0.9, 0.33));
    float lat = dot(d, n);
    float band = exp(-lat * lat / 0.03);
    float cl = fbm(d * 3.5 + 2.0);
    float dust = smoothstep(0.42, 0.72, fbm(d * 7.0 + vec3(cl * 1.5) + 11.0));
    col += mix(vec3(1.0, 0.82, 0.62), vec3(0.7, 0.8, 1.0), cl) * band * (0.3 + cl) * (1.0 - dust * 0.85) * 0.05 * milky;
    col += starLayer(d, 210.0, 0.012, 6.0, px);
    col += starLayer(d, 470.0, 0.004 + band * 0.08 * milky, 2.0, px) * 0.4;
    col += starLayer(d, 880.0, 0.001 + band * 0.12 * milky, 0.8, px) * 0.25;
    return col;
  }
`;

// Ray direction for a fullscreen quad, from camera matrices.
const RAY_FN = /* glsl */ `
  uniform mat4 uInvProj;
  uniform mat3 uCamRot;
  vec3 rayDir(vec2 uv) {
    vec4 v = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    return normalize(uCamRot * normalize(v.xyz / v.w));
  }
`;

const QUAD_VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }`;

function fullscreenMesh(mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = -100;
  return m;
}
function syncRay(u, cam) {
  cam.updateMatrixWorld();
  u.uInvProj.value.copy(cam.projectionMatrixInverse);
  u.uCamRot.value.setFromMatrix4(cam.matrixWorld);
  if (u.uPx) u.uPx.value = (cam.fov * Math.PI / 180) / (innerHeight * renderer.getPixelRatio());
}

function makeSky(milky = 1) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uPx: { value: 0.001 }, uMilky: { value: milky } },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform float uPx, uMilky; varying vec2 vUv;
      ${RAY_FN}
      ${NOISE(Q.oct)}
      ${SKY_FN}
      void main(){ gl_FragColor = vec4(skyColor(rayDir(vUv), uPx, uMilky), 1.0); }
    `,
    depthTest: false, depthWrite: false,
  });
  return fullscreenMesh(mat);
}

/* ---------- Sun sprite ---------- */
function makeSun(color, size, flare = 1) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uFlare: { value: flare }, uI: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uFlare, uI; varying vec2 vUv;
      void main(){
        vec2 c = (vUv - 0.5) * 2.0; float r = length(c);
        float core = exp(-r * r * 1400.0) * 9.0;
        float inner = exp(-r * 45.0) * 2.2;
        float glow = exp(-r * 8.0) * 0.35 + exp(-r * 2.5) * 0.06;
        float ana = exp(-abs(c.y) * 160.0) * exp(-abs(c.x) * 1.6) * 0.9 * uFlare;
        float spikes = (exp(-abs(c.y) * 260.0) * exp(-abs(c.x) * 7.0) + exp(-abs(c.x) * 260.0) * exp(-abs(c.y) * 7.0)) * 0.9;
        vec3 col = uColor * (inner + glow + ana + spikes) + vec3(1.0) * core;
        gl_FragColor = vec4(col * smoothstep(1.0, 0.75, r) * uI, 1.0);
      }
    `,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.scale.setScalar(size);
  m.frustumCulled = false;
  m.userData.billboard = true;
  return m;
}

/* =====================================================================
   SCENE 1 — EARTH ORBIT
   ===================================================================== */
function buildEarth() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 6000);
  const sky = makeSky(0.6);
  scene.add(sky);

  const R = 60, C = V3(0, -R - 4.5, -32);
  const sunDir = V3(-0.82, 0.32, 0.05).normalize();
  const U = { uSun: { value: sunDir }, uC: { value: C }, uTime: { value: 0 }, uR: { value: R } };

  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 192), new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uC; uniform float uTime; varying vec3 vW;
      ${NOISE(Q.oct + 1)}
      void main(){
        vec3 n = normalize(vW - uC);
        vec3 V = normalize(cameraPosition - vW);
        float ca = cos(uTime * 0.006), sa = sin(uTime * 0.006);
        vec3 m = vec3(n.x, -n.z, n.y);
        vec3 q = vec3(ca * m.x - sa * m.z, m.y, sa * m.x + ca * m.z);
        float c = fbm(q * 1.7 + 3.0) * 0.72 + fbm(q * 5.5) * 0.28;
        float land = smoothstep(0.5, 0.514, c);
        float dtl = fbm(q * 22.0);
        vec3 ocean = mix(vec3(0.004, 0.018, 0.055), vec3(0.008, 0.05, 0.11), smoothstep(0.35, 0.51, c));
        ocean = mix(ocean, vec3(0.02, 0.13, 0.16), smoothstep(0.495, 0.512, c) * 0.8);
        float lat = abs(q.y);
        vec3 ground = mix(vec3(0.05, 0.08, 0.03), vec3(0.34, 0.25, 0.14), smoothstep(0.45, 0.6, fbm(q * 3.0 + 7.0)) * (1.0 - smoothstep(0.45, 0.8, lat)));
        ground = mix(ground, vec3(0.16, 0.14, 0.12), smoothstep(0.6, 0.78, dtl) * 0.6);
        ground = mix(ground, vec3(0.85, 0.88, 0.92), smoothstep(0.8, 0.86, lat + dtl * 0.08));
        vec3 alb = mix(ocean, ground * (0.75 + 0.5 * dtl), land);
        vec3 cq = q * 3.2 + vec3(uTime * 0.003, 0.0, 0.0);
        float cl = fbm(cq + 1.7 * fbm(cq * 1.8 + 2.0));
        float clouds = smoothstep(0.56, 0.8, cl) * (0.55 + 0.45 * smoothstep(0.3, 0.65, fbm(cq * 7.0)));
        alb = mix(alb, vec3(0.92), clouds * 0.92);
        float NdL = dot(n, uSun);
        float term = smoothstep(-0.1, 0.22, NdL);
        vec3 col = alb * max(NdL, 0.0) * 2.1 * term;
        vec3 H = normalize(uSun + V);
        col += vec3(1.0, 0.88, 0.7) * pow(max(dot(n, H), 0.0), 140.0) * (1.0 - land) * (1.0 - clouds) * 4.0 * term;
        float night = 1.0 - smoothstep(-0.2, 0.03, NdL);
        float city = smoothstep(0.8, 0.97, noise(q * 1400.0)) * smoothstep(0.45, 0.7, fbm(q * 9.0)) * land * (1.0 - clouds);
        col += vec3(1.0, 0.62, 0.28) * city * night * 0.9;
        float fr = pow(1.0 - max(dot(n, V), 0.0), 2.4);
        col = mix(col, vec3(0.2, 0.45, 1.0) * (term * 1.1 + 0.02), fr * 0.55);
        col += vec3(1.0, 0.42, 0.12) * exp(-pow(NdL / 0.05, 2.0)) * fr * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }));
  earth.position.copy(C);
  scene.add(earth);

  const k = 1.016;
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * k, 160, 120), new THREE.ShaderMaterial({
    uniforms: { ...U, uInner: { value: Math.sqrt(1 - 1 / (k * k)) } },
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun, uC; uniform float uInner; varying vec3 vW;
      void main(){
        vec3 n = normalize(vW - uC); vec3 V = normalize(cameraPosition - vW);
        float d = clamp(-dot(n, V), 0.0, 1.0);
        float i = pow(smoothstep(0.0, uInner, d), 1.8);
        float sunSide = smoothstep(-0.35, 0.35, dot(n, uSun));
        float fwd = pow(max(dot(-V, uSun), 0.0), 10.0);
        vec3 col = mix(vec3(0.25, 0.52, 1.0), vec3(1.0, 0.55, 0.22), fwd) * i * (sunSide * 1.3 + 0.02 + fwd * 2.0);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  atmo.position.copy(C);
  scene.add(atmo);
  if (HIDE.includes('atmo')) atmo.visible = false;
  if (HIDE.includes('earth')) earth.visible = false;

  const sun = makeSun(C3(1.0, 0.86, 0.68), 900, 1.2);
  sun.position.copy(V3(-0.75, 0.22, -0.62).normalize()).multiplyScalar(2400);
  scene.add(sun);
  if (HIDE.includes('sun')) sun.visible = false;


  return {
    scene, cam,
    update(t, time) {
      U.uTime.value = time;
      cam.position.set(Math.sin(time * 0.05) * 0.12, 0.25 - t * 0.2, 4.2 - t * 0.8);
      cam.lookAt(0, -1.1 + t * 0.2, -30);
      syncRay(sky.material.uniforms, cam);
    },
  };
}

/* =====================================================================
   SCENE 2 — SKIMMING THE RINGS
   ===================================================================== */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = 1 + Math.sin(v.x * 3 + seed) * Math.cos(v.y * 4 + seed * 2) * 0.18 + Math.sin(v.z * 7 + seed) * 0.07;
    v.multiplyScalar(r);
    v.y *= 0.75;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildRings() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 8000);
  const sky = makeSky(0.4);
  scene.add(sky);

  const Rp = 300, Rin = 390, Rout = 1150, rc = 640;
  const thetaMid = 0.6;
  const fwdMid = V3(-Math.sin(thetaMid), 0, Math.cos(thetaMid));
  const leftMid = V3(Math.cos(thetaMid), 0, Math.sin(thetaMid)); // away from the planet
  const sunDir = fwdMid.clone().multiplyScalar(1).add(leftMid.clone().multiplyScalar(0.9)).add(V3(0, 0.1, 0)).normalize();
  const U = { uSun: { value: sunDir }, uTime: { value: 0 }, uRp: { value: Rp }, uRin: { value: Rin }, uRout: { value: Rout } };

  // planet
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(Rp, 192, 144), new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uTime, uRin, uRout; varying vec3 vW;
      ${NOISE(Q.oct)}
      void main(){
        vec3 p = normalize(vW); vec3 V = normalize(cameraPosition - vW);
        float t1 = fbm(p * 2.5 + 3.0);
        float t2 = fbm(vec3(p.x * 6.0, p.y * 30.0, p.z * 6.0) + vec3(uTime * 0.004, 0.0, 0.0));
        float lat = p.y + (t1 - 0.5) * 0.1 + (t2 - 0.5) * 0.025;
        vec3 a = vec3(0.62, 0.45, 0.28), b = vec3(0.88, 0.76, 0.56), c = vec3(0.45, 0.3, 0.18);
        vec3 alb = mix(a, b, 0.5 + 0.5 * sin(lat * 30.0));
        alb = mix(alb, c, (0.5 + 0.5 * sin(lat * 74.0 + 1.0)) * 0.4);
        alb *= 0.85 + 0.3 * t2;
        float NdL = dot(p, uSun);
        float term = smoothstep(-0.06, 0.25, NdL);
        vec3 col = alb * max(NdL, 0.0) * 1.25 * term;
        // ring shadow on the planet
        float tt = -vW.y / uSun.y;
        if (tt > 0.0) { vec3 h = vW + uSun * tt; float r = length(h.xz); if (r > uRin && r < uRout) col *= 0.35; }
        float fr = pow(1.0 - max(dot(p, V), 0.0), 3.0);
        col += vec3(0.9, 0.7, 0.45) * fr * term * 0.35;
        // faint ringshine on the night side
        col += alb * 0.012;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })));

  // rings — one huge plane, detail computed per pixel
  const ring = new THREE.Mesh(new THREE.PlaneGeometry(2 * Rout, 2 * Rout, 1, 1), new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun; uniform float uTime, uRp, uRin, uRout; varying vec3 vW;
      ${NOISE(Q.oct)}
      float n1(float x) { return noise(vec3(x, 0.37, 0.71)); }
      void main(){
        float r = length(vW.xz);
        float t = (r - uRin) / (uRout - uRin);
        if (t < 0.0 || t > 1.0) discard;
        float phi = atan(vW.z, vW.x);
        float arc = phi * r;
        float b = 0.42 + 0.22 * n1(r * 0.05) + 0.18 * n1(r * 0.4) + 0.12 * n1(r * 2.6) + 0.08 * n1(r * 14.0);
        b *= smoothstep(0.0, 0.03, t) * smoothstep(1.0, 0.92, t);
        b *= 1.0 - 0.92 * smoothstep(0.52, 0.535, t) * (1.0 - smoothstep(0.58, 0.595, t));
        float dCam = length(vW - cameraPosition);
        float streak = fbm(vec3(r * 3.0, arc * 0.012, 1.0));
        float near = fbm(vec3(r * 14.0, arc * 0.05, 4.0)) * (1.0 - smoothstep(10.0, 80.0, dCam));
        float dens = b * (0.55 + 0.6 * streak + 0.4 * near);
        float sh = smoothstep(0.3, 0.8, streak + near * 0.35); vec3 alb = mix(vec3(0.16, 0.12, 0.09), vec3(0.88, 0.8, 0.68), sh * sh);
        float light = 0.2 + 0.8 * abs(uSun.y) * 4.0;
        // planet shadow
        vec3 oc = -vW; float tca = dot(oc, uSun);
        if (tca > 0.0) { float d2 = dot(oc, oc) - tca * tca; light *= smoothstep(uRp * uRp * 0.96, uRp * uRp * 1.04, d2); }
        vec3 col = alb * light * 0.8;
        float a = clamp(dens * dens * 1.6, 0.0, 0.97);
        gl_FragColor = vec4(col, a);
      }
    `,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);

  // ice chunks rushing past
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.75, metalness: 0, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeometry(1.3), rockMat, Q.rocks);
  rocks.frustumCulled = false;
  scene.add(rocks);
  const light = new THREE.DirectionalLight(0xfff0dd, 3.2);
  light.position.copy(sunDir);
  scene.add(light, new THREE.HemisphereLight(0x8a7a66, 0x000000, 0.35));
  const bits = [];
  for (let i = 0; i < Q.rocks; i++) bits.push({ dth: Math.random() * 0.17 - 0.02, dr: (Math.random() - 0.5) * 60, y: Math.pow(Math.random(), 2) * 2.6 - 0.25, s: 0.04 + Math.pow(Math.random(), 5) * 0.6, rx: Math.random() * 6, ry: Math.random() * 6 });
  const dummy = new THREE.Object3D();

  const sun = makeSun(C3(1.0, 0.92, 0.8), 700, 1.0);
  sun.position.copy(sunDir).multiplyScalar(4000);
  scene.add(sun);


  let thetaPrev = 0;
  return {
    scene, cam,
    update(t, time) {
      U.uTime.value = time;
      const th = 0.35 + t * 0.5 + time * 0.004;
      const pos = V3(rc * Math.cos(th), 3.2 + Math.sin(time * 0.5) * 0.25, rc * Math.sin(th));
      const fwd = V3(-Math.sin(th), 0, Math.cos(th));
      const inward = V3(-Math.cos(th), 0, -Math.sin(th));
      cam.position.copy(pos);
      cam.lookAt(pos.clone().add(fwd.clone().multiplyScalar(100)).add(inward.clone().multiplyScalar(78)).add(V3(0, -14, 0)));
      // recycle rocks relative to the camera's angle
      for (let i = 0; i < bits.length; i++) {
        const b = bits[i];
        let a = b.th === undefined ? th + b.dth : b.th;
        if (a - th < -0.02) a += 0.19;
        if (a - th > 0.17) a -= 0.19;
        b.th = a;
        const rr = rc + b.dr;
        dummy.position.set(rr * Math.cos(a), b.y, rr * Math.sin(a));
        dummy.rotation.set(b.rx + time * 0.3, b.ry + time * 0.2, 0);
        dummy.scale.setScalar(b.s);
        dummy.updateMatrix();
        rocks.setMatrixAt(i, dummy.matrix);
      }
      rocks.instanceMatrix.needsUpdate = true;
      thetaPrev = th;
      syncRay(sky.material.uniforms, cam);
    },
  };
}

/* =====================================================================
   SCENES 3 & 4 — BLACK HOLE with gravitational lensing
   (null geodesics integrated per pixel: a = -1.5 h² x / r⁵)
   ===================================================================== */
function blackHoleMaterial(opts) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uPx: { value: 0.001 },
      uCamPos: { value: new THREE.Vector3() }, uTime: { value: 0 },
      uHot: { value: opts.hot }, uWarm: { value: opts.warm }, uCool: { value: opts.cool }, uGlow: { value: opts.glow },
      uRin: { value: 3.0 }, uRout: { value: opts.rout }, uI: { value: opts.intensity },
      uPlanet: { value: opts.planet || new THREE.Vector4(0, 0, 0, 0) },
    },
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform float uPx, uTime, uRin, uRout, uI;
      uniform vec3 uCamPos, uHot, uWarm, uCool, uGlow;
      uniform vec4 uPlanet;
      varying vec2 vUv;
      ${RAY_FN}
      ${NOISE(Q.oct)}
      ${SKY_FN}
      vec4 disk(vec3 q, vec3 dir) {
        float r = length(q.xz);
        if (r < uRin || r > uRout) return vec4(0.0);
        float x = (r - uRin) / (uRout - uRin);
        float phi = atan(q.z, q.x);
        float omega = 2.2 / pow(r, 1.5);
        float ph = phi + uTime * omega;
        float lr = log(r);
        float n = fbm(vec3(cos(ph) * 2.2, sin(ph) * 2.2, lr * 9.0));
        float fine = noise(vec3(cos(ph) * 6.0, sin(ph) * 6.0, lr * 40.0));
        float bands = 0.65 + 0.35 * noise(vec3(r * 5.0, 0.3, 0.7));
        float den = smoothstep(0.0, 0.06, x) * pow(1.0 - x, 1.6);
        float T = pow(uRin / r, 1.1);
        vec3 c = mix(uCool, uWarm, smoothstep(0.1, 0.55, T));
        c = mix(c, uHot, smoothstep(0.55, 1.0, T));
        vec3 vel = normalize(vec3(-q.z, 0.0, q.x)) * sqrt(0.5 / r);
        float dop = max(1.0 + 2.4 * dot(vel, -dir), 0.12);
        float I = den * (0.25 + 1.1 * n * bands + 0.35 * fine) * (0.4 + 1.6 * T) * pow(dop, 3.0) * uI;
        float a = clamp(den * (0.45 + 0.6 * n), 0.0, 0.95);
        return vec4(c * I, a);
      }
      void main(){
        vec3 rd = rayDir(vUv);
        vec3 p = uCamPos;
        vec3 v = rd;
        vec3 hv = cross(p, v);
        float h2 = dot(hv, hv);
        vec3 col = vec3(0.0);
        float trans = 1.0;
        bool captured = false;
        for (int i = 0; i < ${Q.bhSteps}; i++) {
          float r2 = dot(p, p);
          float r = sqrt(r2);
          if (r < 1.0) { captured = true; break; }
          float dt = clamp(0.07 * r, 0.02, 2.0);
          vec3 acc = -1.5 * h2 * p / (r2 * r2 * r);
          v += acc * dt;
          vec3 pn = p + v * dt;
          if (p.y * pn.y < 0.0) {
            float f = p.y / (p.y - pn.y);
            vec3 q = mix(p, pn, f);
            vec4 d = disk(q, normalize(v));
            col += d.rgb * trans;
            trans *= 1.0 - d.a;
            if (trans < 0.02) break;
          }
          if (uPlanet.w > 0.0) {
            vec3 dp = pn - uPlanet.xyz;
            if (dot(dp, dp) < uPlanet.w * uPlanet.w) {
              vec3 nrm = normalize(dp);
              float lit = max(dot(nrm, normalize(-uPlanet.xyz)), 0.0);
              col += trans * (uWarm * pow(lit, 2.0) * 0.9 + vec3(0.004));
              captured = true;
              break;
            }
          }
          p = pn;
          if (r > 80.0 && dot(p, v) > 0.0) break;
        }
        if (!captured) {
          vec3 d = normalize(v);
          vec3 bg = skyColor(d, uPx, 0.35);
          bg += uGlow * pow(max(dot(rd, normalize(-uCamPos)), 0.0), 5.0) * 0.35;
          col += bg * trans;
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false, depthWrite: false,
  });
}

function buildGargantua() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.05, 1000);
  const aMid = 0.55;
  const camMid = V3(Math.sin(aMid) * 24, 1.2, Math.cos(aMid) * 24);
  const right = V3(Math.cos(aMid), 0, -Math.sin(aMid));
  const planetPos = right.clone().multiplyScalar(-6.5).add(V3(0, 3.6, 0)).add(camMid.clone().normalize().multiplyScalar(6));
  const mat = blackHoleMaterial({
    hot: C3(1.0, 0.93, 0.8), warm: C3(1.0, 0.62, 0.25), cool: C3(0.65, 0.22, 0.05), glow: C3(0.12, 0.07, 0.04),
    rout: 13.0, intensity: 1.0, planet: new THREE.Vector4(planetPos.x, planetPos.y, planetPos.z, 0.32),
  });
  const quad = fullscreenMesh(mat);
  scene.add(quad);


  return {
    scene, cam,
    update(t, time) {
      const a = 0.3 + t * 0.5 + time * 0.003;
      const dist = 26 - t * 5;
      const el = 0.05 + Math.sin(time * 0.07) * 0.015;
      cam.position.set(Math.sin(a) * dist * Math.cos(el), dist * Math.sin(el), Math.cos(a) * dist * Math.cos(el));
      cam.lookAt(0, -0.4, 0);
      cam.rotateZ(-0.08);
      mat.uniforms.uTime.value = time;
      mat.uniforms.uCamPos.value.copy(cam.position);
      syncRay(mat.uniforms, cam);
    },
  };
}

function buildRedEclipse() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 1000);
  const mat = blackHoleMaterial({
    hot: C3(1.0, 0.72, 0.6), warm: C3(1.0, 0.14, 0.05), cool: C3(0.42, 0.18, 0.12), glow: C3(0.9, 0.05, 0.02),
    rout: 16.0, intensity: 0.9,
  });
  scene.add(fullscreenMesh(mat));


  return {
    scene, cam,
    update(t, time) {
      const a = 2.2 + t * 0.6 + time * 0.004;
      const dist = 25 - t * 4;
      const el = 0.42 + Math.sin(time * 0.06) * 0.04;
      cam.position.set(Math.sin(a) * dist * Math.cos(el), dist * Math.sin(el), Math.cos(a) * dist * Math.cos(el));
      cam.lookAt(0, 1.5, 0);
      cam.rotateZ(0.32);
      mat.uniforms.uTime.value = time;
      mat.uniforms.uCamPos.value.copy(cam.position);
      syncRay(mat.uniforms, cam);
    },
  };
}

/* =====================================================================
   SCENE 5 — BLUE VORTEX
   ===================================================================== */
function buildVortex() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100);
  cam.position.set(0, 0, 0);
  const U = { uTime: { value: 0 }, uAspect: { value: innerWidth / innerHeight }, uCenter: { value: new THREE.Vector2(-0.04, 0.06) }, uT: { value: 0 } };
  const quad = fullscreenMesh(new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAspect, uT; uniform vec2 uCenter; varying vec2 vUv;
      ${NOISE(Q.oct)}
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        vec2 d = p - uCenter;
        d = mat2(0.92, -0.38, 0.38, 0.92) * d;
        d.y *= 1.35;
        float r = length(d);
        float a = atan(d.y, d.x);
        float lr = log(r + 1e-4);
        float sw = a - lr * 1.7 + uTime * 0.32;
        float n = fbm(vec3(cos(sw) * 1.1, sin(sw) * 1.1, lr * 13.0 - uTime * 0.9));
        float fine = fbm(vec3(cos(sw) * 4.5, sin(sw) * 4.5, lr * 26.0 - uTime * 1.5));
        float s = 0.55 * n + 0.45 * fine;
        float bright = smoothstep(1.7, 0.1, r);
        vec3 deep = vec3(0.03, 0.08, 0.32), mid = vec3(0.3, 0.5, 0.95), pale = vec3(0.82, 0.9, 1.0);
        vec3 col = mix(deep, mid, smoothstep(0.32, 0.66, s));
        col = mix(col, pale, smoothstep(0.52, 0.86, s) * bright);
        col *= 0.18 + 1.5 * bright;
        float rh = 0.085;
        col *= smoothstep(rh, rh + 0.015, r);
        col += vec3(0.85, 0.93, 1.0) * exp(-pow((r - rh - 0.004) / 0.004, 2.0)) * 1.8 * smoothstep(-1.0, 1.0, sin(a - 0.6));
        float edge = smoothstep(0.35, 1.25, dot(p, normalize(vec2(1.0, 0.85))));
        col = mix(col, vec3(0.0, 0.005, 0.02), edge);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false, depthWrite: false,
  }));
  scene.add(quad);


  return {
    scene, cam,
    update(t, time) {
      U.uTime.value = time;
      U.uAspect.value = cam.aspect;
      U.uT.value = t;
    },
  };
}

/* =====================================================================
   SCENE 6 — FALLING INTO THE GALAXY
   ===================================================================== */
function buildGalaxy() {
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 100);
  const U = { uTime: { value: 0 }, uAspect: { value: innerWidth / innerHeight }, uZoom: { value: 0 } };
  scene.add(fullscreenMesh(new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: QUAD_VS,
    fragmentShader: /* glsl */ `
      uniform float uTime, uAspect, uZoom; varying vec2 vUv;
      ${NOISE(Q.oct)}
      vec3 galaxy(vec2 p, float rot) {
        float r = length(p);
        float a = atan(p.y, p.x) + rot + 0.35 / (r + 0.15) * uTime * 0.04;
        float lr = log(r + 1e-3);
        float arm = 0.5 + 0.5 * cos(2.0 * (a + lr * 2.6));
        arm = pow(arm, 1.6);
        float sw = a + lr * 2.6;
        float n = fbm(vec3(cos(sw) * 2.0 + lr * 1.5, sin(sw) * 2.0, lr * 4.0));
        float fine = fbm(vec3(cos(sw) * 6.0, sin(sw) * 6.0, lr * 14.0));
        float den = arm * (0.35 + 0.9 * n) + fine * 0.25;
        vec3 outer = vec3(0.12, 0.1, 0.42), magenta = vec3(0.85, 0.3, 0.7), pale = vec3(1.0, 0.92, 0.9);
        vec3 c = mix(outer, magenta, smoothstep(0.45, 0.85, n + fine * 0.2));
        c = mix(c, pale, smoothstep(0.75, 1.15, den) * smoothstep(1.4, 0.2, r));
        c *= den;
        float dust = smoothstep(0.55, 0.8, fbm(vec3(cos(sw - 0.25) * 3.0, sin(sw - 0.25) * 3.0, lr * 8.0)));
        c *= 1.0 - dust * 0.6 * arm;
        c *= smoothstep(2.2, 0.15, r) * 1.4;
        c += vec3(1.0, 0.85, 0.65) * (exp(-r * 9.0) * 2.4 + exp(-r * 3.0) * 0.25);
        // stars
        vec2 g = p * 90.0; vec2 id = floor(g);
        float h = hash(vec3(id, 3.0));
        if (h > 0.985) { vec2 f = fract(g) - 0.5; c += vec3(0.9, 0.9, 1.0) * exp(-dot(f, f) * 60.0) * (h - 0.985) * 120.0 * smoothstep(1.8, 0.3, r); }
        return c;
      }
      void main(){
        vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
        float z = uZoom;
        float f = fract(z);
        // two layers for a seamless endless zoom
        vec3 a = galaxy(p * exp2(-f) * 1.4, uTime * 0.05);
        vec3 b = galaxy(p * exp2(1.0 - f) * 1.4, uTime * 0.05);
        vec3 col = mix(a, b, smoothstep(0.0, 1.0, f));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false, depthWrite: false,
  })));


  return {
    scene, cam,
    update(t, time) {
      U.uTime.value = time;
      U.uAspect.value = cam.aspect;
      U.uZoom.value = time * 0.06 + t * 1.5;
    },
  };
}

/* =====================================================================
   SCENE MIX PASS — renders the current scene (and the next one during
   transitions) and blends them with a light-speed warp.
   ===================================================================== */
class SceneMixPass extends Pass {
  constructor() {
    super();
    const opts = { type: THREE.HalfFloatType };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.a = null; this.b = null; this.mix = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tA: { value: null }, tB: { value: null }, uMix: { value: 0 }, uWarp: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tA, tB; uniform float uMix, uWarp, uTime, uAspect; varying vec2 vUv;
        float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        vec3 blurred(sampler2D t, vec2 uv, float amt) {
          vec2 c = uv - 0.5; vec3 s = vec3(0.0);
          for (int i = 0; i < 10; i++) { float k = 1.0 - amt * float(i) / 10.0; s += texture2D(t, 0.5 + c * k).rgb; }
          return s / 10.0;
        }
        void main(){
          float amt = uWarp * 0.22;
          vec3 A = amt > 0.001 ? blurred(tA, vUv, amt) : texture2D(tA, vUv).rgb;
          vec3 col = A;
          if (uMix > 0.001) { vec3 B = blurred(tB, vUv, amt); col = mix(A, B, uMix); }
          vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
          float r = length(c); float ang = atan(c.y, c.x);
          float id = floor(ang * 180.0);
          float s = h1(id);
          float streak = smoothstep(0.9, 1.0, s) * smoothstep(0.08, 0.7, r);
          float run = fract(r * (1.0 + s * 2.0) - uTime * (2.0 + s * 3.0));
          streak *= smoothstep(0.0, 0.25, run) * smoothstep(1.0, 0.4, run);
          vec3 sc = mix(vec3(0.6, 0.75, 1.0), vec3(1.0, 0.7, 0.5), h1(id + 3.0));
          col += sc * streak * uWarp * 2.2;
          col += vec3(0.9, 0.95, 1.0) * pow(uWarp, 4.0) * 0.6 * smoothstep(0.9, 0.0, r);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  setSize(w, h) { this.rtA.setSize(w, h); this.rtB.setSize(w, h); this.mat.uniforms.uAspect.value = w / h; }
  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.rtA); renderer.clear();
    renderer.render(this.a.scene, this.a.cam);
    if (this.mix > 0.001 && this.b) {
      renderer.setRenderTarget(this.rtB); renderer.clear();
      renderer.render(this.b.scene, this.b.cam);
    }
    this.mat.uniforms.tA.value = this.rtA.texture;
    this.mat.uniforms.tB.value = this.rtB.texture;
    this.mat.uniforms.uMix.value = this.mix;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

/* =====================================================================
   BOOT
   ===================================================================== */
const X = makeExtraScenes({ THREE, NOISE, SKY_FN, RAY_FN, QUAD_VS, fullscreenMesh, syncRay, Q });
const SCENES = [
  buildEarth(), X.ocean, buildRings(), X.aurora, X.comet, buildGargantua(), X.crystal, X.pulsar, X.crimson,
  buildRedEclipse(), X.cannibal, X.violet, X.dyson, X.diamond, X.rogue, X.nursery, X.catseye, X.supernova,
  X.ember, buildVortex(), X.merger, X.quasar, X.web, buildGalaxy(), X.wormhole, X.timeedge, X.bigbang,
];
const N = SCENES.length;

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Q.pr);
composer.setSize(innerWidth, innerHeight);
const mixPass = new SceneMixPass();
composer.addPass(mixPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 1.05);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * d * 0.014;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - d * 0.95;
      float g = fract(sin(dot(vUv * uRes + fract(uTime) * 71.3, vec2(12.9898, 78.233))) * 43758.5453);
      col += (g - 0.5) * 0.008;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

/* ---------- Input: scroll / swipe / keys move through the journey ---------- */
let progress = params.has('scene') ? parseFloat(params.get('scene')) + parseFloat(params.get('t') || '0.3') : 0.02;
let vel = 0;
const AUTO = reduceMotion ? 0.012 : 0.045; // scenes per second when idle
addEventListener('wheel', (e) => {
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  vel += e.deltaY * unit * 0.00028;
  vel = THREE.MathUtils.clamp(vel, -0.6, 0.6);
}, { passive: false });
let touchY = null;
addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
addEventListener('touchmove', (e) => {
  if (touchY === null) return;
  const y = e.touches[0].clientY;
  vel += (touchY - y) * 0.0011;
  vel = THREE.MathUtils.clamp(vel, -0.6, 0.6);
  touchY = y;
}, { passive: true });
addEventListener('touchend', () => { touchY = null; }, { passive: true });
addEventListener('keydown', (e) => {
  if (['ArrowDown', 'PageDown', ' ', 'ArrowRight'].includes(e.key)) vel += 0.12;
  if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key)) vel -= 0.12;
  if (e.key === 'f' || e.key === 'Enter') goFullscreen();
});
function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null;
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* unsupported */ }
}
addEventListener('click', goFullscreen);

/* ---------- Resize ---------- */
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  SCENES.forEach((s) => { s.cam.aspect = w / h; s.cam.fov = w / h < 0.8 ? s.cam.userData.fov0 * 1.25 : s.cam.userData.fov0; s.cam.updateProjectionMatrix(); });
  grade.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
}
SCENES.forEach((s) => { s.cam.userData.fov0 = s.cam.fov; });
addEventListener('resize', resize);
resize();

/* ---------- Loop ---------- */
window.__goto = (p) => { progress = p; vel = 0; };
const TRANS = 0.14; // last part of each scene blends into the next
const clock = new THREE.Clock();
let time = 0;
const camQ = new THREE.Quaternion();

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;
  vel *= Math.exp(-dt * 1.4);
  progress += (AUTO + vel) * dt;

  const i = ((Math.floor(progress) % N) + N) % N;
  const t = progress - Math.floor(progress);
  const cur = SCENES[i];
  const nxt = SCENES[(i + 1) % N];
  cur.update(t, time);
  const m = THREE.MathUtils.smoothstep(t, 1 - TRANS, 1.0);
  if (m > 0.001) nxt.update(0, time);

  for (const s of m > 0.001 ? [cur, nxt] : [cur]) {
    s.cam.updateMatrixWorld();
    s.cam.getWorldQuaternion(camQ);
    s.scene.traverse((o) => { if (o.userData.billboard) o.quaternion.copy(camQ); });
  }

  mixPass.a = cur; mixPass.b = nxt; mixPass.mix = m;
  mixPass.mat.uniforms.uWarp.value = Math.sin(Math.PI * m) * (reduceMotion ? 0.3 : 1);
  mixPass.mat.uniforms.uTime.value = time;
  grade.uniforms.uTime.value = time;
  composer.render(dt);
  requestAnimationFrame(frame);
}

// warm up shaders
for (const s of SCENES) { s.update(0.3, 0); try { renderer.compile(s.scene, s.cam); } catch (e) { /* ignore */ } }
requestAnimationFrame(() => {
  frame();
  setTimeout(() => document.documentElement.classList.add('ready'), 400);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) clock.getDelta(); });
