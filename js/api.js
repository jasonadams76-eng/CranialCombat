// Talks to the Open Trivia DB API and returns clean, ready-to-use questions.
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

  // Fetch one round of questions. Retries when rate limited (response_code 5).
  async function fetchRound(difficulty) {
    const url = `${CONFIG.apiUrl}?amount=${CONFIG.questionsPerRound}` +
      `&category=${CONFIG.category}&difficulty=${difficulty}&type=multiple`;

    for (let attempt = 0; attempt < CONFIG.maxRetries; attempt++) {
      const res = await fetch(url);
      const data = await res.json();

      if (data.response_code === 0) {
        return data.results.map(q => ({
          question: decode(q.question),
          correct: decode(q.correct_answer),
          answers: shuffle([q.correct_answer, ...q.incorrect_answers].map(decode)),
        }));
      }
      if (data.response_code === 5) { await sleep(CONFIG.retryDelayMs); continue; }

      throw new Error("API returned code " + data.response_code +
        (data.response_code === 1 ? " (not enough questions available for this difficulty)" : ""));
    }
    throw new Error("Rate limited too many times. Please try again shortly.");
  }

  return { fetchRound };
})();
