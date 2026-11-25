{
const L = window.Logic;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- storage ----------
function load(key, def) { try { return { ...def, ...JSON.parse(localStorage.getItem(key) || "{}") }; } catch { return { ...def }; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

const S = load("cutoff.settings", { cutoff: "23:00", morning: "06:00", noShorts: true, ytKey: "", clientId: "", anthKey: "" });
const D = load("cutoff.data", { scores: {}, names: {}, hidden: {}, liked: {}, progress: {}, subs: [] });
const saveS = () => save("cutoff.settings", S);
const saveD = () => save("cutoff.data", D);

const dl = () => L.deadline(S.cutoff, S.morning);

// ---------- ui helpers ----------
let toastT;
function toast(msg) { const t = $("toast"); t.textContent = msg; t.style.display = "block"; clearTimeout(toastT); toastT = setTimeout(() => (t.style.display = "none"), 3500); }
function status(id, msg, err) { const el = $(id); el.textContent = msg || ""; el.classList.toggle("err", !!err); }

document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.v)));
function show(v) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  document.querySelectorAll(".view").forEach((s) => s.classList.toggle("on", s.id === v));
  if (v === "subs") subsAuto();
}

function tickClock() {
  const left = dl() - Date.now();
  $("clock").innerHTML = left <= 0
    ? `Past cutoff<br>until <b>${esc(S.morning)}</b>`
    : `Cutoff <b>${esc(S.cutoff)}</b><br>${esc(L.fmtLeft(left))} left`;
}

// ---------- YouTube API ----------
async function yt(path, params, token) {
  if (!S.ytKey && !token) throw new Error("Add your YouTube API key in Settings.");
  const u = new URL("https://www.googleapis.com/youtube/v3/" + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token; else u.searchParams.set("key", S.ytKey);
  const r = await fetch(u, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || "YouTube error " + r.status);
  return j;
}

async function details(ids) {
  ids = [...new Set(ids)];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const j = await yt("videos", { part: "snippet,contentDetails,status", id: ids.slice(i, i + 50).join(","), maxResults: 50 });
    for (const it of j.items || []) {
      if (it.snippet.liveBroadcastContent !== "none") continue;
      if (it.status && it.status.embeddable === false) continue;
      const dur = L.parseISODuration(it.contentDetails.duration);
      if (!dur) continue;
      const th = it.snippet.thumbnails || {};
      out.push({
        id: it.id, title: it.snippet.title, channel: it.snippet.channelTitle, channelId: it.snippet.channelId,
        dur, publishedAt: it.snippet.publishedAt, thumb: (th.medium || th.high || th.default || {}).url || "",
      });
    }
  }
  return out;
}

async function searchIds(q, n = 25) {
  const j = await yt("search", { part: "id", q, type: "video", maxResults: n, videoEmbeddable: "true" });
  return (j.items || []).map((x) => x.id.videoId).filter(Boolean);
}

// ---------- Claude ----------
async function claude(system, user, maxTokens = 700) {
  if (!S.anthKey) throw new Error("Add your Anthropic API key in Settings.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-api-key": S.anthKey,
      "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || "Claude error " + r.status);
  return (j.content || []).map((c) => c.text || "").join("");
}

function tasteLines() {
  const ent = Object.entries(D.scores).filter(([id]) => D.names[id]);
  const liked = ent.filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id]) => D.names[id]);
  const disliked = ent.filter(([, s]) => s < 0).sort((a, b) => a[1] - b[1]).slice(0, 15).map(([id]) => D.names[id]);
  return `Channels they like: ${liked.join(", ") || "none yet"}\nChannels they dislike: ${disliked.join(", ") || "none yet"}`;
}

// ---------- rendering ----------
const lists = {}; // gridId -> videos
const ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v11H3V10h4zm0 0 4-8a3 3 0 0 1 3 3v4h5.5a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.1 21H7"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V3h4v11h-4zm0 0-4 8a3 3 0 0 1-3-3v-4H4.5a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.9 3H17"/></svg>';

function visible(v) {
  if (D.hidden[v.id]) return "skip";
  const p = D.progress[v.id] || 0;
  if (p >= v.dur * 0.95) return "skip"; // already watched
  if (S.noShorts && v.dur < 180) return "skip";
  return L.fits(v.dur, p, dl()) ? "show" : "late";
}

