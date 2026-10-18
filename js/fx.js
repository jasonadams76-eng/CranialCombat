// Winner celebration: confetti and fireworks drawn on a full-screen canvas. No libraries.
//
//   Fx.celebrate({ ms, onLaunch, onBurst })   start; the callbacks let the sound module play along
//   Fx.stop()                                 end it early (called whenever the screen changes)
const Fx = (() => {
  const COLORS = ["#28d4ff", "#ff7a1a", "#ffffff", "#ffd23f", "#7dffb0", "#ff5a9e"];
  const MAX_PARTICLES = 450;       // keeps phones smooth
  let run = null;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function stop() {
    if (!run) return;
    cancelAnimationFrame(run.raf);
    clearTimeout(run.timer);
    run.timers.forEach(clearTimeout);
    window.removeEventListener("resize", run.size);
    if (run.canvas.parentNode) run.canvas.parentNode.removeChild(run.canvas);
    run = null;
  }

  function celebrate(opts) {
    stop();
    opts = opts || {};
    const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ms = opts.ms || 9000;
    // Reduced motion: no flashing or movement. The sounds still play, and the screen shows a steady glow.
    if (reduced) {
      if (opts.onBurst) opts.onBurst();
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.className = "fx-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;
    const size = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px"; canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener("resize", size);

    const confetti = [], sparks = [], rockets = [];
    const state = { canvas, size, raf: 0, timer: 0, timers: [] };
    run = state;
    const startedAt = performance.now();
    let last = startedAt;

    function addConfetti(n) {
      for (let i = 0; i < n && confetti.length < MAX_PARTICLES; i++) {
        confetti.push({
          x: rand(0, w), y: rand(-h * 0.3, -10), vx: rand(-40, 40), vy: rand(90, 220),
          rot: rand(0, 6.28), vr: rand(-6, 6), sw: rand(6, 12), sh: rand(3, 7), color: pick(COLORS), wob: rand(0, 6.28),
        });
      }
    }
    function launch() {
      const x = rand(w * 0.15, w * 0.85), peak = rand(h * 0.15, h * 0.45);
      rockets.push({ x, y: h + 10, vy: -rand(520, 680), peak, color: pick(COLORS) });
      if (opts.onLaunch) opts.onLaunch();
    }
    function burst(x, y, color) {
      const count = Math.min(70, MAX_PARTICLES - sparks.length);
      for (let i = 0; i < count; i++) {
        const a = rand(0, 6.28), sp = rand(60, 260);
        sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: rand(0.5, 0.9), color: Math.random() < 0.7 ? color : "#ffffff" });
      }
      if (opts.onBurst) opts.onBurst();
    }

    // A first shower and burst right away, then rockets at a steady rhythm until the time is up.
    addConfetti(120);
    const launchEnd = ms * 0.75;
    for (let t = 150; t < launchEnd; t += rand(500, 850)) state.timers.push(setTimeout(launch, t));
    for (let t = 400; t < launchEnd; t += rand(900, 1500)) state.timers.push(setTimeout(() => addConfetti(40), t));
    state.timer = setTimeout(stop, ms);

    function frame(now) {
      if (run !== state) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, w, h);

      confetti.forEach(c => {
        c.wob += dt * 3; c.x += (c.vx + Math.sin(c.wob) * 40) * dt; c.y += c.vy * dt; c.rot += c.vr * dt;
        ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot); ctx.fillStyle = c.color;
        ctx.fillRect(-c.sw / 2, -c.sh / 2, c.sw, c.sh); ctx.restore();
      });
      for (let i = confetti.length - 1; i >= 0; i--) if (confetti[i].y > h + 20) confetti.splice(i, 1);

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.y += r.vy * dt; r.vy += 160 * dt;
        ctx.fillStyle = r.color; ctx.globalAlpha = 0.9; ctx.fillRect(r.x - 1.5, r.y, 3, 10); ctx.globalAlpha = 1;
        if (r.y <= r.peak || r.vy > -60) { burst(r.x, r.y, r.color); rockets.splice(i, 1); }
      }

      ctx.globalCompositeOperation = "lighter";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.vy += 180 * dt; s.vx *= 0.985; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= s.decay * dt;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";

      state.raf = requestAnimationFrame(frame);
    }
    state.raf = requestAnimationFrame(frame);
  }

  return { celebrate, stop, active: () => !!run };
})();
