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
  join: null,        // player: { code, name, token, attempts } so a dropped connection can be re-opened
  joined: false,     // player: the host has accepted us
  reconnecting: false,
  solo: false,       // a one-player game on this device: the engine runs here with no network
  soloName: null,
  recorded: false,   // this game's score has been filed in the personal Top 10
  heard: 0,          // player: when the host last sent anything
  timers: {},        // beat, sweep, retry, probe
};

// ---------- small helpers ----------
const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
};

function friendlyError(err) {
  switch (err && err.type) {
    case "peer-unavailable": return "No game found with that code. Check the code and try again.";
    case "timeout":          return "Couldn't connect to that game. If you're on the same Wi-Fi as the host, try turning Wi-Fi off and using cellular, or try again.";
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

// ---------- keep the screen awake while playing ----------
// Phones that sleep drop the connection. Not every browser supports this; it is only a help.
let wake = null;
async function acquireWake() {
  try {
    if (!navigator.wakeLock || wake || document.visibilityState !== "visible") return;
    wake = await navigator.wakeLock.request("screen");
    wake.addEventListener("release", () => { wake = null; });
  } catch (e) { wake = null; }
}
function releaseWake() {
  try { if (wake) wake.release(); } catch (e) { /* ignore */ }
  wake = null;
}

function stopTimers() {
  Object.keys(App.timers).forEach(k => { clearInterval(App.timers[k]); clearTimeout(App.timers[k]); });
  App.timers = {};
}

function teardown() {
  App.leaving = true;
  stopTimers();
  releaseWake();
  UI.banner(null);
  if (App.engine) App.engine.destroy();
  if (App.net) App.net.close();
  Object.assign(App, {
    mode: null, me: null, net: null, engine: null, code: null, category: null,
    categories: [], players: [], chat: [], note: null, lastQuestion: null, myScore: 0,
    join: null, joined: false, reconnecting: false, heard: 0, solo: false, soloName: null, recorded: false,
  });
}

// The Host / Join screen. Leaving a game or pressing Back anywhere lands here, not on the splash.
function home() {
  teardown();
  App.leaving = false;
  UI.landing({ onHost: showHostSetup, onJoin: () => showJoinSetup(""), onSolo: () => showSoloSetup(), onTop10: () => showTop10() });
}

function showHostSetup() {
  UI.hostSetup({ name: savedName(), onCreate: startHosting, onBack: home });
}

// ---------- solo ----------
function showSoloSetup(error) {
  UI.soloSetup({ name: savedName(), categories: App.categories, error, onStart: startSolo, onBack: home });
  if (!App.categories.length) {
    Api.fetchCategories().then(list => { App.categories = list; UI.setCategories(list); }).catch(() => { /* Random still works */ });
  }
}

function startSolo(rawName, categoryId) {
  const checked = Filter.checkName(rawName, { maxLength: CONFIG.maxNameLength });
  if (!checked.ok) { UI.formError(checked.message); return; }
  store.set("tsName", checked.name);
  const category = App.categories.find(c => String(c.id) === String(categoryId)) || null;   // null = random
  beginSolo(checked.name, category);
}

// One game for one player. The rules engine runs right here and "broadcasts" straight to our own screen.
async function beginSolo(name, category) {
  const cats = App.categories;
  teardown();
  App.leaving = false;
  App.categories = cats;
  Object.assign(App, { mode: "host", me: "host", solo: true, soloName: name, category });
  const eng = App.engine = HostGame.create({ solo: true, broadcast: handleMessage, send: (id, msg) => handleMessage(msg) });
  acquireWake();
  eng.addPlayer("host", name);
  UI.loading("Fetching questions…");
  try {
    const rounds = await Api.fetchAllRounds(category ? category.id : null, i => {
      if (App.engine === eng) UI.loading(`Fetching questions (${i + 1} of ${CONFIG.rounds.length})…`);
    });
    if (App.engine !== eng) return;                       // the player backed out while we were fetching
    eng.begin(rounds);
  } catch (err) {
    if (App.engine !== eng) return;
    teardown();
    App.leaving = false;
    App.categories = cats;
    UI.message("Couldn't start the game", (err && err.message) || "Couldn't load questions. Please try again.",
      "Try again", () => beginSolo(name, category), "Back", () => showSoloSetup());
  }
}

// ---------- personal Top 10 ----------
function showTop10(name) {
  const names = Scores.names();
  const saved = savedName();
  const pick = name || names.find(n => n.toLowerCase() === saved.toLowerCase()) || names[0] || saved;
  UI.top10Screen({
    names, name: pick, entries: pick ? Scores.list(pick) : [],
    onPick: showTop10, onBack: home, onSolo: () => showSoloSetup(),
  });
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
      App.joined = true;
      App.reconnecting = false;
      if (App.join) App.join.attempts = 0;
      stopTimer("retry");
      UI.banner(null);
      break;
    case "pong":
      break;
    case "roster":     // who is connected, without changing screens
      App.players = msg.players;
      UI.readyUpdate();
      break;
    case "ready":      // who has pressed Ready on the current reveal or scoreboard
      UI.readyUpdate(msg.ready);
      break;
    case "sync":       // what a returning player needs before the screen they missed arrives
      App.lastQuestion = msg.question || App.lastQuestion;
      App.myScore = msg.score || 0;
      break;
    case "lobby":
      App.players = msg.players;
      App.code = msg.meta.code || App.code;
      App.note = msg.meta.note || null;
      if (App.mode === "client") App.category = msg.meta.category || null;
      if (App.solo) break;                                     // no lobby in a solo game
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
      if (msg.round === 1 && msg.qIndex === 1) App.recorded = false;     // a new game: its score has not been filed yet
      UI.question(msg, { me: App.me, score: App.myScore, onAnswer: sendAnswer, solo: App.solo, onLock: sendLock });
      break;
    case "progress":
      UI.progress(msg, App.me, App.players.filter(p => p.connected).length);
      break;
    case "reveal": {
      const mine = msg.results.find(r => r.id === App.me);
      if (mine) App.myScore = mine.score;
      UI.reveal(msg, App.lastQuestion, App.me, hostControls());
      break;
    }
    case "roundEnd":
      UI.roundEnd(msg, App.me, hostControls());
      break;
    case "gameOver": {
      App.myScore = 0;
      const me = msg.standings.find(p => p.id === App.me);
      // File this game's score in the player's own Top 10 (once, even if the screen is shown again after a reconnect).
      let top10 = null;
      if (me && !App.recorded) {
        App.recorded = true;
        top10 = Scores.record(me.name, {
          score: me.score, category: App.category ? App.category.name : "Random",
          mode: App.solo ? "Solo" : "Multiplayer", date: Date.now(),
        });
      }
      const soloName = App.soloName, soloCategory = App.category;
      UI.gameOver(msg, {
        me: App.me, isHost: App.mode === "host" && !App.solo, solo: App.solo, top10,
        returnLabel: App.solo ? "Play Again" : null,
        // The host's button brings everyone back to the lobby. A player's button waits for that.
        onReturn: () => {
          if (App.solo) beginSolo(soloName, soloCategory);
          else if (App.mode === "host") App.engine.reset();
          else UI.message("Back to the lobby", "Waiting for the host to bring everyone back to the lobby…", "Exit Game", home);
        },
        onExit: home,
      });
      break;
    }
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

// Everyone presses Ready to move on. The host's screen also has "Continue anyway".
function hostControls() {
  return {
    isHost: App.mode === "host" && !App.solo,
    players: () => App.players,
    onReady: () => {
      if (App.mode === "host") App.engine.ready("host");
      else if (App.net) App.net.send({ t: "ready" });
    },
    onForce: () => App.engine && App.engine.next(),
  };
}

function stopTimer(name) {
  clearInterval(App.timers[name]); clearTimeout(App.timers[name]); delete App.timers[name];
}

function sendLock() {                       // solo: "Lock in" ends the question now
  if (App.solo && App.engine && App.lastQuestion) App.engine.lockIn("host", App.lastQuestion.id);
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
    send: (id, msg) => {
      if (id === "host") handleMessage(msg);
      else if (App.net) App.net.send(id, msg);
    },
  });
  acquireWake();

  App.net = Net.host({
    onReady: code => {
      App.code = code;
      App.engine.addPlayer("host", name);
      // Players that go quiet (a phone in the background) are dropped, so they don't linger as ghosts.
      App.timers.sweep = setInterval(() => {
        if (App.engine && App.net) App.engine.sweep().forEach(id => App.net.kick(id));
      }, CONFIG.heartbeatMs);
      App.engine.setMeta({ code, category: null, note: null });
      Api.fetchCategories()
        .then(list => { App.categories = list; renderLobby(); })
        .catch(() => {
          App.engine.setMeta({ note: "Couldn't load the category list, so only Random is available." });
        });
    },
    onMessage: (id, msg) => {
      App.engine.touch(id);          // any message counts as "still here"
      if (msg.t === "ping") {
        App.net.send(id, { t: "pong" });
      } else if (msg.t === "join") {
        const res = App.engine.addPlayer(id, msg.name, msg.token);
        if (!res.ok) {
          App.net.send(id, { t: "error", code: res.code, message: res.error });
          App.net.kick(id);
        } else {
          if (res.replaced) App.net.kick(res.replaced);   // the old, dead connection of a returning player
          App.net.send(id, { t: "joined", you: id });
          App.net.send(id, { t: "chatHistory", messages: App.engine.getChat() });
          if (res.rejoined && App.engine.getPhase() !== "lobby") App.engine.resync(id);
        }
      } else if (msg.t === "ready") {
        App.engine.ready(id);
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
function newToken() {
  try { return crypto.getRandomValues(new Uint32Array(3)).join("-"); }
  catch (e) { return String(Math.random()).slice(2) + Date.now(); }
}

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
  App.join = { code, name, token: newToken(), attempts: 0 };   // the token lets the host recognise us if we have to reconnect
  acquireWake();
  App.timers.slow = setTimeout(() => {
    if (UI.isShowing("connecting")) UI.connecting("Joining game…", "Still connecting. This can take a few seconds on some networks.");
  }, CONFIG.stillConnectingMs);
  openClient();
}

// Opens (or re-opens) the connection to the host. Used for the first join and for every reconnect.
function openClient() {
  const info = App.join;
  App.net = Net.join(info.code, {
    onOpen: id => {
      stopTimer("slow");
      App.me = id;
      App.net.send({ t: "join", name: info.name, token: info.token });
      stopTimer("beat");
      App.timers.beat = setInterval(() => { if (App.net) App.net.send({ t: "ping" }); }, CONFIG.heartbeatMs);
    },
    onMessage: msg => { App.heard = Date.now(); handleMessage(msg); },
    onClose: () => { stopTimer("slow"); connectionLost(); },
    onError: err => { stopTimer("slow"); connectionLost(err); },
  });
}

// The connection dropped (phone slept, network changed). Before the host accepted us, that is a plain
// failure. After, we quietly try to get back in under the same name.
function connectionLost(err) {
  if (App.leaving || App.mode !== "client") return;
  if (!App.joined && !App.reconnecting) {
    const code = App.code;
    teardown();
    if (err) UI.message("Couldn't join", friendlyError(err), "Back", () => showJoinSetup(code));
    else UI.message("Game ended", "The host left or the connection was lost.", "Home", home);
    return;
  }
  if (App.timers.retry) return;                          // a retry is already scheduled
  App.timers.retry = setTimeout(() => { delete App.timers.retry; reconnect(); }, App.reconnecting ? CONFIG.reconnectDelayMs : 0);
}

function reconnect() {
  if (App.leaving || App.mode !== "client" || !App.join) return;
  stopTimer("retry"); stopTimer("probe"); stopTimer("beat");
  const old = App.net;
  App.net = null;
  if (old) old.close();                                  // its callbacks are silenced once closed
  App.reconnecting = true;
  if (++App.join.attempts > CONFIG.reconnectAttempts) { giveUpReconnecting(); return; }
  UI.banner("Connection lost. Reconnecting…");
  openClient();
}

function giveUpReconnecting() {
  UI.banner(null);
  const info = App.join;
  UI.message("Couldn't get back in",
    "The connection to the game was lost and couldn't be restored. The host may have left, or this network is blocking the connection.",
    "Try again", () => { info.attempts = 0; UI.banner("Connection lost. Reconnecting…"); reconnect(); },
    "Home", home);
}

// Coming back to the page after the phone slept or another app was in front: check the link is still alive.
function checkAfterReturn() {
  if (document.visibilityState !== "visible") return;
  if (App.mode) acquireWake();
  if (App.mode !== "client" || !App.joined || App.reconnecting || !App.net) return;
  const asked = Date.now();
  App.net.send({ t: "ping" });
  stopTimer("probe");
  App.timers.probe = setTimeout(() => { if (App.heard < asked) reconnect(); }, CONFIG.probeMs);
}
document.addEventListener("visibilitychange", checkAfterReturn);
window.addEventListener("online", () => { if (App.mode === "client" && App.joined) reconnect(); });

// ---------- start ----------
// A perfect game should equal CONFIG.targetTotal. Warn if the settings drift.
(function checkScoring() {
  const total = CONFIG.rounds.reduce((sum, r) => sum + r.points * CONFIG.questionsPerRound, 0);
  if (total !== CONFIG.targetTotal) {
    console.warn(`Scoring adds up to ${total}, but CONFIG.targetTotal is ${CONFIG.targetTotal}.`);
  }
})();

// Called once by index.html after it has checked that every script loaded and matches the page.
// A link like  .../index.html#K7QX  skips the splash and opens the join screen with the code filled in.
App.start = function () {
  UI.setArt();
  UI.setup();
  const hashCode = location.hash.replace("#", "").trim().toUpperCase();
  if (hashCode.length === CONFIG.codeLength) showJoinSetup(hashCode);
  else UI.splash({ onStart: home });
};
