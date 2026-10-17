// Text filter for player names and lobby chat. Used on the forms (quick feedback) and again by
// the host's engine (real enforcement, since a modified client could skip the form check).
//
// Filter.checkName(raw)    -> { ok: true, name }  |  { ok: false, reason, message }   reason: "empty" | "blocked"
// Filter.checkMessage(raw) -> { ok: true, text }  |  { ok: false, reason }
//
// Names are held to a stricter standard (the whole name is squashed together before matching).
// Chat is read word by word, so ordinary sentences such as "this hit me" are not caught by accident.
//
// No word filter is perfect. The lists below are plain arrays: add or remove entries freely.
const Filter = (() => {
  // Matched as WHOLE WORDS (so "Class", "Analise", "Penistone" are fine).
  const WORDS = [
    // profanity / sexual
    "ass", "arse", "tit", "tits", "boob", "boobs", "cock", "dick", "prick", "pussy", "cum", "anal", "anus",
    "penis", "vagina", "sex", "sexy", "nude", "nudes", "nsfw", "horny", "porn", "orgy", "bdsm", "milf",
    "hentai", "fetish", "twat", "wank", "bollocks", "piss", "crap", "damn", "hell",
    // slurs and hate
    "fag", "tranny", "chink", "spic", "kike", "coon", "gook", "beaner", "paki", "nazi", "kkk",
    // violence / self-harm / crime / drugs
    "rape", "rapes", "incest", "pedo", "suicide", "suicidal", "kys", "meth", "cocaine", "heroin",
  ];

  // Matched ANYWHERE in the name, even with spaces/symbols between letters.
  // Only long, distinctive terms belong here; short ones cause false positives.
  const SUBSTRINGS = [
    "fuck", "shit", "bitch", "cunt", "whore", "slut", "nigg", "fagg", "retard", "cocksuck", "blowjob",
    "handjob", "dildo", "jerkoff", "jackoff", "wanker", "asshole", "asswipe", "dumbass", "jackass", "fatass",
    "motherf", "pornhub", "pornstar", "rapist", "pedophile", "paedo", "molest", "hitler", "siegheil",
    "heilhitler", "swastika", "whitepower", "killyourself", "hangyourself",
  ];

  // Multi-word phrases for chat, matched against the whole message with spaces and symbols removed.
  // They are long enough that they won't appear by accident across word boundaries.
  const PHRASES = [
    "killyourself", "killyourselves", "killurself", "hangyourself", "hangurself", "goandkillyourself",
  ];

  // Innocent words that contain a blocked substring. Removed before the substring check.
  const ALLOWED = [
    "scunthorpe", "matsushita", "shiitake", "shitake", "niggle", "niggly", "retardant",
  ];

  // Names that would look like the game itself or its staff. Compared to the whole
  // name (letters only, trailing digits ignored), so "Host", "Admin2" are blocked but "Hosea" is not.
  const RESERVED = [
    "host", "thehost", "admin", "administrator", "moderator", "mod", "system", "server", "gamemaster",
    "official", "staff", "support", "trivia", "triviashowdown", "you", "everyone", "all",
  ];

  // Digit / symbol look-alikes, plus Cyrillic and Greek letters that look like Latin ones.
  const LOOKALIKES = {
    "0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "$": "s", "5": "s", "7": "t", "+": "t",
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "α": "a", "ο": "o", "ν": "v", "ρ": "p", "ι": "i",
  };

  const INVISIBLE = /[\u0000-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

  const MESSAGES = {
    empty: "Please enter a name.",
    blocked: "Please choose a different name.",   // deliberately vague: never say which word matched
  };
  const fail = reason => ({ ok: false, reason, message: MESSAGES[reason] });

  const baseForm = s => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const mapLookalikes = s => Array.from(s, c => LOOKALIKES[c] || c).join("");
  // "fuuuck" -> "fuck" / "fuuck": try runs of 3+ squeezed to 1 and to 2 letters.
  const squeezed = s => [s, s.replace(/(.)\1{2,}/g, "$1"), s.replace(/(.)\1{2,}/g, "$1$1")];

  function hasBlockedWord(tokens) {
    const set = new Set(WORDS);
    return tokens.some(t => squeezed(t).some(v => set.has(v)));
  }

  function hasBlockedSubstring(compact) {
    let c = compact;
    ALLOWED.forEach(w => { c = c.split(w).join("|"); });
    return squeezed(c).some(v => SUBSTRINGS.some(s => v.includes(s)));
  }

  function checkName(raw, options) {
    const maxLength = (options && options.maxLength) || 20;

    // 1. Clean up what will be displayed.
    const name = Array.from(String(raw == null ? "" : raw)
      .normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim())
      .slice(0, maxLength).join("").trim();                          // by character, not UTF-16 unit
    if (!/[\p{L}\p{N}]/u.test(name)) return fail("empty");

    // 2. Links, e-mail addresses, phone-number-like strings.
    if (/https?:|www\.|\.(com|net|org|io|gg|co|me|ly|xyz|tv)\b/i.test(name)) return fail("blocked");
    if (/\S+@\S+\.\S+/.test(name)) return fail("blocked");
    if (/\d{7,}/.test(name.replace(/[\s().\-]/g, ""))) return fail("blocked");
    if (/1488/.test(name)) return fail("blocked");

    // 3. Words, read in a few different ways so simple disguises don't work.
    const spaced = name.replace(/([a-z])([A-Z])/g, "$1 $2");          // BigDick -> Big Dick
    const forms = [baseForm(spaced), mapLookalikes(baseForm(spaced))];
    for (const form of forms) {
      const tokens = form.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      // "a s s" -> "ass": join runs of single letters
      const joined = [];
      let run = "";
      tokens.forEach(t => {
        if (t.length === 1) run += t;
        else { if (run.length > 1) joined.push(run); run = ""; }
      });
      if (run.length > 1) joined.push(run);

      if (hasBlockedWord(tokens.concat(joined))) return fail("blocked");
      const compact = form.replace(/[^\p{L}\p{N}]+/gu, "");
      if (hasBlockedSubstring(compact)) return fail("blocked");
    }

    // 4. Names that pose as the game or its staff.
    const reserved = mapLookalikes(baseForm(name).replace(/[^\p{L}\p{N}]+/gu, "").replace(/\d+$/, ""));
    if (RESERVED.includes(reserved)) return fail("blocked");

    return { ok: true, name };
  }

  // ---------- chat messages ----------
  function tokensBlocked(tokens) {
    // "f u c k" -> "fuck": also try runs of single letters joined together
    const joined = [];
    let run = "";
    tokens.forEach(t => {
      if (t.length === 1) run += t;
      else { if (run.length > 1) joined.push(run); run = ""; }
    });
    if (run.length > 1) joined.push(run);
    // Each word is checked on its own, so letters from neighbouring words never combine into a match.
    return tokens.concat(joined).some(t => hasBlockedWord([t]) || hasBlockedSubstring(t));
  }

  function checkMessage(raw, options) {
    const maxLength = (options && options.maxLength) || 200;
    const text = Array.from(String(raw == null ? "" : raw)
      .normalize("NFC").replace(/[\t\n\r\v\f]+/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim())
      .slice(0, maxLength).join("").trim();
    if (!text) return fail("empty");

    // Links, e-mail addresses and phone numbers (10+ digits, spaces / dashes allowed)
    if (/https?:|www\./i.test(text) || /[a-z0-9]\.(com|net|org|io|gg|co|me|ly|xyz|tv)\b/i.test(text)) return fail("blocked");
    if (/\S+@\S+\.\S+/.test(text)) return fail("blocked");
    if (/(?:\d[\s().\-]*){10,}/.test(text)) return fail("blocked");

    const chunks = text.replace(/([a-z])([A-Z])/g, "$1 $2").split(" ");
    for (const lookalikes of [false, true]) {
      const tokens = [];
      chunks.forEach(chunk => {
        let c = baseForm(chunk);
        // Plain numbers ("455") must not be turned into letters ("ass"): only map chunks that already contain a letter.
        if (lookalikes && /\p{L}/u.test(c)) c = mapLookalikes(c);
        c.split(/[^\p{L}\p{N}]+/u).filter(Boolean).forEach(t => tokens.push(t));
      });
      if (tokensBlocked(tokens)) return fail("blocked");
      if (squeezed(tokens.join("")).some(v => PHRASES.some(p => v.includes(p)))) return fail("blocked");
    }
    return { ok: true, text };
  }

  return { checkName, checkMessage };
})();
