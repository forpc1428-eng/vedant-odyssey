/* =====================================================================
   HERO OBJECTS — large, detailed set-pieces that live in the same
   continuous world as everything else. The camera turns to each one
   as it passes, then returns to the path.
   ===================================================================== */
export function makeHeroes(ctx) {
  const {
    THREE, NOISE, SKY_GLSL, rnd, range, pick, sideSign, gauss, pathX, pathY,
    makeSunSprite, rockGeometry, Q, lowTier, scene, camera, skyUniforms,
  } = ctx;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const smooth = THREE.MathUtils.smoothstep;
  const tmpM = new THREE.Matrix4();

  /* ---------- shared helpers ---------- */
  function glowSprite(color, size, sharp = 6.0, intensity = 1.0) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: intensity }, uK: { value: sharp }, uFade: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uI, uK, uFade; varying vec2 vUv;
        void main(){ float r = length(vUv - 0.5) * 2.0; float g = exp(-r * uK) * smoothstep(1.0, 0.6, r);
          gl_FragColor = vec4(uColor * g * uI * uFade, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    m.scale.setScalar(size);
    m.userData.billboard = true;
    m.frustumCulled = false;
    return m;
  }
  function sun(color, size) {
    const s = makeSunSprite();
    s.material.uniforms.uColor.value.set(color);
    s.scale.setScalar(size);
    return s;
  }
  // A tube whose radius changes along a curve (for tails, streams and jets)
  function flaredTube(curveFn, r0, r1, segs = 160, radial = 32) {
    const pos = [], uv = [], idx = [];
    const p = new THREE.Vector3(), p2 = new THREE.Vector3(), t = new THREE.Vector3(), n = new THREE.Vector3(), b = new THREE.Vector3();
    let prevN = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      curveFn(u, p); curveFn(Math.min(u + 1 / segs, 1) + (u >= 1 ? 0 : 0), p2);
      t.copy(p2).sub(p); if (t.lengthSq() < 1e-8) curveFn(u - 1 / segs, t), t.subVectors(p, t);
      t.normalize();
      n.copy(prevN).sub(t.clone().multiplyScalar(prevN.dot(t))).normalize();
      b.crossVectors(t, n);
      prevN.copy(n);
      const r = r0 + (r1 - r0) * Math.pow(u, 0.8);
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        pos.push(p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * r, p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * r, p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * r);
        uv.push(u, j / radial);
      }
    }
    for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, c = a + radial + 1;
      idx.push(a, c, a + 1, c, c + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const VOL_VS = /* glsl */ `
    varying vec2 vUv; varying vec3 vN, vW;
    void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
  `;
  const STAR_SURF = /* glsl */ `
    uniform vec3 uColA, uColB; uniform float uTime, uFade, uI; varying vec3 vN, vW, vL;
    ${NOISE(Q.objOct)}
    void main(){
      vec3 n = normalize(vL); vec3 V = normalize(cameraPosition - vW);
      float mu = max(dot(normalize(vN), V), 0.0);
      float g1 = fbm(n * 9.0 + vec3(uTime * 0.02, 0.0, 0.0));
      float g2 = fbm(n * 30.0 - vec3(0.0, uTime * 0.03, 0.0));
      float cells = smoothstep(0.35, 0.7, g2);
      vec3 c = mix(uColA, uColB, g1 * 0.6 + cells * 0.4);
      c *= 0.45 + 0.55 * pow(mu, 0.45);
      float spot = smoothstep(0.66, 0.72, fbm(n * 4.0 + 11.0));
      c *= 1.0 - spot * 0.55;
      gl_FragColor = vec4(c * uI * uFade, 1.0);
    }
  `;
  const STAR_VS = `varying vec3 vN, vW, vL; void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  function starSphere(colA, colB, intensity) {
    return new THREE.ShaderMaterial({
      uniforms: { uColA: { value: new THREE.Color(colA) }, uColB: { value: new THREE.Color(colB) }, uTime: { value: 0 }, uFade: { value: 1 }, uI: { value: intensity } },
      vertexShader: STAR_VS, fragmentShader: STAR_SURF,
    });
  }
  // Common camera-focus helper: weight rises on approach and falls after passing.
  function focusWeight(relZ, near, far, after) {
    return (1 - smooth(relZ, near, far)) * smooth(relZ, -after, near * 0.1);
  }
  const distFade = (d, a, b) => 1 - smooth(d, a, b);

  const H = {};

  /* =====================================================================
     BLACK HOLE — real per-pixel light bending inside a proxy sphere,
     blended seamlessly into the surrounding sky.
     ===================================================================== */
  H.blackhole = function () {
    const group = new THREE.Group();
    const R = 24;
    const uniforms = {
      uCam: { value: new THREE.Vector3() }, uRot: { value: new THREE.Matrix3() },
      uTime: { value: 0 }, uFade: { value: 1 }, uPx: skyUniforms.uPx, uTravel: skyUniforms.uTravel,
      uHot: { value: new THREE.Color() }, uWarm: { value: new THREE.Color() }, uCool: { value: new THREE.Color() },
      uRout: { value: 12 }, uR: { value: R }, uBright: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCam, uHot, uWarm, uCool; uniform mat3 uRot;
        uniform float uTime, uFade, uRout, uR, uBright, uPx, uTravel;
        varying vec3 vL;
        ${NOISE(Q.objOct)}
        ${SKY_GLSL}
        const float RIN = 3.0;
        vec4 disk(vec3 q, vec3 dir) {
          float r = length(q.xz);
          if (r < RIN || r > uRout) return vec4(0.0);
          float x = (r - RIN) / (uRout - RIN);
          float phi = atan(q.z, q.x);
          float ph = phi + uTime * 2.4 / pow(r, 1.5);
          float lr = log(r);
          float n = fbm(vec3(cos(ph) * 2.4, sin(ph) * 2.4, lr * 10.0));
          float fine = noise(vec3(cos(ph) * 7.0, sin(ph) * 7.0, lr * 48.0));
          float bands = 0.6 + 0.4 * noise(vec3(r * 6.0, 0.3, 0.7));
          float den = smoothstep(0.0, 0.05, x) * pow(1.0 - x, 1.5);
          float T = pow(RIN / r, 1.1);
          vec3 c = mix(uCool, uWarm, smoothstep(0.1, 0.55, T));
          c = mix(c, uHot, smoothstep(0.55, 1.0, T));
          vec3 vel = normalize(vec3(-q.z, 0.0, q.x)) * sqrt(0.5 / r);
          float dop = max(1.0 + 2.4 * dot(vel, -dir), 0.1);
          float I = den * (0.2 + 1.1 * n * bands + 0.4 * fine) * (0.35 + 1.7 * T) * pow(dop, 3.0) * uBright;
          return vec4(c * I, clamp(den * (0.5 + 0.6 * n), 0.0, 0.96));
        }
        void main(){
          vec3 rd = normalize(vL - uCam);
          vec3 p = uCam;
          if (length(uCam) >= uR) {
            float bb = dot(uCam, rd); float cc = dot(uCam, uCam) - uR * uR; float hh = bb * bb - cc;
            if (hh < 0.0) discard;
            p = uCam + rd * max(-bb - sqrt(hh), 0.0);
          }
          vec3 hv = cross(p, rd); float h2 = dot(hv, hv);
          float b = sqrt(h2);
          float w = smoothstep(uR * 0.97, uR * 0.5, b);
          vec3 v = rd; vec3 col = vec3(0.0); float trans = 1.0; bool cap = false;
          for (int i = 0; i < ${Q.bhSteps}; i++) {
            float r2 = dot(p, p); float r = sqrt(r2);
            if (r < 1.0) { cap = true; break; }
            float dt = clamp(0.065 * r, 0.02, 1.6);
            v += -1.5 * h2 * p / (r2 * r2 * r) * dt;
            vec3 pn = p + v * dt;
            if (p.y * pn.y < 0.0) {
              vec4 d = disk(mix(p, pn, p.y / (p.y - pn.y)), normalize(v));
              col += d.rgb * trans; trans *= 1.0 - d.a;
              if (trans < 0.02) break;
            }
            p = pn;
            if (r > uR * 1.02 && dot(p, v) > 0.0) break;
          }
          vec3 bg = cap ? vec3(0.0) : skyDir(normalize(uRot * normalize(v)));
          vec3 src = col + trans * (cap ? vec3(0.0) : w * bg);
          float a = 1.0 - (cap ? 0.0 : trans * (1.0 - w));
          if (cap) a = 1.0;
          gl_FragColor = vec4(src * uFade, a * uFade);
        }
      `,
      transparent: true, depthWrite: false, side: THREE.BackSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    const proxy = new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64), mat);
    proxy.renderOrder = 20;
    proxy.frustumCulled = false;
    group.add(proxy);
    scene.add(group);
    const PALS = [
      ['#fff1dc', '#ffa448', '#a8390e'],   // Gargantua gold
      ['#ffd9c8', '#ff3216', '#6a1408'],   // red giant's grave
      ['#e6f0ff', '#7fb2ff', '#2b3f9a'],   // blue-hot
    ];
    let scale = 9;
    const inv = new THREE.Matrix4();
    const obj = {
      type: 'blackhole', group, active: false, anchor: 0, behind: 400, hero: true,
      focus: { near: 160, far: 900, after: 260, strength: 0.85 },
      place(z) {
        scale = range(14, 17);
        const side = sideSign();
        const rout = range(11, 14);
        uniforms.uRout.value = rout;
        const off = (rout + 4) * scale;
        group.position.set(pathX(z) + side * off, pathY(z) + sideSign() * range(0.1, 0.25) * off, z);
        group.scale.setScalar(scale);
        group.rotation.set(range(-0.18, 0.18), range(0, Math.PI * 2), range(-0.25, 0.25) + (rnd() < 0.3 ? 0.5 * sideSign() : 0));
        const pal = rnd() < 0.6 ? PALS[0] : pick(PALS);
        uniforms.uHot.value.set(pal[0]); uniforms.uWarm.value.set(pal[1]); uniforms.uCool.value.set(pal[2]);
        obj.anchor = z;
        obj.behind = R * scale + 200;
      },
      update(dt, t) {
        group.updateMatrixWorld();
        inv.copy(group.matrixWorld).invert();
        uniforms.uCam.value.copy(camera.position).applyMatrix4(inv);
        uniforms.uRot.value.setFromMatrix4(group.matrixWorld);
        const s = 1 / scale; const e = uniforms.uRot.value.elements; for (let i = 0; i < 9; i++) e[i] *= s;
        uniforms.uTime.value = t;
        const d = camera.position.distanceTo(group.position);
        uniforms.uFade.value = distFade(d, 3000, 3800);
      },
      focusPoint(out) { return out.copy(group.position); },
    };
    return obj;
  };

  /* =====================================================================
     PULSAR — spinning neutron star, sweeping beams, plasma flowing
     along magnetic field lines.
     ===================================================================== */
  H.pulsar = function () {
    const group = new THREE.Group();
    const spin = new THREE.Group();
    const mag = new THREE.Group();
    group.add(spin); spin.add(mag);
    mag.rotation.z = 0.95;
    const core = sun('#bcd6ff', 70);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(2.2, 48, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.4, 4) }));
    mag.add(ball);
    group.add(core, glowSprite('#5a7dff', 260, 5, 0.35), glowSprite('#9db8ff', 70, 4, 0.6));
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: VOL_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade; varying vec2 vUv; varying vec3 vN, vW;
        ${NOISE(3)}
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float edge = pow(abs(dot(normalize(vN), V)), 1.6);
          float along = vUv.y;
          float fall = pow(1.0 - along, 2.2) + exp(-(1.0 - along) * 30.0) * 0.0;
          float fil = 0.55 + 0.45 * noise(vec3(vUv.x * 18.0, along * 30.0 - uTime * 6.0, 1.0));
          vec3 c = mix(vec3(0.85, 0.92, 1.0), vec3(0.45, 0.55, 1.0), along);
          gl_FragColor = vec4(c * pow(edge, 1.5) * fall * fil * 0.55 * uFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beamGeo = new THREE.CylinderGeometry(26, 1.2, 520, 48, 40, true);
    beamGeo.translate(0, 260, 0);
    const b1 = new THREE.Mesh(beamGeo, beamMat);
    const b2 = new THREE.Mesh(beamGeo, beamMat); b2.rotation.x = Math.PI;
    b1.frustumCulled = b2.frustumCulled = false;
    mag.add(b1, b2);
    // field-line plasma
    const lines = lowTier ? 20 : 36, per = lowTier ? 90 : 170;
    const n = lines * per;
    const aL = new Float32Array(n), aPhi = new Float32Array(n), aS = new Float32Array(n), aSz = new Float32Array(n);
    for (let i = 0; i < lines; i++) {
      const L0 = pick([16, 24, 34, 48, 66]) * range(0.9, 1.1);
      const phi = rnd() * Math.PI * 2;
      for (let j = 0; j < per; j++) { const k = i * per + j; aL[k] = L0; aPhi[k] = phi; aS[k] = rnd(); aSz[k] = range(0.6, 1.6); }
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pg.setAttribute('aL', new THREE.BufferAttribute(aL, 1));
    pg.setAttribute('aPhi', new THREE.BufferAttribute(aPhi, 1));
    pg.setAttribute('aS', new THREE.BufferAttribute(aS, 1));
    pg.setAttribute('aSz', new THREE.BufferAttribute(aSz, 1));
    const fieldMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPR: { value: Q.pr } },
      vertexShader: /* glsl */ `
        attribute float aL, aPhi, aS, aSz; uniform float uTime, uPR; varying float vB;
        void main(){
          float th0 = asin(clamp(sqrt(2.4 / aL), 0.0, 1.0));
          float s = fract(aS + uTime * 0.08 * (30.0 / aL));
          float th = mix(th0, 3.14159 - th0, s);
          float r = aL * sin(th) * sin(th);
          vec3 p = vec3(r * sin(th) * cos(aPhi), r * cos(th), r * sin(th) * sin(aPhi));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = max(-mv.z, 0.1);
          float size = aSz * uPR * 160.0 / d;
          vB = (0.4 + 0.6 * sin(s * 3.14159)) * min(size, 1.0);
          gl_PointSize = clamp(size, 1.0, 6.0 * uPR);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `uniform float uFade; varying float vB; void main(){ vec2 c = gl_PointCoord - 0.5; float g = exp(-dot(c,c) * 18.0); gl_FragColor = vec4(vec3(0.55, 0.68, 1.0) * g * vB * 2.2 * uFade, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const field = new THREE.Points(pg, fieldMat);
    field.frustumCulled = false;
    mag.add(field);
    scene.add(group);
    let rate = 1.6;
    const obj = {
      type: 'pulsar', group, active: false, anchor: 0, behind: 300, hero: true,
      focus: { near: 90, far: 520, after: 140, strength: 0.8 },
      place(z) {
        const side = sideSign();
        group.position.set(pathX(z) + side * range(95, 130), pathY(z) + range(-25, 25), z);
        group.rotation.set(range(-0.3, 0.3), 0, side * range(0.1, 0.35));
        rate = range(1.3, 2.2);
        group.scale.setScalar(range(1.1, 1.5));
        obj.anchor = z;
      },
      update(dt, t) {
        spin.rotation.y = t * rate;
        const d = camera.position.distanceTo(group.position);
        const f = distFade(d, 1800, 2600);
        beamMat.uniforms.uTime.value = t; beamMat.uniforms.uFade.value = f;
        fieldMat.uniforms.uTime.value = t; fieldMat.uniforms.uFade.value = f;
        core.material.uniforms.uFade.value = f; core.material.uniforms.uTime.value = t;
      },
      focusPoint(out) { return out.copy(group.position); },
    };
    return obj;
  };

  /* =====================================================================
     COMET — rocky nucleus, glowing coma, straight blue ion tail and a
     curved golden dust tail streaming past you.
     ===================================================================== */
  H.comet = function () {
    const group = new THREE.Group();
    const nucleus = new THREE.Mesh(rockGeometry(4.2), new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 1, flatShading: true, fog: false }));
    nucleus.scale.set(7, 5.5, 6);
    group.add(nucleus);
    const coma1 = glowSprite('#bfe0ff', 90, 5, 0.9), coma2 = glowSprite('#7fb4ff', 300, 4, 0.25);
    group.add(coma1, coma2);
    const tailMat = (colA, colB, streak, bright) => new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uA: { value: new THREE.Color(colA) }, uB: { value: new THREE.Color(colB) }, uStreak: { value: streak }, uI: { value: bright } },
      vertexShader: VOL_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade, uStreak, uI; uniform vec3 uA, uB;
        varying vec2 vUv; varying vec3 vN, vW;
        ${NOISE(4)}
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float core = pow(abs(dot(normalize(vN), V)), 3.0);
          float u = vUv.x;
          float fall = pow(1.0 - u, 1.4) * smoothstep(0.0, 0.03, u);
          float st = mix(1.0, 0.3 + 1.2 * pow(noise(vec3(vUv.y * 40.0, u * 6.0 - uTime * 0.25, 2.0)), 2.0), uStreak);
          float wisp = 0.6 + 0.6 * fbm(vec3(vUv.y * 6.0, u * 14.0 - uTime * 0.15, 5.0));
          vec3 c = mix(uA, uB, u);
          float near = smoothstep(4.0, 40.0, length(cameraPosition - vW));
          gl_FragColor = vec4(c * core * fall * st * wisp * uI * near * uFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const ionMat = tailMat('#cfe6ff', '#3d6fff', 1.0, 0.2);
    const dustMat = tailMat('#fff2d6', '#c98a4a', 0.25, 0.13);
    let ion = null, dust = null;
    const tailGroup = new THREE.Group();
    group.add(tailGroup);
    // dust grains streaming along the curved tail
    const grains = lowTier ? 1500 : 4000;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grains * 3), 3));
    const gS = new Float32Array(grains), gO = new Float32Array(grains * 3);
    for (let i = 0; i < grains; i++) { gS[i] = rnd(); gO[i * 3] = gauss(); gO[i * 3 + 1] = gauss(); gO[i * 3 + 2] = gauss(); }
    gg.setAttribute('aS', new THREE.BufferAttribute(gS, 1));
    gg.setAttribute('aO', new THREE.BufferAttribute(gO, 3));
    const grainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPR: { value: Q.pr }, uLen: { value: 900 }, uBend: { value: 0.0006 }, uSide: { value: new THREE.Vector3(1, 0, 0) }, uDir: { value: new THREE.Vector3(0, 0, 1) } },
      vertexShader: /* glsl */ `
        attribute float aS; attribute vec3 aO; uniform float uTime, uPR, uLen, uBend; uniform vec3 uSide, uDir; varying float vB;
        void main(){
          float s = fract(aS + uTime * 0.012);
          float a = s * uLen;
          vec3 p = uDir * a + uSide * a * a * uBend + aO * (2.0 + a * 0.12);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = max(-mv.z, 0.1);
          float size = uPR * 90.0 / d;
          vB = (1.0 - s) * min(size, 1.0) * smoothstep(0.0, 0.03, s);
          gl_PointSize = clamp(size, 1.0, 5.0 * uPR);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `uniform float uFade; varying float vB; void main(){ vec2 c = gl_PointCoord - 0.5; gl_FragColor = vec4(vec3(1.0, 0.88, 0.7) * exp(-dot(c,c) * 16.0) * vB * 0.7 * uFade, 1.0); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const grainPts = new THREE.Points(gg, grainMat);
    grainPts.frustumCulled = false;
    group.add(grainPts);
    scene.add(group);
    const sunDirV = new THREE.Vector3();
    const obj = {
      type: 'comet', group, active: false, anchor: 0, behind: 260, hero: true,
      focus: { near: 70, far: 480, after: 110, strength: 0.75 },
      place(z) {
        const side = sideSign();
        group.position.set(pathX(z) + side * range(55, 80), pathY(z) + range(5, 25), z);
        // the tail points back toward where we come from, angled outward, so we ride alongside it
        const A = V3(side * range(0.15, 0.4), range(0.0, 0.2), 1).normalize();
        const B = V3(-A.z * side, 0, A.x * side).normalize().multiplyScalar(side);
        sunDirV.copy(A).negate();
        obj.light = sunDirV.clone();
        const len = range(800, 1000);
        if (ion) { tailGroup.remove(ion); ion.geometry.dispose(); }
        if (dust) { tailGroup.remove(dust); dust.geometry.dispose(); }
        ion = new THREE.Mesh(flaredTube((u, out) => out.copy(A).multiplyScalar(u * len), 3, 55, lowTier ? 100 : 180, 28), ionMat);
        const bend = 0.0007;
        const sideV = V3(side, -0.2, 0).normalize();
        dust = new THREE.Mesh(flaredTube((u, out) => { const a = u * len * 0.85; out.copy(A).multiplyScalar(a).add(sideV.clone().multiplyScalar(a * a * bend)); }, 4, 120, lowTier ? 100 : 180, 28), dustMat);
        ion.frustumCulled = dust.frustumCulled = false;
        tailGroup.add(dust, ion);
        grainMat.uniforms.uDir.value.copy(A); grainMat.uniforms.uSide.value.copy(sideV); grainMat.uniforms.uLen.value = len * 0.85; grainMat.uniforms.uBend.value = bend;
        nucleus.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
        obj.anchor = z;
        obj.behind = len * 0.4;
      },
      update(dt, t) {
        nucleus.rotation.y += dt * 0.05;
        const d = camera.position.distanceTo(group.position);
        const f = distFade(d, 2000, 2800);
        [ionMat, dustMat, grainMat].forEach((m) => { m.uniforms.uTime.value = t; m.uniforms.uFade.value = f; });
        coma1.material.uniforms.uFade.value = f; coma2.material.uniforms.uFade.value = f;
      },
      focusPoint(out) { return out.copy(group.position); },
    };
    return obj;
  };

  /* =====================================================================
     DYSON SWARM — a star wrapped in rings of orbiting mirror panels
     that glint as they turn.
     ===================================================================== */
  H.dyson = function () {
    const group = new THREE.Group();
    const starMat = starSphere('#ffd38a', '#fff6df', 2.6);
    const star = new THREE.Mesh(new THREE.SphereGeometry(26, 96, 64), starMat);
    group.add(star, glowSprite('#ffc977', 260, 4.5, 0.55), glowSprite('#ffdba8', 900, 5.5, 0.12));
    const light = new THREE.PointLight(0xffe2b5, 6, 0, 0);
    group.add(light);
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, metalness: 0.92, roughness: 0.22, emissive: 0x0a0602, fog: false });
    const panelGeo = new THREE.BoxGeometry(5.5, 0.35, 3.6);
    const rings = [];
    const ringDefs = [[62, 0.0, 0.1], [78, 0.45, -0.3], [94, -0.5, 0.6], [112, 1.1, 0.2], [134, -0.2, -0.9], [158, 0.7, 1.2]];
    const per = lowTier ? 220 : 560;
    const dummy = new THREE.Object3D();
    ringDefs.forEach(([r, tx, tz], k) => {
      const holder = new THREE.Group();
      holder.rotation.set(tx, 0, tz);
      const im = new THREE.InstancedMesh(panelGeo, panelMat, per);
      for (let i = 0; i < per; i++) {
        const a = (i / per) * Math.PI * 2 + rnd() * 0.004;
        if (rnd() < 0.12) { dummy.scale.setScalar(0.0001); }
        else dummy.scale.set(range(0.8, 1.3), 1, range(0.8, 1.2));
        const rr = r + gauss() * 1.5;
        dummy.position.set(Math.cos(a) * rr, gauss() * 1.2, Math.sin(a) * rr);
        dummy.lookAt(0, 0, 0);
        dummy.rotateX(Math.PI / 2 + gauss() * 0.15);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.frustumCulled = false;
      holder.add(im);
      group.add(holder);
      rings.push({ im, speed: (0.05 / (1 + k * 0.35)) * (k % 2 ? -1 : 1) });
    });
    scene.add(group);
    const obj = {
      type: 'dyson', group, active: false, anchor: 0, behind: 300, hero: true,
      focus: { near: 150, far: 700, after: 200, strength: 0.8 },
      place(z) {
        const side = sideSign();
        group.position.set(pathX(z) + side * range(230, 280), pathY(z) + range(-30, 30), z);
        group.rotation.set(range(-0.3, 0.3), rnd() * 6, range(-0.2, 0.2));
        obj.light = V3(-side, 0.1, 0).normalize();
        obj.anchor = z;
      },
      update(dt, t) {
        rings.forEach((r) => { r.im.rotation.y += r.speed * dt; });
        starMat.uniforms.uTime.value = t;
        const d = camera.position.distanceTo(group.position);
        starMat.uniforms.uFade.value = distFade(d, 2400, 3200);
        light.intensity = 6 * starMat.uniforms.uFade.value;
      },
      focusPoint(out) { return out.copy(group.position); },
    };
    return obj;
  };

  /* =====================================================================
     SUPERNOVA REMNANT — you fly through the expanding shell of
     glowing filaments around a newborn pulsar.
     ===================================================================== */
  H.supernova = function () {
    const group = new THREE.Group();
    const shellMat = (cA, cB, freq, bright, seed) => new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uA: { value: new THREE.Color(cA) }, uB: { value: new THREE.Color(cB) }, uF: { value: freq }, uI: { value: bright }, uSeed: { value: seed } },
      vertexShader: `varying vec3 vL, vN, vW; void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade, uF, uI, uSeed; uniform vec3 uA, uB; varying vec3 vL, vN, vW;
        ${NOISE(Q.objOct)}
        float ridge(vec3 p) { return 1.0 - abs(fbm(p) * 2.0 - 1.0); }
        void main(){
          vec3 d = normalize(vL);
          vec3 V = normalize(cameraPosition - vW);
          float limb = pow(1.0 / max(abs(dot(normalize(vN), V)), 0.1), 1.6);
          vec3 q = d * uF + uSeed;
          vec3 w = vec3(fbm(q * 0.6), fbm(q * 0.6 + 4.3), fbm(q * 0.6 + 8.1));
          float f1 = pow(ridge(q + w * 1.5), 12.0);
          float f2 = pow(ridge(q * 2.3 + w), 16.0);
          float cloud = smoothstep(0.35, 0.75, fbm(q * 0.8 + 2.0));
          vec3 c = mix(uA, uB, smoothstep(0.3, 0.7, w.x));
          c = mix(c, vec3(1.0, 0.92, 0.8), f2 * 0.5);
          float near = smoothstep(3.0, 70.0, length(cameraPosition - vW));
          float edgeOn = mix(0.04, 1.0, smoothstep(0.2, 0.85, 1.0 - abs(dot(normalize(vN), V))));
          gl_FragColor = vec4(edgeOn * c * (f1 * 0.9 + f2 * 0.6) * limb * 0.03 * uI * near * uFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const outerMat = shellMat('#ff3a2e', '#ff9d6b', 3.2, 1.0, 1.0);
    const innerMat = shellMat('#1fd3c6', '#7ad8ff', 4.5, 0.35, 7.0);
    const sGeo = new THREE.SphereGeometry(1, lowTier ? 96 : 160, lowTier ? 64 : 110);
    const outer = new THREE.Mesh(sGeo, outerMat), inner = new THREE.Mesh(sGeo, innerMat);
    outer.scale.setScalar(240); inner.scale.setScalar(190);
    outer.frustumCulled = inner.frustumCulled = false;
    const core = sun('#cfe0ff', 60);
    group.add(outer, inner, core, glowSprite('#4b78ff', 320, 4, 0.35), glowSprite('#ffffff', 40, 6, 0.8));
    scene.add(group);
    const obj = {
      type: 'supernova', group, active: false, anchor: 0, behind: 320, hero: true,
      focus: { near: 120, far: 600, after: 60, strength: 0.45 },
      place(z) {
        const side = sideSign();
        group.position.set(pathX(z) + side * range(230, 270), pathY(z) + range(-40, 40), z);
        group.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
        obj.anchor = z;
      },
      update(dt, t) {
        group.rotation.y += dt * 0.004;
        const d = camera.position.distanceTo(group.position);
        const f = distFade(d, 2200, 3000);
        [outerMat, innerMat].forEach((m) => { m.uniforms.uTime.value = t; m.uniforms.uFade.value = f; });
        core.material.uniforms.uFade.value = f; core.material.uniforms.uTime.value = t;
      },
      focusPoint(out) { return out.copy(group.position); },
    };
    return obj;
  };

  /* =====================================================================
     STAR NURSERY — towering pillars of dust, edges lit by newborn
     stars, inside a glowing emission cloud.
     ===================================================================== */
  H.pillars = function () {
    const group = new THREE.Group();
    const pillarMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uL: { value: V3(0.2, 1, -0.4).normalize() } },
      vertexShader: /* glsl */ `
        varying vec3 vN, vW, vL; uniform float uTime;
        ${NOISE(4)}
        vec3 disp(vec3 p, vec3 n) { return p + n * ((fbm(p * 0.028 + 3.0) - 0.5) * 15.0 + (noise(p * 0.16) - 0.5) * 2.0); }
        void main(){
          vL = position;
          vec3 nrm = normalize(vec3(normal.x, 0.0, normal.z) + vec3(0.0, normal.y, 0.0) * 0.001);
          vec3 t1 = normalize(vec3(-nrm.z, 0.0, nrm.x)); vec3 t2 = vec3(0.0, 1.0, 0.0);
          vec3 p = disp(position, normal);
          vec3 pa = disp(position + t1 * 1.5, normal); vec3 pb = disp(position + t2 * 1.5, normal);
          vec3 sn = normalize(cross(pa - p, pb - p));
          if (dot(sn, normal) < 0.0) sn = -sn;
          vN = normalize(mat3(modelMatrix) * sn);
          vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uFade, uTime; uniform vec3 uL; varying vec3 vN, vW, vL;
        ${NOISE(4)}
        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(cameraPosition - vW);
          float dif = max(dot(N, uL), 0.0);
          float rim = pow(1.0 - max(dot(N, V), 0.0), 2.5);
          float top = smoothstep(0.6, 1.0, vL.y / 300.0);
          float grit = fbm(vL * 0.12);
          vec3 dust = vec3(0.09, 0.055, 0.035) * (0.5 + grit);
          vec3 lit = vec3(1.0, 0.55, 0.22) * dif * 0.55 + vec3(1.0, 0.72, 0.4) * rim * (0.35 + dif) * 1.6;
          vec3 front = vec3(1.0, 0.85, 0.55) * top * pow(dif, 2.0) * 1.2;
          vec3 c = dust * (0.4 + dif) + lit + front;
          c += vec3(0.2, 0.5, 0.55) * rim * 0.15;
          gl_FragColor = vec4(c * uFade, 1.0);
        }
      `,
    });
    const defs = [[-40, 0, 0, 34, 22, 1.0], [32, -10, -30, 26, 15, 0.8], [80, -20, -70, 20, 12, 0.6]];
    const pillars = [];
    defs.forEach(([x, y, z, rb, rt, h]) => {
      const g = new THREE.CylinderGeometry(rt, rb, 300, 64, 96, false);
      g.translate(0, 150, 0);
      const yMax = 300 * h;
      const m = new THREE.Mesh(g, pillarMat);
      m.scale.y = h;
      m.position.set(x, y - 180, z);
      m.rotation.z = range(-0.08, 0.08);
      m.frustumCulled = false;
      group.add(m);
      pillars.push(m);
      const tip = sun('#fff1d0', 60);
      tip.position.set(x, y - 180 + yMax + 12, z);
      group.add(tip, glowSprite('#ffcf8a', 180, 5, 0.3));
      group.children[group.children.length - 1].position.copy(tip.position);
    });
    // emission cloud around the pillars
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: { uFade: { value: 1 }, uTime: { value: 0 } },
      vertexShader: `attribute float aSeed; varying vec2 vUv; varying float vSeed, vF; void main(){ vUv = uv; vSeed = aSeed; vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0); float s = length((modelMatrix * instanceMatrix)[0].xyz); vF = smoothstep(s * 0.2, s * 0.7, -c.z); gl_Position = projectionMatrix * (c + vec4(position.xy * s, 0.0, 0.0)); }`,
      fragmentShader: /* glsl */ `
        uniform float uFade, uTime; varying vec2 vUv; varying float vSeed, vF;
        ${NOISE(4)}
        void main(){
          vec2 c = vUv - 0.5; float r = length(c) * 2.0; if (r > 1.0) discard;
          vec3 q = vec3(c * 2.5, vSeed * 9.0);
          float n = fbm(q + fbm(q * 1.7));
          vec3 col = mix(vec3(0.05, 0.35, 0.38), vec3(0.75, 0.48, 0.18), smoothstep(0.4, 0.7, n));
          float d = smoothstep(0.3, 0.8, n) * pow(1.0 - r, 1.6);
          gl_FragColor = vec4(col * d * 0.22 * vF * uFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const nC = lowTier ? 10 : 18;
    const cg = new THREE.PlaneGeometry(1, 1);
    const seeds = new Float32Array(nC); for (let i = 0; i < nC; i++) seeds[i] = rnd();
    cg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    const clouds = new THREE.InstancedMesh(cg, cloudMat, nC);
    const dm = new THREE.Object3D();
    for (let i = 0; i < nC; i++) { dm.position.set(gauss() * 120, range(-40, 220), -60 + gauss() * 90); dm.scale.setScalar(range(160, 320)); dm.updateMatrix(); clouds.setMatrixAt(i, dm.matrix); }
    clouds.frustumCulled = false;
    group.add(clouds);
    scene.add(group);
    const obj = {
      type: 'pillars', group, active: false, anchor: 0, behind: 260, hero: true,
      focus: { near: 140, far: 650, after: 160, strength: 0.75 },
      place(z) {
        const side = sideSign();
        group.position.set(pathX(z) + side * range(150, 190), pathY(z) - range(20, 50), z);
        group.rotation.y = side > 0 ? range(-0.6, -0.2) : range(0.2, 0.6);
        obj.anchor = z;
      },
      update(dt, t) {
        const d = camera.position.distanceTo(group.position);
        const f = distFade(d, 2200, 3000);
        pillarMat.uniforms.uFade.value = f; cloudMat.uniforms.uFade.value = f;
      },
      focusPoint(out) { return out.copy(group.position).add(V3(0, 40, 0)); },
    };
    return obj;
  };

  /* =====================================================================
     STAR CANNIBAL — a bloated red giant losing a river of plasma to a
     white dwarf's accretion disk.
     ===================================================================== */
  H.cannibal = function () {
    const group = new THREE.Group();
    const giantMat = starSphere('#a8240a', '#ff7a2a', 2.0);
    const giant = new THREE.Mesh(new THREE.SphereGeometry(70, 128, 96), giantMat);
    giant.scale.set(1.08, 1, 1);
    group.add(giant, glowSprite('#ff5a20', 420, 4.5, 0.3));
    const W = V3(190, 0, 0);
    const dwarf = sun('#d8e6ff', 70);
    dwarf.position.copy(W);
    group.add(dwarf);
    const diskMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade; varying vec2 vP;
        ${NOISE(4)}
        void main(){
          float r = length(vP); float x = (r - 3.0) / 42.0;
          if (x < 0.0 || x > 1.0) discard;
          float ph = atan(vP.y, vP.x) + uTime * 8.0 / pow(r, 1.2);
          float n = fbm(vec3(cos(ph) * 2.0, sin(ph) * 2.0, log(r) * 8.0));
          vec3 c = mix(vec3(0.8, 0.88, 1.0) * 2.5, vec3(1.0, 0.45, 0.15), smoothstep(0.0, 0.8, x));
          float d = smoothstep(0.0, 0.05, x) * pow(1.0 - x, 1.3) * (0.35 + n);
          gl_FragColor = vec4(c * d * 1.3 * uFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const disk = new THREE.Mesh(new THREE.RingGeometry(3, 45, 128, 1), diskMat);
    disk.position.copy(W);
    disk.rotation.set(-Math.PI / 2 + 0.25, 0.1, 0);
    group.add(disk);
    const streamMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: VOL_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade; varying vec2 vUv; varying vec3 vN, vW;
        ${NOISE(4)}
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float core = pow(abs(dot(normalize(vN), V)), 2.0);
          float u = vUv.x;
          float clump = 0.45 + 0.8 * fbm(vec3(vUv.y * 5.0, u * 9.0 - uTime * 0.7, 1.0));
          vec3 c = mix(vec3(1.0, 0.38, 0.1), vec3(1.0, 0.85, 0.6), u);
          gl_FragColor = vec4(c * pow(core, 1.5) * clump * 0.45 * smoothstep(0.0, 0.05, u) * uFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const P0 = V3(72, 2, 0), P1 = V3(150, 4, 70), P2 = V3(W.x + 40, 0, 20);
    const stream = new THREE.Mesh(flaredTube((u, out) => {
      const a = 1 - u;
      out.set(a * a * P0.x + 2 * a * u * P1.x + u * u * P2.x, a * a * P0.y + 2 * a * u * P1.y + u * u * P2.y, a * a * P0.z + 2 * a * u * P1.z + u * u * P2.z);
    }, 7, 3, 120, 24), streamMat);
    stream.frustumCulled = false;
    group.add(stream);
    scene.add(group);
    const obj = {
      type: 'cannibal', group, active: false, anchor: 0, behind: 300, hero: true,
      focus: { near: 160, far: 700, after: 200, strength: 0.8 },
      place(z) {
        const side = sideSign();
        group.position.set(pathX(z) + side * range(250, 300), pathY(z) + range(-40, 40), z);
        group.rotation.set(range(0.15, 0.4), side > 0 ? Math.PI + range(-0.6, 0.6) : range(-0.6, 0.6), range(-0.15, 0.15));
        obj.light = V3(-side, 0, 0);
        obj.anchor = z;
      },
      update(dt, t) {
        const d = camera.position.distanceTo(group.position);
        const f = distFade(d, 2400, 3200);
        giantMat.uniforms.uTime.value = t; giantMat.uniforms.uFade.value = f;
        diskMat.uniforms.uTime.value = t; diskMat.uniforms.uFade.value = f;
        streamMat.uniforms.uTime.value = t; streamMat.uniforms.uFade.value = f;
        dwarf.material.uniforms.uFade.value = f; dwarf.material.uniforms.uTime.value = t;
      },
      focusPoint(out) { return out.copy(group.position).add(V3(95, 0, 0).applyQuaternion(group.quaternion)); },
    };
    return obj;
  };

  /* =====================================================================
     ROGUE WORLD — a starless planet lit only by its own aurora.
     ===================================================================== */
  H.rogue = function () {
    const group = new THREE.Group();
    const R = 130;
    const planetMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: STAR_VS,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade; varying vec3 vN, vW, vL;
        ${NOISE(Q.objOct)}
        void main(){
          vec3 n = normalize(vL); vec3 V = normalize(cameraPosition - vW);
          float f = fbm(n * 5.0); float f2 = fbm(n * 18.0);
          vec3 c = vec3(0.006, 0.007, 0.012) * (0.4 + f + f2 * 0.5);
          float lat = abs(n.y);
          c += vec3(0.05, 0.4, 0.2) * exp(-pow((lat - 0.92) / 0.06, 2.0)) * 0.12;
          float cracks = smoothstep(0.7, 0.78, fbm(n * 14.0 + 3.0));
          c += vec3(0.8, 0.18, 0.04) * cracks * 0.015;
          float rim = pow(1.0 - max(dot(normalize(vN), V), 0.0), 5.0);
          c += vec3(0.25, 0.4, 0.9) * rim * 0.18;
          gl_FragColor = vec4(c * uFade, 1.0);
        }
      `,
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 96), planetMat);
    group.add(planet);
    const auroraMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
      vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade; varying vec2 vUv; varying vec3 vW;
        ${NOISE(4)}
        void main(){
          float a = vUv.x * 6.2831; float h = vUv.y;
          float wav = fbm(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 0.05)) * 3.0;
          float rays = pow(noise(vec3(a * 40.0 + wav * 6.0, h * 2.0, uTime * 0.4)), 2.5);
          float curtain = (0.4 + rays * 1.6) * smoothstep(0.0, 0.08, h) * exp(-h * 3.2);
          vec3 c = mix(vec3(0.15, 1.0, 0.5), vec3(0.6, 0.2, 1.0), smoothstep(0.15, 0.7, h));
          c = mix(c, vec3(1.0, 0.25, 0.35), smoothstep(0.7, 1.0, h) * 0.6);
          float near = smoothstep(4.0, 50.0, length(cameraPosition - vW));
          gl_FragColor = vec4(c * curtain * 0.7 * near * uFade, 1.0);
        }
      `,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    [1, -1].forEach((s) => {
      const lat = 0.38;
      const g = new THREE.CylinderGeometry(R * Math.sin(lat) * 1.04, R * Math.sin(lat) * 1.0, 36, 160, 1, true);
      g.translate(0, 18, 0);
      const m = new THREE.Mesh(g, auroraMat);
      m.position.y = s * R * Math.cos(lat);
      if (s < 0) m.rotation.x = Math.PI;
      m.frustumCulled = false;
      group.add(m);
    });
    scene.add(group);
    const obj = {
      type: 'rogue', group, active: false, anchor: 0, behind: 300, hero: true,
      focus: { near: 160, far: 650, after: 200, strength: 0.7 },
      place(z) {
        const side = sideSign();
        group.position.set(pathX(z) + side * range(200, 240), pathY(z) + range(-70, -20), z);
        group.rotation.set(range(0.3, 0.6) * sideSign(), rnd() * 6, range(-0.3, 0.3));
        obj.anchor = z;
      },
      update(dt, t) {
        const d = camera.position.distanceTo(group.position);
        const f = distFade(d, 2200, 3000);
        planetMat.uniforms.uFade.value = f; auroraMat.uniforms.uFade.value = f;
        auroraMat.uniforms.uTime.value = t;
        planet.rotation.y += dt * 0.01;
      },
      focusPoint(out) { return out.copy(group.position); },
    };
    return obj;
  };

  /* =====================================================================
     CRYSTAL FIELD — a drift of glowing crystal shards you fly through.
     ===================================================================== */
  H.crystals = function () {
    const group = new THREE.Group();
    const count = lowTier ? 260 : 650;
    const geo = new THREE.OctahedronGeometry(1, 0);
    const cols = new Float32Array(count * 3);
    const crystalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uPx: skyUniforms.uPx, uTravel: skyUniforms.uTravel },
      vertexShader: /* glsl */ `
        attribute vec3 aCol; varying vec3 vCol, vN, vW, vL;
        void main(){
          vCol = aCol; vL = position;
          mat4 m = modelMatrix * instanceMatrix;
          vN = normalize(mat3(m) * normal);
          vec4 w = m * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uFade, uPx, uTravel; varying vec3 vCol, vN, vW, vL;
        ${NOISE(3)}
        ${SKY_GLSL}
        void main(){
          vec3 N = normalize(vN); vec3 V = normalize(cameraPosition - vW);
          float fr = pow(1.0 - abs(dot(N, V)), 3.0);
          vec3 rf = refract(-V, N, 0.66);
          vec3 inner = vCol * (0.25 + 1.4 * pow(fbm(vL * 2.0 + vCol * 9.0 + uTime * 0.05), 2.0));
          vec3 disp = vec3(skyDir(normalize(rf + 0.02)).r, skyDir(normalize(rf)).g, skyDir(normalize(rf - 0.02)).b) * 6.0;
          vec3 c = inner + disp + vec3(0.85, 0.92, 1.0) * fr * 0.9;
          c += vCol * pow(max(dot(reflect(-V, N), normalize(vec3(0.3, 1.0, 0.2))), 0.0), 30.0) * 1.5;
          float near = smoothstep(1.5, 12.0, length(cameraPosition - vW));
          gl_FragColor = vec4(c * uFade * near, 1.0);
        }
      `,
    });
    const im = new THREE.InstancedMesh(geo, crystalMat, count);
    geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(cols, 3));
    im.frustumCulled = false;
    group.add(im);
    const glowA = glowSprite('#7ff0ff', 260, 4, 0.12), glowB = glowSprite('#ff7ad9', 220, 4, 0.12);
    group.add(glowA, glowB);
    scene.add(group);
    const PAL = ['#5ff3ff', '#a06bff', '#ff6fd0', '#7dffc7', '#ffffff'].map((h) => new THREE.Color(h));
    const dm = new THREE.Object3D();
    const obj = {
      type: 'crystals', group, active: false, anchor: 0, behind: 120, hero: true,
      focus: { near: 0, far: 1, after: 1, strength: 0 },
      place(z) {
        group.position.set(0, 0, 0);
        const len = 520;
        for (let i = 0; i < count; i++) {
          const zz = z - rnd() * len;
          const a = rnd() * Math.PI * 2;
          const big = rnd() < 0.05;
          const r = big ? range(45, 130) : 10 + Math.pow(rnd(), 0.6) * 110;
          dm.position.set(pathX(zz) + Math.cos(a) * r, pathY(zz) + Math.sin(a) * r * 0.7, zz);
          dm.rotation.set(rnd() * 6, rnd() * 6, rnd() * 6);
          const s = big ? range(6, 14) : range(0.6, 3.2);
          dm.scale.set(s, s * range(1.8, 4.0), s);
          dm.updateMatrix();
          im.setMatrixAt(i, dm.matrix);
          const c = pick(PAL); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
        }
        im.instanceMatrix.needsUpdate = true;
        geo.attributes.aCol.needsUpdate = true;
        glowA.position.set(pathX(z - 150) + 70, pathY(z - 150) + 20, z - 150);
        glowB.position.set(pathX(z - 350) - 80, pathY(z - 350) - 10, z - 350);
        obj.anchor = z;
        obj.behind = len + 80;
      },
      update(dt, t) {
        crystalMat.uniforms.uTime.value = t;
        const d = Math.abs(camera.position.z - (obj.anchor - 260));
        crystalMat.uniforms.uFade.value = distFade(d, 1400, 2200);
      },
      focusPoint(out) { return out.set(0, 0, obj.anchor); },
    };
    return obj;
  };

  return H;
}
