# Trivia Showdown

A browser-based trivia game powered by the [Open Trivia DB](https://opentdb.com) API (currently the Sports category).

## How it plays

- 3 rounds of 5 multiple-choice questions
- Round 1 is easy (5 pts each), round 2 is medium (10 pts each), round 3 is hard (20 pts each)
- Max score: 175

## Running it

No build step or server needed. Double-click `index.html` to open it in a browser. An internet connection is required to fetch questions.

## Project layout

```
index.html        page shell
css/styles.css    styling
js/config.js      rounds, points, category, questions per round
js/api.js         OpenTDB fetching, rate-limit retry, HTML entity decoding
js/game.js        game state, scoring, round progression (no DOM code)
js/ui.js          rendering and click handling
js/main.js        entry point wiring UI to game flow
```

Scripts are loaded as plain `<script>` tags in the order above (each file uses globals from the ones before it).

## Changing settings

Edit `js/config.js` to change points per round, questions per round, the trivia category, or the number and order of rounds.

## Notes

OpenTDB allows one request per 5 seconds per IP. The game fetches a whole round in one request and retries automatically if rate limited.
