// Tests for the name and chat filter (js/filter.js).  Run:  node tests/filter.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const code = fs.readFileSync(path.join(__dirname, "..", "js", "filter.js"), "utf8");
const Filter = vm.runInNewContext(code + "\n;Filter");

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

run("names: blocked names are rejected", () => {
  const missed = blocked.filter(n => Filter.checkName(n).ok);
  assert.deepStrictEqual(missed, [], "not blocked: " + JSON.stringify(missed));
});

run("names: innocent names are accepted (no false positives)", () => {
  const wrong = allowed.filter(n => !Filter.checkName(n).ok);
  assert.deepStrictEqual(wrong, [], "wrongly blocked: " + JSON.stringify(wrong));
});

run("empty / symbol-only / invisible-only names are rejected as empty", () => {
  ["", "   ", "!!!", "...", "🙂🙂", "​​​", "‮", "\t\n"].forEach(n => {
    const r = Filter.checkName(n);
    assert.strictEqual(r.ok, false, JSON.stringify(n));
    assert.strictEqual(r.reason, "empty", JSON.stringify(n));
  });
  assert.strictEqual(Filter.checkName(null).ok, false);
  assert.strictEqual(Filter.checkName(undefined).ok, false);
});

run("messages: vague for blocked names, never names the matching word", () => {
  const r = Filter.checkName("fuck");
  assert.strictEqual(r.message, "Please choose a different name.");
  assert(!/fuck/i.test(JSON.stringify(r)));
  assert.strictEqual(Filter.checkName("").message, "Please enter a name.");
});

run("cleaned name: invisible characters stripped, spaces collapsed, length capped", () => {
  assert.strictEqual(Filter.checkName("  Sam​   Smith  ").name, "Sam Smith");
  assert.strictEqual(Filter.checkName("A".repeat(50)).name.length, 20);
  assert.strictEqual(Filter.checkName("B".repeat(50), { maxLength: 8 }).name, "BBBBBBBB");
  assert.strictEqual(Array.from(Filter.checkName("𝒜".repeat(30)).name).length, 20);   // counts characters, not UTF-16 units
});

run("a name cut at the length limit is checked as displayed, and a long name can't hide a word", () => {
  const r = Filter.checkName("x".repeat(30) + "fuck");   // word is beyond the 20-char cut
  assert.strictEqual(r.ok, true);                         // what is displayed is only the x's
  assert.strictEqual(r.name, "x".repeat(20));
  assert.strictEqual(Filter.checkName("x".repeat(15) + "fuck").ok, false);
});

// ---------------------------------------------------------------- chat messages
const blockedMessages = [
  "you are a fuck", "what the fuck", "sh1t happens", "go f.u.c.k yourself", "f u c k", "fuuuuck", "youfuckingidiot",
  "that is $hit", "b!tch please", "fuсk this",           // Cyrillic "с"
  "kill yourself", "KillYourself", "hitler was right", "BigDick jokes", "you are an a s s",
  "visit http://spam.example", "check www.spam.net", "go to mysite.com now", "email me at a@b.com",
  "call 555-123-4567", "text me 5551234567", "(555) 123 4567 is my number",
];
const allowedMessages = [
  // letters from neighbouring words must never combine into a match
  "this hit me", "nice shirt", "what a hit", "that was a class act", "my assistant coach", "I love Hancock Park",
  "Scunthorpe is a town", "Is it Dickinson or Dickens?", "the Cockburn family", "Penistone is in Yorkshire",
  // numbers, trivia talk, normal chat
  "1000000 points!", "I scored 455 points", "Bartolomeu Dias rounded the Cape in 1488", "what's 5 + 7?", "55 or 45?",
  "who is the host?", "tell the admin hi", "is the moderator here", "ready when you are", "lol!!!", "🙂", "good luck everyone",
  "Zoë and José are here", "你好", "Привет", "It's O'Brien's turn", "see you in the Final Round",
  "this is a really long sentence with a lot of ordinary words that should all be fine",
];

run("chat: blocked messages are rejected", () => {
  const missed = blockedMessages.filter(m => Filter.checkMessage(m).ok);
  assert.deepStrictEqual(missed, [], "not blocked: " + JSON.stringify(missed));
});

run("chat: ordinary messages are accepted (no false positives)", () => {
  const wrong = allowedMessages.filter(m => !Filter.checkMessage(m).ok);
  assert.deepStrictEqual(wrong, [], "wrongly blocked: " + JSON.stringify(wrong));
});

run("chat: empty or whitespace-only messages are rejected as empty; symbols and emoji are fine", () => {
  ["", "   ", "\n\t", "\u200B\u200B", null, undefined].forEach(m => {
    const r = Filter.checkMessage(m);
    assert.strictEqual(r.ok, false, JSON.stringify(m));
    assert.strictEqual(r.reason, "empty", JSON.stringify(m));
  });
  assert.strictEqual(Filter.checkMessage("!!!").ok, true);
});

run("chat: text is cleaned and capped at the limit", () => {
  assert.strictEqual(Filter.checkMessage("  hello\u200B   there \n friend ").text, "hello there friend");
  assert.strictEqual(Filter.checkMessage("a".repeat(500)).text.length, 200);
  assert.strictEqual(Filter.checkMessage("b".repeat(50), { maxLength: 10 }).text, "bbbbbbbbbb");
  assert.strictEqual(Filter.checkMessage("<b>hi</b> & <i>there</i>").text, "<b>hi</b> & <i>there</i>");   // kept as text; the screen escapes it
});

run("chat: a blocked word cut off by the length limit is not sent, one beyond it is not seen", () => {
  assert.strictEqual(Filter.checkMessage("x ".repeat(120) + "fuck").ok, true);        // word falls past 200 chars and is dropped
  assert.strictEqual(Filter.checkMessage("x ".repeat(120) + "fuck").text.includes("fuck"), false);
  assert.strictEqual(Filter.checkMessage("x ".repeat(50) + "fuck").ok, false);
});

console.log(failed ? `\n${failed} test(s) FAILED` : "\nAll filter tests passed");
process.exit(failed ? 1 : 0);
