// Peer-to-peer networking on top of PeerJS (WebRTC). The host's browser acts as
// the server. Everyone else connects to it using the 4-letter join code.
// This file knows nothing about the game rules.
const Net = (() => {
  function randomCode() {
    const a = CONFIG.codeAlphabet;
    let s = "";
    for (let i = 0; i < CONFIG.codeLength; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  // callbacks: onReady(code), onMessage(playerId, msg), onPlayerLeft(playerId), onError(err)
  function host(cb) {
    const conns = new Map();   // playerId -> DataConnection
    let peer = null;
    let attempts = 0;
    let closed = false;

    const api = {
      code: null,
      send(id, msg) {
        const c = conns.get(id);
        if (c && c.open) c.send(msg);
      },
      broadcast(msg) {
        conns.forEach(c => { if (c.open) c.send(msg); });
      },
      // Let a final message arrive, then drop the connection.
      kick(id) {
        const c = conns.get(id);
        if (c) setTimeout(() => c.close(), 400);
      },
      close() {
        closed = true;
        if (peer) peer.destroy();
      },
    };

    function open() {
      const code = randomCode();
      peer = new Peer(CONFIG.peerPrefix + code, { config: { iceServers: CONFIG.iceServers } });

      peer.on("open", () => { api.code = code; cb.onReady(code); });

      peer.on("error", err => {
        // Someone else already has this code: try another.
        if (err.type === "unavailable-id" && ++attempts < 5) { peer.destroy(); open(); return; }
        if (!closed) cb.onError(err);
      });

      // Lost the connection to the broker: existing players stay connected,
      // reconnecting lets new players join.
      peer.on("disconnected", () => { if (!closed && !peer.destroyed) peer.reconnect(); });

      peer.on("connection", conn => {
        conn.on("open", () => conns.set(conn.peer, conn));
        conn.on("data", msg => cb.onMessage(conn.peer, msg));
        conn.on("close", () => {
          if (conns.get(conn.peer) === conn) conns.delete(conn.peer);
          cb.onPlayerLeft(conn.peer);
        });
        conn.on("error", () => {});
      });
    }

    open();
    return api;
  }

  // callbacks: onOpen(myId), onMessage(msg), onClose(), onError(err)
  function join(code, cb) {
    let conn = null;
    let myId = null;
    let closed = false;
    const peer = new Peer(undefined, { config: { iceServers: CONFIG.iceServers } });

    const api = {
      send(msg) { if (conn && conn.open) conn.send(msg); },
      close() { closed = true; peer.destroy(); },
    };

    peer.on("open", id => {
      myId = id;
      conn = peer.connect(CONFIG.peerPrefix + String(code).trim().toUpperCase(),
        { serialization: "json", reliable: true });
      conn.on("open", () => { clearTimeout(timeout); cb.onOpen(myId); });
      conn.on("data", msg => cb.onMessage(msg));
      conn.on("close", () => { if (!closed) cb.onClose(); });
      conn.on("error", err => { if (!closed) cb.onError(err); });
      const timeout = setTimeout(() => {
        if (!conn.open && !closed) cb.onError({ type: "timeout" });
      }, CONFIG.joinTimeoutMs);
    });

    peer.on("error", err => { if (!closed) cb.onError(err); });
    return api;
  }

  return { host, join };
})();
