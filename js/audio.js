// Sound: music and effects, made in the browser with the Web Audio API. No audio files are needed.
// To use a recording instead of a built-in sound, name its file in CONFIG.audioFiles (see config.js).
//
//   Sound.unlockOnGesture()   browsers only allow sound after a tap or key press; call once at startup
//   Sound.music("lobby")      start looping music (splash | lobby), or Sound.music(null) for silence
//   Sound.play("correct")     a one-off effect
//   Sound.toggle()            mute / unmute (remembered between visits)
const Sound = (() => {
  const MUTE_KEY = "tsMuted";
  const hz = n => 440 * Math.pow(2, (n - 69) / 12);          // MIDI note number to frequency
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- building blocks (work on a live or an offline context) ----------
  function osc(ctx, out, o) {
    const gain = o.gain == null ? 0.3 : o.gain, attack = o.attack || 0.005, release = o.release || 0.05;
    const src = ctx.createOscillator(), g = ctx.createGain();
    src.type = o.type || "sine";
    src.frequency.setValueAtTime(o.freq, o.t);
    if (o.to) src.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur);
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.linearRampToValueAtTime(gain, o.t + attack);
    g.gain.setValueAtTime(gain, o.t + Math.max(attack, o.dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    let tail = src;
    if (o.lp) {                                                // soften harsh waveforms
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp;
      src.connect(f); tail = f;
    }
    tail.connect(g); g.connect(out);
    src.start(o.t); src.stop(o.t + o.dur + 0.05);
  }

  const noiseCache = new WeakMap();
  function noiseBuffer(ctx) {
    let b = noiseCache.get(ctx);
    if (!b) {
      b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache.set(ctx, b);
    }
    return b;
  }
  function noise(ctx, out, o) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuffer(ctx); src.loop = true;
    f.type = o.type || "highpass"; f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.freq || 4000, o.t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, o.t + o.dur);
    const gain = o.gain == null ? 0.3 : o.gain;
    g.gain.setValueAtTime(0.0001, o.t);
    g.gain.linearRampToValueAtTime(gain, o.t + (o.attack || 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, o.t + o.dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(o.t, Math.random()); src.stop(o.t + o.dur + 0.05);
  }

  const kick = (c, out, t, gain) => {
    osc(c, out, { freq: 150, to: 42, t, dur: 0.16, gain: gain || 0.9, release: 0.1 });
    noise(c, out, { t, dur: 0.02, gain: 0.15, type: "lowpass", freq: 900 });
  };
  const snare = (c, out, t, gain) => {
    noise(c, out, { t, dur: 0.16, gain: gain || 0.3, type: "bandpass", freq: 1900, q: 0.8 });
    osc(c, out, { type: "triangle", freq: 210, to: 120, t, dur: 0.09, gain: (gain || 0.3) * 0.6 });
  };
  const hat = (c, out, t, gain) => noise(c, out, { t, dur: 0.04, gain: gain || 0.1, type: "highpass", freq: 8000 });

  // ---------- one-off effects:  fn(ctx, out, startTime, opts) ----------
  const EFFECTS = {
    click(c, out, t) {
      osc(c, out, { type: "square", freq: 1400, to: 900, t, dur: 0.045, gain: 0.1, lp: 5000 });
      noise(c, out, { t, dur: 0.02, gain: 0.06, freq: 6000 });
    },
    select(c, out, t) {                                          // picking an answer
      osc(c, out, { type: "triangle", freq: hz(76), t, dur: 0.07, gain: 0.25 });
      osc(c, out, { type: "triangle", freq: hz(83), t: t + 0.06, dur: 0.1, gain: 0.25 });
    },
    ready(c, out, t) {
      osc(c, out, { type: "triangle", freq: hz(79), t, dur: 0.08, gain: 0.25 });
      osc(c, out, { type: "triangle", freq: hz(86), t: t + 0.07, dur: 0.14, gain: 0.25 });
      osc(c, out, { type: "sine", freq: hz(98), t: t + 0.12, dur: 0.18, gain: 0.08 });
    },
    correct(c, out, t) {
      [84, 88, 91, 96].forEach((n, i) => osc(c, out, { type: "triangle", freq: hz(n), t: t + i * 0.075, dur: 0.28, gain: 0.26 }));
      osc(c, out, { type: "sine", freq: hz(72), t, dur: 0.6, gain: 0.18, attack: 0.02, release: 0.3 });
      noise(c, out, { t: t + 0.22, dur: 0.3, gain: 0.05, freq: 7000 });
    },
    wrong(c, out, t) {
      osc(c, out, { type: "sawtooth", freq: 233, to: 196, t, dur: 0.22, gain: 0.2, lp: 1200 });
      osc(c, out, { type: "sawtooth", freq: 175, to: 110, t: t + 0.2, dur: 0.38, gain: 0.22, lp: 900 });
    },
    tick(c, out, t, o) {                                         // a row of the scoreboard appearing
      const n = Math.min((o && o.n) || 0, 8);
      osc(c, out, { type: "triangle", freq: hz(67 + n * 2), t, dur: 0.14, gain: 0.26 });
      noise(c, out, { t, dur: 0.03, gain: 0.08, freq: 5000 });
    },
    drumroll(c, out, t) {                                        // builds before first place
      let at = t, gap = 0.11;
      for (let i = 0; at < t + 1.7; i++) {
        noise(c, out, { t: at, dur: 0.07, gain: 0.06 + 0.22 * ((at - t) / 1.7), type: "bandpass", freq: 2000, q: 0.7 });
        at += gap; gap = Math.max(0.035, gap * 0.93);
      }
    },
    crash(c, out, t) {
      noise(c, out, { t, dur: 1.7, gain: 0.4, freq: 5500, to: 2500 });
      noise(c, out, { t, dur: 0.5, gain: 0.2, type: "bandpass", freq: 900, q: 0.6 });
      osc(c, out, { freq: 90, to: 38, t, dur: 0.5, gain: 0.55, release: 0.3 });
    },
    fanfare(c, out, t) {
      const stab = (notes, at, dur, gain) => notes.forEach(n => {
        osc(c, out, { type: "sawtooth", freq: hz(n), t: at, dur, gain: gain, lp: 2200, attack: 0.01, release: dur * 0.5 });
        osc(c, out, { type: "triangle", freq: hz(n + 12), t: at, dur, gain: gain * 0.6, attack: 0.01, release: dur * 0.5 });
      });
      stab([67], t, 0.16, 0.12);
      stab([72], t + 0.18, 0.16, 0.12);
      stab([76], t + 0.36, 0.16, 0.12);
      stab([60, 64, 67, 72, 79], t + 0.56, 1.3, 0.09);
    },
    launch(c, out, t) {                                          // a rocket going up
      osc(c, out, { freq: 500, to: 2300, t, dur: 0.7, gain: 0.1, attack: 0.03, release: 0.2 });
      noise(c, out, { t, dur: 0.7, gain: 0.05, type: "bandpass", freq: 2600, q: 1.5 });
    },
    burst(c, out, t) {                                           // and exploding
      noise(c, out, { t, dur: 0.7, gain: 0.5, type: "bandpass", freq: 2600, to: 400, q: 0.7 });
      osc(c, out, { freq: 140, to: 40, t, dur: 0.4, gain: 0.55, release: 0.25 });
      noise(c, out, { t, dur: 0.16, gain: 0.2, freq: 6500 });
    },
    crackle(c, out, t) {
      for (let i = 0; i < 16; i++) noise(c, out, { t: t + rand(0.05, 0.9), dur: 0.025, gain: rand(0.08, 0.2), freq: rand(4500, 9000) });
    },
    applause(c, out, t) {
      for (let i = 0; i < 110; i++) {
        const at = t + rand(0, 2.8), swell = Math.sin(Math.PI * Math.min(1, (at - t) / 2.8));
        noise(c, out, { t: at, dur: rand(0.03, 0.08), gain: rand(0.04, 0.16) * (0.3 + swell), type: "bandpass", freq: rand(1500, 3800), q: 0.8 });
      }
    },
  };

  // ---------- music: a step sequencer. play(ctx, out, step, time, stepSeconds) is called for every 16th note ----------
  const MUSIC = {
    // Arena rock-electronic in A minor: driving bass, arpeggio, a lead melody in the second half.
    splash: (() => {
      const bass = [45, 41, 48, 43];
      const chords = [[57, 60, 64, 69], [53, 57, 60, 65], [60, 64, 67, 72], [55, 59, 62, 67]];
      const arp = [0, 1, 2, 3, 2, 1, 2, 3];
      const lead = [
        [[0, 76, 3], [4, 72, 2], [6, 74, 2], [8, 76, 4]],
        [[0, 77, 3], [4, 74, 2], [6, 72, 2], [8, 69, 4]],
        [[0, 76, 3], [4, 79, 2], [6, 76, 2], [8, 72, 4]],
        [[0, 74, 3], [4, 71, 2], [6, 74, 2], [8, 67, 4], [12, 71, 2]],
      ];
      return {
        bpm: 124, steps: 128,
        play(c, out, step, t, sd) {
          const bar = Math.floor(step / 16), s = step % 16, ch = bar % 4;
          if (s % 4 === 0) kick(c, out, t, 0.8);
          if (s === 4 || s === 12) snare(c, out, t, 0.26);
          if (s % 2 === 1 || s === 2 || s === 6) hat(c, out, t, s % 2 ? 0.05 : 0.09);
          if ([0, 3, 6, 8, 10, 12, 14].includes(s)) osc(c, out, { type: "sawtooth", freq: hz(bass[ch]), t, dur: sd * 1.6, gain: 0.2, lp: 420, release: 0.08 });
          if (s % 2 === 0) osc(c, out, { type: "sawtooth", freq: hz(chords[ch][arp[(s / 2) % 8]]), t, dur: sd * 1.5, gain: 0.05, lp: 2200, release: 0.08 });
          if (s === 0) chords[ch].forEach(n => osc(c, out, { type: "triangle", freq: hz(n - 12), t, dur: sd * 16, gain: 0.035, attack: 0.25, release: 0.5 }));
          if (bar >= 4) lead[ch].forEach(([at, n, len]) => { if (at === s) osc(c, out, { type: "square", freq: hz(n), t, dur: sd * len * 0.9, gain: 0.05, lp: 3000, release: 0.06 }); });
        },
      };
    })(),

    // Lighter and slower for the lobby: soft groove in C major with bell notes.
    lobby: (() => {
      const bass = [48, 45, 41, 43];
      const chords = [[60, 64, 67, 72], [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67]];
      const arp = [0, 1, 2, 3, 2, 1, 2, 3];
      const bell = [[], [], [[0, 84, 4], [6, 83, 2], [8, 79, 4]], [[0, 81, 4], [6, 79, 2], [8, 76, 4], [12, 79, 2]]];
      return {
        bpm: 96, steps: 64,
        play(c, out, step, t, sd) {
          const bar = Math.floor(step / 16), s = step % 16;
          if (s === 0 || s === 8) kick(c, out, t, 0.5);
          if (s === 4 || s === 12) noise(c, out, { t, dur: 0.07, gain: 0.1, type: "bandpass", freq: 3500, q: 1 });
          if (s % 2 === 1) hat(c, out, t, 0.04);
          if ([0, 6, 8, 14].includes(s)) osc(c, out, { type: "sine", freq: hz(bass[bar]), t, dur: sd * 2.4, gain: 0.3, release: 0.1 });
          if (s % 2 === 0) osc(c, out, { type: "triangle", freq: hz(chords[bar][arp[(s / 2) % 8]]), t, dur: sd * 2.2, gain: 0.1, release: 0.12 });
          bell[bar].forEach(([at, n, len]) => { if (at === s) osc(c, out, { type: "sine", freq: hz(n), t, dur: sd * len, gain: 0.09, release: sd * len * 0.7 }); });
        },
      };
    })(),
  };

  // ---------- live playback ----------
  let ctx = null, master = null, musicBus = null, sfxBus = null;
  let unlocked = false;
  let muted = false;
  let wanted = null;                 // the music that should be playing
  let current = null;                // { name, stop() } the music that is
  let lastClick = 0;
  const buffers = {};                // recordings named in CONFIG.audioFiles, once loaded
  const listeners = [];

  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) { /* ignore */ }

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    const comp = ctx.createDynamicsCompressor();                 // keeps loud moments from clipping
    master = ctx.createGain(); master.gain.value = 0.9;
    musicBus = ctx.createGain(); musicBus.gain.value = 0.3;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8;
    musicBus.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    decodeIfNeeded();
    return ctx;
  }

  // Recordings named in CONFIG.audioFiles. The bytes are fetched in the background as soon as the page opens
  // (one file at a time); a track is only decoded when it is needed, because decoded audio is large (~40 MB for
  // two minutes of stereo) and a phone should not hold two at once.
  const raw = {};                    // name -> downloaded bytes
  const fileState = {};              // name -> "loading" | "ready" | "failed"
  const files = () => (typeof CONFIG !== "undefined" && CONFIG.audioFiles) || {};
  const WAIT_FOR_FILE_MS = 2500;     // how long music waits for a recording before the built-in tune stands in
  let waitTimer = 0, waitFrom = 0;

  // Adds the build id to a file address so a changed recording is never served from an old cache.
  const stamped = url => (typeof BUILD !== "undefined" && BUILD) ? url + (url.indexOf("?") < 0 ? "?" : "&") + "v=" + BUILD : url;

  function prefetch() {
    const names = Object.keys(files()).filter(n => files()[n] && !fileState[n]);
    if (typeof fetch !== "function") return;
    names.forEach(n => { fileState[n] = "loading"; });
    names.reduce((chain, n) => chain.then(() =>
      fetch(stamped(files()[n])).then(r => { if (!r.ok) throw new Error("missing"); return r.arrayBuffer(); })
        .then(bytes => { raw[n] = bytes; decodeIfNeeded(); })
        .catch(() => { fileState[n] = "failed"; applyMusic(); })), Promise.resolve());
  }

  // Decode the recording that is wanted now (music), and any sound effect recordings (small).
  function decodeIfNeeded() {
    if (!ctx) return;
    Object.keys(raw).forEach(n => {
      if (buffers[n] || !raw[n] || raw[n] === "busy") return;
      const isMusic = !!MUSIC[n];
      if (isMusic && n !== wanted) return;
      const bytes = raw[n]; raw[n] = "busy";
      ctx.decodeAudioData(bytes.slice(0)).then(buf => {
        raw[n] = bytes; buffers[n] = buf; fileState[n] = "ready";
        if (n === wanted) applyMusic();
      }).catch(() => { raw[n] = bytes; fileState[n] = "failed"; applyMusic(); });
    });
  }

  // Free the decoded copy of music that is no longer wanted.
  function releaseOthers() {
    Object.keys(buffers).forEach(n => { if (MUSIC[n] && n !== wanted && !(current && current.name === n)) delete buffers[n]; });
  }

  const running = () => !!ctx && ctx.state === "running";

  function play(name, opts) {
    if (muted || !ensure()) return;
    if (name === "click") { const n = Date.now(); if (n - lastClick < 40) return; lastClick = n; }
    if (!running()) { ctx.resume && ctx.resume(); if (!running()) return; }
    const t = ctx.currentTime + 0.01;
    if (buffers[name]) {
      const s = ctx.createBufferSource(); s.buffer = buffers[name]; s.connect(sfxBus); s.start(t);
    } else if (EFFECTS[name]) {
      try { EFFECTS[name](ctx, sfxBus, t, opts || {}); } catch (e) { /* a sound must never break the game */ }
    }
  }

  function stopMusic() {
    if (!current) return;
    const m = current; current = null;
    m.stop();
  }

  function startMusic(name) {
    const out = ctx.createGain(), now = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, now); out.gain.linearRampToValueAtTime(1, now + 0.8);   // fade in
    out.connect(musicBus);
    const fadeOut = cleanup => {
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0.0001, t + 0.5);
      setTimeout(() => { cleanup(); try { out.disconnect(); } catch (e) { /* ignore */ } }, 650);
    };
    if (buffers[name]) {
      const g = ctx.createGain(); g.gain.value = (typeof CONFIG !== "undefined" && CONFIG.musicFileGain) || 0.8; g.connect(out);   // recordings are mastered loud
      const s = ctx.createBufferSource(); s.buffer = buffers[name]; s.loop = true; s.connect(g); s.start();
      current = { name, file: true, stop: () => fadeOut(() => { try { s.stop(); } catch (e) { /* ignore */ } }) };
      return;
    }
    const def = MUSIC[name];
    if (!def) return;
    const sd = 60 / def.bpm / 4;
    let step = 0, next = ctx.currentTime + 0.1;
    const timer = setInterval(() => {                           // schedules a little ahead of the clock
      if (next < ctx.currentTime - 0.3) next = ctx.currentTime + 0.05;
      while (next < ctx.currentTime + 0.3) {
        try { def.play(ctx, out, step % def.steps, next, sd); } catch (e) { /* ignore */ }
        next += sd; step++;
      }
    }, 80);
    current = { name, stop: () => { clearInterval(timer); fadeOut(() => {}); } };
  }

  function applyMusic() {
    if (!wanted || muted || !running() || document.visibilityState === "hidden") { stopMusic(); return; }
    if (current && current.name === wanted) return;
    stopMusic();
    // A recording is configured for this music: wait for it (a short while) instead of starting the built-in tune.
    const configured = !!files()[wanted] && fileState[wanted] !== "failed";
    if (configured && !buffers[wanted]) {
      decodeIfNeeded();
      if (!waitFrom) waitFrom = Date.now();
      const left = WAIT_FOR_FILE_MS - (Date.now() - waitFrom);
      if (left > 0) { clearTimeout(waitTimer); waitTimer = setTimeout(applyMusic, Math.min(left, 400)); return; }
    }
    waitFrom = 0; clearTimeout(waitTimer);
    startMusic(wanted);
    releaseOthers();
  }

  function unlock() {
    if (!ensure()) return;
    unlocked = true;
    const done = () => applyMusic();
    if (ctx.state === "running") done();
    else if (ctx.resume) ctx.resume().then(done, () => {});
  }

  function unlockOnGesture() {
    prefetch();                                                // start downloading recordings right away
    const handler = () => unlock();
    ["pointerdown", "touchend", "keydown", "click"].forEach(ev => document.addEventListener(ev, handler, { capture: true, passive: true }));
    document.addEventListener("visibilitychange", () => {      // phones lock or switch apps: pause the music, resume on return
      if (document.visibilityState === "hidden") stopMusic();
      else if (unlocked && ctx && ctx.resume) ctx.resume().then(applyMusic, () => {});
    });
  }

  function music(name) { if (name !== wanted) waitFrom = 0; wanted = name || null; applyMusic(); }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) { /* ignore */ }
    applyMusic();
    listeners.forEach(fn => fn(muted));
  }

  // Renders a sound offline and reports how loud it is. Used by the tests, since nobody is listening there.
  function renderForTest(kind, name, seconds) {
    const rate = 22050, off = new OfflineAudioContext(1, Math.floor(rate * seconds), rate);
    const out = off.createGain(); out.connect(off.destination);
    if (kind === "effect") EFFECTS[name](off, out, 0.01, { n: 3 });
    else {
      const def = MUSIC[name], sd = 60 / def.bpm / 4;
      for (let step = 0, t = 0.01; t < seconds; step++, t += sd) def.play(off, out, step % def.steps, t, sd);
    }
    return off.startRendering().then(buf => {
      const d = buf.getChannelData(0);
      let peak = 0, sum = 0, bad = 0;
      for (let i = 0; i < d.length; i++) { const v = d[i]; if (!isFinite(v)) bad++; peak = Math.max(peak, Math.abs(v)); sum += v * v; }
      return { peak, rms: Math.sqrt(sum / d.length), bad, samples: d.length };
    });
  }

  return {
    unlockOnGesture, play, music, setMuted, toggle: () => setMuted(!muted),
    isMuted: () => muted, onChange: fn => listeners.push(fn),
    playing: () => current ? { name: current.name, file: !!current.file } : null,     // for tests
    effects: Object.keys(EFFECTS), tracks: Object.keys(MUSIC), renderForTest,
  };
})();
