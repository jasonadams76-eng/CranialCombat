// "Challenge a friend": builds the text-message invitation. A web page can't send a text itself, so this
// opens the phone's own messaging app with the number(s) and the message filled in; the person taps Send.
// Phone numbers are never stored or sent anywhere by the game.
//
//   Invite.cleanNumber("(555) 123-4567")        -> { ok, number, message }
//   Invite.message(name, code, link)            -> the text of the invitation
//   Invite.smsLink(numbers, body, isIos)        -> "sms:..." address
//   Invite.contactsSupported() / pickContacts() -> Android Chrome's contact picker
//   Invite.open(url)                            -> hands the address to the phone (replaceable in tests)
const Invite = (() => {
  const MAX_RECIPIENTS = 7;                     // the lobby holds 8 players, one of them is you

  // Accepts what people type or what contacts hold: spaces, dashes, dots and brackets are ignored.
  function cleanNumber(raw) {
    const text = String(raw == null ? "" : raw).trim();
    if (!text) return { ok: false, message: "Type a phone number first." };
    if (/[^\d\s()+.\-]/.test(text)) return { ok: false, message: "A phone number can only have digits, spaces, dashes, dots, brackets and a leading +." };
    const plus = text.startsWith("+") ? "+" : "";
    if (text.indexOf("+", 1) >= 0) return { ok: false, message: "A + can only come at the start of the number." };
    const digits = text.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return { ok: false, message: "That doesn't look like a full phone number. Include the area code." };
    return { ok: true, number: plus + digits };
  }

  // The address that opens the game with the code already filled in (same as the lobby's share link).
  function joinLink(code, loc) {
    loc = loc || (typeof location !== "undefined" ? location : null);
    if (!loc || !/^https?:$/.test(loc.protocol)) return null;
    return `${loc.origin}${loc.pathname}#${code}`;
  }

  function message(name, code, link) {
    const who = String(name || "A friend").trim() || "A friend";
    return link
      ? `${who} challenges you to Cranial Combat trivia! Tap to join: ${link} (code ${code})`
      : `${who} challenges you to Cranial Combat trivia! Join with code ${code}.`;
  }

  // Android and most browsers put the message after "?", iPhones after "&".
  function smsLink(numbers, body, isIos) {
    const to = (numbers || []).join(",");
    return `sms:${to}${isIos ? "&" : "?"}body=${encodeURIComponent(body)}`;
  }

  function isIos() {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  const contactsSupported = () => typeof navigator !== "undefined" && !!navigator.contacts && typeof navigator.contacts.select === "function"
    && typeof window !== "undefined" && "ContactsManager" in window;
  const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Opens the phone's contact picker and returns the usable numbers (first valid one of each contact).
  async function pickContacts() {
    const picked = await navigator.contacts.select(["tel"], { multiple: true });
    const numbers = [];
    (picked || []).forEach(c => {
      const hit = (c.tel || []).map(cleanNumber).find(r => r.ok);
      if (hit && !numbers.includes(hit.number)) numbers.push(hit.number);
    });
    return numbers.slice(0, MAX_RECIPIENTS);
  }

  return {
    MAX_RECIPIENTS, cleanNumber, joinLink, message, smsLink, isIos, contactsSupported, canShare, pickContacts,
    open: url => { location.href = url; },
  };
})();
