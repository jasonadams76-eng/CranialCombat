// All rendering and click handling. Receives data and callbacks; holds no game rules.
const UI = (() => {
  const app = document.getElementById("app");
  const stage = document.getElementById("stage");
  let current = null;
  let tick = null;
  let qState = null;

  const esc = s => String(s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function clearTimers() { if (tick) { clearInterval(tick); tick = null; } }
  function show(name, html) {
    clearTimers(); current = name;
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
      <tr class="${s.id === me ? "me" : ""} ${s.rank === 1 && s.score > 0 ? "lead" : ""} ${s.connected ? "" : "gone"}">
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

  // ---------- reveal / standings ----------
  // msg: reveal message. q: the question message it belongs to. h: { isHost, onNext }
  function reveal(msg, q, me, h) {
    const mine = msg.results.find(r => r.id === me);
    let headline = "⏰ Time's up!", cls = "bad";
    if (mine && mine.correct) { headline = `✅ Correct! +${mine.gained}`; cls = "good"; }
    else if (mine && mine.choice !== null) { headline = "❌ Not quite"; cls = "bad"; }

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
      <h2>Standings</h2>
      ${standingsTable(msg.standings, me)}
      ${nextControl(h, msg.nextLabel)}`);
    wireNext(h);
  }

  // The host gets a button; everyone else is told to wait.
  function nextControl(h, label) {
    return h.isHost
      ? `<button class="primary" id="next">${esc(label)}</button>`
      : `<p class="muted center">Waiting for the host to continue…</p>`;
  }
  function wireNext(h) {
    if (!h.isHost) return;
    $("next").onclick = e => { e.target.disabled = true; h.onNext(); };   // disabled so a double click can't skip ahead
  }

  // msg: roundEnd message. h: { isHost, onNext }
  function roundEnd(msg, me, h) {
    show("roundEnd", `
      <h1>${esc(msg.roundName)} complete!</h1>
      ${standingsTable(msg.standings.map(s => Object.assign({}, s, { gained: 0 })), me)}
      <p class="muted center">Up next: <strong>${esc(msg.nextRoundName)}</strong>, ${msg.nextPoints} points per question.</p>
      ${nextControl(h, msg.nextLabel)}`);
    wireNext(h);
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
      <div class="winner">${banner}</div>
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
    splash, setArt, banner, landing, hostSetup, joinSetup, formError, connecting, loading, message,
    lobby, chatUpdate, chatError, question, progress, reveal, roundEnd, gameOver,
    isShowing: name => current === name,
  };
})();
