// All rendering and click handling. Receives data and callbacks; holds no game rules.
const UI = (() => {
  const app = document.getElementById("app");
  let current = null;
  let tick = null;
  let qState = null;

  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function clearTimers() { if (tick) { clearInterval(tick); tick = null; } }
  function show(name, html) { clearTimers(); current = name; app.innerHTML = html; }
  const $ = id => document.getElementById(id);

  // Counts down in the element with the given id.
  function countdown(id, ms, prefix) {
    const end = performance.now() + ms;
    const update = () => {
      const el = $(id);
      if (!el) return;
      el.textContent = `${prefix} ${Math.max(0, Math.ceil((end - performance.now()) / 1000))}s`;
    };
    update();
    tick = setInterval(update, 250);
  }

  const medal = rank => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank);

  function standingsTable(list, me) {
    return `<table class="standings"><tbody>${list.map(s => `
      <tr class="${s.id === me ? "me" : ""} ${s.connected ? "" : "gone"}">
        <td class="rank">${medal(s.rank)}</td>
        <td class="name">${esc(s.name)}${s.id === me ? ' <span class="you">you</span>' : ""}${s.connected ? "" : ' <span class="muted">(left)</span>'}</td>
        <td class="gain">${s.gained > 0 ? "+" + s.gained : ""}</td>
        <td class="score">${s.score}</td>
      </tr>`).join("")}</tbody></table>`;
  }

  // ---------- simple screens ----------
  function landing(h) {
    show("landing", `
      <h1>🏆 Trivia Showdown</h1>
      <p class="muted">Multiplayer trivia. Host a game and share the code, or join a friend's game.</p>
      <button class="primary" id="host">Host a Game</button>
      <button class="secondary" id="join">Join a Game</button>`);
    $("host").onclick = h.onHost;
    $("join").onclick = h.onJoin;
  }

  function hostSetup(h) {
    show("hostSetup", `
      <h1>Host a Game</h1>
      <label for="name">Your name</label>
      <input id="name" maxlength="${CONFIG.maxNameLength}" autocomplete="off" value="${esc(h.name || "")}">
      <button class="primary" id="create">Create Game</button>
      <button class="secondary" id="back">Back</button>`);
    const go = () => h.onCreate($("name").value);
    $("create").onclick = go;
    $("back").onclick = h.onBack;
    $("name").onkeydown = e => { if (e.key === "Enter") go(); };
    $("name").focus();
  }

  function joinSetup(h) {
    show("joinSetup", `
      <h1>Join a Game</h1>
      <label for="code">Join code</label>
      <input id="code" class="code-input" maxlength="${CONFIG.codeLength}" autocomplete="off" value="${esc(h.code || "")}">
      <label for="name">Your name</label>
      <input id="name" maxlength="${CONFIG.maxNameLength}" autocomplete="off" value="${esc(h.name || "")}">
      <button class="primary" id="go">Join</button>
      <button class="secondary" id="back">Back</button>`);
    const go = () => h.onJoin($("code").value, $("name").value);
    $("go").onclick = go;
    $("back").onclick = h.onBack;
    $("code").oninput = e => { e.target.value = e.target.value.toUpperCase(); };
    $("name").onkeydown = e => { if (e.key === "Enter") go(); };
    ($("code").value ? $("name") : $("code")).focus();
  }

  function connecting(text) {
    show("connecting", `<h1>${esc(text)}</h1><p class="muted">One moment…</p>`);
  }

  function loading(text) {
    show("loading", `<h1>Get ready!</h1><p class="muted">${esc(text)}</p><div class="spinner"></div>`);
  }

  function message(title, text, label, onClick) {
    show("message", `
      <h1>${esc(title)}</h1>
      <p class="muted">${esc(text)}</p>
      <button class="primary" id="ok">${esc(label)}</button>`);
    $("ok").onclick = onClick;
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

  // s: { code, players, me, isHost, category, categories, note, canStart, onCategory, onStart, onLeave }
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
  }

  // ---------- question ----------
  // msg: question message. ctx: { me, score, onAnswer(index) }
  function question(msg, ctx) {
    show("question", `
      <div class="topbar">
        <span>Round ${msg.round} of ${msg.rounds} · Question ${msg.qIndex} of ${msg.qTotal}</span>
        <span>Your score: ${ctx.score}</span>
      </div>
      <div class="timer"><div class="timer-bar" id="bar"></div></div>
      <div class="timer-text"><span id="secs">${Math.ceil(msg.durationMs / 1000)}</span>s</div>
      <span class="badge ${esc(msg.difficulty)}">${esc(msg.difficulty)} · ${msg.points} pts</span>
      <span class="badge category">${esc(msg.category)}</span>
      <div class="question">${esc(msg.question)}</div>
      <div class="answers" id="answers">
        ${msg.answers.map((a, i) => `<button data-i="${i}">${esc(a)}</button>`).join("")}
      </div>
      <div class="status" id="status"></div>`);

    qState = { id: msg.id, answered: false, total: ctx.total };
    const buttons = Array.from(document.querySelectorAll("#answers button"));
    const lockAll = () => buttons.forEach(b => { b.disabled = true; });

    buttons.forEach(b => {
      b.onclick = () => {
        if (qState.answered) return;
        qState.answered = true;
        b.classList.add("picked");
        lockAll();
        $("status").textContent = "Answer locked in. Waiting for the others…";
        ctx.onAnswer(Number(b.dataset.i));
      };
    });

    // Countdown bar. Time runs from the moment the question arrives here.
    const bar = $("bar");
    bar.style.transition = `width ${msg.durationMs}ms linear`;
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = "0%"; }));
    const end = performance.now() + msg.durationMs;
    tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      const secs = $("secs");
      if (secs) secs.textContent = left;
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

  // ---------- reveal / standings ----------
  // msg: reveal message. q: the question message it belongs to.
  function reveal(msg, q, me) {
    const mine = msg.results.find(r => r.id === me);
    let headline = "⏰ Time's up!", cls = "bad";
    if (mine && mine.correct) { headline = `✅ Correct! +${mine.gained}`; cls = "good"; }
    else if (mine && mine.choice !== null) { headline = "❌ Not quite"; cls = "bad"; }

    show("reveal", `
      <div class="topbar">
        <span>Round ${q.round} of ${q.rounds} · Question ${q.qIndex} of ${q.qTotal}</span>
        <span class="badge category">${esc(q.category)}</span>
      </div>
      <div class="headline ${cls}">${headline}</div>
      <div class="question small-q">${esc(q.question)}</div>
      <div class="answers">
        ${q.answers.map((a, i) => `<button disabled class="${i === msg.correctIndex ? "correct" : ""} ${mine && i === mine.choice && i !== msg.correctIndex ? "wrong" : ""}">${esc(a)}</button>`).join("")}
      </div>
      <h2>Standings</h2>
      ${standingsTable(msg.standings, me)}
      <p class="muted center" id="next-in"></p>`);
    countdown("next-in", msg.revealMs, "Next question in");
  }

  function roundEnd(msg, me) {
    show("roundEnd", `
      <h1>${esc(msg.roundName)} round complete!</h1>
      ${standingsTable(msg.standings.map(s => Object.assign({}, s, { gained: 0 })), me)}
      <p class="muted center">Up next: <strong>${esc(msg.nextRoundName)}</strong> questions, ${msg.nextPoints} points each.</p>
      <p class="muted center" id="next-in"></p>`);
    countdown("next-in", msg.breakMs, "Starting in");
  }

  // ---------- final results ----------
  // s: { me, isHost, onAgain, onLeave }
  function gameOver(msg, s) {
    const top = msg.standings.filter(p => p.rank === 1);
    const banner = top.length > 1
      ? `It's a tie! ${top.map(p => esc(p.name)).join(" & ")}`
      : `${esc(top[0].name)} wins!`;

    show("gameOver", `
      <h1>Game Over!</h1>
      <div class="winner">🏆 ${banner}</div>
      <table class="standings final">
        <thead><tr><th></th><th>Player</th>${msg.rounds.map(r => `<th>${esc(r.name)}</th>`).join("")}<th>Total</th></tr></thead>
        <tbody>${msg.standings.map(p => `
          <tr class="${p.id === s.me ? "me" : ""} ${p.connected ? "" : "gone"}">
            <td class="rank">${medal(p.rank)}</td>
            <td class="name">${esc(p.name)}${p.id === s.me ? ' <span class="you">you</span>' : ""}</td>
            ${p.roundScores.map(x => `<td>${x}</td>`).join("")}
            <td class="score">${p.score}</td>
          </tr>`).join("")}</tbody>
      </table>
      ${s.isHost
        ? `<button class="primary" id="again">Play Again (same players)</button>`
        : `<p class="muted center">Waiting for the host to start another game…</p>`}
      <button class="secondary" id="leave">${s.isHost ? "End Game" : "Leave"}</button>`);
    if (s.isHost) $("again").onclick = s.onAgain;
    $("leave").onclick = s.onLeave;
  }

  return {
    landing, hostSetup, joinSetup, connecting, loading, message,
    lobby, question, progress, reveal, roundEnd, gameOver,
    isShowing: name => current === name,
  };
})();