function render(gridId) {
  const vids = lists[gridId] || [];
  const grid = $(gridId), note = $(gridId.replace("Grid", "Hidden"));
  let late = 0;
  const shown = vids.filter((v) => { const s = visible(v); if (s === "late") late++; return s === "show"; });
  grid.innerHTML = shown.map((v) => {
    const p = D.progress[v.id] || 0;
    const left = L.remainingSec(v.dur, p);
    const pct = p ? Math.min(100, (p / v.dur) * 100) : 0;
    const thumb = /^https:\/\//.test(v.thumb) ? v.thumb : "";
    return `<div class="card" data-id="${esc(v.id)}">
      <button class="thumb" data-act="play" aria-label="Play ${esc(v.title)}">
        ${thumb ? `<img loading="lazy" src="${esc(thumb)}" alt="">` : ""}
        <span class="dur">${p ? esc(L.fmtDur(left)) + " left" : esc(L.fmtDur(v.dur))}</span>
        ${pct ? `<span class="bar" style="width:${pct.toFixed(1)}%"></span>` : ""}
      </button>
      <div class="meta">
        <div class="title" data-act="play">${esc(v.title)}</div>
        <div class="chan">${esc(v.channel)}</div>
        ${v.why ? `<div class="why">${esc(v.why)}</div>` : ""}
      </div>
      <div class="acts">
        <button data-act="up" class="${D.liked[v.id] ? "up" : ""}" aria-label="More like this">${ICON_UP}</button>
        <button data-act="down" aria-label="Not interested">${ICON_DOWN}</button>
      </div>
    </div>`;
  }).join("");
  if (!vids.length) grid.innerHTML = "";
  else if (!shown.length) grid.innerHTML = `<div class="empty">Nothing here fits before ${esc(S.cutoff)}.</div>`;
  note.textContent = late ? `${late} video${late > 1 ? "s" : ""} hidden because ${late > 1 ? "they'd" : "it'd"} run past ${S.cutoff}.` : "";
}
const renderAll = () => Object.keys(lists).forEach(render);

function findVid(id) { for (const k in lists) { const v = lists[k].find((x) => x.id === id); if (v) return v; } }

document.querySelector("main").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const card = b.closest(".card"); if (!card) return;
  const v = findVid(card.dataset.id); if (!v) return;
  D.names[v.channelId] = v.channel;
  if (b.dataset.act === "play") return play(v);
  if (b.dataset.act === "up") {
    if (D.liked[v.id]) { delete D.liked[v.id]; D.scores[v.channelId] = (D.scores[v.channelId] || 0) - 2; }
    else { D.liked[v.id] = 1; D.scores[v.channelId] = (D.scores[v.channelId] || 0) + 2; toast("Got it, more like this."); }
  }
  if (b.dataset.act === "down") {
    D.hidden[v.id] = 1; D.scores[v.channelId] = (D.scores[v.channelId] || 0) - 1;
    toast("Hidden. You'll see less from " + v.channel + ".");
  }
  saveD(); renderAll();
});

// ---------- player ----------
let ytReady, player, current, watchT;
function loadYTApi() {
  if (!ytReady) ytReady = new Promise((res) => {
    window.onYouTubeIframeAPIReady = res;
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
  });
  return ytReady;
}

async function play(v) {
  const p = D.progress[v.id] || 0;
  if (!L.fits(v.dur, p, dl())) { timesUp(); return; }
  current = v;
  $("playerTitle").textContent = v.title;
  $("playerView").classList.add("on");
  await loadYTApi();
  const start = Math.floor(p);
  if (!player) {
    player = new YT.Player("player", {
      videoId: v.id,
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, start },
      events: { onStateChange: onState },
    });
  } else {
    player.loadVideoById({ videoId: v.id, startSeconds: start });
  }
  clearInterval(watchT);
  watchT = setInterval(watch, 1000);
}

function onState(e) {
  if (e.data === YT.PlayerState.ENDED && current) {
    D.progress[current.id] = current.dur;
    D.scores[current.channelId] = (D.scores[current.channelId] || 0) + 1; // finished it: small boost
    D.names[current.channelId] = current.channel;
    saveD(); closePlayer();
  }
}

