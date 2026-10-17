// Game settings. Edit these to change how the game plays.
const CONFIG = {
  apiUrl: "https://opentdb.com/api.php",
  categoriesUrl: "https://opentdb.com/api_category.php",

  questionsPerRound: 5,
  rounds: [
    { name: "Easy",   difficulty: "easy",   points: 5  },
    { name: "Medium", difficulty: "medium", points: 10 },
    { name: "Hard",   difficulty: "hard",   points: 20 },
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
