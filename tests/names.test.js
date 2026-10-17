// Tests for the name filter (js/names.js).  Run:  node tests/names.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const code = fs.readFileSync(path.join(__dirname, "..", "js", "names.js"), "utf8");
const NameFilter = vm.runInNewContext(code + "\n;NameFilter");

const blocked = [
  // profanity, plain and disguised
  "fuck", "FUCK", "Fuck You", "f u c k", "f.u.c.k", "fuuuck", "fvck".replace("v", "u"), "sh1t", "$hit", "b!tch", "bitch_please",
  "fuсk",                       // Cyrillic "с"
  "BigDick", "big dick", "Dick", "a s s", "Jackass99", "asshole", "pussy", "sexy",
  // hate / harm
  "nazi", "Hitler Fan", "Heil Hitler", "kill yourself", "KillYourself", "kys", "Mike1488",
  // spam / personal info
  "http://x.com", "visit mysite.com", "me@mail.com", "5551234567", "555-123-4567", "(555) 123 4567",
  // impersonation
  "Host", "the host", "ADMIN", "Admin123", "Moderator", "Trivia Showdown", "Ηοst".replace("Η", "H"),
];

const allowed = [
  // classic false-positive traps
  "Scunthorpe", "Dickinson", "Cassie", "Hancock", "Class", "Assassin", "Assistant", "Penistone", "Essex",
  "Sussex", "Analise", "Analyst", "Matsushita", "Shiitake", "Cockburn", "Peacock", "Hitchcock", "Raccoon",
  "Nazir", "Grapes", "Titan", "Skittles", "Mitt", "Shell", "Hello", "Pornchai", "Kanokporn",
  // ordinary names in various forms and scripts
  "Jason", "Mike_99", "Alex T.", "Anne-Marie", "O'Brien", "Zoë", "José", "Σοφία", "李雷", "Иван", "The Quizzard",
  "Trivia Queen", "Hosea", "Admiral", "Systematic", "Team 7",
];

let failed = 0;
const run = (name, fn) => { try { fn(); console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); } };

run("blocked names are rejected", () => {
  const missed = blocked.filter(n => NameFilter.check(n).ok);
  assert.deepStrictEqual(missed, [], "not blocked: " + JSON.stringify(missed));
});

run("innocent names are accepted (no false positives)", () => {
  const wrong = allowed.filter(n => !NameFilter.check(n).ok);
  assert.deepStrictEqual(wrong, [], "wrongly blocked: " + JSON.stringify(wrong));
});

run("empty / symbol-only / invisible-only names are rejected as empty", () => {
  ["", "   ", "!!!", "...", "🙂🙂", "​​​", "‮", "\t\n"].forEach(n => {
    const r = NameFilter.check(n);
    assert.strictEqual(r.ok, false, JSON.stringify(n));
    assert.strictEqual(r.reason, "empty", JSON.stringify(n));
  });
  assert.strictEqual(NameFilter.check(null).ok, false);
  assert.strictEqual(NameFilter.check(undefined).ok, false);
});

run("messages: vague for blocked names, never names the matching word", () => {
  const r = NameFilter.check("fuck");
  assert.strictEqual(r.message, "Please choose a different name.");
  assert(!/fuck/i.test(JSON.stringify(r)));
  assert.strictEqual(NameFilter.check("").message, "Please enter a name.");
});

run("cleaned name: invisible characters stripped, spaces collapsed, length capped", () => {
  assert.strictEqual(NameFilter.check("  Sam​   Smith  ").name, "Sam Smith");
  assert.strictEqual(NameFilter.check("A".repeat(50)).name.length, 20);
  assert.strictEqual(NameFilter.check("B".repeat(50), { maxLength: 8 }).name, "BBBBBBBB");
  assert.strictEqual(Array.from(NameFilter.check("𝒜".repeat(30)).name).length, 20);   // counts characters, not UTF-16 units
});

run("a name cut at the length limit is checked as displayed, and a long name can't hide a word", () => {
  const r = NameFilter.check("x".repeat(30) + "fuck");   // word is beyond the 20-char cut
  assert.strictEqual(r.ok, true);                         // what is displayed is only the x's
  assert.strictEqual(r.name, "x".repeat(20));
  assert.strictEqual(NameFilter.check("x".repeat(15) + "fuck").ok, false);
});

console.log(failed ? `\n${failed} test(s) FAILED` : "\nAll name filter tests passed");
process.exit(failed ? 1 : 0);
