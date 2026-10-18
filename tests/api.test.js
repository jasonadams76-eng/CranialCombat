// Tests for js/api.js: session tokens, the second question source, fallback and repeat tracking.
// Uses fake network answers, so nothing touches the real services. Run: node tests/api.test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "api.js"), "utf8");
const cfgSrc = fs.readFileSync(path.join(__dirname, "..", "js", "config.js"), "utf8");

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("FAIL", m); } };

function world(handler, storage) {
  const calls = [];
  const ls = storage || {};
  const sandbox = {
    console, setTimeout, Date, Math, JSON, Set, Promise, encodeURIComponent,
    document: { createElement: () => { const o = {}; Object.defineProperty(o, "innerHTML", { set(v) { o.value = v.replace(/&quot;/g, '"').replace(/&amp;/g, "&"); } }); return o; } },
    localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = v; } },
    fetch: async url => {
      calls.push(url);
      const r = await handler(url);
      return { ok: r.status === undefined || r.status < 400, status: r.status || 200, json: async () => r.body };
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(cfgSrc + "\nCONFIG.requestSpacingMs = 0; CONFIG.retryDelayMs = 0;", sandbox);
  vm.runInContext(src + "\nthis.Api = Api;", sandbox);
  return { Api: sandbox.Api, calls, ls };
}

const otdbQ = (n, tag) => Array.from({ length: n }, (_, i) => ({ category: "Sports", type: "multiple", difficulty: "easy", question: `${tag} q${i} &quot;x&quot;`, correct_answer: "Right", incorrect_answers: ["A", "B", "C"] }));
let tid = 0;
const triviaQ = (n, tag) => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, category: "sport_and_leisure", difficulty: "easy", type: "text_choice", question: { text: `${tag} question ${i}` }, correctAnswer: "Yes", incorrectAnswers: ["N1", "N2", "N3"] }));

