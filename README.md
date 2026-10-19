# Cranial Combat: Trivia Showdown

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

- Each question has a **20 second** timer. Tap an answer to pick it, and **tap another to change it**. The question locks when every player has picked, or when the timer runs out, and your last pick counts. No answer scores 0.
- When a question ends, everyone sees whether they were right, the correct answer and their own score. There are no standings after a question.
- Everyone then presses **Ready**. The next question starts as soon as every player has. The host also has **Continue anyway** if someone has wandered off. A player who leaves does not hold the game up.
- After each round there is a **round scoreboard**. Rows are revealed one at a time, from last place up to first (tap the board to show it all at once). Everyone presses Ready to start the next round.
- **Final Standings** reveals the winner with confetti, fireworks and sound effects (ties share the banner). Then choose **Return to Lobby** or **Exit Game**. The host returning to the lobby brings everyone back; players wait for the host.
- Up to 8 players.

### Solo

Press **Solo** on the main screen to play a full game on your own: pick a name and a category and go, with no lobby and no code. The game runs entirely on your device (questions are still fetched from the internet). Pick an answer, change it if you like, then press **Lock in** (or let the timer end). At the end the buttons are **Play Again** and **Exit Game**.

### Personal Top 10

Every game, solo or multiplayer, adds the player's score to **their own Top 10** on the device they played on. After the final standings you see "You placed #N in your Top 10!" with your list, or how far you were from getting in. Press **My Top 10** on the main screen to see the list any time; people who share a device each have their own list (it is matched by name, ignoring capitals). Each row shows the score, category, whether it was Solo or Multiplayer, and the date. A score of 0 is not saved, and ties keep the earlier score ahead. The lists are kept in the browser's local storage, so clearing site data or using another device starts fresh.

## Running it

Players on different devices need a web address, so host the folder as a static site, for example with **GitHub Pages** (repo Settings, Pages, deploy from the `main` branch). Then share the address. A link like `https://<you>.github.io/CranialCombat/#K7QX` opens the join screen with the code filled in.

For a quick solo test you can double-click `index.html`. An internet connection is required (for PeerJS and the question API).

## Project layout

```
index.html        page shell, startup check (loads PeerJS from a CDN, version pinned)
css/styles.css    the neon cyan-vs-orange look
assets/splash.jpg splash artwork (also the blurred backdrop on every screen)
tools/stamp.js    stamps a build id onto the file links (see "Updating the site")
js/build.js       the build id, written by stamp.js
js/config.js      rounds, points, timers, player limit, join-code settings
js/api.js         question sources (Open Trivia DB and The Trivia API), session token, repeat tracking (host only)
js/filter.js      name and chat filter (blocked words, disguises, links, reserved names)
js/invite.js      "Challenge a friend": text-message invitation (number check, message, sms link)
js/scores.js      personal Top 10, saved per player name in the browser
js/game.js        host rules engine: players, timer, scoring, standings (no DOM, no network)
js/net.js         PeerJS wrapper: host and join (knows nothing about the rules)
js/audio.js       music (recordings, with built-in fallback) and synthesized sound effects (Web Audio)
assets/audio/     splash.mp3 and lobby.mp3
assets/icons/     home-screen and tab icons made from assets/AppLogo.png
manifest.webmanifest  the name, colors and icons Android uses when the game is added to the home screen
js/fx.js          confetti and fireworks canvas
js/ui.js          all screens and click handling
js/main.js        wires UI, network and engine together
tests/            node tests for the rules engine and the filter
```

Scripts are plain `<script>` tags loaded in the order above; each file uses globals from the ones before it.

## Updating the site

GitHub Pages and browsers cache files for about 10 minutes, so a visitor can briefly get a new page with old scripts. To prevent that, run this before each commit that changes `css/`, `js/` or `assets/`:

```
node tools/stamp.js
```

It adds a build id to every file link in `index.html` and writes `js/build.js`. The page checks at startup that every script loaded and matches; if not, it says so and offers a Reload button instead of showing buttons that do nothing. The Host / Join screen shows the build id, so you can confirm which version you are looking at. After a push, wait a minute or two for Pages to deploy, then hard refresh (Ctrl+F5).

Screens open on a splash with a START GAME button; a link like `.../#K7QX` skips it. Fonts (Russo One, Rajdhani) come from Google Fonts and fall back to system fonts when offline. The splash art is 1024 px wide, so it looks soft on very large screens; swap in a larger `assets/splash.jpg` (same crop, no buttons) and run the stamp step.

