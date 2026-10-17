# Trivia Showdown

A multiplayer browser trivia game powered by the [Open Trivia DB](https://opentdb.com) API. One player hosts, everyone else joins with a 4-letter code. There is no game server: the host's browser runs the game and players connect to it directly (peer-to-peer, via [PeerJS](https://peerjs.com)).

## How it plays

1. **Host** creates a game, picks a category (or Random for all categories) and shares the join code.
2. **Players** open the game, enter the code and a name.
3. The host starts the game. Everyone gets the same questions: **3 rounds of 5**.

| Round | Questions | Points per correct answer | Round total |
|-------|-----------|---------------------------|-------------|
| Round 1 | Easy | 25 | 125 |
| Round 2 | Medium | 75 | 375 |
| Final Round | Hard | 100 | 500 |

A perfect game scores exactly **1000** points.

- Each question has a **20 second** timer. It ends early once everyone has answered. No answer scores 0.
- When a question ends, everyone sees the correct answer and the **updated standings**. They stay up until the **host clicks Next**, so nobody is rushed. Players see "Waiting for the host…".
- The round scoreboard works the same way: the host clicks to start the next round.
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
js/names.js       player-name filter (blocked words, disguises, links, reserved names)
js/game.js        host rules engine: players, timer, scoring, standings (no DOM, no network)
js/net.js         PeerJS wrapper: host and join (knows nothing about the rules)
js/ui.js          all screens and click handling
js/main.js        wires UI, network and engine together
tests/            node tests for the rules engine and the name filter
```

Scripts are plain `<script>` tags loaded in the order above; each file uses globals from the ones before it.

## How the multiplayer works

- The host's browser is authoritative: it fetches the questions, runs the timer and keeps the scores.
- The correct answer is **never sent** to players until the reveal, so it can't be read from network messages.
- The host decides when time is up; the countdown on players' screens is only for display. There is no speed bonus, so network lag does not cost anyone points.
- Pacing is in the host's hands: only the host's own screen can advance the game. If the host walks away on a standings screen, the game waits.
- A player who disconnects is marked "(left)" and the game carries on without waiting for them.
- If the **host** leaves, the game ends for everyone.
- Joining closes once the game starts.

## Player names

Names are checked on the host and join screens, and again by the host's game engine, so a modified client can't skip the check. Blocked: profanity, sexual terms, slurs and hate terms, threats and self-harm phrases, links / e-mail addresses / phone-number-like strings, invisible or direction-flipping characters, and names that pose as the game or its staff (such as "Host" or "Admin"). Common disguises are handled (`sh1t`, `f u c k`, `fuuuck`, look-alike letters). A rejected name just gets "Please choose a different name." and never says which word matched.

No word filter is perfect: unusual spellings and other languages can slip through, and a rare innocent name may be blocked. The lists are plain arrays at the top of `js/names.js`, so they are easy to adjust. Mild words such as "hell" and "damn" are blocked too; remove them from the list if you want a more relaxed game.

## Settings

Edit `js/config.js` to change the question timer, round names, points per round, questions per round, or the maximum number of players.

## Tests

```
node tests/host-game.test.js
node tests/names.test.js
```

The first covers lobby rules, scoring per round (and that a perfect game is exactly 1000), the timer, early close when everyone has answered, invalid or late answers, disconnects, ranking with ties, round breaks and play-again, plus the host-controlled pacing (nothing advances on its own after a question ends). The second checks that disguised bad names are blocked and that innocent ones (Scunthorpe, Dickinson, Cassie, Hancock, and so on) are not. No dependencies needed.

## Notes and limits

- OpenTDB allows one request per 5 seconds per IP. The host fetches all three rounds when the game starts (about 10 seconds, shown as "Get ready!") and retries automatically if rate limited.
- Some categories do not have enough questions at every difficulty. If a request comes back short, the host is returned to the lobby with a message and can pick another category or Random.
- Peer-to-peer uses WebRTC through PeerJS's free public connection broker. Some strict corporate or school networks block WebRTC; if a player cannot connect, try a different network.