(async () => {
  // 1. Open Trivia DB: asks for a token once, sends it, saves it
  {
    const w = world(url => url.includes("api_token") ? { body: { response_code: 0, token: "TOK1" } } : { body: { response_code: 0, results: otdbQ(5, "o") } });
    const q = await w.Api.fetchRound("easy", 21 + 1000, new Set(), false);   // an id with no match: Open Trivia DB only
    ok(q.length === 5 && q[0].question === 'o q0 "x"', "otdb round decodes text");
    ok(w.calls.filter(u => u.includes("command=request")).length === 1, "token requested once");
    ok(w.calls.some(u => u.includes("token=TOK1")), "token sent with the questions");
    ok(JSON.parse(w.ls.tsOtdbToken).token === "TOK1", "token saved on the device");
    await w.Api.fetchRound("easy", 1021, new Set(), false);
    ok(w.calls.filter(u => u.includes("command=request")).length === 1, "saved token is reused, not requested again");
  }
  // 2. Expired saved token is replaced
  {
    const old = JSON.stringify({ token: "OLD", at: Date.now() - 6 * 3600 * 1000 });
    const w = world(url => url.includes("api_token") ? { body: { response_code: 0, token: "NEW" } } : { body: { response_code: 0, results: otdbQ(5, "o") } }, { tsOtdbToken: old });
    await w.Api.fetchRound("easy", 1021, new Set(), false);
    ok(w.calls.some(u => u.includes("token=NEW")) && !w.calls.some(u => u.includes("token=OLD")), "expired token is replaced");
  }
  // 3. Token used up (code 4): reset, then succeed
  {
    let n = 0;
    const w = world(url => {
      if (url.includes("command=request")) return { body: { response_code: 0, token: "T" } };
      if (url.includes("command=reset")) return { body: { response_code: 0, token: "T" } };
      return n++ === 0 ? { body: { response_code: 4, results: [] } } : { body: { response_code: 0, results: otdbQ(5, "r") } };
    });
    const q = await w.Api.fetchRound("easy", 1021, new Set(), false);
    ok(q.length === 5 && w.calls.some(u => u.includes("command=reset&token=T")), "exhausted token is reset and the round succeeds");
  }
  // 4. Forgotten token (code 3): gets a new one
  {
    let n = 0, issued = 0;
    const w = world(url => {
      if (url.includes("command=request")) return { body: { response_code: 0, token: "T" + (++issued) } };
      return n++ === 0 ? { body: { response_code: 3, results: [] } } : { body: { response_code: 0, results: otdbQ(5, "r") } };
    });
    const q = await w.Api.fetchRound("easy", 1021, new Set(), false);
    ok(q.length === 5 && w.calls.some(u => u.includes("token=T2")), "forgotten token is replaced");
  }
  // 5. Token service down: game still works without a token
  {
    const w = world(url => url.includes("api_token") ? { status: 500, body: {} } : { body: { response_code: 0, results: otdbQ(5, "n") } });
    const q = await w.Api.fetchRound("easy", 1021, new Set(), false);
    ok(q.length === 5 && !w.calls.some(u => u.includes("&token=")), "no token available: questions still load");
  }
  // 6. Trivia API: converts, filters odd types, remembers seen ids
  {
    const w = world(url => url.includes("the-trivia-api") ? { body: [...triviaQ(30, "t"), { id: "img", type: "image_choice", question: { text: "pic" }, correctAnswer: "x", incorrectAnswers: ["a", "b", "c"] }] } : { body: { response_code: 1, results: [] } });
    const used = new Set();
    const q = await w.Api.fetchRound("easy", null, used, true);
    ok(q.length === 5 && q.every(x => x.answers.length === 4 && x.answers.includes(x.correct) && x.category === "Sport & Leisure"), "trivia api round converted to game format");
    ok(!q.some(x => x.question === "pic"), "non-text questions are skipped");
    ok(used.size === 5, "used question texts recorded");
    ok(JSON.parse(w.ls.tsSeenIds).length === 5, "seen ids saved");
    ok(w.calls.length === 1 && w.calls[0].includes("difficulties=easy") && !w.calls[0].includes("categories="), "random mode sends no category");
  }
  // 7. Seen ids are avoided on the next round
  {
    const seen = JSON.stringify(Array.from({ length: 30 }, (_, i) => "t" + i).slice(0, 25));
    const w = world(url => ({ body: triviaQ(30, "t") }), { tsSeenIds: seen });
    const q = await w.Api.fetchRound("easy", null, new Set(), true);
    ok(q.length === 5 && q.every(x => parseInt(x.question.split(" ")[2]) >= 25), "only unseen questions are chosen when enough exist");
  }
  // 8. Everything seen: list restarts instead of failing
  {
    const seen = JSON.stringify(Array.from({ length: 30 }, (_, i) => "t" + i));
    const w = world(url => ({ body: triviaQ(30, "t") }), { tsSeenIds: seen });
    const q = await w.Api.fetchRound("easy", null, new Set(), true);
    ok(q.length === 5 && JSON.parse(w.ls.tsSeenIds).length === 5, "seen list restarts when everything has been seen");
  }
  // 9. Category mapping: Sports (21) goes to sport_and_leisure; unmapped category never calls trivia api
  {
    const w = world(url => url.includes("the-trivia-api") ? { body: triviaQ(30, "s") } : { body: { response_code: 0, results: otdbQ(5, "o") } });
    await w.Api.fetchRound("hard", 21, new Set(), true);
    ok(w.calls[0].includes("categories=sport_and_leisure") && w.calls[0].includes("difficulties=hard"), "Sports maps to Sport & Leisure");
    const w2 = world(url => ({ body: { response_code: 0, results: otdbQ(5, "o") } }));
    await w2.Api.fetchRound("easy", 13, new Set(), true);   // Musicals: no match
    ok(!w2.calls.some(u => u.includes("the-trivia-api")), "category without a match uses Open Trivia DB only");
  }
  // 10. Fallbacks both ways
  {
    const w = world(url => url.includes("the-trivia-api") ? { status: 503, body: {} } : url.includes("api_token") ? { body: { response_code: 0, token: "T" } } : { body: { response_code: 0, results: otdbQ(5, "f") } });
    const q = await w.Api.fetchRound("easy", null, new Set(), true);
    ok(q.length === 5 && q[0].question.startsWith("f q"), "trivia api down: falls back to Open Trivia DB");
    const w2 = world(url => url.includes("the-trivia-api") ? { body: triviaQ(30, "b") } : url.includes("api_token") ? { body: { response_code: 0, token: "T" } } : { body: { response_code: 1, results: [] } });
    const q2 = await w2.Api.fetchRound("hard", 21, new Set(), false);
    ok(q2.length === 5 && q2[0].question.startsWith("b question"), "Open Trivia DB short: falls back to The Trivia API");
    const w3 = world(url => url.includes("the-trivia-api") ? { status: 500, body: {} } : url.includes("api_token") ? { body: { response_code: 0, token: "T" } } : { body: { response_code: 1, results: [] } });
    let msg = ""; try { await w3.Api.fetchRound("hard", 21, new Set(), false); } catch (e) { msg = e.message; }
    ok(/Not enough/.test(msg), "both fail: the host sees the friendly 'pick a different category' message");
  }
  // 11. Duplicate across sources within one game is skipped
  {
    const w = world(url => url.includes("the-trivia-api") ? { body: triviaQ(30, "d") } : { body: { response_code: 0, results: otdbQ(5, "o") } });
    const used = new Set(["d question 0", "d question 1"]);
    const q = await w.Api.fetchRound("easy", null, used, true);
    ok(!q.some(x => x.question === "d question 0" || x.question === "d question 1"), "questions already used in this game are skipped");
  }
  // 12. A whole game: 3 rounds, 15 distinct questions, alternating sources
  {
    const w = world(url => url.includes("the-trivia-api") ? { body: triviaQ(40, "g" + (tid++) + "_") } : url.includes("api_token") ? { body: { response_code: 0, token: "T" } } : { body: { response_code: 0, results: otdbQ(5, "g" + (tid++) + "o") } });
    const rounds = await w.Api.fetchAllRounds(null, () => {});
    const texts = rounds.flat().map(q => q.question);
    ok(rounds.length === 3 && rounds.every(r => r.length === 5) && new Set(texts).size === 15, "full game: 3 rounds of 5, all different");
    const t = w.calls.filter(u => u.includes("the-trivia-api")).length;
    ok(t === 1 || t === 2, "full game uses both sources (trivia api called " + t + " times)");
  }
  console.log(failed ? `${failed} FAILED, ${passed} passed` : `All ${passed} api tests passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error("CRASH", e); process.exit(2); });
