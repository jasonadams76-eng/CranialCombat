# Trivia Showdown

A multiplayer browser trivia game powered by the [Open Trivia DB](https://opentdb.com) API. One player hosts, everyone else joins with a 4-letter code. There is no game server: the host's browser runs the game and players connect to it directly (peer-to-peer, via [PeerJS](https://peerjs.com)).

## How it plays

1. **Host** creates a game, picks a category (or Random for all categories) and shares the join code.
2. **Players** open the game, enter the code and a name.
3. The host starts the game. Everyone gets the same questions: **3 rounds of 5**.

| Round | Difficulty | Points per correct answer | Round total |
|-------|-----------|---------------------------|-------------|
| 1 | Easy | 25 | 125 |
| 2 | Medium | 75 | 375 |
| 3 | Hard | 100 | 500 |

A perfect game scores exactly **1000** points.

- Each question has a **10 second** timer. It ends early once everyone has answered. No answer scores 0.
- After every question everyone sees the correct answer and the **updated standings**.
- At the end there is a final leaderboard with a per-round breakdown. The host can start another game with the same players.
- Up to 8 players.

## Running it

Players on different devices need a web address, so host the folder as a static site, for example with **GitHub Pages** (repo Settings, Pages, deploy from the `main` branch). Then share the address. A link like `https://<you>.github.io/TriviaShowdown/#K7QX` opens the join screen with the code filled in.

For a quick solo test you can double-click `index.html`. An internet connection is required (for PeerJS and the question API).

## Project layout

```
index.html        page shell (loads PeerJS from a CDN, version pinned)
css/styles.css    styling
js/config.js      rounds, points, timers, player limit, join-code settings
js/api.js         OpenTDB: category list and question fetching (host only)
js/game.js        host rules engine: players, timer, scoring, standings (no DOM, no network)
js/net.js         PeerJS wrapper: host and join (knows nothing about the rules)
js/ui.js          all screens and click handling
js/main.js        wires UI, network and engine together
tests/            node tests for the rules engine
```

Scripts are plain `<script>` tags loaded in the order above; each file uses globals from the ones before it.

## How the multiplayer works

- The host's browser is authoritative: it fetches the questions, runs the timer and keeps the scores.
- The correct answer is **never sent** to players until the reveal, so it can't be read from network messages.
- The host decides when time is up; the countdown on players' screens is only for display. There is no speed bonus, so network lag does not cost anyone points.
- A player who disconnects is marked "(left)" and the game carries on without waiting for them.
- If the **host** leaves, the game ends for everyone.
- Joining closes once the game starts.

## Settings

Edit `js/config.js` to change the timer, reveal and round-break lengths, points per round, questions per round, or the maximum number of players.

## Tests

```
node tests/host-game.test.js
```

Covers lobby rules, scoring per round (and that a perfect game is exactly 1000), the timer, early close when everyone has answered, invalid or late answers, disconnects, ranking with ties, round breaks and play-again. No dependencies needed.

## Notes and limits

- OpenTDB allows one request per 5 seconds per IP. The host fetches all three rounds when the game starts (about 10 seconds, shown as "Get ready!") and retries automatically if rate limited.
- Some categories do not have enough questions at every difficulty. If a request comes back short, the host is returned to the lobby with a message and can pick another category or Random.
- Peer-to-peer uses WebRTC through PeerJS's free public connection broker. Some strict corporate or school networks block WebRTC; if a player cannot connect, try a different network.
