// Tests for the personal Top 10 (js/scores.js).  node tests/scores.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "scores.js"), "utf8");
function fresh(initial) {
  const ls = Object.assign({}, initial);
  const sb = { console, localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = v; } } };
  return { Scores: vm.runInNewContext(src + "\n;Scores", sb), ls };
}
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
let failed = 0, n = 0;
const test = (name, fn) => { n++; try { fn(); console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); } };
const rec = (S, name, score, extra) => S.record(name, Object.assign({ score, category: "Sports", mode: "Solo", date: 1000 + score }, extra));

test("first score is rank 1 and is saved", () => {
  const { Scores, ls } = fresh();
  const r = rec(Scores, "Jason", 400);
  assert.strictEqual(r.rank, 1); assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(Scores.list("Jason")[0].score, 400);
  assert(ls.tsTop10, "written to local storage");
});
test("scores are ranked best first", () => {
  const { Scores } = fresh();
  [300, 700, 500].forEach(s => rec(Scores, "Jason", s));
  same(Scores.list("Jason").map(e => e.score), [700, 500, 300]);
  assert.strictEqual(rec(Scores, "Jason", 600).rank, 2);
});
test("a tie ranks below the earlier score", () => {
  const { Scores } = fresh();
  rec(Scores, "Jason", 500, { date: 1 });
  const r = rec(Scores, "Jason", 500, { date: 2 });
  assert.strictEqual(r.rank, 2);
  assert.strictEqual(Scores.list("Jason")[0].date, 1);
});
test("only ten are kept; a score that does not make it gets no rank", () => {
  const { Scores } = fresh();
  for (let i = 1; i <= 10; i++) rec(Scores, "Jason", i * 100);          // 100..1000
  assert.strictEqual(Scores.list("Jason").length, 10);
  const low = rec(Scores, "Jason", 50);
  assert.strictEqual(low.rank, null); assert.strictEqual(low.best, 1000); assert.strictEqual(low.tenth, 100);
  assert.strictEqual(Scores.list("Jason").length, 10);
  const tie = rec(Scores, "Jason", 100);                                // ties the 10th: earlier one stays
  assert.strictEqual(tie.rank, null);
  const hi = rec(Scores, "Jason", 550);
  assert.strictEqual(hi.rank, 6);
  assert.strictEqual(Scores.list("Jason").length, 10);
  assert.strictEqual(Scores.list("Jason").pop().score, 200);            // 100 dropped off
});
test("each name has its own list, matched without regard to case", () => {
  const { Scores } = fresh();
  rec(Scores, "Jason", 400); rec(Scores, "Anna", 900); rec(Scores, "jason", 450);
  assert.strictEqual(Scores.list("Anna").length, 1);
  assert.strictEqual(Scores.list("JASON").length, 2);
  same(Scores.names(), ["Anna", "jason"]);
});
test("zero, negative and junk scores are not recorded", () => {
  const { Scores } = fresh();
  assert.strictEqual(rec(Scores, "Jason", 0).skipped, true);
  assert.strictEqual(rec(Scores, "Jason", -5).skipped, true);
  assert.strictEqual(Scores.record("Jason", { score: "abc" }).skipped, true);
  assert.strictEqual(Scores.record("", { score: 100 }).skipped, true);
  assert.strictEqual(Scores.list("Jason").length, 0); assert.strictEqual(Scores.names().length, 0);
});
test("category and mode are kept with each score", () => {
  const { Scores } = fresh();
  rec(Scores, "Jason", 300, { category: "History", mode: "Multiplayer" });
  const e = Scores.list("Jason")[0];
  assert.strictEqual(e.category, "History"); assert.strictEqual(e.mode, "Multiplayer");
});
test("damaged storage is ignored instead of breaking the game", () => {
  const { Scores } = fresh({ tsTop10: "{not json" });
  assert.strictEqual(rec(Scores, "Jason", 300).rank, 1);
  const b = fresh({ tsTop10: JSON.stringify({ players: { jason: { name: "Jason", entries: [{ score: "x" }, null, { score: 200 }] } } }) });
  same(b.Scores.list("Jason").map(e => e.score), [200]);
});
test("storage that throws does not break recording", () => {
  const sb = { console, localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } } };
  const Scores = vm.runInNewContext(src + "\n;Scores", sb);
  assert.strictEqual(rec(Scores, "Jason", 300).rank, 1);
});
test("a save that gets overwritten by another tab is retried", () => {
  const ls = {}; let sets = 0;
  const sb = { console, localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { if (++sets === 1) return; ls[k] = v; } } };   // the first write is lost
  const Scores = vm.runInNewContext(src + "\n;Scores", sb);
  assert.strictEqual(rec(Scores, "Jason", 300).rank, 1);
  assert.strictEqual(Scores.list("Jason").length, 1);
  assert.strictEqual(sets, 2);
});
console.log(failed ? `\n${failed} of ${n} tests FAILED` : `\nAll ${n} score tests passed`);
process.exit(failed ? 1 : 0);
