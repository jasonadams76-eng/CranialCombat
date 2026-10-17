// Tests for the host rules engine (js/game.js). No dependencies:  node tests/host-game.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

// Load the browser scripts into one sandbox, in the same order index.html does.
const source = ["config.js", "names.js", "game.js"]
  .map(f => fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8")).join("\n");
const { CONFIG, HostGame } = vm.runInNewContext(source + "\n;({ CONFIG, HostGame })", { console });

// ----- fake clock -----
function fakeTimers() {
  let now = 0, nextId = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { const id = nextId++; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: id => pending.delete(id),
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let best = null;
        pending.forEach((t, id) => { if (t.at <= target && (!best || t.at < best.t.at)) best = { id, t }; });
        if (!best) break;
        pending.delete(best.id);
        now = best.t.at;
        best.t.fn();
      }
      now = target;
    },
  };
}

function makeQuestions() {
  // 3 rounds x 5 questions; correct answer is always "right" at a known index
  return CONFIG.rounds.map((_, r) => Array.from({ length: CONFIG.questionsPerRound }, (_, i) => ({
    category: "Cat" + r, question: `Q${r}-${i}`, correct: "right",
    answers: i % 2 ? ["wrong1", "right", "wrong2", "wrong3"] : ["right", "wrong1", "wrong2", "wrong3"],
  })));
}

function setup() {
  const timers = fakeTimers();
  const log = [];
  const game = HostGame.create({ broadcast: m => log.push(m), timers });
  const last = t => { for (let i = log.length - 1; i >= 0; i--) if (log[i].t === t) return log[i]; };
  return { timers, log, game, last };
}

// Arrays made inside the vm sandbox are a different realm, so compare as JSON.
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("lobby: joins, unique names, max players, no join after start", () => {
  const { game, last } = setup();
  assert(game.addPlayer("a", "Sam").ok);
  assert(game.addPlayer("b", "sam").ok);
  same(last("lobby").players.map(p => p.name), ["Sam", "sam 2"]);
  assert.strictEqual(game.addPlayer("c", "   ").ok, false);    // blank names are no longer turned into "Player"
  for (let i = 0; i < 10; i++) game.addPlayer("x" + i, "X");
  assert.strictEqual(game.getPlayers().length, CONFIG.maxPlayers);
  assert.strictEqual(game.addPlayer("late", "Late").ok, false);
  game.lock("loading");
  assert.strictEqual(game.addPlayer("late2", "Late").ok, false);
});

test("names: blocked and reserved names are refused by the host engine itself", () => {
  const { game, last } = setup();
  const r = game.addPlayer("a", "sh1t");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "name");
  assert.strictEqual(r.error, "Please choose a different name.");
  assert.strictEqual(game.addPlayer("b", "Host").ok, false);
  assert.strictEqual(game.addPlayer("c", "").ok, false);
  assert.strictEqual(game.getPlayers().length, 0);
  assert.strictEqual(last("lobby"), undefined);                // nothing was broadcast for refused names
  assert.strictEqual(game.addPlayer("d", "Scunthorpe").ok, true);
});

test("names: accepted names are stored cleaned (invisible characters and extra spaces removed)", () => {
  const { game, last } = setup();
  game.addPlayer("a", "  Sam\u200B   Smith ");
  assert.strictEqual(last("lobby").players[0].name, "Sam Smith");
});

test("question message never reveals the correct answer", () => {
  const { game, last } = setup();
  game.addPlayer("a", "A");
  game.lock("x"); game.begin(makeQuestions());
  const q = last("question");
  assert.strictEqual(q.correctIndex, undefined);
  assert.strictEqual(q.correct, undefined);
  assert.strictEqual(q.durationMs, 10000);
  assert.strictEqual(q.category, "Cat0");
});

test("scoring: 25 / 75 / 100 points by round (1000 total), wrong and missing answers score 0", () => {
  const { game, last, timers } = setup();
  game.addPlayer("a", "A"); game.addPlayer("b", "B"); game.addPlayer("c", "C");
  game.lock("x"); game.begin(makeQuestions());
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 5; i++) {
      const q = last("question");
      const right = q.answers.indexOf("right");
      game.submitAnswer("a", q.id, right);                    // always right
      game.submitAnswer("b", q.id, (right + 1) % 4);          // always wrong
      // c never answers -> timer must close the question
      assert.strictEqual(game.getPhase(), "question");
      timers.advance(10000);
      assert.strictEqual(game.getPhase(), "reveal");
      const rev = last("reveal");
      const pts = CONFIG.rounds[r].points;
      assert.strictEqual(rev.results.find(x => x.id === "a").gained, pts);
      assert.strictEqual(rev.results.find(x => x.id === "b").gained, 0);
      assert.strictEqual(rev.results.find(x => x.id === "c").choice, null);
      timers.advance(5000);                                   // reveal -> next question / round break
      if (i === 4 && r < 2) { assert.strictEqual(game.getPhase(), "roundbreak"); timers.advance(6000); }
    }
  }
  assert.strictEqual(game.getPhase(), "over");
  const over = last("gameOver");
  const a = over.standings.find(s => s.id === "a");
  assert.strictEqual(a.score, 1000);
  same(a.roundScores, [125, 375, 500]);
  assert.strictEqual(a.rank, 1);
  assert.strictEqual(over.standings.find(s => s.id === "b").score, 0);
});

