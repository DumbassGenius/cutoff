# Cutoff

A small YouTube front-end that only shows videos you can finish before your cutoff time.

- **Mood**: describe what you feel like; Claude turns it into searches and picks the best matches.
- **Subscriptions**: latest uploads from channels you follow.
- **Search**: plain search.
- Everything is filtered by time left before your cutoff (using how much of a video you've already watched). Between the cutoff and the morning reset, nothing plays.
- Thumbs up/down nudge which channels show up first.

Keys (YouTube API key, Google OAuth client ID, Anthropic API key) are entered in Settings and stored only in that browser's localStorage. They are never in this repo.

Static site: `index.html`, `app.js`, `logic.js` (pure helpers, tested with `node test/logic.test.js`).
