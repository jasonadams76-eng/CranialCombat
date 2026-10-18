// Talks to the Open Trivia DB API and returns clean, ready-to-use questions.
// Only the host's browser calls this.
const Api = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // The API returns HTML entities (&quot; etc.), so decode them to plain text.
  function decode(str) {
    const t = document.createElement("textarea");
    t.innerHTML = str;
    return t.value;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Keep requests at least requestSpacingMs apart (OpenTDB rate limit).
  let lastRequestAt = 0;
  async function throttle() {
    const wait = lastRequestAt + CONFIG.requestSpacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  }

  // Returns [{ id, name }] sorted by name.
  async function fetchCategories() {
    const res = await fetch(CONFIG.categoriesUrl);
    const data = await res.json();
    return data.trivia_categories
      .map(c => ({ id: c.id, name: decode(c.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---- Small helpers for remembering things on this device (the host's browser) ----
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode: carry on */ } },
  };

  // ---- Source 1: Open Trivia DB, with a session token so questions do not repeat ----
  const TOKEN_KEY = "tsOtdbToken";
  const TOKEN_MAX_AGE_MS = 5 * 60 * 60 * 1000;   // the service forgets idle tokens after 6 hours

  async function getToken(forceNew) {
    const saved = store.get(TOKEN_KEY);
    if (!forceNew && saved && saved.token && Date.now() - saved.at < TOKEN_MAX_AGE_MS) return saved.token;
    try {
      await throttle();
      const data = await (await fetch(CONFIG.tokenUrl + "?command=request")).json();
      if (data.response_code === 0 && data.token) { store.set(TOKEN_KEY, { token: data.token, at: Date.now() }); return data.token; }
    } catch (e) { /* no token is fine: questions may repeat, but the game still works */ }
    return null;
  }
  async function resetToken(token) {
    try { await throttle(); await fetch(CONFIG.tokenUrl + "?command=reset&token=" + encodeURIComponent(token)); } catch (e) { /* ignore */ }
  }

  async function roundFromOpenTdb(difficulty, categoryId) {
    let token = await getToken(false);
    let resets = 0, renewed = false;
    for (let attempt = 0; attempt < CONFIG.maxRetries + 2; attempt++) {
      let url = `${CONFIG.apiUrl}?amount=${CONFIG.questionsPerRound}&difficulty=${difficulty}&type=multiple`;
      if (categoryId != null) url += `&category=${categoryId}`;
      if (token) url += `&token=${encodeURIComponent(token)}`;
      await throttle();
      const res = await fetch(url);
      if (res.status === 429) { await sleep(CONFIG.retryDelayMs); continue; }
      const data = await res.json();

      if (data.response_code === 0) {
        return data.results.map(q => ({
          category: decode(q.category),
          question: decode(q.question),
          correct: decode(q.correct_answer),
          answers: shuffle([q.correct_answer, ...q.incorrect_answers].map(decode)),
        }));
      }
      if (data.response_code === 5) { await sleep(CONFIG.retryDelayMs); continue; }
      // Code 3 = the service forgot our token; ask for a fresh one once.
      if (data.response_code === 3 && !renewed) { renewed = true; token = await getToken(true); continue; }
      // Code 4 = every question for this search has been used. Start the list over (once per round).
      if (data.response_code === 4 && token && resets === 0) { resets++; await resetToken(token); continue; }
      if (data.response_code === 1 || data.response_code === 4) {
        throw new Error(`Not enough ${difficulty} questions in that category. Pick a different category or Random.`);
      }
      throw new Error("The question service returned an error (code " + data.response_code + ").");
    }
    throw new Error("The question service is busy. Please try again in a moment.");
  }

  // ---- Source 2: The Trivia API (free for non-commercial use; credit is in the README) ----
  const SEEN_KEY = "tsSeenIds";
  const SEEN_MAX = 600;
  const T_NAMES = {
    arts_and_literature: "Arts & Literature", film_and_tv: "Film & TV", food_and_drink: "Food & Drink",
    general_knowledge: "General Knowledge", geography: "Geography", history: "History", music: "Music",
    science: "Science", society_and_culture: "Society & Culture", sport_and_leisure: "Sport & Leisure",
  };

  async function roundFromTriviaApi(difficulty, slug, usedText) {
    let url = `${CONFIG.triviaApiUrl}?limit=${CONFIG.triviaApiFetch}&difficulties=${difficulty}`;
    if (slug) url += `&categories=${slug}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("The second question service is unavailable.");
    const list = await res.json();
    const good = (Array.isArray(list) ? list : []).filter(q =>
      q && q.type === "text_choice" && q.question && q.question.text && q.correctAnswer &&
      Array.isArray(q.incorrectAnswers) && q.incorrectAnswers.length >= 3 && !usedText.has(q.question.text));
    let seen = store.get(SEEN_KEY) || [];
    let fresh = good.filter(q => !seen.includes(q.id));
    if (fresh.length < CONFIG.questionsPerRound) { seen = []; fresh = good; }   // ran out of new ones: start over
    const picked = shuffle(fresh.slice()).slice(0, CONFIG.questionsPerRound);
    if (picked.length < CONFIG.questionsPerRound) throw new Error("Not enough questions from the second service.");
    store.set(SEEN_KEY, seen.concat(picked.map(q => q.id)).slice(-SEEN_MAX));
    return picked.map(q => ({
      category: T_NAMES[q.category] || "Trivia",
      question: q.question.text,
      correct: q.correctAnswer,
      answers: shuffle([q.correctAnswer, ...q.incorrectAnswers.slice(0, 3)]),
    }));
  }

  // Which Trivia API category matches an Open Trivia DB category id (none = Open Trivia DB only).
  const T_SLUG = { 9: "general_knowledge", 10: "arts_and_literature", 11: "film_and_tv", 12: "music", 14: "film_and_tv",
    17: "science", 21: "sport_and_leisure", 22: "geography", 23: "history", 25: "arts_and_literature" };

  // One round. Picks a source (alternating for variety), and falls back to the other if it fails or comes up short.
  // categoryId = null means "all categories".
  async function fetchRound(difficulty, categoryId, usedText, preferTrivia) {
    usedText = usedText || new Set();
    const slug = categoryId == null ? null : T_SLUG[categoryId];
    const canTrivia = categoryId == null || !!slug;
    const order = (canTrivia && preferTrivia) ? ["trivia", "otdb"] : canTrivia ? ["otdb", "trivia"] : ["otdb"];
    let firstError = null;
    for (const src of order) {
      try {
        const qs = src === "otdb" ? await roundFromOpenTdb(difficulty, categoryId) : await roundFromTriviaApi(difficulty, slug, usedText);
        qs.forEach(q => usedText.add(q.question));
        return qs;
      } catch (e) { if (!firstError) firstError = e; }
    }
    throw firstError;
  }

  // Fetches every round up front so problems show before play starts.
  async function fetchAllRounds(categoryId, onProgress) {
    const all = [], used = new Set();
    let preferTrivia = Math.random() < 0.5;
    for (let i = 0; i < CONFIG.rounds.length; i++) {
      if (onProgress) onProgress(i);
      all.push(await fetchRound(CONFIG.rounds[i].difficulty, categoryId, used, preferTrivia));
      preferTrivia = !preferTrivia;
    }
    return all;
  }

  return { fetchCategories, fetchAllRounds, fetchRound };
})();
