/**
 * Chronology field — an SPD-style density curve behind the home page.
 *
 * One continuous multimodal curve rests on the footer axis strip: unevenly
 * clustered gaussian modes summed across the full width over a nonzero
 * probability floor, roughened by deterministic value noise, the profile of
 * a summed probability distribution of radiocarbon dates. Modes drift and
 * breathe slowly so the landscape wanders.
 * Peak-normalised so the tallest point always reaches its target height.
 *
 * Scroll settles the field (fade + flatten via `presence`); the cursor gently
 * lifts the curve near it. Respects prefers-reduced-motion (one static frame),
 * pauses when the tab is hidden, adapts to the light/dark accent colour, and
 * never blocks clicks.
 */
(function () {
  const canvas = document.getElementById('chronology-field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const SPEED = 0.36; // drift/breathe speed
  const FILL_A = 0.08;
  const STROKE_A = 0.35;
  const PEAK = 0.52; // tallest mode, as a fraction of the band height

  // A composed SPD: modes clustered unevenly so the profile booms and busts
  // instead of scalloping. The adjacent pairs (0.5 + 0.565, 0.71 + 0.755) sum
  // into flat-topped plateaus and asymmetric rises — the calibration-plateau
  // signature. mu is a fraction of the width; w is relative height.
  const MODES = [
    { mu: 0.045, sigma: 0.05, w: 0.3 },
    { mu: 0.135, sigma: 0.055, w: 0.52 },
    { mu: 0.305, sigma: 0.06, w: 0.4 },
    { mu: 0.435, sigma: 0.035, w: 0.78 },
    { mu: 0.5, sigma: 0.05, w: 1.0 },
    { mu: 0.565, sigma: 0.038, w: 0.88 },
    { mu: 0.71, sigma: 0.055, w: 0.62 },
    { mu: 0.755, sigma: 0.032, w: 0.48 },
    { mu: 0.9, sigma: 0.06, w: 0.28 },
  ].map((m, i) => ({
    ...m,
    // small drift so the plateau pairs never wander apart into twin peaks
    driftAmp: 0.008 + 0.008 * ((i * 7919) % 3),
    driftPhase: i * 2.39996, // golden-angle offsets so modes never sync
    driftFreq: 0.22 + 0.09 * i,
    breathePhase: i * 1.7,
    breatheFreq: 0.35 + 0.11 * i,
  }));

  // Accent colour is read from the active theme and re-read on theme toggle.
  let accent = { r: 220, g: 53, b: 34 };
  function readAccent() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--global-theme-color').trim();
    const m = v.match(/^#?([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      accent = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
  }
  readAccent();
  new MutationObserver(readAccent).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  let W = 0, H = 0, dpr = 1;
  // target = raw pointer x; mouse = smoothed pointer that eases toward it
  const target = { x: -1, active: false };
  const mouse = { x: -1, infl: 0 };
  const FOLLOW = 0.04;

  // Scroll-linked presence: full at the top of the page, settled away after
  // ~1.2 viewports of scrolling. Drives canvas opacity directly (composited,
  // works even under reduced motion) and flattens the curve in draw().
  let presence = 1;
  function readScroll() {
    const span = Math.max(window.innerHeight * 1.2, 1);
    const p = Math.min(Math.max(window.scrollY / span, 0), 1);
    presence = 1 - p * p * (3 - 2 * p); // smoothstep out
    canvas.style.opacity = presence.toFixed(3);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Deterministic 1D value noise (hash-based, no Math.random). Low octaves
  // smooth-step; the top octave interpolates linearly so the finest wiggles
  // keep sharp corners, like calibration-curve jitter, not a sine ripple.
  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }
  function vnoise(x, smooth) {
    const i = Math.floor(x);
    const f = x - i;
    const u = smooth ? f * f * (3 - 2 * f) : f;
    return hash(i) * (1 - u) + hash(i + 1) * u;
  }
  // three octaves drifting at different rates so the roughness wanders
  // with the modes instead of shimmering; returns -1..1
  function jitter(x, t) {
    const n =
      0.5 * vnoise(x * 31 + t * 0.35, true) +
      0.32 * vnoise(x * 67 - t * 0.22, true) +
      0.18 * vnoise(x * 121 + t * 0.14, false);
    return (n - 0.5) * 2;
  }

  // probability floor: a real SPD never dies to zero mid-range
  const BASELINE = 0.09;

  function densityAt(x, t) {
    let y = BASELINE;
    for (const m of MODES) {
      const mu = m.mu + m.driftAmp * Math.sin(t * m.driftFreq + m.driftPhase);
      const amp = m.w * (0.82 + 0.18 * Math.sin(t * m.breatheFreq + m.breathePhase));
      const d = (x - mu) / m.sigma;
      y += amp * Math.exp(-0.5 * d * d);
    }
    return y * (1 + 0.07 * jitter(x, t));
  }

  function draw(now) {
    const t = reduce.matches ? 3.2 : ((now - t0) / 1000) * SPEED;

    if (!reduce.matches) {
      mouse.x += (target.x - mouse.x) * FOLLOW;
      mouse.infl += ((target.active ? 1 : 0) - mouse.infl) * (FOLLOW * 0.8);
    }
    const mx = mouse.x / Math.max(W, 1);

    ctx.clearRect(0, 0, W, H);
    // flatten toward the axis as the page scrolls, so the curve settles
    // (in step with the opacity fade) instead of cutting out
    const rowH = (H - 10) * (0.65 + 0.35 * presence);
    // enough samples that the top noise octave (freq 121) renders as
    // structure instead of aliasing
    const N = 240;

    // sample, then peak-normalise so the tallest mode always reaches PEAK
    const raw = [];
    let dmax = 0;
    for (let i = 0; i <= N; i++) {
      const d = densityAt(i / N, t);
      if (d > dmax) dmax = d;
      raw.push(d);
    }
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const x = i / N;
      // cursor gently lifts the curve near it (post-normalisation, so the
      // overall height budget is unaffected elsewhere)
      const lift = 1 + 0.22 * Math.exp(-Math.pow((x - mx) / 0.08, 2)) * mouse.infl;
      pts.push([x * W, H - (raw[i] / dmax) * PEAK * lift * rowH]);
    }

    // straight segments, like a plotted density — quadratic smoothing here
    // would filter the calibration jitter back out
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(W, H);
    ctx.closePath();
    // denser toward the axis, like an OxCal posterior fill
    const grad = ctx.createLinearGradient(0, H - PEAK * rowH, 0, H);
    grad.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},${FILL_A * 0.35})`);
    grad.addColorStop(1, `rgba(${accent.r},${accent.g},${accent.b},${FILL_A})`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = `rgba(${accent.r},${accent.g},${accent.b},${STROKE_A})`;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    if (running && !reduce.matches) raf = requestAnimationFrame(draw);
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let running = false;
  let raf = null;
  let t0 = performance.now();

  function start() {
    if (running || reduce.matches) return;
    running = true;
    t0 = performance.now();
    raf = requestAnimationFrame(draw);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  window.addEventListener('pointermove', (e) => {
    target.x = e.clientX - canvas.getBoundingClientRect().left;
    target.active = true;
  });
  window.addEventListener('pointerleave', () => (target.active = false));
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', () => {
    resize();
    readScroll();
    if (reduce.matches || !running) draw(performance.now());
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  reduce.addEventListener('change', () => {
    if (reduce.matches) {
      stop();
      draw(performance.now());
    } else {
      start();
    }
  });

  resize();
  readScroll();
  if (reduce.matches) draw(performance.now());
  else start();
})();
