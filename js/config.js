// Game settings. Edit these to change how the game plays.
const CONFIG = {
  apiUrl: "https://opentdb.com/api.php",
  categoriesUrl: "https://opentdb.com/api_category.php",

  // Points per correct answer. With 5 questions per round, 5 x (25 + 75 + 100) = 1000.
  questionsPerRound: 5,
  targetTotal: 1000,       // a perfect game; main.js warns if the settings above stop adding up to this
  rounds: [
    { name: "Easy",   difficulty: "easy",   points: 25  },
    { name: "Medium", difficulty: "medium", points: 75  },
    { name: "Hard",   difficulty: "hard",   points: 100 },
  ],

  questionSeconds: 10,     // time limit per question
  revealSeconds: 5,        // how long the answer + standings stay up
  roundBreakSeconds: 6,    // pause between rounds

  maxPlayers: 8,
  maxNameLength: 20,

  // Join codes. Ambiguous characters (0/O, 1/I) are left out.
  codeLength: 4,
  codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  peerPrefix: "trivia-showdown-",
  joinTimeoutMs: 12000,

  // OpenTDB allows 1 request per 5 seconds per IP.
  requestSpacingMs: 5200,
  retryDelayMs: 5200,
  maxRetries: 5,
};
