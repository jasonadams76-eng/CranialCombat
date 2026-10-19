// Personal Top 10: each player's ten best game scores, kept on this device (in the browser's local storage).
// Scores are filed under the player's name, so people sharing a phone each get their own list.
//
//   Scores.record(name, { score, category, mode, date })  -> { rank, entries, best, tenth, skipped }
//   Scores.list(name)                                     -> [{ score, category, mode, date }] best first
//   Scores.names()                                        -> names that have at least one saved score
const Scores = (() => {
  const KEY = "tsTop10";
  const MAX = 10;
  const keyOf = name => String(name || "").trim().toLowerCase();

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && typeof d === "object" && d.players && typeof d.players === "object") return d;
    } catch (e) { /* missing or damaged: start empty */ }
    return { players: {} };
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* private mode: the list just won't be kept */ } }

  const clean = entries => (Array.isArray(entries) ? entries : [])
    .filter(e => e && Number.isFinite(e.score) && e.score > 0)
    .map(e => ({ score: e.score, category: String(e.category || "Random"), mode: e.mode === "Solo" ? "Solo" : "Multiplayer", date: Number(e.date) || 0 }));

  function list(name) {
    const p = load().players[keyOf(name)];
    return p ? clean(p.entries).slice(0, MAX) : [];
  }

  function names() {
    return Object.keys(load().players).map(k => load().players[k])
      .filter(p => p && clean(p.entries).length)
      .map(p => String(p.name || ""))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  // A score of 0 is not worth keeping. Ties keep the earlier score ahead.
  function record(name, entry) {
    const key = keyOf(name);
    const score = Math.round(Number(entry && entry.score));
    if (!key || !Number.isFinite(score) || score <= 0) return { rank: null, entries: list(name), skipped: true };
    const e = { score, category: String((entry && entry.category) || "Random"), mode: entry && entry.mode === "Solo" ? "Solo" : "Multiplayer", date: Number(entry && entry.date) || Date.now() };
    // Two tabs on one device can finish a game at the same moment and overwrite each other's save,
    // so read, add, write, then check that the entry is really there (up to three tries).
    let result = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const data = load();
      const p = data.players[key] || { name: String(name).trim(), entries: [] };
      const entries = clean(p.entries);
      let idx = entries.findIndex(x => x.score < score);
      if (idx < 0) idx = entries.length;
      entries.splice(idx, 0, e);
      const kept = entries.slice(0, MAX);
      p.name = String(name).trim();
      p.entries = kept;
      data.players[key] = p;
      save(data);
      const rank = idx < MAX ? idx + 1 : null;
      result = { rank, entries: kept, best: kept[0].score, tenth: kept.length >= MAX ? kept[MAX - 1].score : null, skipped: false };
      const check = load().players[key];
      if (check && clean(check.entries).some(x => x.score === score && x.date === e.date)) break;
      // not there: someone else's save landed after ours; go round again on top of theirs
    }
    return result;
  }

  return { record, list, names, MAX };
})();
