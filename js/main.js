// Entry point: wires the UI to the game flow.
async function startRound() {
  UI.renderLoading();
  try {
    await Game.loadRound();
    showQuestion();
  } catch (err) {
    UI.renderError(err, startRound);
  }
}

function showQuestion() {
  UI.renderQuestion(onNext);
}

function onNext() {
  if (!Game.isLastQuestionOfRound()) {
    Game.nextQuestion();
    showQuestion();
  } else if (!Game.isFinalRound()) {
    Game.nextRound();
    startRound();
  } else {
    UI.renderResults(newGame);
  }
}

function newGame() {
  Game.reset();
  startRound();
}

UI.renderStart(newGame);
