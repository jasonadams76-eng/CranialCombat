// Tests for the text-message invitation (js/invite.js).  node tests/invite.test.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "invite.js"), "utf8");
const Invite = vm.runInNewContext(src + "\n;Invite", { console, location: {}, navigator: {}, window: {} });
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
let failed = 0, n = 0;
const test = (name, fn) => { n++; try { fn(); console.log("  ok   " + name); } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); } };

test("numbers are cleaned of spaces, dashes, dots and brackets", () => {
  assert.strictEqual(Invite.cleanNumber("(555) 123-4567").number, "5551234567");
  assert.strictEqual(Invite.cleanNumber("555.123.4567").number, "5551234567");
  assert.strictEqual(Invite.cleanNumber(" 555 123 4567 ").number, "5551234567");
});
test("a leading + is kept (international numbers)", () => {
  assert.strictEqual(Invite.cleanNumber("+1 (555) 123-4567").number, "+15551234567");
  assert.strictEqual(Invite.cleanNumber("+44 7700 900123").number, "+447700900123");
});
test("bad numbers are refused with a reason", () => {
  for (const bad of ["", "   ", "abc", "555-1234-ext", "12345", "1234567890123456", "55+5551234", "<script>", "555 123 4567; rm"]) {
    const r = Invite.cleanNumber(bad);
    assert.strictEqual(r.ok, false, JSON.stringify(bad));
    assert(r.message && r.message.length > 5);
  }
  assert.strictEqual(Invite.cleanNumber(null).ok, false);
  assert.strictEqual(Invite.cleanNumber(undefined).ok, false);
});
test("7 to 15 digits are accepted", () => {
  assert.strictEqual(Invite.cleanNumber("555-1234").ok, true);
  assert.strictEqual(Invite.cleanNumber("123456789012345").ok, true);
});
test("the message names the player, the code and the link", () => {
  const m = Invite.message("Jason", "K7QX", "https://x.github.io/CranialCombat/#K7QX");
  assert(m.includes("Jason challenges you") && m.includes("https://x.github.io/CranialCombat/#K7QX") && m.includes("K7QX"));
  assert(Invite.message("Jason", "K7QX", null).includes("code K7QX"));
  assert(Invite.message("", "K7QX", null).startsWith("A friend challenges you"));
});
test("join link uses the page address and the code; none for file: pages", () => {
  assert.strictEqual(Invite.joinLink("ABCD", { protocol: "https:", origin: "https://a.github.io", pathname: "/CranialCombat/" }), "https://a.github.io/CranialCombat/#ABCD");
  assert.strictEqual(Invite.joinLink("ABCD", { protocol: "file:", origin: "null", pathname: "/x/index.html" }), null);
});
test("sms link: Android style puts the message after ?, iPhone after &", () => {
  const body = "Jason challenges you! Tap: https://a.b/c#K7QX (code K7QX)";
  const a = Invite.smsLink(["5551234567"], body, false);
  assert(a.startsWith("sms:5551234567?body=") && !a.includes(" ") && !a.includes("#K7QX"), a);
  assert.strictEqual(decodeURIComponent(a.split("?body=")[1]), body);
  const i = Invite.smsLink(["5551234567"], body, true);
  assert(i.startsWith("sms:5551234567&body="), i);
  assert.strictEqual(decodeURIComponent(i.split("&body=")[1]), body);
});
test("sms link with several people, and with nobody (the person chooses in their messaging app)", () => {
  assert(Invite.smsLink(["5551234567", "+447700900123"], "hi", false).startsWith("sms:5551234567,+447700900123?body="));
  assert(Invite.smsLink([], "hi", false).startsWith("sms:?body="));
});
test("the message can't break out of the link", () => {
  const l = Invite.smsLink(["5551234567"], 'a&b=c?d#e"f', false);
  assert.strictEqual((l.match(/\?/g) || []).length, 1);
  assert(!/[&#"]/.test(l.split("?body=")[1]));
});
test("picked contacts: first valid number of each, duplicates and bad numbers dropped, capped", async () => {
  const sb = { console, location: {}, window: { ContactsManager: function () {} },
    navigator: { contacts: { select: async () => [
      { tel: ["abc", "(555) 123-4567"] }, { tel: ["555-123-4567"] }, { tel: [] }, { tel: ["12"] }, {},
      { tel: ["+44 7700 900123"] }, ...Array.from({ length: 10 }, (_, i) => ({ tel: ["555-000-" + String(1000 + i)] })),
    ] } } };
  const I = vm.runInNewContext(src + "\n;Invite", sb);
  assert.strictEqual(I.contactsSupported(), true);
  const nums = await I.pickContacts();
  assert.strictEqual(nums[0], "5551234567"); assert.strictEqual(nums[1], "+447700900123");
  assert.strictEqual(nums.length, I.MAX_RECIPIENTS);
  assert.strictEqual(new Set(nums).size, nums.length);
});
test("support checks are false where the browser lacks the feature", () => {
  assert.strictEqual(Invite.contactsSupported(), false);
  assert.strictEqual(Invite.canShare(), false);
});
// the async test above completes before the summary
setTimeout(() => { console.log(failed ? `\n${failed} of ${n} tests FAILED` : `\nAll ${n} invite tests passed`); process.exit(failed ? 1 : 0); }, 100);