## How the multiplayer works

- The host's browser is authoritative: it fetches the questions, runs the timer and keeps the scores.
- The correct answer is **never sent** to players until the reveal, so it can't be read from network messages.
- The host decides when time is up; the countdown on players' screens is only for display. There is no speed bonus, so network lag does not cost anyone points.
- Pacing is in the host's hands: only the host's own screen can advance the game. If the host walks away on a standings screen, the game waits.
- A player who disconnects is marked "(left)" and the game carries on without waiting for them.
- **Phones that sleep or switch apps:** players send a "still here" message every 5 seconds. The host drops anyone silent for 15 seconds (so there are no ghost entries). When the player comes back to the page, it checks the link and, if it's dead, quietly reconnects under the same name and a private token. In the lobby they take their old spot; mid-game they get their score back, see the current question (with any answer they already gave and the time left) or the current standings. If the host's own page was asleep, nobody is dropped for the silence. The game also asks the browser to keep the screen awake while playing (where supported).
- If the **host** leaves, the game ends for everyone.
- Joining closes once the game starts.
- Direct phone-to-phone links are blocked on some home Wi-Fi networks. The game lists STUN and relay (TURN) servers in `js/config.js` (`iceServers`) so it can fall back to a relay. The Open Relay entries are a free shared service with public credentials; if it proves unreliable, swap in a hosted TURN account. If a player still can't connect, turning Wi-Fi off and joining over cellular works.

## Challenge a friend
In the lobby, anyone (host or player) can open **Challenge a friend** under the player list and text someone the join code, until the lobby is full. A web page can't send a text by itself, so the button opens your phone's messaging app with the number and a message already filled in ("Jason challenges you to Cranial Combat trivia! Tap to join: <link> (code ABCD)"); you tap Send there. The link opens the game with the code already entered. The game never stores or transmits phone numbers.

- **Type a number**: works everywhere that can open a text message.
- **Pick from contacts**: only shown where the browser has a contact picker (Chrome on Android, over https).
- **Share…**: shown where the browser has a share sheet (mainly iPhone); choose Messages and a contact there.

## Lobby chat

Everyone in the lobby (including after "Play Again") can chat. It closes when the game starts and starts empty in the next lobby.

- The host checks every message before sharing it, with the same word lists and disguise handling as names. A message that fails is not sent; the sender sees "That message wasn't sent. Please keep chat friendly." and nobody else sees anything. Links, e-mail addresses and phone numbers are blocked too.
- Chat is read word by word, so sentences like "this hit me" are fine. The trade-off: a word split with spaces inside a word (`fu ck`) can slip through, while single-letter spacing (`f u c k`) is caught.
- The sender's name comes from their connection, so nobody can post as someone else. Messages are limited to 200 characters and 5 per 10 seconds per player ("Slow down a little."). Blocked attempts count toward that limit.
- "Bob joined" / "Bob left" lines appear, and people who join late see the last 50 messages.
- Messages are shown as plain text, never as HTML.

## Player names

Names are checked on the host and join screens, and again by the host's game engine, so a modified client can't skip the check. Blocked: profanity, sexual terms, slurs and hate terms, threats and self-harm phrases, links / e-mail addresses / phone-number-like strings, invisible or direction-flipping characters, and names that pose as the game or its staff (such as "Host" or "Admin"). Common disguises are handled (`sh1t`, `f u c k`, `fuuuck`, look-alike letters). A rejected name just gets "Please choose a different name." and never says which word matched.

No word filter is perfect: unusual spellings and other languages can slip through, and a rare innocent name may be blocked. The lists are plain arrays at the top of `js/filter.js`, so they are easy to adjust. Mild words such as "hell" and "damn" are blocked too; remove them from the list if you want a more relaxed game.

## Settings

Edit `js/config.js` to change the question timer, round names, points per round, questions per round, or the maximum number of players.

## Question sources

Questions come from two free services, and only the host's browser talks to them:

