// Entry point: wires the screens, the network and the host's rules engine together.
//
// Host:   engine (HostGame) <-> Net.host <-> players. The host's own screen gets the
//         same messages players do, through handleMessage().
// Player: Net.join <-> host. Everything on screen comes from host messages.
const App = {
  mode: null,        // "host" | "client"
  me: null,          // my player id ("host" for the host)
  net: null,
  engine: null,
  code: null,
  category: null,    // { id, name } or null for random
  categories: [],
  players: [],
  chat: [],          // lobby chat messages, oldest first
  note: null,
  lastQuestion: null,
  myScore: 0,
  leaving: false,
};

// ---------- small helpers ----------
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

function friendlyError(err) {
  switch (err && err.type) {
    case "peer-unavailable": return "No game found with that code. Check the code and try again.";
    case "timeout":          return "Could not connect to that game. Check the code and your connection.";
    case "browser-incompatible": return "This browser does not support the connection technology this game needs.";
    case "network":
    case "server-error":
    case "socket-error":
    case "socket-closed":    return "Could not reach the connection service. Check your internet connection and try again.";
    default: return (err && (err.message || err.type)) || "Something went wrong.";
  }
}

// The name remembered from last time, unless it wouldn't pass the filter now.
function savedName() {
  const n = store.get("tsName");
  return Filter.checkName(n, { maxLength: CONFIG.maxNameLength }).ok ? n : "";
}

function teardown() {
  App.leaving = true;
  if (App.engine) App.engine.destroy();
  if (App.net) App.net.close();
  Object.assign(App, {
    mode: null, me: null, net: null, engine: null, code: null, category: null,
    categories: [], players: [], chat: [], note: null, lastQuestion: null, myScore: 0,
  });
}

function home() {
  teardown();
  App.leaving = false;
  UI.landing({ onHost: showHostSetup, onJoin: () => showJoinSetup("") });
}

function showHostSetup() {
  UI.hostSetup({ name: savedName(), onCreate: startHosting, onBack: home });
}

function showJoinSetup(code, error) {
  UI.joinSetup({
    code, error, name: savedName(),
    onJoin: startJoining, onBack: home,
  });
}

// ---------- screens shared by host and players ----------
function renderLobby() {
  const isHost = App.mode === "host";
  UI.lobby({
    code: App.code, players: App.players, me: App.me, isHost,
    category: App.category, categories: App.categories, note: App.note,
    onCategory: id => {
      App.category = App.categories.find(c => c.id === id) || null;   // null = random
      App.engine.setMeta({ category: App.category, note: null });
    },
    chat: App.chat, onChat: sendChat,
    onStart: hostBegin,
    onLeave: home,
  });
}

// ---------- lobby chat ----------
// Ids come from the host, so a message that arrives twice (live and again in the history) is shown once.
function addChat(list) {
  list.forEach(m => { if (!App.chat.some(x => x.id === m.id)) App.chat.push(m); });
  App.chat.sort((a, b) => a.id - b.id);
  if (App.chat.length > 100) App.chat = App.chat.slice(-100);
  if (UI.isShowing("lobby")) UI.chatUpdate(App.chat, App.me);
}

function sendChat(text) {
  if (App.mode === "host") {
    const res = App.engine.chat("host", text);
    if (!res.ok && res.error) UI.chatError(res.error);
  } else {
    App.net.send({ t: "chat", text });
  }
}

// Every message from the host (including the host's own copy) comes through here.
function handleMessage(msg) {
  switch (msg.t) {
    case "joined":
      break;
    case "lobby":
      App.players = msg.players;
      App.code = msg.meta.code || App.code;
      App.note = msg.meta.note || null;
      if (App.mode === "client") App.category = msg.meta.category || null;
      renderLobby();
      break;
    case "chat":
      addChat([msg.msg]);
      break;
    case "chatHistory":
      addChat(msg.messages);
      break;
    case "chatClear":
      App.chat = [];
      break;
    case "chatError":
      UI.chatError(msg.message);
      break;
    case "loading":
      UI.loading(msg.message);
      break;
    case "question":
      App.lastQuestion = msg;
      UI.question(msg, { me: App.me, score: App.myScore, onAnswer: sendAnswer });
      break;
    case "progress":
      UI.progress(msg, App.me, App.players.filter(p => p.connected).length);
      break;
    case "reveal": {
      const mine = msg.standings.find(s => s.id === App.me);
      if (mine) App.myScore = mine.score;
      UI.reveal(msg, App.lastQuestion, App.me, hostControls());
      break;
    }
    case "roundEnd":
      UI.roundEnd(msg, App.me, hostControls());
      break;
    case "gameOver":
      App.myScore = 0;
      UI.gameOver(msg, {
        me: App.me, isHost: App.mode === "host",
        onAgain: () => App.engine.reset(),
        onLeave: home,
      });
      break;
    case "error": {
      const code = App.code;
      teardown();
      // A rejected name goes back to the form so it can be fixed; anything else is a dead end.
      if (msg.code === "name") showJoinSetup(code, msg.message);
      else UI.message("Can't join", msg.message, "Back", home);
      break;
    }
  }
}