test("scoring: a perfect game adds up to exactly CONFIG.targetTotal (1000)", () => {
  const total = CONFIG.rounds.reduce((s, r) => s + r.points * CONFIG.questionsPerRound, 0);
  assert.strictEqual(total, 1000);
  assert.strictEqual(total, CONFIG.targetTotal);
  same(CONFIG.rounds.map(r => r.points), [25, 75, 100]);
});

test("question closes early when every connected player has answered", () => {
  const { game, last } = setup();
  game.addPlayer("a", "A"); game.addPlayer("b", "B");
  game.lock("x"); game.begin(makeQuestions());
  const q = last("question");
  game.submitAnswer("a", q.id, 0);
  assert.strictEqual(game.getPhase(), "question");
  game.submitAnswer("b", q.id, 1);
  assert.strictEqual(game.getPhase(), "reveal");
});

test("answers: only first counts, invalid / stale / late ones are ignored", () => {
  const { game, last, timers } = setup();
  game.addPlayer("a", "A"); game.addPlayer("b", "B");
  game.lock("x"); game.begin(makeQuestions());
  const q = last("question");
  const right = q.answers.indexOf("right");
  assert.strictEqual(game.submitAnswer("a", q.id, right), true);
  assert.strictEqual(game.submitAnswer("a", q.id, (right + 1) % 4), false);  // second answer
  assert.strictEqual(game.submitAnswer("b", q.id, 9), false);                // out of range
  assert.strictEqual(game.submitAnswer("b", q.id, "1"), false);              // not an integer
  assert.strictEqual(game.submitAnswer("b", q.id + 99, 0), false);           // wrong question id
  assert.strictEqual(game.submitAnswer("zzz", q.id, 0), false);              // unknown player
  timers.advance(10000);
  assert.strictEqual(game.submitAnswer("b", q.id, 0), false);                // after time is up
  assert.strictEqual(last("reveal").results.find(r => r.id === "a").gained, 25);
});

test("disconnect mid-question: game does not wait for the player who left", () => {
  const { game, last } = setup();
  game.addPlayer("host", "H"); game.addPlayer("b", "B"); game.addPlayer("c", "C");
  game.lock("x"); game.begin(makeQuestions());
  const q = last("question");
  game.submitAnswer("host", q.id, 0);
  game.submitAnswer("b", q.id, 0);
  assert.strictEqual(game.getPhase(), "question");
  game.removePlayer("c");                       // c was the only one left to answer
  assert.strictEqual(game.getPhase(), "reveal");
  const st = last("reveal").standings;
  assert.strictEqual(st.find(s => s.id === "c").connected, false);
  assert.strictEqual(game.submitAnswer("c", q.id, 0), false);
});

test("standings: ranked by score, ties share a rank, gained shown", () => {
  const { game, last } = setup();
  ["a", "b", "c"].forEach(id => game.addPlayer(id, id.toUpperCase()));
  game.lock("x"); game.begin(makeQuestions());
  const q = last("question");
  const right = q.answers.indexOf("right");
  game.submitAnswer("b", q.id, right);
  game.submitAnswer("c", q.id, right);
  game.submitAnswer("a", q.id, (right + 1) % 4);
  const st = last("reveal").standings;
  same(st.map(s => [s.id, s.rank, s.score, s.gained]),
    [["b", 1, 25, 25], ["c", 1, 25, 25], ["a", 3, 0, 0]]);
});

test("round break shows standings and announces the next round", () => {
  const { game, last, timers } = setup();
  game.addPlayer("a", "A");
  game.lock("x"); game.begin(makeQuestions());
  for (let i = 0; i < 5; i++) { timers.advance(10000); timers.advance(5000); }
  const rb = last("roundEnd");
  assert.strictEqual(rb.roundName, "Easy");
  assert.strictEqual(rb.nextRoundName, "Medium");
  assert.strictEqual(rb.nextPoints, 75);
  assert.strictEqual(last("question").roundName, "Easy");     // not started yet
  timers.advance(6000);
  assert.strictEqual(last("question").roundName, "Medium");
  assert.strictEqual(last("question").qIndex, 1);
});

test("reset: keeps connected players, zeroes scores, returns to lobby", () => {
  const { game, last, timers } = setup();
  game.addPlayer("a", "A"); game.addPlayer("b", "B");
  game.lock("x"); game.begin(makeQuestions());
  const q = last("question");
  game.submitAnswer("a", q.id, q.answers.indexOf("right"));
  game.removePlayer("b");
  timers.advance(10000);
  game.reset();
  assert.strictEqual(game.getPhase(), "lobby");
  same(last("lobby").players.map(p => p.id), ["a"]);
  game.lock("x"); game.begin(makeQuestions());
  timers.advance(10000);
  assert.strictEqual(last("reveal").standings[0].score, 0);
});

test("lock / unlock: failed question load returns everyone to the lobby with a note", () => {
  const { game, last } = setup();
  game.addPlayer("a", "A");
  game.setMeta({ code: "ABCD" });
  assert.strictEqual(game.lock("Fetching…"), true);
  assert.strictEqual(game.getPhase(), "loading");
  game.unlock("Not enough hard questions");
  assert.strictEqual(game.getPhase(), "lobby");
  assert.strictEqual(last("lobby").meta.note, "Not enough hard questions");
  assert.strictEqual(last("lobby").meta.code, "ABCD");
});

let failed = 0;
for (const { name, fn } of tests) {
  try { fn(); console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); }
}
console.log(failed ? `\n${failed} of ${tests.length} tests FAILED` : `\nAll ${tests.length} tests passed`);
process.exit(failed ? 1 : 0);
