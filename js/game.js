// Game state and rules. Contains no DOM code.
const Game = (() => {
  let state = newState();

  function newState() {
    const n = CONFIG.rounds.length;
    return {
      round: 0,
      index: 0,
      score: 0,
      questions: [],
      roundScores: Array(n).fill(0),
      roundCorrect: Array(n).fill(0),
    };
  }

  const reset = () => { state = newState(); };
  const get = () => state;
  const currentRound = () => CONFIG.rounds[state.round];
  const currentQuestion = () => state.questions[state.index];
  const maxScore = () =>
    CONFIG.rounds.reduce((sum, r) => sum + r.points * CONFIG.questionsPerRound, 0);

  async function loadRound() {
    state.questions = await Api.fetchRound(currentRound().difficulty);
    state.index = 0;
  }

  // Returns { correct, points, correctAnswer }
  function answer(choice) {
    const q = currentQuestion();
    const r = currentRound();
    const correct = choice === q.correct;
    if (correct) {
      state.score += r.points;
      state.roundScores[state.round] += r.points;
      state.roundCorrect[state.round]++;
    }
    return { correct, points: correct ? r.points : 0, correctAnswer: q.correct };
  }

  const isLastQuestionOfRound = () => state.index === CONFIG.questionsPerRound - 1;
  const isFinalRound = () => state.round === CONFIG.rounds.length - 1;

  const nextQuestion = () => { state.index++; };
  const nextRound = () => { state.round++; };

  return {
    reset, get, currentRound, currentQuestion, maxScore, loadRound, answer,
    isLastQuestionOfRound, isFinalRound, nextQuestion, nextRound,
  };
})();
