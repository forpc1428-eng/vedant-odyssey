/* =====================================================================
   ODYSSEY — 17 more original scenes, each drawn per pixel in a shader.
   ===================================================================== */
export function makeExtraScenes(ctx) {
  const { THREE, NOISE, SKY_FN, RAY_FN, QUAD_VS, fullscreenMesh, syncRay, Q } = ctx;

  const COMMON = /* glsl */ `
    mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
    float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
    vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
    float jit(vec2 uv) { return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453); }
    vec2 sph(vec3 ro, vec3 rd, vec3 c, float r) {
      vec3 oc = ro - c; float b = dot(oc, rd); float k = dot(oc, oc) - r * r; float h = b * b - k;
      if (h < 0.0) return vec2(-1.0); h = sqrt(h); return vec2(-b - h, -b + h);
    }
  `;

  function shaderScene({ frag, cam: camFn, fov = 55, uniforms = {}, onUpdate }) {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.1, 1000);
    const U = {
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uPx: { value: 0.001 },
      uTime: { value: 0 }, uT: { value: 0 }, uAspect: { value: 1 }, uCamPos: { value: new THREE.Vector3() },
      ...uniforms,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `
        uniform float uPx, uTime, uT, uAspect; uniform vec3 uCamPos; varying vec2 vUv;
        #define STEPS ${Q.steps}
        ${RAY_FN}
        ${NOISE(Q.oct)}
        ${SKY_FN}
        ${COMMON}
        ${frag}
        void main(){
          vec3 rd = rayDir(vUv);
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
          gl_FragColor = vec4(max(shade(uCamPos, rd, vUv, p), 0.0), 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });
    scene.add(fullscreenMesh(mat));
    return {
      scene, cam,
      update(t, time) {
        camFn(cam, t, time);
        cam.updateMatrixWorld();
        U.uTime.value = time; U.uT.value = t; U.uAspect.value = cam.aspect;
        U.uCamPos.value.copy(cam.position);
        if (onUpdate) onUpdate(U, t, time);
        syncRay(U, cam);
      },
    };
  }
  const look = (cam, x, y, z, tx, ty, tz, roll = 0) => { cam.position.set(x, y, z); cam.lookAt(tx, ty, tz); if (roll) cam.rotateZ(roll); };
  const orbit = (cam, r, a, el, ty = 0, roll = 0) => look(cam, Math.sin(a) * r * Math.cos(el), r * Math.sin(el), Math.cos(a) * r * Math.cos(el), 0, ty, 0, roll);

  const S = {};

  /* ---------- 7 · AURORA SEA ---------- */
  S.aurora = shaderScene({
    fov: 62,
    cam: (c, t, time) => { const z = -(time * 9 + t * 420); look(c, Math.sin(time * 0.07) * 4, 6.5, z, Math.sin(time * 0.07) * 4 + 2, 9, z - 40, Math.sin(time * 0.1) * 0.05); },
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.25) * 0.7;
        if (rd.y > 0.0) {
          float t0 = max((3.0 - ro.y) / rd.y, 0.0), t1 = min((44.0 - ro.y) / rd.y, 400.0);
          float dt = (t1 - t0) / float(STEPS);
          vec3 acc = vec3(0.0);
          float j = jit(uv * 731.0 + fract(uTime));
          for (int i = 0; i < STEPS; i++) {
            float t = t0 + dt * (float(i) + j);
            vec3 q = ro + rd * t;
            float w = fbm(vec3(q.x * 0.012, q.z * 0.008, uTime * 0.04)) * 7.0;
            float band = sin(q.x * 0.035 + w + q.z * 0.003);
            float rib = exp(-band * band * 60.0) + 0.15 * exp(-band * band * 8.0);
            float h = (q.y - 3.0) / 41.0;
            float vert = smoothstep(0.0, 0.04, h) * exp(-h * 3.2);
            vec3 c = mix(vec3(0.15, 1.0, 0.5), vec3(0.55, 0.2, 1.0), smoothstep(0.08, 0.55, h));
            c = mix(c, vec3(1.0, 0.25, 0.35), smoothstep(0.55, 0.9, h) * 0.7);
            float fl = 0.55 + 0.45 * noise(vec3(q.x * 0.25, q.y * 0.04 - uTime * 1.5, q.z * 0.03));
            acc += c * rib * vert * fl * dt * exp(-t * 0.004);
          }
          col += acc * 0.012;
        } else {
          float t = -ro.y / rd.y;
          vec3 q = ro + rd * t;
          float c1 = fbm(vec3(q.xz * 0.03, uTime * 0.01));
          float c2 = fbm(vec3(q.xz * 0.12 + c1 * 2.0, 1.0));
          vec3 cloud = vec3(0.02, 0.035, 0.07) * (0.35 + c1) + vec3(0.03, 0.22, 0.12) * pow(c2, 2.0) * 0.6;
          float fog = 1.0 - exp(-t * 0.006);
          col = mix(cloud, vec3(0.02, 0.07, 0.07), fog);
        }
        return col;
      }
    `,
  });

  /* ---------- 8 · CRYSTAL NEBULA ---------- */
  S.crystal = shaderScene({
    fov: 60,
    cam: (c, t, time) => { const z = -(time * 2.5 + t * 110); look(c, Math.sin(time * 0.21) * 1.2, Math.cos(time * 0.17) * 1.0, z, Math.sin(time * 0.21 + 0.4) * 1.2, Math.cos(time * 0.17 + 0.4) * 1.0, z - 10, time * 0.05); },
    frag: /* glsl */ `
      float sdOct(vec3 p, float s) { p = abs(p); return (p.x + p.y + p.z - s) * 0.57735; }
      float mapC(vec3 p, out vec3 cid) {
        vec3 c = floor((p + 4.0) / 8.0);
        vec3 q = mod(p + 4.0, 8.0) - 4.0;
        cid = c;
        vec3 h = hash3(c + 7.0);
        if ((abs(c.x) < 0.5 && abs(c.y) < 0.5) || h.z < 0.25) return 3.0;
        q -= (h - 0.5) * 2.6;
        q.xy = rot(h.x * 6.28 + uTime * 0.05) * q.xy;
        q.yz = rot(h.y * 6.28) * q.yz;
        float stretch = 1.6 + h.x * 2.2;
        q.y /= stretch;
        return sdOct(q, 0.7 + h.y * 0.8) * 0.6;
      }
      vec3 nebula(vec3 d) {
        float n = fbm(d * 2.5 + 3.0);
        vec3 c = mix(vec3(0.05, 0.0, 0.12), vec3(0.0, 0.25, 0.35), n);
        c += vec3(0.55, 0.1, 0.45) * pow(fbm(d * 5.0 + 9.0), 3.0) * 1.2;
        return c * 0.5;
      }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 bg = nebula(rd) + skyColor(rd, uPx, 0.0);
        float t = 0.2; vec3 glow = vec3(0.0); vec3 cid; bool hit = false; float d;
        for (int i = 0; i < STEPS + 16; i++) {
          vec3 q = ro + rd * t;
          d = mapC(q, cid);
          vec3 h = hash3(cid + 7.0);
          vec3 cc = mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.35, 0.85), h.x);
          glow += cc * exp(-max(d, 0.0) * 5.0) * 0.012 * exp(-t * 0.03);
          if (d < 0.002) { hit = true; break; }
          t += d * 0.8;
          if (t > 70.0) break;
        }
        vec3 col = bg;
        if (hit) {
          vec3 q = ro + rd * t; vec3 tmp;
          vec2 e = vec2(0.002, 0.0);
          vec3 n = normalize(vec3(mapC(q + e.xyy, tmp) - mapC(q - e.xyy, tmp), mapC(q + e.yxy, tmp) - mapC(q - e.yxy, tmp), mapC(q + e.yyx, tmp) - mapC(q - e.yyx, tmp)));
          vec3 h = hash3(cid + 7.0);
          vec3 cc = mix(vec3(0.2, 0.9, 1.0), vec3(1.0, 0.35, 0.85), h.x);
          float fr = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
          vec3 refr = nebula(refract(rd, n, 0.7)) * 3.0;
          vec3 inner = cc * (0.35 + 1.2 * pow(fbm(q * 1.5 + h * 10.0), 2.0));
          col = mix(refr + inner * 0.6, vec3(0.9, 0.95, 1.0), fr * 0.7);
          col += cc * pow(max(dot(reflect(rd, n), normalize(vec3(0.3, 1.0, 0.2))), 0.0), 40.0) * 2.0;
          col = mix(col, bg, 1.0 - exp(-t * 0.03));
        }
        return col + glow;
      }
    `,
  });

  /* ---------- 9 · PULSAR LIGHTHOUSE ---------- */
  S.pulsar = shaderScene({
    fov: 55,
    uniforms: { uAxis: { value: new THREE.Vector3(0, 1, 0) } },
    cam: (c, t, time) => orbit(c, 30 - t * 8, 0.6 + t * 0.9 + time * 0.01, 0.12 + Math.sin(time * 0.05) * 0.05, 0, 0.1),
    onUpdate: (U, t, time) => { const a = 1.15, ph = time * 1.7; U.uAxis.value.set(Math.sin(a) * Math.cos(ph), Math.cos(a), Math.sin(a) * Math.sin(ph)).normalize(); },
    frag: /* glsl */ `
      uniform vec3 uAxis;
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.4);
        col += vec3(0.25, 0.1, 0.35) * pow(fbm(rd * 3.0), 3.0) * 0.4;
        float b = dot(ro, rd);
        vec2 hs = sph(ro, rd, vec3(0.0), 0.55);
        float tmax = hs.x > 0.0 ? hs.x : 1e9;
        float ta = max(-b - 22.0, 0.0), tb = min(-b + 22.0, tmax);
        float dt = (tb - ta) / float(STEPS);
        vec3 u = normalize(cross(uAxis, vec3(0.3, 1.0, 0.2)));
        vec3 v = cross(uAxis, u);
        vec3 acc = vec3(0.0);
        float j = jit(uv * 913.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 q = ro + rd * (ta + dt * (float(i) + j));
          float r = length(q);
          float ca = dot(q / r, uAxis);
          float ang = acos(min(abs(ca), 1.0));
          float beam = exp(-ang * ang / 0.0035) / (1.0 + r * 0.12) * smoothstep(0.5, 1.4, r);
          float s2 = max(1.0 - ca * ca, 1e-3);
          float L = r / s2;
          float fl = exp(-pow((L - 3.0) / 0.35, 2.0)) + exp(-pow((L - 6.0) / 0.6, 2.0)) + exp(-pow((L - 10.0) / 1.0, 2.0));
          float phi = atan(dot(q, v), dot(q, u));
          fl *= pow(abs(cos(phi * 3.0)), 30.0) * smoothstep(13.0, 2.0, r);
          acc += (vec3(0.65, 0.82, 1.0) * beam * 3.5 + vec3(0.35, 0.45, 1.0) * fl * 0.35) * dt;
        }
        col += acc;
        float dmin = sqrt(max(dot(ro, ro) - b * b, 0.0));
        if (b < 0.0) col += vec3(0.5, 0.7, 1.0) * (exp(-dmin * 1.2) * 0.9 + exp(-dmin * 6.0) * 3.0);
        if (hs.x > 0.0) {
          vec3 n = normalize(ro + rd * hs.x);
          float pole = pow(abs(dot(n, uAxis)), 20.0);
          col = vec3(0.75, 0.88, 1.0) * 2.5 + vec3(1.0) * pole * 4.0;
        }
        col += vec3(0.7, 0.85, 1.0) * pow(abs(dot(normalize(ro), uAxis)), 300.0) * 1.6;
        return col;
      }
    `,
  });

  /* ---------- 10 · STAR CANNIBAL ---------- */
  const streamPts = [];
  for (let i = 0; i < 12; i++) {
    const s = i / 11;
    const a = -Math.PI * 0.05 - s * Math.PI * 0.75;
    const r = 7.6 * (1 - s) + 3.0 * s;
    streamPts.push(new THREE.Vector3(6 + Math.cos(Math.PI + a * 0.9) * r * (1 - s * 0.1), 0.0, Math.sin(Math.PI + a * 0.9) * r * 0.75));
  }
  streamPts[0].set(-1.4, 0, 0);
  S.cannibal = shaderScene({
    fov: 52,
    uniforms: { uPts: { value: streamPts } },
    cam: (c, t, time) => { const a = 0.9 + t * 0.7 + time * 0.005; c.position.set(Math.sin(a) * 19 + 2, 6 - t * 2, Math.cos(a) * 19); c.lookAt(1.5, -0.5, 0); },
    frag: /* glsl */ `
      uniform vec3 uPts[12];
      const vec3 G = vec3(-6.0, 0.0, 0.0); const float GR = 4.6;
      const vec3 W = vec3(6.0, 0.0, 0.0);
      float segD(vec3 p, vec3 a, vec3 b, out float h) { vec3 pa = p - a, ba = b - a; h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.3);
        float tG = 1e9;
        vec2 g = sph(ro, rd, G, GR);
        // accretion disk around the companion
        vec3 dn = normalize(vec3(0.12, 1.0, 0.25));
        float td = dot(W - ro, dn) / dot(rd, dn);
        vec4 disk = vec4(0.0);
        if (td > 0.0) {
          vec3 q = ro + rd * td - W; float r = length(q);
          if (r > 0.35 && r < 3.4) {
            vec3 a1 = normalize(cross(dn, vec3(0.0, 0.0, 1.0))); vec3 a2 = cross(dn, a1);
            float ph = atan(dot(q, a2), dot(q, a1)) + uTime * 1.5 / pow(r, 1.5);
            float n = fbm(vec3(cos(ph) * 2.0, sin(ph) * 2.0, log(r) * 8.0));
            float x = (r - 0.35) / 3.05;
            vec3 c = mix(vec3(0.75, 0.85, 1.0) * 3.0, vec3(1.0, 0.45, 0.15), smoothstep(0.0, 0.7, x));
            float den = smoothstep(0.0, 0.05, x) * pow(1.0 - x, 1.4) * (0.4 + n);
            disk = vec4(c * den * 1.6, clamp(den, 0.0, 0.95));
          }
        }
        // plasma stream
        float j = jit(uv * 517.0);
        vec3 acc = vec3(0.0);
        float tEnd = min(g.x > 0.0 ? g.x : 80.0, 80.0);
        float dt = tEnd / float(STEPS);
        for (int i = 0; i < STEPS; i++) {
          vec3 q = ro + rd * dt * (float(i) + j);
          float best = 1e9; float sAt = 0.0;
          for (int k = 0; k < 11; k++) { float hh; float d = segD(q, uPts[k], uPts[k + 1], hh); if (d < best) { best = d; sAt = (float(k) + hh) / 11.0; } }
          float w = 0.25 + sAt * 0.35;
          float clump = 0.5 + 0.5 * noise(vec3(sAt * 30.0 - uTime * 3.0, q.y * 2.0, 1.0));
          acc += mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.85, 0.6), sAt) * exp(-best * best / (w * w)) * clump * dt * 2.4;
        }
        if (g.x > 0.0) {
          vec3 n = normalize(ro + rd * g.x - G);
          float mu = max(dot(n, -rd), 0.0);
          float gran = fbm(n * 7.0 + vec3(uTime * 0.05));
          vec3 c = vec3(1.0, 0.32, 0.08) * (0.6 + 0.8 * gran) * (0.35 + 0.65 * pow(mu, 0.6));
          c += vec3(1.0, 0.6, 0.25) * pow(max(dot(n, normalize(W - G)), 0.0), 6.0) * 0.6;
          col = c * 1.6;
        } else {
          float b = dot(ro - G, rd); float dmin = length(ro - G - rd * b);
          if (b < 0.0) col += vec3(1.0, 0.3, 0.1) * exp(-(dmin - GR) * 0.8) * 0.25;
        }
        if (td > 0.0 && (g.x < 0.0 || td < g.x)) col = col * (1.0 - disk.a) + disk.rgb;
        col += acc;
        float bW = dot(ro - W, rd); float dW = length(ro - W - rd * bW);
        if (bW < 0.0) col += vec3(0.7, 0.85, 1.0) * (exp(-dW * 7.0) * 6.0 + exp(-dW * 1.5) * 0.3);
        return col;
      }
    `,
  });

  /* ---------- 11 · DYSON SWARM ---------- */
  S.dyson = shaderScene({
    fov: 50,
    cam: (c, t, time) => orbit(c, 17 - t * 4, 0.2 + t * 0.8 + time * 0.01, 0.28 - t * 0.15, 0, -0.12),
    frag: /* glsl */ `
      vec4 ringHit(vec3 ro, vec3 rd, vec3 n, float R, float w, float N, float speed, float seed, out float tHit) {
        tHit = -1.0;
        float dd = dot(rd, n); if (abs(dd) < 1e-4) return vec4(0.0);
        float t = -dot(ro, n) / dd; if (t < 0.0) return vec4(0.0);
        vec3 q = ro + rd * t; float r = length(q);
        if (abs(r - R) > w) return vec4(0.0);
        vec3 a1 = normalize(cross(n, vec3(0.31, 0.7, 0.2))); vec3 a2 = cross(n, a1);
        float ang = atan(dot(q, a2), dot(q, a1)) + uTime * speed;
        float ca = ang * N / 6.2831853; float cr = (r - R + w) / (2.0 * w) * 4.0;
        vec2 cell = vec2(floor(ca), floor(cr)); vec2 f = fract(vec2(ca, cr));
        float h = hash(vec3(cell, seed));
        if (h < 0.3) return vec4(0.0);
        float inside = step(0.12, f.x) * step(f.x, 0.88) * step(0.1, f.y) * step(f.y, 0.9);
        if (inside < 0.5) return vec4(0.0);
        tHit = t;
        float glint = pow(0.5 + 0.5 * sin(uTime * (1.0 + h * 3.0) + h * 60.0 + ang * 3.0), 40.0);
        vec3 V = -rd; vec3 L = normalize(-q);
        float back = max(dot(V, L), 0.0);
        vec3 c = vec3(0.012, 0.01, 0.009) + vec3(1.0, 0.75, 0.4) * glint * 3.0 * (0.3 + back) + vec3(1.0, 0.6, 0.25) * pow(back, 8.0) * 0.08;
        return vec4(c, 1.0);
      }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.5);
        vec2 s = sph(ro, rd, vec3(0.0), 2.0);
        float b = dot(ro, rd); float dmin = sqrt(max(dot(ro, ro) - b * b, 0.0));
        if (b < 0.0) col += vec3(1.0, 0.75, 0.4) * (exp(-(dmin - 2.0) * 1.1) * 0.9 + exp(-(dmin - 2.0) * 0.25) * 0.12);
        if (s.x > 0.0) {
          vec3 n = normalize(ro + rd * s.x);
          float g = fbm(n * 14.0 + uTime * 0.03);
          col = vec3(1.0, 0.78, 0.45) * (2.2 + 1.5 * g) * (0.5 + 0.5 * pow(max(dot(n, -rd), 0.0), 0.5));
        }
        float tStar = s.x > 0.0 ? s.x : 1e9;
        float ts[6]; vec4 cs[6];
        vec3 ns[6];
        ns[0] = normalize(vec3(0.0, 1.0, 0.1)); ns[1] = normalize(vec3(0.4, 1.0, -0.2)); ns[2] = normalize(vec3(-0.5, 1.0, 0.3));
        ns[3] = normalize(vec3(0.9, 0.4, 0.2)); ns[4] = normalize(vec3(-0.2, 0.3, 1.0)); ns[5] = normalize(vec3(0.3, -0.6, 1.0));
        for (int i = 0; i < 6; i++) {
          float fi = float(i);
          cs[i] = ringHit(ro, rd, ns[i], 4.0 + fi * 1.1, 0.35 + fi * 0.04, 90.0 + fi * 25.0, 0.18 / (1.0 + fi * 0.4) * (mod(fi, 2.0) * 2.0 - 1.0), fi * 7.3, ts[i]);
          if (ts[i] > tStar) ts[i] = -1.0;
        }
        for (int k = 0; k < 6; k++) {
          int far = -1; float ft = -1.0;
          for (int i = 0; i < 6; i++) if (ts[i] > ft) { ft = ts[i]; far = i; }
          if (far < 0) break;
          for (int i = 0; i < 6; i++) if (i == far) { col = mix(col, cs[i].rgb, cs[i].a); ts[i] = -1.0; }
        }
        return col;
      }
    `,
  });

  /* ---------- 12 · COMET RIDE ---------- */
  S.comet = shaderScene({
    fov: 55,
    cam: (c, t, time) => { const a = -0.4 + t * 0.5; look(c, Math.sin(a) * 9, 2.5 + Math.sin(time * 0.1) * 0.4, Math.cos(a) * 9, -6, 0, -4); },
    frag: /* glsl */ `
      const vec3 SUN = normalize(vec3(0.9, 0.1, 0.6));
      float mapN(vec3 p) { return length(p * vec3(1.0, 0.75, 0.9)) - 1.0 + fbm(p * 2.2 + 4.0) * 0.45; }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.6);
        vec3 A = -SUN;                                       // ion tail axis
        vec3 B = normalize(cross(A, vec3(0.0, 1.0, 0.0)));   // dust tail bends this way
        vec3 acc = vec3(0.0);
        float j = jit(uv * 611.0);
        float dt = 70.0 / float(STEPS);
        for (int i = 0; i < STEPS; i++) {
          float t = dt * (float(i) + j);
          vec3 q = ro + rd * t;
          float a = dot(q, A);
          if (a < -2.0) continue;
          float aa = max(a, 0.0);
          vec3 perp = q - A * a;
          float d = length(perp);
          float w = 0.35 + aa * 0.06;
          float ang = atan(dot(perp, B), dot(perp, cross(A, B)));
          float stri = 0.4 + 0.6 * pow(noise(vec3(ang * 4.0, aa * 0.08 - uTime * 1.2, 2.0)), 2.0);
          acc += vec3(0.3, 0.62, 1.0) * exp(-d * d / (w * w)) * stri * smoothstep(-1.0, 1.5, a) * exp(-aa * 0.035) * dt * 0.55;
          vec3 c2 = A * aa + B * aa * aa * 0.025;
          float d2 = length(q - c2);
          float w2 = 0.6 + aa * 0.16;
          acc += vec3(1.0, 0.85, 0.6) * exp(-d2 * d2 / (w2 * w2)) * smoothstep(-1.0, 2.0, a) * exp(-aa * 0.045) * dt * 0.28 * (0.6 + 0.4 * noise(q * 0.4));
          float r = length(q);
          acc += vec3(0.7, 0.85, 1.0) * exp(-r * 1.4) * dt * 0.07;
          float jet = pow(max(dot(normalize(q), normalize(SUN + vec3(0.0, 0.4, 0.0))), 0.0), 60.0) * exp(-r * 0.5);
          acc += vec3(0.9, 0.95, 1.0) * jet * dt * 0.2;
        }
        col += acc;
        vec2 bs = sph(ro, rd, vec3(0.0), 1.7);
        if (bs.x > 0.0) {
          float t = bs.x;
          for (int i = 0; i < 48; i++) {
            vec3 q = ro + rd * t; float d = mapN(q);
            if (d < 0.003) {
              vec2 e = vec2(0.01, 0.0);
              vec3 n = normalize(vec3(mapN(q + e.xyy) - mapN(q - e.xyy), mapN(q + e.yxy) - mapN(q - e.yxy), mapN(q + e.yyx) - mapN(q - e.yyx)));
              float dif = max(dot(n, SUN), 0.0);
              col = vec3(0.09, 0.08, 0.075) * dif * 2.5 + vec3(0.6, 0.75, 1.0) * pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.3;
              break;
            }
            t += d * 0.7; if (t > bs.y) break;
          }
        }
        float sb = max(dot(rd, SUN), 0.0);
        col += vec3(1.0, 0.95, 0.85) * (pow(sb, 2000.0) * 30.0 + pow(sb, 60.0) * 0.4);
        return col;
      }
    `,
  });

  /* ---------- 13 · COSMIC WEB ---------- */
  S.web = shaderScene({
    fov: 62,
    cam: (c, t, time) => { const z = -(time * 4 + t * 160); look(c, Math.sin(time * 0.05) * 6, Math.sin(time * 0.04) * 4, z, Math.sin(time * 0.05 + 0.3) * 6, Math.sin(time * 0.04 + 0.3) * 4, z - 20, time * 0.03); },
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 acc = vec3(0.0);
        float j = jit(uv * 377.0);
        float dt = 3.2;
        for (int i = 0; i < STEPS; i++) {
          float t = dt * (float(i) + j) + 1.0;
          vec3 q = (ro + rd * t) * 0.045;
          float ra = 1.0 - abs(noise(q) * 2.0 - 1.0);
          float rb = 1.0 - abs(noise(q * 1.03 + vec3(5.2, 1.3, 7.7)) * 2.0 - 1.0);
          float fil = pow(ra * rb, 9.0);
          float node = pow(ra * rb, 40.0);
          vec3 c = mix(vec3(0.25, 0.3, 1.0), vec3(0.75, 0.35, 1.0), noise(q * 0.5));
          float fade = exp(-t * 0.012);
          acc += (c * fil * 0.55 + vec3(1.0, 0.8, 0.5) * node * 6.0) * fade;
          vec3 g = floor(q * 22.0);
          float hh = hash(g);
          if (hh > 0.993 && fil > 0.25) { vec3 f = fract(q * 22.0) - 0.5; acc += vec3(1.0, 0.9, 0.7) * exp(-dot(f, f) * 80.0) * 2.0 * fade; }
        }
        return acc * 0.09 + skyColor(rd, uPx, 0.0) * 0.4;
      }
    `,
  });

  /* ---------- 14 · WORMHOLE ---------- */
  S.wormhole = shaderScene({
    fov: 58,
    cam: (c, t, time) => { const d = 7 - 6.3 * Math.pow(t, 1.3); look(c, 0.3 * Math.sin(time * 0.1), 0.2, d, 0, 0, -1, time * 0.04); },
    frag: /* glsl */ `
      vec3 otherSky(vec3 d) {
        vec3 c = vec3(0.0);
        float n = fbm(d * 2.0 + 20.0);
        c += mix(vec3(0.0, 0.15, 0.18), vec3(0.9, 0.4, 0.1), smoothstep(0.45, 0.8, n)) * pow(n, 2.0) * 1.2;
        c += vec3(0.1, 0.6, 0.6) * pow(fbm(d * 6.0 + 2.0), 4.0) * 1.5;
        c += starLayer(d, 160.0, 0.03, 8.0, uPx) * vec3(1.0, 0.8, 0.6);
        // a ringed world on the other side
        vec3 pc = normalize(vec3(0.3, 0.2, -1.0));
        float a = acos(dot(d, pc));
        if (a < 0.12) { vec3 n2 = normalize(d - pc * cos(a)); c = mix(c, vec3(0.9, 0.6, 0.35) * (0.3 + 0.7 * smoothstep(0.12, 0.0, a)), 0.95); }
        return c;
      }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        float R = 1.0;
        float tca = -dot(ro, rd);
        vec3 cl = ro + rd * tca;
        float b = length(cl);
        bool inside = length(ro) < R;
        if (inside) return otherSky(rd);
        if (tca > 0.0 && b < R) {
          float k = b / R;
          vec3 axis = normalize(cross(rd, normalize(cl) + 1e-5));
          float ang = 3.14159 * (1.0 - k) * 0.9;
          vec3 d2 = rd * cos(ang) + cross(axis, rd) * sin(ang) + axis * dot(axis, rd) * (1.0 - cos(ang));
          vec3 c = otherSky(d2);
          c += vec3(0.9, 0.95, 1.0) * exp(-pow((k - 1.0) / 0.04, 2.0)) * 1.2;
          return c;
        }
        float bend = tca > 0.0 ? 0.6 * R / max(b, 0.05) : 0.0;
        vec3 d3 = normalize(rd - normalize(cl) * bend * 0.35);
        vec3 c = skyColor(d3, uPx, 0.8);
        c += vec3(0.25, 0.4, 0.8) * fbm(d3 * 3.0) * 0.08;
        if (tca > 0.0) c += vec3(0.8, 0.9, 1.0) * exp(-pow((b - R) / 0.05, 2.0)) * 0.9 + vec3(0.4, 0.6, 1.0) * exp(-(b - R) * 4.0) * 0.12;
        return c;
      }
    `,
  });

  /* ---------- 15 · SUPERNOVA ---------- */
  S.supernova = shaderScene({
    fov: 55,
    cam: (c, t, time) => orbit(c, 30, 0.4 + t * 0.4, 0.15, 0, 0.05),
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.4);
        float Rs = 3.0 + uT * 40.0;
        float th = 2.5 + uT * 5.0;
        vec2 o = sph(ro, rd, vec3(0.0), Rs + th);
        if (o.y > 0.0) {
          float ta = max(o.x, 0.0), tb = o.y;
          float dt = (tb - ta) / float(STEPS);
          float j = jit(uv * 271.0);
          vec3 acc = vec3(0.0);
          for (int i = 0; i < STEPS; i++) {
            vec3 q = ro + rd * (ta + dt * (float(i) + j));
            float r = length(q);
            float sh = exp(-pow((r - Rs) / th, 2.0));
            if (sh < 0.01) continue;
            vec3 d = q / r;
            float f1 = 1.0 - abs(fbm(d * 5.0 + 3.0) * 2.0 - 1.0);
            float f2 = 1.0 - abs(fbm(d * 11.0 + r * 0.05) * 2.0 - 1.0);
            float fil = pow(f1, 6.0) + pow(f2, 10.0) * 0.8;
            float x = (r - Rs) / th;
            vec3 c = mix(vec3(0.1, 0.8, 0.85), vec3(1.0, 0.18, 0.12), smoothstep(-0.6, 0.6, x));
            c = mix(c, vec3(1.0, 0.9, 0.7), pow(f2, 14.0));
            acc += c * sh * fil * dt;
          }
          col += acc * (0.07 / (1.0 + uT * 1.5));
        }
        float b = dot(ro, rd); float dmin = sqrt(max(dot(ro, ro) - b * b, 0.0));
        if (b < 0.0) {
          col += vec3(0.5, 0.65, 1.0) * exp(-dmin * 0.6) * 0.15 * (0.4 + uT);
          col += vec3(1.0) * exp(-dmin * 8.0) * 4.0;
        }
        col += vec3(1.0, 0.95, 0.9) * smoothstep(0.08, 0.0, uT) * 2.0;
        return col;
      }
    `,
  });

  /* ---------- 16 · QUASAR JET ---------- */
  S.quasar = shaderScene({
    fov: 60,
    cam: (c, t, time) => { const y = -6 + t * 130 + time * 1.5; look(c, 9, y, 7, 0, y + 22, 0, 0.15); },
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.3);
        // host galaxy disk in the y=0 plane
        if (abs(rd.y) > 1e-3) {
          float t = -ro.y / rd.y;
          if (t > 0.0) {
            vec3 q = ro + rd * t; float r = length(q.xz) * 0.03;
            float a = atan(q.z, q.x);
            float arm = pow(0.5 + 0.5 * cos(2.0 * (a + log(r + 0.01) * 2.5)), 2.0);
            float n = fbm(vec3(q.xz * 0.05, 1.0));
            vec3 g = mix(vec3(0.5, 0.6, 1.0), vec3(1.0, 0.8, 0.55), exp(-r * 3.0)) * (arm * (0.3 + n) * 0.35 + exp(-r * 6.0) * 2.0) * smoothstep(1.4, 0.2, r);
            col += g * 0.6;
          }
        }
        // jets along ±y
        vec2 dxz = rd.xz; vec2 oxz = ro.xz;
        float tc = -dot(oxz, dxz) / max(dot(dxz, dxz), 1e-5);
        float ta = max(tc - 14.0, 0.0), tb = tc + 14.0;
        float dt = (tb - ta) / float(STEPS);
        float j = jit(uv * 433.0);
        vec3 acc = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 q = ro + rd * (ta + dt * (float(i) + j));
          float y = abs(q.y);
          float w = 0.25 + y * 0.018;
          float rr = length(q.xz);
          float tw = atan(q.z, q.x) - y * 0.25 + uTime * 2.0;
          float hel = 0.6 + 0.4 * cos(tw * 2.0);
          float knots = 0.5 + 0.5 * pow(0.5 + 0.5 * sin(y * 0.45 - uTime * 9.0), 4.0) * 2.0;
          float den = exp(-rr * rr / (w * w)) * knots * hel * smoothstep(0.0, 1.5, y) * exp(-y * 0.006);
          vec3 c = mix(vec3(0.75, 0.85, 1.0), vec3(0.55, 0.3, 1.0), smoothstep(0.0, 1.0, rr / w));
          acc += c * den * dt;
        }
        col += acc * 0.9;
        float b = dot(ro, rd); float dmin = sqrt(max(dot(ro, ro) - b * b, 0.0));
        if (b < 0.0) col += vec3(1.0, 0.9, 0.8) * (exp(-dmin * 1.5) * 3.0 + exp(-dmin * 0.2) * 0.15);
        return col;
      }
    `,
  });

  /* ---------- 17 · CAT'S EYE NEBULA ---------- */
  S.catseye = shaderScene({
    fov: 50,
    cam: (c, t, time) => orbit(c, 22 - t * 6, 0.3 + t * 1.0 + time * 0.01, 0.35 + Math.sin(time * 0.05) * 0.1, 0, 0.2),
    frag: /* glsl */ `
      float ell(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.3);
        vec2 o = sph(ro, rd, vec3(0.0), 11.0);
        if (o.y > 0.0) {
          float ta = max(o.x, 0.0), tb = o.y; float dt = (tb - ta) / float(STEPS);
          float j = jit(uv * 199.0);
          vec3 acc = vec3(0.0);
          for (int i = 0; i < STEPS; i++) {
            vec3 q = ro + rd * (ta + dt * (float(i) + j));
            vec3 q1 = q; q1.xy = rot(0.5) * q1.xy;
            vec3 q2 = q; q2.yz = rot(-0.7) * q2.yz; q2.xy = rot(-0.4) * q2.xy;
            vec3 q3 = q; q3.xz = rot(1.1) * q3.xz;
            float n = fbm(q * 0.6 + uTime * 0.02);
            float e1 = abs(ell(q1, vec3(3.0, 6.5, 3.2))) - 0.08 - n * 0.25;
            float e2 = abs(ell(q2, vec3(4.2, 2.6, 5.5))) - 0.08 - n * 0.3;
            float e3 = abs(ell(q3, vec3(8.5, 7.5, 8.0))) - 0.2 - n * 0.6;
            acc += vec3(0.15, 0.85, 0.8) * exp(-max(e1, 0.0) * 9.0) * (0.4 + n);
            acc += vec3(1.0, 0.35, 0.25) * exp(-max(e2, 0.0) * 8.0) * (0.4 + n);
            acc += vec3(0.9, 0.55, 0.2) * exp(-max(e3, 0.0) * 4.0) * 0.25 * n;
            float r = length(q);
            acc += vec3(0.3, 0.7, 1.0) * exp(-r * 0.6) * 0.15;
          }
          col += acc * dt * 0.22;
        }
        float b = dot(ro, rd); float dmin = sqrt(max(dot(ro, ro) - b * b, 0.0));
        if (b < 0.0) col += vec3(0.8, 0.9, 1.0) * exp(-dmin * 10.0) * 5.0;
        return col;
      }
    `,
  });

  /* ---------- 18 · BLACK HOLE MERGER ---------- */
  S.merger = shaderScene({
    fov: 55,
    cam: (c) => look(c, 0, 0, 0, 0, 0, -1),
    frag: /* glsl */ `
      vec3 bgAt(vec2 q) {
        vec3 d = normalize(vec3(q, -1.0));
        vec3 c = skyColor(d, uPx * 0.7, 1.0) * 1.3;
        float n = fbm(vec3(q * 2.0, 3.0));
        c += mix(vec3(0.05, 0.08, 0.2), vec3(0.35, 0.18, 0.4), n) * pow(n, 2.0) * 0.6;
        return c;
      }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        float s = 0.32 * (1.0 - uT * 0.88);
        float ph = uTime * 0.5 + uT * uT * 60.0;
        vec2 c1 = vec2(cos(ph), sin(ph) * 0.45) * s * 0.55;
        vec2 c2 = -vec2(cos(ph), sin(ph) * 0.45) * s * 0.45;
        float m1 = 0.012, m2 = 0.009;
        float merged = smoothstep(0.9, 0.95, uT);
        vec2 d1 = p - c1, d2 = p - c2;
        vec2 q = p - (1.0 - merged) * (m1 * d1 / dot(d1, d1) + m2 * d2 / dot(d2, d2)) - merged * 0.021 * p / dot(p, p);
        float rr = length(p);
        q += normalize(p + 1e-5) * 0.008 * sin(rr * 40.0 - uTime * 8.0) * exp(-rr * 1.5) * (0.3 + uT);
        vec3 col = bgAt(q);
        float r1 = sqrt(m1) * 1.0, r2 = sqrt(m2) * 1.0, rm = sqrt(0.021);
        float sh = (1.0 - merged) * (smoothstep(r1, r1 * 0.92, length(d1)) + smoothstep(r2, r2 * 0.92, length(d2))) + merged * smoothstep(rm, rm * 0.92, rr);
        col *= 1.0 - clamp(sh, 0.0, 1.0);
        vec3 ring = vec3(1.0, 0.85, 0.7);
        col += ring * (1.0 - merged) * (exp(-pow((length(d1) - r1 * 1.08) / 0.004, 2.0)) + exp(-pow((length(d2) - r2 * 1.08) / 0.004, 2.0))) * 0.9;
        col += ring * merged * exp(-pow((rr - rm * 1.08) / 0.005, 2.0)) * 1.2;
        col += vec3(1.0, 0.95, 0.9) * exp(-pow((uT - 0.93) / 0.015, 2.0)) * exp(-rr * 3.0) * 3.0;
        return col;
      }
    `,
  });

  /* ---------- 19 · DIAMOND RAIN ---------- */
  S.diamond = shaderScene({
    fov: 55,
    cam: (c) => look(c, 0, 0, 0, 0, 0, -1),
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        float y = p.y;
        vec3 col = mix(vec3(0.0, 0.03, 0.12), vec3(0.04, 0.2, 0.45), smoothstep(-0.6, 0.6, y));
        float fall = uTime * 0.6 + uT * 12.0;
        for (int L = 0; L < 4; L++) {
          float fl = float(L);
          float n = fbm(vec3(p.x * (1.5 + fl), p.y * 0.6 * (1.0 + fl) + fall * (0.1 + fl * 0.08), fl * 3.0));
          col += vec3(0.1, 0.35, 0.6) * pow(n, 3.0) * 0.18;
        }
        float rays = pow(fbm(vec3(p.x * 4.0 + p.y * 0.8, 0.0, uTime * 0.05)), 3.0) * smoothstep(-0.5, 0.6, y);
        col += vec3(0.4, 0.7, 1.0) * rays * 0.6;
        for (int L = 0; L < 6; L++) {
          float fl = float(L);
          float sc = 7.0 + fl * 5.0;
          vec2 g = p * sc + vec2(fl * 13.1, fall * (2.0 + 3.0 * fl / 5.0) * (1.0 + fl * 0.5));
          g.y = -g.y + fall * sc * 0.4;
          vec2 id = floor(g); vec2 f = fract(g) - 0.5;
          float h = hash(vec3(id, fl));
          if (h > 0.6) {
            vec2 off = (hash3(vec3(id, fl + 4.0)).xy - 0.5) * 0.5;
            vec2 d = f - off;
            d = rot(uTime * (h - 0.5) * 3.0 + h * 6.0) * d;
            float size = 0.06 + 0.1 * h;
            float dia = abs(d.x) * 1.3 + abs(d.y);
            float body = smoothstep(size, size * 0.7, dia);
            float tw = pow(0.5 + 0.5 * sin(uTime * (3.0 + h * 5.0) + h * 40.0), 6.0);
            vec3 hc = mix(vec3(0.8, 0.9, 1.0), hue(fract(h * 7.0 + uTime * 0.1)), 0.5);
            float spk = (exp(-abs(d.x) * 80.0) * exp(-abs(d.y) * 6.0) + exp(-abs(d.y) * 80.0) * exp(-abs(d.x) * 6.0)) * tw;
            float depthFade = 1.0 - fl / 7.0;
            col += (hc * body * (0.25 + 0.75 * tw) + hc * spk * 1.5) * depthFade * 0.8;
          }
        }
        return col;
      }
    `,
  });

  /* ---------- 20 · ROGUE PLANET ---------- */
  S.rogue = shaderScene({
    fov: 50,
    cam: (c, t, time) => { const a = -0.25 + t * 0.5; look(c, Math.sin(a) * 26, 4.5 - t * 3, Math.cos(a) * 26, 0, 6 - t * 2, 0, -0.1); },
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.0) * 1.2;
        vec3 gd = normalize(vec3(-0.3, 0.25, -1.0));
        float ga = acos(clamp(dot(rd, gd), -1.0, 1.0));
        if (ga < 0.25) {
          vec3 a1 = normalize(cross(gd, vec3(0.0, 1.0, 0.0))); vec3 a2 = cross(gd, a1);
          vec2 g = vec2(dot(rd, a1), dot(rd, a2)) / 0.25; g.y *= 2.2; g = rot(0.5) * g;
          float r = length(g); float a = atan(g.y, g.x);
          float arm = pow(0.5 + 0.5 * cos(2.0 * (a + log(r + 0.02) * 2.5)), 2.0);
          col += mix(vec3(0.5, 0.6, 1.0), vec3(1.0, 0.85, 0.6), exp(-r * 4.0)) * (arm * 0.4 + exp(-r * 8.0) * 2.0) * smoothstep(1.0, 0.2, r) * 0.6;
        }
        float R = 10.0;
        vec2 s = sph(ro, rd, vec3(0.0), R);
        vec2 s2 = sph(ro, rd, vec3(0.0), R * 1.05);
        if (s2.x > 0.0) {
          float ta = s2.x, tb = s.x > 0.0 ? s.x : s2.y;
          vec3 acc = vec3(0.0); float dt = (tb - ta) / 24.0;
          for (int i = 0; i < 24; i++) {
            vec3 q = ro + rd * (ta + dt * (float(i) + 0.5)); vec3 n = normalize(q);
            float h = (length(q) - R) / (R * 0.05);
            float lat = n.y;
            float oval = exp(-pow((lat - 0.82 - 0.04 * sin(atan(n.z, n.x) * 5.0 + uTime * 0.3)) / 0.035, 2.0));
            float curtain = 0.5 + 0.5 * noise(vec3(atan(n.z, n.x) * 20.0, h * 2.0 - uTime * 0.8, 1.0));
            vec3 c = mix(vec3(0.15, 1.0, 0.45), vec3(1.0, 0.2, 0.35), smoothstep(0.2, 0.9, h));
            acc += c * oval * curtain * exp(-h * 2.0) * dt;
          }
          col += acc * 0.9;
        }
        if (s.x > 0.0) {
          vec3 n = normalize(ro + rd * s.x);
          float f = fbm(n * 6.0);
          vec3 surf = vec3(0.004, 0.005, 0.008) * (0.5 + f);
          surf += vec3(0.35, 0.08, 0.02) * pow(smoothstep(0.62, 0.75, fbm(n * 12.0 + 4.0)), 3.0) * 0.08;
          float rim = pow(1.0 - max(dot(n, -rd), 0.0), 6.0);
          surf += vec3(0.25, 0.4, 0.9) * rim * max(dot(n, gd), 0.0) * 0.5;
          col = surf;
        } else {
          float b = dot(ro, rd); float dmin = sqrt(max(dot(ro, ro) - b * b, 0.0));
          if (b < 0.0) col += vec3(0.3, 0.5, 1.0) * exp(-(dmin - R) * 4.0) * 0.25 * smoothstep(-0.3, 0.6, dot(normalize(ro + rd * (-b)), gd));
        }
        return col;
      }
    `,
  });

  /* ---------- 21 · STAR NURSERY PILLARS ---------- */
  S.nursery = shaderScene({
    fov: 55,
    cam: (c, t, time) => { const x = -14 + t * 22; look(c, x, 4 + t * 4, 34 - t * 10, x * 0.3, 10, 0, 0.03); },
    frag: /* glsl */ `
      float capsule(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r * (1.0 - h * 0.55); }
      float mapP(vec3 p) {
        float d = capsule(p, vec3(-6.0, -40.0, 0.0), vec3(-4.0, 22.0, -2.0), 5.5);
        d = min(d, capsule(p, vec3(5.0, -40.0, -6.0), vec3(7.0, 13.0, -5.0), 4.2));
        d = min(d, capsule(p, vec3(14.0, -40.0, -14.0), vec3(13.0, 6.0, -12.0), 3.5));
        return d + (fbm(p * 0.35) - 0.5) * 4.0 + noise(p * 1.4) * 0.6;
      }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 L = normalize(vec3(0.2, 0.8, -0.6));
        float n = fbm(rd * 2.0 + 8.0);
        vec3 bg = mix(vec3(0.02, 0.06, 0.08), vec3(0.6, 0.45, 0.2), smoothstep(0.35, 0.75, n)) * (0.25 + 0.6 * smoothstep(-0.3, 0.8, rd.y));
        bg += vec3(0.1, 0.4, 0.45) * pow(fbm(rd * 4.0 + 2.0), 3.0) * 0.6;
        bg += skyColor(rd, uPx, 0.0) * 0.6;
        float t = 0.5; bool hit = false;
        for (int i = 0; i < STEPS + 24; i++) {
          float d = mapP(ro + rd * t);
          if (d < 0.02 * t * 0.05 + 0.01) { hit = true; break; }
          t += d * 0.6; if (t > 120.0) break;
        }
        vec3 col = bg;
        if (hit) {
          vec3 q = ro + rd * t; vec2 e = vec2(0.05, 0.0);
          vec3 nn = normalize(vec3(mapP(q + e.xyy) - mapP(q - e.xyy), mapP(q + e.yxy) - mapP(q - e.yxy), mapP(q + e.yyx) - mapP(q - e.yyx)));
          float dif = max(dot(nn, L), 0.0);
          float rim = pow(1.0 - max(dot(nn, -rd), 0.0), 3.0);
          float edge = smoothstep(0.1, 0.7, dot(nn, L)) * smoothstep(5.0, 22.0, q.y + 10.0);
          vec3 c = vec3(0.05, 0.03, 0.02) * (0.3 + dif) + vec3(1.0, 0.55, 0.2) * rim * 0.6 * (0.3 + dif) + vec3(1.0, 0.75, 0.4) * edge * 0.35;
          col = mix(c, bg, 1.0 - exp(-t * 0.012));
        }
        vec3 stars[3]; stars[0] = vec3(-4.0, 23.5, -2.0); stars[1] = vec3(7.0, 14.5, -5.0); stars[2] = vec3(13.0, 7.0, -12.0);
        for (int i = 0; i < 3; i++) {
          vec3 oc = stars[i] - ro; float b = dot(oc, rd);
          if (b > 0.0 && (!hit || b < t + 2.0)) { float dd = length(oc - rd * b); col += vec3(1.0, 0.9, 0.75) * (exp(-dd * 3.0) * 2.5 + exp(-dd * 0.5) * 0.15); }
        }
        return col;
      }
    `,
  });

  /* ---------- 22 · THE EDGE OF TIME ---------- */
  S.timeedge = shaderScene({
    fov: 55,
    cam: (c) => look(c, 0, 0, 0, 0, 0, -1),
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        p = rot(uTime * 0.02) * p;
        float r = length(p); float a = atan(p.y, p.x);
        vec3 col = vec3(0.0);
        float rings = 160.0;
        float k = floor(r * rings);
        for (int o = -1; o <= 1; o++) {
          float kk = k + float(o);
          float h = h1(kk * 1.37);
          if (h < 0.55) continue;
          float rc = (kk + 0.5) / rings;
          float speed = 0.25 / (0.15 + rc);
          float start = h1(kk * 7.1) * 6.2831 + uTime * speed;
          float len = (0.4 + 2.2 * h1(kk * 3.3)) * (0.4 + uT);
          float da = mod(start - a, 6.2831);
          float on = step(da, len);
          float fade = on * (1.0 - da / len);
          float w = exp(-pow((r - rc) * rings * 1.4, 2.0));
          vec3 c = mix(vec3(0.6, 0.75, 1.0), vec3(1.0, 0.8, 0.5), h1(kk * 9.9));
          col += c * w * pow(fade, 1.5) * 0.9;
        }
        for (int i = 0; i < 4; i++) {
          float fi = float(i);
          float rr = fract(uTime * 0.05 + fi * 0.25) * 1.3;
          float ring = exp(-pow((r - rr) / 0.0025, 2.0));
          float ticks = smoothstep(0.92, 1.0, cos(a * 60.0));
          col += vec3(1.0, 0.85, 0.55) * (ring * (0.4 + ticks)) * (1.0 - rr / 1.3) * 0.8;
        }
        col += vec3(1.0, 0.95, 0.85) * (exp(-r * 30.0) * 3.0 + exp(-r * 5.0) * 0.25);
        return col;
      }
    `,
  });

  /* ---------- 23 · BIG BANG ---------- */
  S.bigbang = shaderScene({
    fov: 55,
    cam: (c) => look(c, 0, 0, 0, 0, 0, -1),
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        float r = length(p); float a = atan(p.y, p.x);
        vec3 col = vec3(0.0);
        float t = uT;
        if (t < 0.48) {
          float pull = pow(t / 0.48, 3.0);
          vec3 acc = vec3(0.0);
          for (int i = 0; i < 8; i++) {
            float k = 1.0 + pull * 6.0 * float(i) / 8.0;
            vec2 q = p * k;
            acc += skyColor(normalize(vec3(q, -1.0)), uPx, 1.0) * 1.5 + vec3(0.3, 0.2, 0.5) * pow(fbm(vec3(q * 2.0, 1.0)), 3.0) * 0.3;
          }
          col = acc / 8.0 * (1.0 + pull * 3.0);
          col += vec3(1.0, 0.95, 0.9) * exp(-r * (40.0 - pull * 30.0)) * pull * 4.0;
        } else {
          float e = (t - 0.48) / 0.52;
          col += vec3(1.0) * exp(-pow((t - 0.5) / 0.02, 2.0)) * 6.0;
          float front = e * 1.6;
          float n = fbm(vec3(cos(a) * 2.0, sin(a) * 2.0, r * 3.0 - e * 4.0));
          float n2 = fbm(vec3(cos(a) * 6.0, sin(a) * 6.0, r * 8.0 - e * 6.0));
          float inside = smoothstep(front + 0.05, front - 0.2, r);
          vec3 plasma = hue(fract(r * 0.8 - e * 0.5 + n * 0.4)) * 0.7 + vec3(1.0, 0.9, 0.8) * 0.3;
          col += plasma * inside * (0.4 + n2) * (1.4 - e) * 1.2;
          col += vec3(1.0, 0.85, 0.7) * exp(-pow((r - front) / 0.03, 2.0)) * (1.5 - e);
          vec2 g = p * 80.0; vec2 id = floor(g);
          float h = hash(vec3(id, 9.0));
          if (h > 0.985 && r < front) { vec2 f = fract(g) - 0.5; col += vec3(1.0, 0.9, 0.8) * exp(-dot(f, f) * 50.0) * e * 2.0; }
          col *= 1.0 - smoothstep(0.75, 1.0, e) * 0.85;
        }
        return col;
      }
    `,
  });

  /* ---------- 24 · OCEAN OF THE GIANT MOON ---------- */
  S.ocean = shaderScene({
    fov: 52,
    cam: (c, t, time) => { const z = -(time * 0.8 + t * 30); look(c, 0, 7.5, z, 0.5, 9.2, z - 40, -0.04); },
    frag: /* glsl */ `
      const vec3 SUND = normalize(vec3(0.15, -0.02, -1.0));
      const vec3 PD = normalize(vec3(0.42, 0.52, -1.0));
      vec3 skyO(vec3 rd) {
        float y = rd.y;
        vec3 col = mix(vec3(0.05, 0.055, 0.06), vec3(0.008, 0.012, 0.018), smoothstep(0.0, 0.5, y));
        col += vec3(1.0, 0.45, 0.15) * exp(-max(y, 0.0) * 14.0) * 0.18;
        float az = max(dot(normalize(vec3(rd.x, 0.0, rd.z)), normalize(vec3(SUND.x, 0.0, SUND.z))), 0.0);
        float line = exp(-abs(y + 0.004) * 260.0);
        col += vec3(1.0, 0.6, 0.22) * line * (1.2 + 3.0 * pow(az, 6.0));
        col += vec3(1.0, 0.5, 0.18) * exp(-abs(y) * 60.0) * 0.12 * (0.3 + az);
        // giant planet
        float ca = dot(rd, PD); float ang = acos(clamp(ca, -1.0, 1.0)); float AR = 0.62;
        if (ang < AR && y > -0.01) {
          vec3 a1 = normalize(cross(PD, vec3(0.0, 1.0, 0.0))); vec3 a2 = cross(a1, PD);
          vec2 q = vec2(dot(rd, a1), dot(rd, a2)) / sin(AR);
          float z = sqrt(max(1.0 - dot(q, q), 0.0));
          vec3 n = normalize(a1 * q.x + a2 * q.y - PD * z);
          vec3 L = normalize(vec3(-0.9, -0.15, 0.4));
          float lit = smoothstep(-0.05, 0.6, dot(n, -L));
          float f = fbm(n * 5.0 + 2.0); float f2 = fbm(n * 16.0);
          vec3 alb = mix(vec3(0.12, 0.16, 0.18), vec3(0.55, 0.6, 0.62), smoothstep(0.35, 0.75, f * 0.7 + f2 * 0.3));
          vec3 pc = alb * lit * 0.55 + vec3(0.6, 0.75, 0.85) * pow(1.0 - z, 4.0) * lit * 0.5 + alb * 0.03;
          float haze = exp(-max(y, 0.0) * 6.0);
          col = mix(pc, col, 0.1 + 0.6 * haze);
        }
        col += skyColor(rd, uPx, 0.0) * smoothstep(0.1, 0.5, y) * 0.6;
        return col;
      }
      float wave(vec2 p) {
        float h = 0.0;
        h += sin(p.x * 0.18 + uTime * 0.9) * 0.18 + sin(p.y * 0.23 - uTime * 0.7 + p.x * 0.1) * 0.15;
        h += (noise(vec3(p * 0.6, uTime * 0.25)) - 0.5) * 0.35 + (noise(vec3(p * 2.2, uTime * 0.5)) - 0.5) * 0.12;
        return h;
      }
      float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
      float boat(vec3 p) {
        float hull = sdBox(p - vec3(0.0, 0.15, 0.0), vec3(0.45, 0.18, 1.2)) - 0.05;
        float cab = sdBox(p - vec3(0.0, 0.55, 0.15), vec3(0.32, 0.25, 0.65));
        float mast = sdBox(p - vec3(0.0, 1.0, -0.2), vec3(0.03, 0.4, 0.03));
        return min(min(hull, cab), mast);
      }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        if (rd.y >= 0.0) return skyO(rd);
        float t = -ro.y / rd.y;
        vec3 q = ro + rd * t;
        vec2 e = vec2(0.08, 0.0);
        float hx = wave(q.xz + e.xy) - wave(q.xz - e.xy);
        float hz = wave(q.xz + e.yx) - wave(q.xz - e.yx);
        float fade = exp(-t * 0.012);
        vec3 n = normalize(vec3(-hx * fade, 2.0 * e.x, -hz * fade));
        vec3 rf = reflect(rd, n); rf.y = abs(rf.y);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
        vec3 water = vec3(0.01, 0.03, 0.04);
        vec3 col = mix(water, skyO(rf) * 0.42, fres);
        float glit = pow(max(dot(rf, normalize(SUND + vec3(0.0, 0.03, 0.0))), 0.0), 300.0);
        col += vec3(1.0, 0.55, 0.25) * glit * 6.0 * fade;
        col += vec3(0.9, 0.45, 0.2) * pow(max(dot(rf, normalize(vec3(SUND.x, 0.02, SUND.z))), 0.0), 25.0) * 0.25 * smoothstep(0.4, 0.75, noise(vec3(q.xz * 1.5, uTime)));
        col = mix(col, skyO(vec3(rd.x, 0.0, rd.z)), 1.0 - exp(-t * 0.006));
        // little boat with lit windows
        vec3 bp = vec3(2.2, wave(vec2(2.2, ro.z - 16.0)) * 0.6, ro.z - 16.0);
        vec2 bs = sph(ro, rd, bp + vec3(0.0, 0.5, 0.0), 1.6);
        if (bs.x > 0.0) {
          float tt = bs.x;
          for (int i = 0; i < 40; i++) {
            vec3 x = ro + rd * tt - bp; float d = boat(x);
            if (d < 0.004) {
              float win = step(0.45, x.y) * step(x.y, 0.68) * step(0.5, fract(x.z * 3.0 + 0.2)) * step(abs(x.x), 0.34) * step(0.28, abs(x.x));
              vec3 bc = vec3(0.012, 0.012, 0.014) + vec3(1.0, 0.7, 0.35) * win * 3.0;
              bc += vec3(1.0, 0.3, 0.2) * exp(-length(x - vec3(0.0, 1.42, -0.2)) * 20.0) * 4.0;
              col = bc; break;
            }
            tt += d; if (tt > bs.y) break;
          }
          float bd = length(cross(bp + vec3(0.0, 0.5, 0.0) - ro, rd));
          col += vec3(1.0, 0.65, 0.3) * exp(-bd * 4.0) * 0.08;
        }
        return col;
      }
    `,
  });

  /* ---------- 25 · EMBER STORM ---------- */
  S.ember = shaderScene({
    fov: 55,
    cam: (c) => look(c, 0, 0, 0, 0, 0, -1),
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec2 c = vec2(-0.08, -0.12);
        vec2 d = p - c; d = rot(-0.5) * d; d.y *= 1.6;
        float r = length(d); float a = atan(d.y, d.x);
        vec3 col = vec3(0.004, 0.004, 0.01);
        col += skyColor(normalize(vec3(p, -1.0)), uPx, 0.0) * 0.8;
        float crest = exp(-pow((r - 0.32) / 0.02, 2.0)) * smoothstep(0.2, -0.9, sin(a + 0.4));
        float molten = smoothstep(0.34, 0.3, r) * smoothstep(0.1, 0.5, -sin(a + 0.4) * r * 3.0);
        float lava = fbm(vec3(d * 8.0, uTime * 0.3));
        col += vec3(1.0, 0.5, 0.12) * crest * 3.0;
        col += mix(vec3(0.6, 0.12, 0.02), vec3(1.0, 0.75, 0.35), lava) * molten * 1.6;
        col *= 1.0 - smoothstep(0.3, 0.26, r) * (1.0 - molten) * 0.95;
        for (int L = 0; L < 5; L++) {
          float fl = float(L);
          float lr = log(r + 0.02) * (6.0 + fl * 3.0);
          float spin = a * (8.0 + fl * 4.0) / 6.2831 * 6.2831 + uTime * (0.6 + fl * 0.25) / (r + 0.2);
          vec2 g = vec2(spin, lr - uTime * 0.4);
          vec2 id = floor(g); vec2 f = fract(g) - 0.5;
          float h = hash(vec3(id, fl));
          if (h > 0.55) {
            vec2 o = (hash3(vec3(id, fl + 2.0)).xy - 0.5) * 0.5;
            vec2 q = f - o;
            float streak = exp(-q.y * q.y * 120.0) * exp(-q.x * q.x * 6.0);
            vec3 ec = h > 0.93 ? vec3(0.4, 0.65, 1.0) : mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.45), h);
            col += ec * streak * (1.6 - fl * 0.2) * smoothstep(1.4, 0.25, r) * (0.5 + 0.5 * sin(uTime * 4.0 + h * 50.0));
          }
        }
        float plume = fbm(vec3(p.x * 3.0 + sin(p.y * 4.0 + uTime) * 0.3, p.y * 1.5 - uTime * 0.5, 2.0));
        col += vec3(1.0, 0.45, 0.1) * pow(plume, 4.0) * smoothstep(0.0, 0.6, p.y + 0.1) * smoothstep(0.5, 0.0, abs(p.x + 0.05)) * 1.8;
        return col;
      }
    `,
  });

  /* ---------- 26 · CRIMSON CRESCENT ---------- */
  S.crimson = shaderScene({
    fov: 50,
    cam: (c, t, time) => { const a = -0.2 + t * 0.35; look(c, Math.sin(a) * 3, 0.5, Math.cos(a) * 3, -0.6 + t * 0.3, 0.3, -10, 0.05); },
    frag: /* glsl */ `
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.0) * vec3(1.2, 0.7, 0.7);
        float n = fbm(rd * 2.5 + 5.0); float n2 = fbm(rd * 7.0 + 1.0);
        col += vec3(0.5, 0.03, 0.04) * pow(n, 3.0) * 1.6 + vec3(0.9, 0.15, 0.1) * pow(n2, 5.0) * 0.8;
        vec3 starP = vec3(1.5, 0.6, -12.0);
        vec3 sd = normalize(starP - ro); float sa = max(dot(rd, sd), 0.0);
        col += vec3(1.0, 0.15, 0.08) * (pow(sa, 4000.0) * 25.0 + pow(sa, 300.0) * 1.5 + pow(sa, 25.0) * 0.12);
        vec3 PC = vec3(-4.2, 2.6, -11.0); float PR = 4.6;
        vec2 s = sph(ro, rd, PC, PR);
        vec3 Ld = normalize(starP - PC + vec3(6.0, -1.0, -8.0));
        if (s.x > 0.0) {
          vec3 nn = normalize(ro + rd * s.x - PC);
          float dl = dot(nn, Ld);
          float rim = pow(1.0 - max(dot(nn, -rd), 0.0), 5.0);
          col = vec3(0.004, 0.0, 0.0) + vec3(1.0, 0.08, 0.04) * smoothstep(-0.05, 0.25, dl) * (0.15 + rim * 3.5);
          col += vec3(0.35, 0.03, 0.02) * fbm(nn * 8.0) * smoothstep(0.0, 0.4, dl) * 0.3;
        } else {
          vec3 oc = PC - ro; float b = dot(oc, rd); float dd = length(oc - rd * b) - PR;
          vec3 edgeN = normalize(ro + rd * b - PC);
          if (b > 0.0) col += vec3(1.0, 0.1, 0.05) * exp(-dd * 18.0) * 0.8 * smoothstep(-0.1, 0.3, dot(edgeN, Ld));
        }
        return col;
      }
    `,
  });

  /* ---------- 27 · VIOLET ECLIPSE ---------- */
  S.violet = shaderScene({
    fov: 55,
    cam: (c, t, time) => { const a = 0.15 - t * 0.3; look(c, Math.sin(a) * 2, -0.3 + t * 0.6, Math.cos(a) * 2, 0.2, 0.4, -10, 0.0); },
    frag: /* glsl */ `
      vec3 planetV(vec3 ro, vec3 rd, vec3 C, float R, vec3 L, float seed, inout bool hit) {
        vec2 s = sph(ro, rd, C, R);
        if (s.x < 0.0) {
          vec3 oc = C - ro; float b = dot(oc, rd); float dd = length(oc - rd * b) - R;
          if (b > 0.0) return vec3(0.55, 0.2, 1.0) * exp(-dd * 6.0 / R) * 0.25 * smoothstep(-0.3, 0.5, dot(normalize(ro + rd * b - C), L));
          return vec3(0.0);
        }
        hit = true;
        vec3 n = normalize(ro + rd * s.x - C);
        float f = fbm(n * 4.0 + seed); float f2 = fbm(n * 14.0 + seed);
        float dl = dot(n, L);
        float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        vec3 alb = mix(vec3(0.12, 0.03, 0.25), vec3(0.5, 0.28, 0.8), smoothstep(0.3, 0.8, f * 0.5 + f2 * 0.5));
        return alb * smoothstep(-0.1, 0.7, dl) * 0.8 + vec3(0.6, 0.3, 1.0) * rim * smoothstep(-0.2, 0.4, dl) * 1.2 + alb * 0.02;
      }
      vec3 shade(vec3 ro, vec3 rd, vec2 uv, vec2 p) {
        vec3 col = skyColor(rd, uPx, 0.0) * vec3(0.9, 0.8, 1.2);
        col += vec3(0.25, 0.05, 0.45) * pow(fbm(rd * 2.0 + 3.0), 3.0) * 0.9;
        vec3 star = normalize(vec3(0.35, 0.55, -1.0));
        vec3 moonC = ro + star * 14.0;
        vec3 sd = normalize(moonC - ro);
        float ca = dot(rd, sd); float ang = acos(clamp(ca, -1.0, 1.0));
        float mr = 0.11;
        float ring = exp(-pow((ang - mr) / 0.004, 2.0)) * 3.0 + exp(-max(ang - mr, 0.0) * 30.0) * 0.6 * step(mr, ang);
        vec3 tang = normalize(cross(sd, vec3(0.0, 1.0, 0.0)));
        float diamond = exp(-length(rd - normalize(sd + tang * -0.07 + vec3(0.0, 0.08, 0.0))) * 60.0) * 3.0;
        col += vec3(0.75, 0.5, 1.0) * ring + vec3(1.0, 0.95, 1.0) * diamond;
        col += vec3(0.8, 0.6, 1.0) * exp(-abs(dot(rd - sd, vec3(1.0, 0.0, 0.0))) * 300.0) * exp(-abs(dot(rd - sd, vec3(0.0, 1.0, 0.0))) * 3.0) * 0.4;
        if (ang < mr) col = vec3(0.004, 0.0, 0.01);
        bool hit = false;
        vec3 L = normalize(star + vec3(0.2, 0.0, 0.3));
        vec3 big = planetV(ro, rd, vec3(-7.5, 0.5, -9.0), 6.2, normalize(vec3(0.9, 0.2, 0.3)), 2.0, hit);
        if (hit) col = big; else col += big;
        bool hit2 = false;
        vec3 small = planetV(ro, rd, vec3(2.8, -3.2, -12.0), 2.4, L, 7.0, hit2);
        if (hit2) col = small; else col += small;
        bool hit3 = false;
        vec3 tiny = planetV(ro, rd, vec3(1.2, 4.0, -16.0), 0.7, L, 3.0, hit3);
        if (hit3) col = tiny * 0.4; else col += tiny * 0.5;
        return col;
      }
    `,
  });

  return S;
}
