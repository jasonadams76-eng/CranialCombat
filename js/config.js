// Game settings. Edit these to change how the game plays.
const CONFIG = {
  apiUrl: "https://opentdb.com/api.php",
  categoriesUrl: "https://opentdb.com/api_category.php",

  // Points per correct answer. With 5 questions per round, 5 x (25 + 75 + 100) = 1000.
  questionsPerRound: 5,
  targetTotal: 1000,       // a perfect game; main.js warns if the settings above stop adding up to this
  rounds: [
    { name: "Round 1",     difficulty: "easy",   points: 25  },
    { name: "Round 2",     difficulty: "medium", points: 75  },
    { name: "Final Round", difficulty: "hard",   points: 100 },
  ],

  // Time limit per question. The standings and round scoreboards have no timer:
  // the host clicks Next to move on.
  questionSeconds: 20,

  // Guards against double clicks landing on the next screen.
  minAdvanceMs: 600,       // the engine ignores Next this soon after the standings / scoreboard appear
  answerGuardMs: 500,      // answer buttons ignore clicks this soon after a question appears

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
