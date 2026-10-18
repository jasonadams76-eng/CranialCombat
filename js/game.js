// Host-side rules engine: players, timer, scoring, standings, round flow.
// No DOM and no networking in here. It talks to the outside world only through
// the broadcast() callback and the methods it exposes, so it can be tested in Node.
//
// Messages it broadcasts (type in field "t"):
//   lobby, loading, question, progress, reveal, roundEnd, gameOver
const HostGame = (() => {
  function create(options) {
    const o = Object.assign({
      rounds: CONFIG.rounds,
      maxPlayers: CONFIG.maxPlayers,
      maxNameLength: CONFIG.maxNameLength,
      questionMs: CONFIG.questionSeconds * 1000,
      broadcast: () => {},
      minAdvanceMs: CONFIG.minAdvanceMs,
      now: () => Date.now(),
      heartbeatMs: CONFIG.heartbeatMs,
      staleMs: CONFIG.staleMs,
      send: () => {},          // send(playerId, msg): one message to one player (used to catch up a returning player)
      chatMaxLength: CONFIG.chatMaxLength,
      chatHistory: CONFIG.chatHistory,
      chatRateCount: CONFIG.chatRateCount,
      chatRateWindowMs: CONFIG.chatRateWindowMs,
      // Chat filter. Same word lists as names, read word by word (see js/filter.js).
      messageCheck: (text, opts) => (typeof Filter !== "undefined"
        ? Filter.checkMessage(text, opts)
        : { ok: true, text: String(text || "").trim().slice(0, opts.maxLength) }),
      // Name filter. The host enforces this even if a player's screen skipped it.
      nameCheck: n => (typeof Filter !== "undefined"
        ? Filter.checkName(n, { maxLength: CONFIG.maxNameLength })
        : { ok: true, name: String(n || "").trim().slice(0, CONFIG.maxNameLength) || "Player" }),
      timers: {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: id => clearTimeout(id),
      },
    }, options);

    let players = [];          // { id, name, score, roundScores[], connected }
    let phase = "lobby";       // lobby | loading | question | reveal | roundbreak | over
    let meta = {};             // extra info shown in the lobby (code, category, note)
    let rounds = null;         // [[question, ...], ...]
    let r = 0, q = 0;          // current round / question index
    let cur = null;            // { id, question, answers: Map(playerId -> choice) }
    let timer = null;
    let qSeq = 0;
    let phaseStartedAt = 0;    // when the standings / round scoreboard appeared (see next())
    let chatLog = [];          // recent lobby chat, kept for people who join later
    let chatSeq = 0;
    let curMsg = null;         // the question message as first sent
    let qEndsAt = 0;
    let lastGained = {};
    let lastReveal = null, lastRoundEnd = null, lastGameOver = null, loadingMessage = "";
    let lastSweepAt = null;
    const chatTimes = new Map();   // playerId -> times of their recent messages (rate limit)

    const find = id => players.find(p => p.id === id);
    const connected = () => players.filter(p => p.connected);

    function setTimer(fn, ms) {
      if (timer != null) o.timers.clearTimeout(timer);
      timer = o.timers.setTimeout(fn, ms);
    }
    function clearTimer() {
      if (timer != null) o.timers.clearTimeout(timer);
      timer = null;
    }

    function uniqueName(raw) {
      const base = String(raw || "").trim().slice(0, o.maxNameLength) || "Player";
      let name = base, i = 2;
      while (players.some(p => p.name.toLowerCase() === name.toLowerCase())) name = `${base} ${i++}`;
      return name;
    }

    const publicPlayers = () => players.map(p => ({ id: p.id, name: p.name, connected: p.connected }));
    const sendRoster = () => o.broadcast({ t: "roster", players: publicPlayers() });   // player list without switching screens
    const sendLobby = () => o.broadcast({ t: "lobby", players: publicPlayers(), meta: Object.assign({}, meta) });

    // Ranked list, ties share a rank. gainedMap = points earned on the last question.
    function standings(gainedMap) {
      gainedMap = gainedMap || {};
      const list = players.map((p, order) => ({
        id: p.id, name: p.name, score: p.score, roundScores: p.roundScores.slice(),
        gained: gainedMap[p.id] || 0, connected: p.connected, order,
      }));
      list.sort((a, b) => b.score - a.score || a.order - b.order);
      let rank = 0, prev = null;
      list.forEach((s, i) => {
        if (s.score !== prev) { rank = i + 1; prev = s.score; }
        s.rank = rank;
        delete s.order;
      });
      return list;
    }

    // ----- lobby -----
    // A player who comes back (phone slept, page reloaded) joins with the same name. They take over
    // their old spot if their token matches, or the old connection is gone or has gone quiet.
    const canTakeOver = (p, token) =>
      (token && p.token && token === p.token) || !p.connected || o.now() - p.lastSeen > o.staleMs;

    function takeOver(p, newId, token) {
      const oldId = p.id;
      chatTimes.delete(oldId);
      if (cur && cur.answers.has(oldId)) {            // keep an answer already given this question
        cur.answers.set(newId, cur.answers.get(oldId));
        cur.answers.delete(oldId);
      }
      if (lastReveal) {                                // the standings already on screen refer to the old id
        lastReveal.results.forEach(x => { if (x.id === oldId) x.id = newId; });
        if (oldId in lastGained) { lastGained[newId] = lastGained[oldId]; delete lastGained[oldId]; }
      }
      p.id = newId; p.connected = true; p.lastSeen = o.now();
      if (token) p.token = token;
      if (phase === "lobby") { sendLobby(); systemLine(`${p.name} rejoined`); }
      else sendRoster();
      return { ok: true, player: p, replaced: oldId, rejoined: true };
    }

    function addPlayer(id, name, token) {
      const existing = find(id);
      if (existing) { existing.lastSeen = o.now(); return { ok: true, player: existing }; }
      const checked = o.nameCheck(name);
      const twin = checked.ok
        ? players.find(p => p.id !== "host" && p.name.toLowerCase() === checked.name.toLowerCase())
        : null;
      if (twin && canTakeOver(twin, token)) return takeOver(twin, id, token);
      if (phase !== "lobby") return { ok: false, error: "That game has already started." };
      if (players.length >= o.maxPlayers) return { ok: false, error: "That game is full." };
      if (!checked.ok) return { ok: false, code: "name", error: checked.message };
      const p = {
        id, name: uniqueName(checked.name), score: 0, token: token || null, lastSeen: o.now(),
        roundScores: o.rounds.map(() => 0), connected: true,
      };
      players.push(p);
      sendLobby();
      systemLine(`${p.name} joined`);
      return { ok: true, player: p };
    }

    // Any message from a player counts as "still here".
    function touch(id) { const p = find(id); if (p) p.lastSeen = o.now(); }

    // Called every heartbeat by the host. Drops players who have gone quiet; returns their ids so the
    // connections can be closed. If the host's own page was asleep, nobody is blamed for the silence.
    function sweep() {
      const now = o.now();
      const asleep = lastSweepAt !== null && now - lastSweepAt > o.heartbeatMs * 3;
      lastSweepAt = now;
      if (asleep) { players.forEach(p => { p.lastSeen = now; }); return []; }
      const stale = players.filter(p => p.id !== "host" && p.connected && now - p.lastSeen > o.staleMs).map(p => p.id);
      stale.forEach(removePlayer);
      return stale;
    }

    // Brings one returning player up to date with whatever is on everyone else's screen.
    function resync(id) {
      const p = find(id);
      if (!p) return;
      o.send(id, { t: "roster", players: publicPlayers() });
      o.send(id, { t: "sync", question: curMsg, score: p.score });
      if (phase === "question" && curMsg) {
        o.send(id, Object.assign({}, curMsg, {
          durationMs: Math.max(0, qEndsAt - o.now()), totalMs: o.questionMs,
          picked: cur.answers.has(id) ? cur.answers.get(id) : null,
        }));
      }
      // Standings are rebuilt so they show who is connected now, not who was when the screen first appeared.
      else if (phase === "reveal" && lastReveal) o.send(id, Object.assign({}, lastReveal, { standings: standings(lastGained) }));
      else if (phase === "roundbreak" && lastRoundEnd) o.send(id, Object.assign({}, lastRoundEnd, { standings: standings() }));
      else if (phase === "over" && lastGameOver) o.send(id, Object.assign({}, lastGameOver, { standings: standings() }));
      else if (phase === "loading") o.send(id, { t: "loading", message: loadingMessage });
    }

    function removePlayer(id) {
      const p = find(id);
      if (!p) return;
      chatTimes.delete(id);
      if (phase === "lobby") {
        players = players.filter(x => x.id !== id);
        sendLobby();
        systemLine(`${p.name} left`);
      } else {
        p.connected = false;
        sendRoster();
        if (phase === "question") checkAllAnswered();
      }
    }

    function setMeta(patch) { meta = Object.assign({}, meta, patch); sendLobby(); }

    function lock(message) {
      if (phase !== "lobby" && phase !== "loading") return false;
      phase = "loading";
      loadingMessage = message;
      o.broadcast({ t: "loading", message });
      return true;
    }

    function unlock(note) {
      phase = "lobby";
      meta = Object.assign({}, meta, { note: note || null });
      sendLobby();
    }

    function reset() {
      clearTimer();
      players = players.filter(p => p.connected);
      players.forEach(p => { p.score = 0; p.roundScores = o.rounds.map(() => 0); });
      rounds = null; r = 0; q = 0; cur = null;
      phase = "lobby";
      meta = Object.assign({}, meta, { note: null });
      sendLobby();
    }

    // ----- lobby chat -----
    function remember(msg) {
      chatLog.push(msg);
      if (chatLog.length > o.chatHistory) chatLog = chatLog.slice(-o.chatHistory);
      o.broadcast({ t: "chat", msg });
    }

    function systemLine(text) {
      remember({ id: ++chatSeq, system: true, text, ts: o.now() });
    }

    // playerId comes from the connection, never from the message, so nobody can speak as someone else.
    function chat(playerId, text) {
      if (phase !== "lobby") return { ok: false, code: "closed", error: "Chat is only open in the lobby." };
      const p = find(playerId);
      if (!p || !p.connected) return { ok: false, code: "unknown", error: "You are not in this game." };
      if (typeof text !== "string" || !text.trim()) return { ok: false, code: "empty" };

      const now = o.now();
      const recent = (chatTimes.get(playerId) || []).filter(t => now - t < o.chatRateWindowMs);
      if (recent.length >= o.chatRateCount) {
        chatTimes.set(playerId, recent);
        return { ok: false, code: "rate", error: "Slow down a little." };
      }
      recent.push(now);                                // blocked attempts count too, so the filter can't be probed quickly
      chatTimes.set(playerId, recent);

      const checked = o.messageCheck(text, { maxLength: o.chatMaxLength });
      if (!checked.ok) {
        return checked.reason === "empty"
          ? { ok: false, code: "empty" }
          : { ok: false, code: "filtered", error: "That message wasn't sent. Please keep chat friendly." };
      }
      remember({ id: ++chatSeq, from: { id: p.id, name: p.name }, text: checked.text, ts: now });
      return { ok: true };
    }

    // ----- play -----
    function begin(roundData) {
      if (phase !== "loading" && phase !== "lobby") return false;
      chatLog = [];
      chatTimes.clear();
      o.broadcast({ t: "chatClear" });
      rounds = roundData;
      r = 0; q = 0;
      players.forEach(p => { p.score = 0; p.roundScores = o.rounds.map(() => 0); });
      startQuestion();
      return true;
    }

    function startQuestion() {
      const question = rounds[r][q];
      const round = o.rounds[r];
      qSeq++;
      cur = { id: qSeq, question, answers: new Map() };
      phase = "question";
      qEndsAt = o.now() + o.questionMs;
      curMsg = {
        t: "question", id: cur.id,
        round: r + 1, rounds: o.rounds.length,
        roundName: round.name, difficulty: round.difficulty, points: round.points,
        qIndex: q + 1, qTotal: rounds[r].length,
        category: question.category, question: question.question,
        answers: question.answers.slice(),       // never includes which one is correct
        durationMs: o.questionMs,
      };
      o.broadcast(curMsg);
      setTimer(closeQuestion, o.questionMs);
    }

    function checkAllAnswered() {
      const live = connected();
      if (live.length > 0 && live.every(p => cur.answers.has(p.id))) closeQuestion();
    }

    function submitAnswer(playerId, questionId, choice) {
      if (phase !== "question" || !cur || questionId !== cur.id) return false;
      const p = find(playerId);
      if (!p || !p.connected || cur.answers.has(playerId)) return false;
      if (!Number.isInteger(choice) || choice < 0 || choice >= cur.question.answers.length) return false;
      cur.answers.set(playerId, choice);
      o.broadcast({ t: "progress", id: cur.id, answered: Array.from(cur.answers.keys()) });
      checkAllAnswered();
      return true;
    }

    function closeQuestion() {
      if (phase !== "question") return;
      clearTimer();
      phase = "reveal";
      phaseStartedAt = o.now();
      const round = o.rounds[r];
      const correctIndex = cur.question.answers.indexOf(cur.question.correct);
      const gainedMap = {};
      const results = players.map(p => {
        const choice = cur.answers.has(p.id) ? cur.answers.get(p.id) : null;
        const correct = choice === correctIndex;
        const gained = correct ? round.points : 0;
        p.score += gained;
        p.roundScores[r] += gained;
        gainedMap[p.id] = gained;
        return { id: p.id, name: p.name, choice, correct, gained };
      });
      const lastOfRound = q + 1 >= rounds[r].length;
      const finalRound = r + 1 >= o.rounds.length;
      // No timer here: the standings stay up until the host calls next().
      lastGained = gainedMap;
      lastReveal = {
        t: "reveal", id: cur.id, correctIndex, correct: cur.question.correct,
        results, standings: standings(gainedMap),
        nextLabel: !lastOfRound ? "Next Question" : finalRound ? "See Final Results" : "Finish Round",
      };
      o.broadcast(lastReveal);
    }

    // Host-only (called locally by the host's screen, never from a network message).
    // Moves on from the standings, or from a round scoreboard.
    function next() {
      // A double click on the button would otherwise skip the next screen too.
      if ((phase === "reveal" || phase === "roundbreak") && o.now() - phaseStartedAt < o.minAdvanceMs) return;
      if (phase === "reveal") advance();
      else if (phase === "roundbreak") { r++; q = 0; startQuestion(); }
    }

    function advance() {
      if (phase !== "reveal") return;
      if (q + 1 < rounds[r].length) {
        q++;
        startQuestion();
      } else if (r + 1 < o.rounds.length) {
        phase = "roundbreak";
        phaseStartedAt = o.now();
        lastRoundEnd = {
          t: "roundEnd", round: r + 1, roundName: o.rounds[r].name,
          nextRoundName: o.rounds[r + 1].name, nextPoints: o.rounds[r + 1].points,
          standings: standings(), nextLabel: `Start ${o.rounds[r + 1].name}`,
        };
        o.broadcast(lastRoundEnd);
      } else {
        phase = "over";
        lastGameOver = {
          t: "gameOver", standings: standings(),
          rounds: o.rounds.map(x => ({ name: x.name, points: x.points })),
        };
        o.broadcast(lastGameOver);
      }
    }

    function destroy() { clearTimer(); }

    return {
      addPlayer, removePlayer, touch, sweep, resync, setMeta, lock, unlock, reset, begin, submitAnswer, next, chat, destroy,
      getChat: () => chatLog.slice(),
      getPhase: () => phase,
      getPlayers: () => publicPlayers(),
    };
  }

  return { create };
})();
