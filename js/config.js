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

  // Lobby chat
  chatMaxLength: 200,
  chatHistory: 50,         // messages kept for people who join later
  chatRateCount: 5,        // at most this many messages...
  chatRateWindowMs: 10000, // ...per this long, per player

  // Join codes. Ambiguous characters (0/O, 1/I) are left out.
  codeLength: 4,
  codeAlphabet: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
  peerPrefix: "trivia-showdown-",
  joinTimeoutMs: 20000,    // allows time for the relay fallback on tricky networks
  stillConnectingMs: 4000, // after this long the joining screen says it is still working

  // Servers that help two phones find each other (STUN) and relay data when a direct
  // link is blocked (TURN), as on many home Wi-Fi networks. Setting iceServers replaces
  // PeerJS's built-in list, so its defaults are repeated here. The Open Relay entries are a
  // shared free service with public credentials: fine for friends and family, not guaranteed.
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"], username: "peerjs", credential: "peerjsp" },
    { urls: "stun:openrelay.metered.ca:80" },
    { urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turns:openrelay.metered.ca:443?transport=tcp",
      ], username: "openrelayproject", credential: "openrelayproject" },
  ],

  // OpenTDB allows 1 request per 5 seconds per IP.
  requestSpacingMs: 5200,
  retryDelayMs: 5200,
  maxRetries: 5,
};
