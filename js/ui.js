// All rendering and click handling. Receives data and callbacks; holds no game rules.
const UI = (() => {
  const app = document.getElementById("app");
  const stage = document.getElementById("stage");
  let current = null;
  let tick = null;
  let qState = null;

  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let revealTimers = [];             // the row-by-row scoreboard reveal
  function clearTimers() {
    if (tick) { clearInterval(tick); tick = null; }
    revealTimers.forEach(clearTimeout); revealTimers = [];
  }

  // Which music plays on which screen. Other screens (questions, scoreboards) have none.
  const MUSIC_FOR = { splash: "splash", landing: "splash", hostSetup: "splash", joinSetup: "splash", connecting: "splash", lobby: "lobby" };
  const reducedMotion = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  function show(name, html) {
    clearTimers(); current = name;
    if (typeof Fx !== "undefined") Fx.stop();
    if (typeof Sound !== "undefined") Sound.music(MUSIC_FOR[name] || null);
    stage.className = name === "splash" ? "stage splash-stage" : "stage";
    app.className = name === "splash" ? "splash" : "panel";
    app.innerHTML = html;
  }

  const ART = "assets/splash.jpg";
  const artUrl = () => `${ART}?v=${typeof BUILD === "undefined" ? "0" : BUILD}`;
  // The blurred artwork behind every screen. If the image is missing the plain dark background shows.
  function setArt() {
    document.documentElement.style.setProperty("--art", `url("${new URL(artUrl(), document.baseURI).href}")`);   // CSS resolves urls against the stylesheet, so make it absolute
  }
  const $ = id => document.getElementById(id);

  const medal = rank => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank);

  function standingsTable(list, me) {
    return `<table class="standings"><tbody>${list.map(s => `
      <tr class="row pending ${s.id === me ? "me" : ""} ${s.rank === 1 && s.score > 0 ? "lead" : ""} ${s.connected ? "" : "gone"}" data-rank="${s.rank}">
        <td class="rank">${medal(s.rank)}</td>
        <td class="name">${esc(s.name)}${s.id === me ? ' <span class="you">you</span>' : ""}${s.connected ? "" : ' <span class="muted">(left)</span>'}</td>
        <td class="gain">${s.gained > 0 ? "+" + s.gained : ""}</td>
        <td class="score">${s.score}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  // ---------- simple screens ----------
  function splash(h) {
    show("splash", `
      <div class="splash-art" id="splash-art">
        <img src="${artUrl()}" alt="Cranial Combat: Trivia Showdown. A glowing blue brain faces a flaming orange brain." width="1024" height="478">
        <span class="clash" aria-hidden="true"></span>
      </div>
      <button class="primary start" id="start-game">Start Game</button>`);
    const img = app.querySelector("img");
    // No artwork: show the title as text so the screen still works.
    img.onerror = () => {
      $("splash-art").innerHTML = `<h1 class="fallback-title">Cranial Combat<small>Trivia Showdown</small></h1>`;
    };
    $("start-game").onclick = h.onStart;
  }

  function landing(h) {
    show("landing", `
      <h1>Cranial Combat<small>Trivia Showdown</small></h1>
      <p class="muted">Host a game and share the code, or join a friend's game.</p>
      <button class="primary" id="host">Host a Game</button>
      <button class="secondary" id="join">Join a Game</button>
      <p class="build">Build ${typeof BUILD === "undefined" ? "unknown" : esc(BUILD)}</p>`);
    $("host").onclick = h.onHost;
    $("join").onclick = h.onJoin;
  }

  function hostSetup(h) {
    show("hostSetup", `
      <h1>Host a Game</h1>
      <label for="name">Your name</label>
      <input id="name" maxlength="${CONFIG.maxNameLength}" autocomplete="off" value="${esc(h.name || "")}">
      <p class="form-error" id="form-error" role="alert">${esc(h.error || "")}</p>
      <button class="primary" id="create">Create Game</button>
      <button class="secondary" id="back">Back</button>`);
    const go = () => h.onCreate($("name").value);
    $("create").onclick = go;
    $("back").onclick = h.onBack;
    $("name").onkeydown = e => { if (e.key === "Enter") go(); };
    $("name").oninput = () => formError("");
    $("name").focus();
  }

  function joinSetup(h) {
    show("joinSetup", `
      <h1>Join a Game</h1>
      <label for="code">Join code</label>
      <input id="code" class="code-input" maxlength="${CONFIG.codeLength}" autocomplete="off" value="${esc(h.code || "")}">
      <label for="name">Your name</label>
      <input id="name" maxlength="${CONFIG.maxNameLength}" autocomplete="off" value="${esc(h.name || "")}">
      <p class="form-error" id="form-error" role="alert">${esc(h.error || "")}</p>
      <button class="primary" id="go">Join</button>
      <button class="secondary" id="back">Back</button>`);
    const go = () => h.onJoin($("code").value, $("name").value);
    $("go").onclick = go;
    $("back").onclick = h.onBack;
    $("code").oninput = e => { e.target.value = e.target.value.toUpperCase(); formError(""); };
    $("name").onkeydown = e => { if (e.key === "Enter") go(); };
    $("name").oninput = () => formError("");
    ($("code").value ? $("name") : $("code")).focus();
  }

  // Inline message on the host / join forms.
  function formError(text) {
    const el = $("form-error");
    if (el) el.textContent = text;
  }

  function connecting(text, sub) {
    show("connecting", `<h1>${esc(text)}</h1><p class="muted">${esc(sub || "One moment…")}</p>`);
  }

  function loading(text) {
    show("loading", `<h1>Get ready!</h1><p class="muted">${esc(text)}</p><div class="spinner"></div>`);
  }

  // Optional second button (label2, onClick2) is shown as the quieter choice.
  function message(title, text, label, onClick, label2, onClick2) {
    show("message", `
      <h1>${esc(title)}</h1>
      <p class="muted">${esc(text)}</p>
      <button class="primary" id="ok">${esc(label)}</button>
      ${label2 ? `<button class="secondary" id="ok2">${esc(label2)}</button>` : ""}`);
    $("ok").onclick = onClick;
    if (label2) $("ok2").onclick = onClick2;
  }

  // A thin strip over the top of any screen ("Reconnecting…"). It lives outside the screen area,
  // so changing screens doesn't remove it. banner(null) hides it.
  function banner(text) {
    let el = document.getElementById("conn-banner");
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement("div");
      el.id = "conn-banner"; el.className = "conn-banner";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
  }

  // ---------- lobby ----------
  function fillCategories(sel, categories, selectedId) {
    sel.innerHTML = `<option value="">🎲 Random (all categories)</option>` +
      categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("");
    sel.value = selectedId == null ? "" : String(selectedId);
  }

  function playersHtml(players, me) {
    return players.map(p => `
      <li class="${p.connected ? "" : "gone"}">${esc(p.name)}
        ${p.id === "host" ? '<span class="tag">host</span>' : ""}
        ${p.id === me ? '<span class="you">you</span>' : ""}</li>`).join("");
  }

  // ---------- lobby chat ----------
  let chatDraft = "";      // what is typed but not sent, kept when the lobby is redrawn
  let lastSent = "";       // restored to the box if the host refuses the message

  function chatRender(messages, me) {
    const log = $("chat-log");
    if (!log) return;
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.textContent = "";
    messages.forEach(m => {
      const row = document.createElement("div");
      if (m.system) {
        row.className = "msg sys";
        row.textContent = m.text;
      } else {
        row.className = "msg" + (m.from.id === me ? " mine" : "");
        const who = document.createElement("span");
        who.className = "who";
        who.textContent = m.from.name;
        row.appendChild(who);
        row.appendChild(document.createTextNode(m.text));      // text only, so nothing typed can become markup
      }
      log.appendChild(row);
    });
    const last = messages[messages.length - 1];
    if (nearBottom || (last && last.from && last.from.id === me)) log.scrollTop = log.scrollHeight;
  }

  function chatUpdate(messages, me) { chatRender(messages, me); }

  function chatError(text) {
    const el = $("chat-error");
    if (!el) return;
    el.textContent = text || "";
    const input = $("chat-input");
    if (text && input && !input.value && lastSent) { input.value = lastSent; chatDraft = lastSent; }
  }

  // s: { code, players, me, isHost, category, categories, note, chat, onCategory, onStart, onChat, onLeave }
  function lobby(s) {
    const link = /^https?:/.test(location.protocol) ? `${location.origin}${location.pathname}#${s.code}` : null;
    const catName = s.category ? s.category.name : "Random (all categories)";

    if (current === "lobby") {   // update in place so an open dropdown isn't disturbed
      $("lobby-players").innerHTML = playersHtml(s.players, s.me);
      $("lobby-count").textContent = s.players.length;
      $("lobby-note").textContent = s.note || "";
      if (s.isHost) {
        const sel = $("category");
        if (sel.options.length - 1 !== s.categories.length) fillCategories(sel, s.categories, s.category && s.category.id);
      } else {
        $("lobby-cat").textContent = catName;
      }
      return;
    }

    show("lobby", `
      <div class="topbar"><span>Game lobby</span><span><span id="lobby-count">${s.players.length}</span> / ${CONFIG.maxPlayers} players</span></div>
      <div class="code-label">Join code</div>
      <div class="code-big">${esc(s.code)}</div>
      ${link && s.isHost ? `<p class="muted small">or share <span class="mono">${esc(link)}</span></p>` : ""}
      <div class="lobby-cat">
        ${s.isHost
          ? `<label for="category">Category</label><select id="category"></select>`
          : `<div class="code-label">Category</div><div id="lobby-cat" class="cat-name">${esc(catName)}</div>`}
      </div>
      <ul class="players" id="lobby-players">${playersHtml(s.players, s.me)}</ul>
      <div class="chat">
        <h2>Chat</h2>
        <div class="chat-log" id="chat-log" role="log" aria-live="polite"></div>
        <form class="chat-form" id="chat-form" autocomplete="off">
          <input id="chat-input" maxlength="${CONFIG.chatMaxLength}" placeholder="Say something…" aria-label="Chat message">
          <button type="submit" id="chat-send">Send</button>
        </form>
        <p class="form-error" id="chat-error" role="alert"></p>
      </div>
      <p class="note" id="lobby-note">${esc(s.note || "")}</p>
      ${s.isHost
        ? `<button class="primary" id="start">Start Game</button>`
        : `<p class="muted">Waiting for the host to start…</p>`}
      <button class="secondary" id="leave">${s.isHost ? "Cancel Game" : "Leave"}</button>`);

    if (s.isHost) {
      fillCategories($("category"), s.categories, s.category && s.category.id);
      $("category").onchange = e => s.onCategory(e.target.value === "" ? null : Number(e.target.value));
      $("start").onclick = s.onStart;
    }
    $("leave").onclick = s.onLeave;

    chatRender(s.chat || [], s.me);
    const input = $("chat-input");
    input.value = chatDraft;
    input.oninput = () => { chatDraft = input.value; chatError(""); };
    $("chat-form").onsubmit = e => {
      e.preventDefault();
      const text = input.value;
      if (!text.trim()) return;
      lastSent = text;
      input.value = "";
      chatDraft = "";
      chatError("");
      s.onChat(text);
    };
  }

  // ---------- question ----------
  // msg: question message. ctx: { me, score, onAnswer(index) }
  function question(msg, ctx) {
    show("question", `
      <div class="topbar">
        <span>${esc(msg.roundName)} · Question ${msg.qIndex} of ${msg.qTotal}</span>
        <span>Your score: ${ctx.score}</span>
      </div>
      <div class="timer"><div class="timer-bar" id="bar"></div></div>
      <div class="timer-text"><span id="secs">${Math.ceil(msg.durationMs / 1000)}</span>s</div>
      <span class="badge ${esc(msg.difficulty)}">${esc(msg.roundName)} · ${msg.points} pts</span>
      <span class="badge category">${esc(msg.category)}</span>
      <div class="question">${esc(msg.question)}</div>
      <div class="answers" id="answers">
        ${msg.answers.map((a, i) => `<button data-i="${i}" data-k="${"ABCD"[i]}">${esc(a)}</button>`).join("")}
      </div>
      <div class="status" id="status"></div>`);

    qState = { id: msg.id, answered: false, total: ctx.total };
    const buttons = Array.from(document.querySelectorAll("#answers button"));
    const lockAll = () => buttons.forEach(b => { b.disabled = true; });

    // A player who came back mid-question: show an answer they already gave.
    if (msg.picked !== undefined && msg.picked !== null && buttons[msg.picked]) {
      qState.answered = true;
      buttons[msg.picked].classList.add("picked");
      lockAll();
      $("status").textContent = "Answer locked in. Waiting for the others…";
    }

    const shownAt = performance.now();
    buttons.forEach(b => {
      b.onclick = () => {
        if (qState.answered) return;
        // A double click on the host's Next button can land here: ignore clicks right after render.
        if (performance.now() - shownAt < CONFIG.answerGuardMs) return;
        qState.answered = true;
        b.classList.add("picked");
        lockAll();
        $("status").textContent = "Answer locked in. Waiting for the others…";
        ctx.onAnswer(Number(b.dataset.i));
      };
    });

    // Countdown bar. Time runs from the moment the question arrives here.
    const bar = $("bar");
    if (msg.totalMs && msg.durationMs < msg.totalMs) {   // joined part-way through: start the bar partly used
      bar.style.clipPath = `inset(0 ${Math.round(100 * (1 - msg.durationMs / msg.totalMs))}% 0 0)`;
    }
    bar.style.transition = `clip-path ${msg.durationMs}ms linear`;
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.clipPath = "inset(0 100% 0 0)"; }));
    const end = performance.now() + msg.durationMs;
    tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      const secs = $("secs");
      if (secs) secs.textContent = left;
      const track = document.querySelector(".timer");
      if (track && left <= 5) track.classList.add("urgent");
      if (left <= 0 && !qState.answered) {
        qState.answered = true;
        lockAll();
        $("status").textContent = "⏰ Time's up!";
      }
    }, 200);
  }

  function progress(msg, me, playerCount) {
    if (current !== "question" || !qState || qState.id !== msg.id) return;
    if (msg.answered.includes(me)) {
      $("status").textContent = `Answer locked in. ${msg.answered.length} of ${playerCount} answered…`;
    }
  }

  // ---------- sound button and button clicks ----------
  function setup() {
    if (typeof Sound === "undefined") return;
    Sound.unlockOnGesture();
    const btn = document.createElement("button");
    btn.id = "sound-btn"; btn.type = "button"; btn.className = "sound-btn";
    const paint = () => {
      const m = Sound.isMuted();
      btn.textContent = m ? "🔇" : "🔊";
      btn.setAttribute("aria-label", m ? "Turn sound on" : "Turn sound off");
      btn.title = m ? "Turn sound on" : "Turn sound off";
    };
    paint();
    btn.onclick = () => Sound.toggle();
    Sound.onChange(paint);
    document.body.appendChild(btn);
    // One click sound for every button; answers and Ready have their own.
    document.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("button");
      if (!b || b.disabled || b.id === "sound-btn") return;
      Sound.play(b.dataset.sfx || (b.closest("#answers") ? "select" : "click"));
    });
  }
  const play = (name, opts) => { if (typeof Sound !== "undefined") Sound.play(name, opts); };

  // ---------- Ready ----------
  // Everyone presses Ready after a question and after a round scoreboard; the host's screen also
  // gets "Continue anyway" for a player who is connected but not pressing it.
  let readyCtx = null;               // { h, me, ids, mine }

  function readyBlock(h, hidden) {
    return `
      <div class="ready${hidden ? " pending" : ""}" id="ready-area">
        <button class="primary" id="ready" data-sfx="ready">Ready</button>
        <p class="status center" id="ready-status" role="status"></p>
        ${h.isHost ? `<button class="secondary" id="force">Continue anyway</button>` : ""}
      </div>`;
  }

  function wireReady(h, me, ids) {
    readyCtx = { h, me, ids: ids || [], mine: (ids || []).includes(me) };
    $("ready").onclick = () => {
      if (readyCtx.mine) return;
      readyCtx.mine = true;
      renderReady();
      h.onReady();
    };
    if (h.isHost) $("force").onclick = () => h.onForce();
    renderReady();
  }

  function renderReady() {
    const btn = $("ready"), st = $("ready-status");
    if (!btn || !readyCtx) return;
    const { h, ids, mine } = readyCtx;
    btn.disabled = mine;
    btn.textContent = mine ? "Ready ✓" : "Ready";
    const live = h.players().filter(p => p.connected);
    const waiting = live.filter(p => !ids.includes(p.id));
    const names = waiting.slice(0, 3).map(p => esc(p.name)).join(", ") + (waiting.length > 3 ? ` +${waiting.length - 3} more` : "");
    st.innerHTML = !waiting.length ? "Everyone is ready…"
      : `${live.length - waiting.length} of ${live.length} ready` + (mine ? `. Waiting for ${names}` : "");
  }

  // ids: who has pressed Ready (omit to just redraw, e.g. after the player list changed)
  function readyUpdate(ids) {
    if (!readyCtx || !$("ready")) return;
    if (ids) { readyCtx.ids = ids; readyCtx.mine = ids.includes(readyCtx.me) || readyCtx.mine; }
    renderReady();
  }

  // ---------- reveal after a question ----------
  // msg: reveal message. q: the question message it belongs to. h: { isHost, players, onReady, onForce }
  function reveal(msg, q, me, h) {
    const mine = msg.results.find(r => r.id === me);
    let headline = "⏰ Time's up!", cls = "bad", sfx = "wrong";
    if (mine && mine.correct) { headline = `✅ Correct! +${mine.gained}`; cls = "good"; sfx = "correct"; }
    else if (mine && mine.choice !== null) { headline = "❌ Not quite"; cls = "bad"; }
    const finalRound = q.round === q.rounds;
    const next = !msg.lastOfRound ? "" : finalRound ? "Next: the final standings." : "Next: the round scoreboard.";

    show("reveal", `
      <div class="topbar">
        <span>${esc(q.roundName)} · Question ${q.qIndex} of ${q.qTotal}</span>
        <span class="badge category">${esc(q.category)}</span>
      </div>
      <div class="headline ${cls}">${headline}</div>
      <div class="question small-q">${esc(q.question)}</div>
      <div class="answers">
        ${q.answers.map((a, i) => `<button disabled data-k="${"ABCD"[i]}" class="${i === msg.correctIndex ? "correct" : ""} ${mine && i === mine.choice && i !== msg.correctIndex ? "wrong" : ""}">${esc(a)}</button>`).join("")}
      </div>
      <div class="score-line">Your score <b>${mine ? mine.score : 0}</b></div>
      ${readyBlock(h)}
      ${next ? `<p class="muted center small">${next}</p>` : ""}`);
    wireReady(h, me, msg.ready);
    if (!msg.resumed) play(sfx);
  }

  // ---------- scoreboards: rows appear one at a time, last place first ----------
  // root: element holding the rows (tr.row[data-rank]). opts: { instant, onWinner(rows), onDone() }
  function revealBoard(root, opts) {
    const rows = Array.from(root.querySelectorAll("tr.row"));
    const ranks = Array.from(new Set(rows.map(r => Number(r.dataset.rank)))).sort((x, y) => y - x);   // last place first
    const groups = ranks.map(rank => ({ rank, rows: rows.filter(r => Number(r.dataset.rank) === rank) }));
    let gi = 0, finished = false, winnerShown = false;
    const later = (fn, ms) => revealTimers.push(setTimeout(fn, ms));

    const showWinner = g => {
      if (winnerShown) return;
      winnerShown = true;
      if (opts.onWinner) opts.onWinner(g.rows);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      revealTimers.forEach(clearTimeout); revealTimers = [];
      groups.forEach(g => g.rows.forEach(r => r.classList.remove("pending")));
      if (groups.length && !opts.noWinner) showWinner(groups[groups.length - 1]);
      opts.onDone();
    };

    if (opts.instant || reducedMotion() || !groups.length) { finish(); return { skip: finish }; }

    const step = () => {
      if (finished) return;
      const g = groups[gi];
      const reveal = () => {
        if (finished) return;
        g.rows.forEach(r => { r.classList.remove("pending"); r.classList.add("shown"); });
        gi++;
        if (g.rank === 1 || gi >= groups.length) {
          showWinner(g);
          later(() => { finished = true; opts.onDone(); }, 900);
        } else {
          play("tick", { n: gi });
          later(step, CONFIG.revealRowMs);
        }
      };
      if (g.rank === 1 || gi === groups.length - 1) {            // first place: a drumroll, then the reveal
        play("drumroll");
        later(reveal, CONFIG.revealWinnerPauseMs);
      } else reveal();
    };
    later(step, 700);
    return { skip: finish };
  }

  // msg: roundEnd message. h: as for reveal
  function roundEnd(msg, me, h) {
    show("roundEnd", `
      <h1>${esc(msg.roundName)} complete!</h1>
      <div class="board" id="board">
        ${standingsTable(msg.standings.map(s => Object.assign({}, s, { gained: 0 })), me)}
      </div>
      <p class="muted center small" id="skip-hint">Tap the scoreboard to skip the countdown.</p>
      <p class="muted center">Up next: <strong>${esc(msg.nextRoundName)}</strong>, ${msg.nextPoints} points per question.</p>
      ${readyBlock(h, true)}`);
    wireReady(h, me, msg.ready);
    const done = () => { const area = $("ready-area"); if (area) area.classList.remove("pending"); const hint = $("skip-hint"); if (hint) hint.remove(); };
    const board = revealBoard($("board"), { instant: msg.resumed, noWinner: true, onDone: done });
    $("board").onclick = () => board.skip();
  }

  // ---------- final results ----------
  // s: { me, isHost, onReturn, onExit }
  function gameOver(msg, s) {
    const top = msg.standings.filter(p => p.rank === 1);
    const banner = top.length > 1
      ? `It's a tie! ${top.map(p => esc(p.name)).join(" & ")}`
      : `${esc(top[0].name)} wins!`;

    show("gameOver", `
      <h1>Final Standings</h1>
      <div class="winner pending" id="winner">${banner}</div>
      <div class="board" id="board">
        <table class="standings final">
          <thead><tr><th></th><th>Player</th>${msg.rounds.map(r => `<th>${esc(r.name)}</th>`).join("")}<th>Total</th></tr></thead>
          <tbody>${msg.standings.map(p => `
            <tr class="row pending ${p.id === s.me ? "me" : ""} ${p.rank === 1 ? "lead" : ""} ${p.connected ? "" : "gone"}" data-rank="${p.rank}">
              <td class="rank">${medal(p.rank)}</td>
              <td class="name">${esc(p.name)}${p.id === s.me ? ' <span class="you">you</span>' : ""}</td>
              ${p.roundScores.map(x => `<td>${x}</td>`).join("")}
              <td class="score">${p.score}</td>
            </tr>`).join("")}</tbody>
        </table>
      </div>
      <p class="muted center small" id="skip-hint">Tap the scoreboard to skip the countdown.</p>
      <div class="end-buttons pending" id="end-buttons">
        <button class="primary" id="return">Return to Lobby</button>
        <button class="secondary" id="exit">Exit Game</button>
      </div>`);

    const celebrate = () => {
      $("winner").classList.remove("pending");
      $("winner").classList.add("shown");
      play("crash"); setTimeout(() => play("fanfare"), 120); setTimeout(() => play("applause"), 700);
      if (typeof Fx !== "undefined") {
        Fx.celebrate({ ms: CONFIG.celebrationMs, onLaunch: () => play("launch"), onBurst: () => { play("burst"); if (Math.random() < 0.5) play("crackle"); } });
      }
    };
    const done = () => {
      $("end-buttons").classList.remove("pending");
      const hint = $("skip-hint"); if (hint) hint.remove();
    };
    // A player who came back after the reveal just sees the final table, with no replay.
    if (msg.resumed) { $("winner").classList.remove("pending"); }
    const board = revealBoard($("board"), { instant: msg.resumed, noWinner: !!msg.resumed, onWinner: celebrate, onDone: done });
    $("board").onclick = () => board.skip();

    gameOverButtons(s);
  }

  // Leaving as host ends the game for everyone, so that choice asks first.
  function gameOverButtons(s) {
    $("return").onclick = s.onReturn;
    $("exit").onclick = () => {
      if (!s.isHost) { s.onExit(); return; }
      $("end-buttons").innerHTML = `
        <p class="center">End the game for everyone?</p>
        <button class="primary" id="exit-yes">Yes, exit</button>
        <button class="secondary" id="exit-no">Stay</button>`;
      $("exit-yes").onclick = s.onExit;
      $("exit-no").onclick = () => {
        $("end-buttons").innerHTML = `
          <button class="primary" id="return">Return to Lobby</button>
          <button class="secondary" id="exit">Exit Game</button>`;
        gameOverButtons(s);
      };
    };
  }

  return {
    setup, splash, setArt, banner, readyUpdate, landing, hostSetup, joinSetup, formError, connecting, loading, message,
    lobby, chatUpdate, chatError, question, progress, reveal, roundEnd, gameOver,
    isShowing: name => current === name,
  };
})();
