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
      // Name filter. The host enforces this even if a player's screen skipped it.
      nameCheck: n => (typeof NameFilter !== "undefined"
        ? NameFilter.check(n, { maxLength: CONFIG.maxNameLength })
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
    function addPlayer(id, name) {
      if (phase !== "lobby") return { ok: false, error: "That game has already started." };
      if (find(id)) return { ok: true, player: find(id) };
      if (players.length >= o.maxPlayers) return { ok: false, error: "That game is full." };
      const checked = o.nameCheck(name);
      if (!checked.ok) return { ok: false, code: "name", error: checked.message };
      const p = {
        id, name: uniqueName(checked.name), score: 0,
        roundScores: o.rounds.map(() => 0), connected: true,
      };
      players.push(p);
      sendLobby();
      return { ok: true, player: p };
    }

    function removePlayer(id) {
      const p = find(id);
      if (!p) return;
      if (phase === "lobby") {
        players = players.filter(x => x.id !== id);
        sendLobby();
      } else {
        p.connected = false;
        if (phase === "question") checkAllAnswered();
      }
    }

    function setMeta(patch) { meta = Object.assign({}, meta, patch); sendLobby(); }

    function lock(message) {
      if (phase !== "lobby" && phase !== "loading") return false;
      phase = "loading";
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

    // ----- play -----
    function begin(roundData) {
      if (phase !== "loading" && phase !== "lobby") return false;
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
      o.broadcast({
        t: "question", id: cur.id,
        round: r + 1, rounds: o.rounds.length,
        roundName: round.name, difficulty: round.difficulty, points: round.points,
        qIndex: q + 1, qTotal: rounds[r].length,
        category: question.category, question: question.question,
        answers: question.answers.slice(),       // never includes which one is correct
        durationMs: o.questionMs,
      });
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
      o.broadcast({
        t: "reveal", id: cur.id, correctIndex, correct: cur.question.correct,
        results, standings: standings(gainedMap),
        nextLabel: !lastOfRound ? "Next Question" : finalRound ? "See Final Results" : "Finish Round",
      });
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
        o.broadcast({
          t: "roundEnd", round: r + 1, roundName: o.rounds[r].name,
          nextRoundName: o.rounds[r + 1].name, nextPoints: o.rounds[r + 1].points,
          standings: standings(), nextLabel: `Start ${o.rounds[r + 1].name}`,
        });
      } else {
        phase = "over";
        o.broadcast({
          t: "gameOver", standings: standings(),
          rounds: o.rounds.map(x => ({ name: x.name, points: x.points })),
        });
      }
    }

    function destroy() { clearTimer(); }

    return {
      addPlayer, removePlayer, setMeta, lock, unlock, reset, begin, submitAnswer, next, destroy,
      getPhase: () => phase,
      getPlayers: () => publicPlayers(),
    };
  }

  return { create };
})();