function watch() {
  if (!player || !current || !player.getCurrentTime) return;
  const t = player.getCurrentTime() || 0;
  const d = player.getDuration() || current.dur;
  const rate = player.getPlaybackRate ? player.getPlaybackRate() || 1 : 1;
  if (t > 0) D.progress[current.id] = t;
  const left = Math.max(0, d - t) / rate;
  $("playerLeft").textContent = L.fmtDur(left) + " left";
  if (Date.now() + left * 1000 > dl()) { saveD(); closePlayer(); timesUp(); return; }
  if (Math.round(t) % 5 === 0) saveD();
}

function closePlayer() {
  clearInterval(watchT);
  try { player && player.pauseVideo(); } catch {}
  $("playerView").classList.remove("on");
  current = null; saveD(); renderAll();
}
$("playerBack").addEventListener("click", closePlayer);

function timesUp() {
  const past = dl() <= Date.now();
  $("timesupMsg").textContent = past
    ? `It's past ${S.cutoff}. Videos are back at ${S.morning}.`
    : `That one would run past ${S.cutoff}.`;
  $("timesup").classList.add("on");
}
$("timesupOk").addEventListener("click", () => $("timesup").classList.remove("on"));

// ---------- Mood ----------
$("moodGo").addEventListener("click", async () => {
  const text = $("moodText").value.trim();
  if (!text) { status("moodStatus", "Type what you feel like first."); return; }
  const mins = Math.floor((dl() - Date.now()) / 60000);
  if (mins < 1) { timesUp(); return; }
  const btn = $("moodGo"); btn.disabled = true;
  try {
    status("moodStatus", "Asking Claude what to look for…");
    const q = L.extractJSON(await claude(
      "You turn a person's mood into YouTube searches. Reply with JSON only, no prose.",
      `Mood: ${text}\nTime available: about ${mins} minutes.\n${tasteLines()}\n\nGive 3 varied, specific YouTube search queries likely to find videos they'd enjoy that fit in the time. JSON: {"queries":["...","...","..."]}`,
      300));
    const queries = (q.queries || []).slice(0, 3).map(String);
    status("moodStatus", "Searching: " + queries.join(" · "));
    const ids = (await Promise.all(queries.map((x) => searchIds(x)))).flat();
    let vids = await details(ids);
    const cands = vids.filter((v) => visible(v) === "show");
    if (cands.length > 12) {
      status("moodStatus", "Picking the best ones…");
      const lines = cands.slice(0, 60).map((v, i) => `${i}. ${v.title} — ${v.channel} — ${Math.round(L.remainingSec(v.dur, D.progress[v.id]) / 60)} min`).join("\n");
      const r = L.extractJSON(await claude(
        "You pick YouTube videos for a person. Reply with JSON only, no prose.",
        `Mood: ${text}\n${tasteLines()}\n\nCandidates:\n${lines}\n\nPick up to 12 that best match the mood, varied, avoiding clickbait and near-duplicates. For each give a reason of at most 8 words. JSON: {"picks":[{"n":0,"why":"..."}]}`));
      const picked = (r.picks || []).map((p) => cands[p.n] && { ...cands[p.n], why: String(p.why || "") }).filter(Boolean);
      vids = [...new Map(picked.map((v) => [v.id, v])).values()].concat(vids.filter((v) => visible(v) === "late"));
    }
    lists.moodGrid = vids;
    render("moodGrid");
    status("moodStatus", "");
  } catch (e) { status("moodStatus", e.message, true); }
  btn.disabled = false;
});

// ---------- Search ----------
$("searchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("searchText").value.trim(); if (!q) return;
  try {
    status("searchStatus", "Searching…");
    const vids = await details(await searchIds(q, 40));
    const scoreOf = (v) => D.scores[v.channelId] || 0;
    lists.searchGrid = vids.map((v, i) => ({ v, k: i - scoreOf(v) * 3 })).sort((a, b) => a.k - b.k).map((x) => x.v);
    render("searchGrid");
    status("searchStatus", "");
  } catch (err) { status("searchStatus", err.message, true); }
});

// ---------- Subscriptions ----------
let gisReady;
function loadGIS() {
  if (!gisReady) gisReady = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client";
    s.onload = res; s.onerror = () => rej(new Error("Couldn't load Google sign-in.")); document.head.appendChild(s);
  });
  return gisReady;
}

