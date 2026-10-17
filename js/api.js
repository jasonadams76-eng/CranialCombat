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

  // One round of questions. categoryId = null means "all categories".
  async function fetchRound(difficulty, categoryId) {
    let url = `${CONFIG.apiUrl}?amount=${CONFIG.questionsPerRound}&difficulty=${difficulty}&type=multiple`;
    if (categoryId != null) url += `&category=${categoryId}`;

    for (let attempt = 0; attempt < CONFIG.maxRetries; attempt++) {
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
      if (data.response_code === 1) {
        throw new Error(`Not enough ${difficulty} questions in that category. Pick a different category or Random.`);
      }
      throw new Error("The question service returned an error (code " + data.response_code + ").");
    }
    throw new Error("The question service is busy. Please try again in a moment.");
  }

  // Fetches every round up front so problems show before play starts.
  async function fetchAllRounds(categoryId, onProgress) {
    const all = [];
    for (let i = 0; i < CONFIG.rounds.length; i++) {
      if (onProgress) onProgress(i);
      all.push(await fetchRound(CONFIG.rounds[i].difficulty, categoryId));
    }
    return all;
  }

  return { fetchCategories, fetchAllRounds };
})();
