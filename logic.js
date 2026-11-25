// Pure helpers (no DOM) so they can be tested in Node.
(function (root) {
  function parseHM(s) { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; }

  // Timestamp (ms) everything must finish by. Between cutoff and morning
  // reset it returns `now`, so nothing fits.
  function deadline(cutoff, morning, now = new Date()) {
    const mins = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const c = parseHM(cutoff), m = parseHM(morning);
    const inLock = c <= m ? (mins >= c && mins < m) : (mins >= c || mins < m);
    if (inLock) return now.getTime();
    const d = new Date(now);
    d.setHours(Math.floor(c / 60), c % 60, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  // "PT1H2M3S" -> 3723 ; "P1DT2H" -> 93600 ; "P0D" -> 0
  function parseISODuration(s) {
    const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s || "");
    if (!m) return null;
    const [, d, h, mi, se] = m.map((x) => Number(x || 0));
    return d * 86400 + h * 3600 + mi * 60 + se;
  }

  function remainingSec(durSec, progressSec) {
    return Math.max(0, durSec - Math.min(progressSec || 0, durSec));
  }

  function fits(durSec, progressSec, dl, nowMs = Date.now()) {
    return nowMs + remainingSec(durSec, progressSec) * 1000 <= dl;
  }

  function fmtDur(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function fmtLeft(ms) {
    const min = Math.max(0, Math.floor(ms / 60000));
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  // Tiny ranking: newer first, nudged by how much you like the channel.
  // Each point of channel score is worth 12 hours of recency.
  function rankFeed(videos, scores) {
    const key = (v) => Date.parse(v.publishedAt || 0) + (scores[v.channelId] || 0) * 12 * 3600e3;
    return [...videos].sort((a, b) => key(b) - key(a));
  }

  // Pull the first JSON object/array out of a model reply.
  function extractJSON(text) {
    const m = /[\[{][\s\S]*[\]}]/.exec(text || "");
    if (!m) throw new Error("No JSON in reply");
    return JSON.parse(m[0]);
  }

  const api = { parseHM, deadline, parseISODuration, remainingSec, fits, fmtDur, fmtLeft, rankFeed, extractJSON };
  if (typeof module !== "undefined") module.exports = api; else root.Logic = api;
})(this);