- **[Open Trivia DB](https://opentdb.com)** (CC BY-SA 4.0): used for every category. The host's browser asks for a **session token** and keeps it on the device (about 5 hours), so the service does not repeat a question. If a category's questions run out, the list is reset and the game carries on.
- **[The Trivia API](https://the-trivia-api.com)** (CC BY-NC 4.0, free for non-commercial use): used for Random games and for the categories that match one of its ten (General Knowledge, Film & TV, Music, Science, Sports, Geography, History, Arts & Literature). It has no token, so the host's browser remembers the last 600 question ids it used and skips them.

In Random mode the two sources alternate from round to round. If one is down or comes up short, the other fills in, and a question that already appeared in the same game is skipped. Categories with no match (Musicals, Gadgets and so on) use Open Trivia DB only. Edit `CONFIG.triviaApiUrl` or `T_SLUG` in `js/api.js` to change the mapping.

This is a personal, non-commercial game. Thanks to both services for their free questions: please keep these credits if you share it, and check The Trivia API's terms before using the game commercially.

## Home-screen icon

The page has a web app manifest (`manifest.webmanifest`), so adding the game to an Android home screen (Chrome menu, **Install app** or **Add to Home screen**) uses the Cranial Combat logo and the name "Cranial Combat", and opens full screen like an app. The icons in `assets/icons/` are cut from `assets/AppLogo.png`: 192 and 512 px with rounded transparent corners, a 512 px "maskable" version with extra margin so Android's circle or rounded-square crop never clips the lettering, an Apple touch icon (180 px) and the browser-tab icon (48 px). To change the icon, replace the images (keep the names), run `node tools/stamp.js` and push. Android keeps the old icon on a shortcut that already exists, so remove it and add the game again to see a new one.

## Sound

The **splash and lobby music are recordings** in `assets/audio/` (`splash.mp3` plays on the splash, join and connecting screens, `lobby.mp3` in the lobby). They are 128 kbps MP3s, about 1.9 MB and 1.6 MB, and fade out and in at their ends so they loop smoothly. The page downloads them in the background when it opens. Music starts on the first tap and waits up to about 2.5 seconds for the recording; if it can't be loaded, the built-in synthesized tune plays instead. There is no music during questions.

The sound effects (button taps, correct/wrong, scoreboard ticks, winner fanfare) are generated in the browser, so there are no files for them. The speaker button in the corner opens a **volume panel**: a 0–100 slider for music and effects together (sliding to 0 mutes; sliding up unmutes) and a Mute/Unmute button that returns to the previous level. The level is remembered per device. Tap outside the panel or press Escape to close it. Browsers only allow sound after a tap, and on iPhones the ring/silent switch can silence web audio. Music pauses when the page is in the background.

To change the music, replace the MP3 files (keeping the names, or updating them in `CONFIG.audioFiles` in `js/config.js`) and run `node tools/stamp.js`. The build id is added to the music addresses, so browsers fetch the new files. The same setting can swap in a recording for any sound effect (names: click, select, ready, correct, wrong, tick, drumroll, crash, fanfare, launch, burst, crackle, applause). `CONFIG.musicFileGain` sets how loud the recordings are. Reveal and celebration timing (`revealRowMs`, `revealWinnerPauseMs`, `celebrationMs`) is in the same file, and reduced-motion settings skip the animations.

## Tests

```
node tests/host-game.test.js
node tests/filter.test.js
node tests/api.test.js
node tests/scores.test.js
node tests/invite.test.js
```

The first covers lobby rules, scoring per round (and that a perfect game is exactly 1000), the timer, early close when everyone has answered, changing an answer until the question locks, solo mode locking, invalid or late answers, disconnects, ranking with ties, round breaks and play-again, plus the host-controlled pacing (nothing advances on its own after a question ends). The second checks that disguised bad names and chat messages are blocked and that innocent ones (Scunthorpe, Dickinson, "this hit me", "1000000 points", and so on) are not. The engine tests also cover chat: filtering, the rate limit, history, and lobby-only. The third covers the question sources with fake network answers: session token reuse, expiry and reset, repeat tracking, category mapping and fallback both ways. The fourth covers the personal Top 10: ranking, ties, the ten-score limit, separate lists per name and damaged storage. The fifth covers the invitation: phone-number checks, the message, and the Android and iPhone text-message links. No dependencies needed.

## Notes and limits

- OpenTDB allows one request per 5 seconds per IP. The host fetches all three rounds when the game starts (about 10 seconds, shown as "Get ready!") and retries automatically if rate limited.
- Some categories do not have enough questions at every difficulty. If a request comes back short, the host is returned to the lobby with a message and can pick another category or Random.
- Peer-to-peer uses WebRTC through PeerJS's free public connection broker. Some strict corporate or school networks block WebRTC; if a player cannot connect, try a different network.