$("subsConnect").addEventListener("click", async () => {
  if (!S.clientId) { status("subsStatus", "Add your Google OAuth client ID in Settings first.", true); return; }
  try {
    await loadGIS();
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: S.clientId, scope: "https://www.googleapis.com/auth/youtube.readonly",
      callback: async (resp) => {
        if (resp.error) { status("subsStatus", "Sign-in failed: " + resp.error, true); return; }
        try {
          status("subsStatus", "Reading your subscriptions…");
          const subs = []; let page = "";
          do {
            const j = await yt("subscriptions", { part: "snippet", mine: "true", maxResults: 50, ...(page ? { pageToken: page } : {}) }, resp.access_token);
            for (const it of j.items || []) subs.push({ id: it.snippet.resourceId.channelId, title: it.snippet.title });
            page = j.nextPageToken || "";
          } while (page);
          D.subs = subs; subs.forEach((s) => (D.names[s.id] = s.title)); saveD();
          await subsRefresh();
        } catch (e) { status("subsStatus", e.message, true); }
      },
    });
    tc.requestAccessToken();
  } catch (e) { status("subsStatus", e.message, true); }
});

async function subsRefresh() {
  if (!D.subs.length) { status("subsStatus", "Connect your Google account to load your subscriptions."); return; }
  status("subsStatus", `Checking ${D.subs.length} channels…`);
  const found = [];
  const queue = [...D.subs];
  async function worker() {
    while (queue.length) {
      const s = queue.shift();
      if (!/^UC/.test(s.id)) continue;
      try {
        const j = await yt("playlistItems", { part: "contentDetails", playlistId: "UU" + s.id.slice(2), maxResults: 5 });
        for (const it of j.items || []) found.push(it.contentDetails.videoId);
      } catch {}
    }
  }
  try {
    await Promise.all(Array.from({ length: 8 }, worker));
    const vids = L.rankFeed(await details(found), D.scores);
    lists.subsGrid = vids;
    try { localStorage.setItem("cutoff.feed", JSON.stringify({ t: Date.now(), vids })); } catch {}
    render("subsGrid");
    status("subsStatus", "");
  } catch (e) { status("subsStatus", e.message, true); }
}
$("subsRefresh").addEventListener("click", subsRefresh);

function subsAuto() {
  if (lists.subsGrid) return;
  let cache = null;
  try { cache = JSON.parse(localStorage.getItem("cutoff.feed") || "null"); } catch {}
  if (cache && Date.now() - cache.t < 30 * 60e3) { lists.subsGrid = L.rankFeed(cache.vids, D.scores); render("subsGrid"); }
  else if (D.subs.length) subsRefresh();
  else status("subsStatus", "Connect your Google account to load your subscriptions.");
}

// ---------- Settings ----------
function fillSettings() {
  $("sCutoff").value = S.cutoff; $("sMorning").value = S.morning; $("sNoShorts").checked = S.noShorts;
  $("sYtKey").value = S.ytKey; $("sClientId").value = S.clientId; $("sAnthKey").value = S.anthKey;
}
$("setForm").addEventListener("submit", (e) => {
  e.preventDefault();
  S.cutoff = $("sCutoff").value || "23:00"; S.morning = $("sMorning").value || "06:00";
  S.noShorts = $("sNoShorts").checked;
  S.ytKey = $("sYtKey").value.trim(); S.clientId = $("sClientId").value.trim(); S.anthKey = $("sAnthKey").value.trim();
  saveS(); tickClock(); renderAll(); status("setStatus", "Saved.");
});
$("sTest").addEventListener("click", async () => {
  const res = [];
  try { await yt("videos", { part: "id", id: "jNQXAC9IVRw" }); res.push("YouTube key works"); } catch (e) { res.push("YouTube: " + e.message); }
  try { await claude("Reply with OK.", "ping", 5); res.push("Anthropic key works"); } catch (e) { res.push("Anthropic: " + e.message); }
  status("setStatus", res.join(" · "), res.some((r) => r.includes(":")));
});
$("sReset").addEventListener("click", () => {
  D.scores = {}; D.hidden = {}; D.liked = {}; D.progress = {}; saveD(); renderAll(); status("setStatus", "Likes and history cleared.");
});

// ---------- start ----------
fillSettings();
tickClock();
setInterval(tickClock, 1000);
setInterval(renderAll, 30000);
if (!S.ytKey) { show("settings"); status("setStatus", "Add your keys to get started."); }
}
