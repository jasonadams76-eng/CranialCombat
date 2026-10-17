// All rendering and click handling. Reads from Game, never changes rules.
const UI = (() => {
  const app = document.getElementById("app");

  function renderStart(onStart) {
    app.innerHTML = `
      <h1>🏆 Sports Trivia</h1>
      <p class="muted">${CONFIG.rounds.length} rounds, ${CONFIG.questionsPerRound} questions each.</p>
      <ul class="breakdown">
        ${CONFIG.rounds.map((r, i) =>
          `<li><span>Round ${i + 1} – ${r.name}</span><span>${r.points} pts each</span></li>`).join("")}
      </ul>
      <p class="muted">Max score: ${Game.maxScore()}</p>
      <button class="primary" id="start">Start Game</button>`;
    document.getElementById("start").onclick = onStart;
  }

  function renderLoading() {
    const s = Game.get();
    const r = Game.currentRound();
    app.innerHTML = `<h1>Round ${s.round + 1}: ${r.name}</h1><p class="muted">Fetching questions…</p>`;
  }

  function renderError(err, onRetry) {
    app.innerHTML = `
      <h1>Something went wrong</h1>
      <p class="muted" id="errmsg"></p>
      <button class="primary" id="retry">Try Again</button>`;
    document.getElementById("errmsg").textContent = err.message;
    document.getElementById("retry").onclick = onRetry;
  }

  function renderQuestion(onNext) {
    const s = Game.get();
    const r = Game.currentRound();
    const q = Game.currentQuestion();
    app.innerHTML = `
      <div class="topbar">
        <span>Round ${s.round + 1} of ${CONFIG.rounds.length} · Question ${s.index + 1} of ${CONFIG.questionsPerRound}</span>
        <span>Score: ${s.score}</span>
      </div>
      <span class="badge ${r.difficulty}">${r.difficulty} · ${r.points} pts</span>
      <div class="question" id="q"></div>
      <div class="answers" id="answers"></div>
      <div class="feedback" id="feedback"></div>
      <div id="next"></div>`;
    document.getElementById("q").textContent = q.question;

    const box = document.getElementById("answers");
    q.answers.forEach(ans => {
      const b = document.createElement("button");
      b.textContent = ans;
      b.onclick = () => handleAnswer(b, ans, onNext);
      box.appendChild(b);
    });
  }

  function handleAnswer(clicked, choice, onNext) {
    const result = Game.answer(choice);

    document.querySelectorAll("#answers button").forEach(b => {
      b.disabled = true;
      if (b.textContent === result.correctAnswer) b.classList.add("correct");
    });

    const fb = document.getElementById("feedback");
    if (result.correct) {
      fb.textContent = `✅ Correct! +${result.points} points`;
      fb.className = "feedback good";
    } else {
      clicked.classList.add("wrong");
      fb.textContent = `❌ Incorrect. The answer was: ${result.correctAnswer}`;
      fb.className = "feedback bad";
    }

    const last = Game.isLastQuestionOfRound();
    const label = !last ? "Next Question" : Game.isFinalRound() ? "See Final Score" : "Start Next Round";
    document.getElementById("next").innerHTML = `<button class="primary" id="nextBtn">${label}</button>`;
    document.getElementById("nextBtn").onclick = onNext;
  }

  function renderResults(onAgain) {
    const s = Game.get();
    app.innerHTML = `
      <h1>Game Over!</h1>
      <div class="big">${s.score} <small class="muted">/ ${Game.maxScore()}</small></div>
      <ul class="breakdown">
        ${CONFIG.rounds.map((r, i) => `
          <li><span>${r.name}: ${s.roundCorrect[i]}/${CONFIG.questionsPerRound} correct</span>
              <span>${s.roundScores[i]} pts</span></li>`).join("")}
      </ul>
      <button class="primary" id="again">Play Again</button>`;
    document.getElementById("again").onclick = onAgain;
  }

  return { renderStart, renderLoading, renderError, renderQuestion, renderResults };
})();
