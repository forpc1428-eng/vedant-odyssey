/* =====================================================================
   CINEMA — pre-rendered, full-detail clips stitched into the live
   starfield. The live flight never stops: each clip fades in from the
   stars, plays as you scroll (faster, slower or backwards), and fades
   back into the stars before the next one.
   ===================================================================== */
const CLIPS = [
  'c1_blackhole', 'c3_dyson', 'c2_comet', 'c5_pillars',
  'c4_pulsar', 'c6_supernova', 'c7_cannibal', 'c8_crystals',
];
const CLIP_LEN = 7.0;     // seconds of footage per clip
const BRIDGE = 2.6;       // seconds of live starfield between clips
const FADE = 1.1;         // cross-fade time at each end of a clip
const SLOT = CLIP_LEN + BRIDGE;

export function makeCinema() {
  const layer = document.createElement('div');
  layer.id = 'cinema';
  document.body.appendChild(layer);
  const vids = CLIPS.map((name, i) => {
    const v = document.createElement('video');
    v.src = `clips/${name}.mp4`;
    v.muted = true; v.playsInline = true; v.loop = false;
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.preload = i < 2 ? 'auto' : 'metadata';
    v.style.opacity = '0';
    layer.appendChild(v);
    return v;
  });
  let clock = 0;            // journey time in seconds (can run backwards)
  let current = -1;

  function slotOf(t) {
    const total = SLOT * CLIPS.length;
    const tt = ((t % total) + total) % total;
    const i = Math.floor(tt / SLOT);
    return { i, local: tt - i * SLOT };
  }

  // Returns how much the clip covers the screen (0..1) so the live scene can relax underneath.
  function update(dt, rate) {
    clock += dt * rate;
    const { i, local } = slotOf(clock);
    const inClip = local < CLIP_LEN;
    const a = inClip ? Math.min(1, local / FADE, (CLIP_LEN - local) / FADE) : 0;
    const ease = a * a * (3 - 2 * a);
    // preload the next clip a little ahead
    const nxt = vids[(i + 1) % vids.length];
    if (nxt.preload !== 'auto') nxt.preload = 'auto';
    vids.forEach((v, k) => {
      if (k !== i) {
        if (v.style.opacity !== '0') v.style.opacity = '0';
        if (!v.paused) v.pause();
        return;
      }
      v.style.opacity = ease.toFixed(3);
      if (!inClip) { if (!v.paused) v.pause(); return; }
      const target = Math.max(0, Math.min(CLIP_LEN - 0.05, local));
      if (rate > 0.05) {
        const pr = Math.max(0.25, Math.min(4, rate));
        if (Math.abs(v.playbackRate - pr) > 0.05) v.playbackRate = pr;
        if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
        if (Math.abs(v.currentTime - target) > 0.35) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > 0.08) v.currentTime = target;
      }
    });
    current = i;
    return ease;
  }
  // Some mobile browsers only allow playback after a touch: unlock all clips on the first one.
  const unlock = () => { vids.forEach((v) => { const p = v.play(); if (p && p.then) p.then(() => v.pause()).catch(() => {}); }); removeEventListener('touchstart', unlock); removeEventListener('click', unlock); };
  addEventListener('touchstart', unlock, { passive: true });
  addEventListener('click', unlock);
  return { update, get clip() { return current; } };
}