// Only the host's own screen can move the game on; players just wait.
function hostControls() {
  return { isHost: App.mode === "host", onNext: () => App.engine && App.engine.next() };
}

function sendAnswer(choice) {
  const id = App.lastQuestion.id;
  if (App.mode === "host") App.engine.submitAnswer("host", id, choice);
  else App.net.send({ t: "answer", id, choice });
}

// ---------- hosting ----------
function startHosting(rawName) {
  const checked = Filter.checkName(rawName, { maxLength: CONFIG.maxNameLength });
  if (!checked.ok) { UI.formError(checked.message); return; }
  const name = checked.name;
  store.set("tsName", name);
  UI.connecting("Creating game…");

  App.leaving = false;
  App.mode = "host";
  App.me = "host";
  App.engine = HostGame.create({
    broadcast: msg => {
      if (App.net) App.net.broadcast(msg);
      handleMessage(msg);
    },
  });

  App.net = Net.host({
    onReady: code => {
      App.code = code;
      App.engine.addPlayer("host", name);
      App.engine.setMeta({ code, category: null, note: null });
      Api.fetchCategories()
        .then(list => { App.categories = list; renderLobby(); })
        .catch(() => {
          App.engine.setMeta({ note: "Couldn't load the category list, so only Random is available." });
        });
    },
    onMessage: (id, msg) => {
      if (msg.t === "join") {
        const res = App.engine.addPlayer(id, msg.name);
        if (!res.ok) {
          App.net.send(id, { t: "error", code: res.code, message: res.error });
          App.net.kick(id);
        } else {
          App.net.send(id, { t: "joined", you: id });
          App.net.send(id, { t: "chatHistory", messages: App.engine.getChat() });
        }
      } else if (msg.t === "answer") {
        App.engine.submitAnswer(id, msg.id, msg.choice);
      } else if (msg.t === "chat") {
        const res = App.engine.chat(id, msg.text);
        if (!res.ok && res.error) App.net.send(id, { t: "chatError", message: res.error });
      }
    },
    onPlayerLeft: id => { if (App.engine) App.engine.removePlayer(id); },
    onError: err => {
      teardown();
      UI.message("Could not create game", friendlyError(err), "Back", home);
    },
  });
}

async function hostBegin() {
  const eng = App.engine;
  if (!eng.lock("Fetching questions…")) return;
  try {
    const rounds = await Api.fetchAllRounds(App.category ? App.category.id : null, i => {
      eng.lock(`Fetching questions (${i + 1} of ${CONFIG.rounds.length})…`);
    });
    eng.begin(rounds);
  } catch (err) {
    eng.unlock(err.message || "Couldn't load questions. Please try again.");
  }
}

// ---------- joining ----------
function startJoining(rawCode, rawName) {
  const code = rawCode.trim().toUpperCase();
  if (code.length !== CONFIG.codeLength) { UI.formError(`Enter the ${CONFIG.codeLength}-letter join code.`); return; }
  const checked = Filter.checkName(rawName, { maxLength: CONFIG.maxNameLength });
  if (!checked.ok) { UI.formError(checked.message); return; }
  const name = checked.name;
  store.set("tsName", name);
  UI.connecting("Joining game…");

  App.leaving = false;
  App.mode = "client";
  App.code = code;

  App.net = Net.join(code, {
    onOpen: id => { App.me = id; App.net.send({ t: "join", name }); },
    onMessage: handleMessage,
    onClose: () => {
      if (App.leaving) return;
      teardown();
      UI.message("Game ended", "The host left or the connection was lost.", "Home", home);
    },
    onError: err => {
      if (App.leaving) return;
      teardown();
      UI.message("Couldn't join", friendlyError(err), "Back", () => showJoinSetup(code));
    },
  });
}

// ---------- start ----------
// A perfect game should equal CONFIG.targetTotal. Warn if the settings drift.
(function checkScoring() {
  const total = CONFIG.rounds.reduce((sum, r) => sum + r.points * CONFIG.questionsPerRound, 0);
  if (total !== CONFIG.targetTotal) {
    console.warn(`Scoring adds up to ${total}, but CONFIG.targetTotal is ${CONFIG.targetTotal}.`);
  }
})();

// A link like  .../index.html#K7QX  opens the join screen with the code filled in.
const hashCode = location.hash.replace("#", "").trim().toUpperCase();
if (hashCode.length === CONFIG.codeLength) showJoinSetup(hashCode);
else home();
