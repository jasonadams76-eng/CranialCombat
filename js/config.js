// Game settings. Edit these to change how the game plays.
const CONFIG = {
  apiUrl: "https://opentdb.com/api.php",
  category: 21,            // 21 = Sports in Open Trivia DB
  questionsPerRound: 5,
  rounds: [
    { name: "Easy",   difficulty: "easy",   points: 5  },
    { name: "Medium", difficulty: "medium", points: 10 },
    { name: "Hard",   difficulty: "hard",   points: 20 },
  ],
  retryDelayMs: 5200,      // OpenTDB allows 1 request per 5 seconds per IP
  maxRetries: 5,
};
