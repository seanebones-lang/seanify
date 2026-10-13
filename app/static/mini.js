const audio = document.querySelector("#audio");
const cover = document.querySelector("#cover");
const title = document.querySelector("#title");
const artist = document.querySelector("#artist");
const edge = document.querySelector("#edge");
const playBtn = document.querySelector("#play");
const playIcon = document.querySelector("#play-icon");
const likeBtn = document.querySelector("#like");
const PLAY = '<path d="M4.2 2.4v11.2L13.6 8 4.2 2.4z"/>';
const PAUSE = '<path d="M3.2 2.2h3.2v11.6H3.2zm6.4 0h3.2v11.6H9.6z"/>';

let tracks = [];
let index = 0;
const liked = new Set(JSON.parse(localStorage.getItem("sean-sporify-liked") || "[]"));
const channel = "BroadcastChannel" in window ? new BroadcastChannel("seanify") : null;

function setArt(el, item) {
  if (!el) return;
  let img = el.querySelector(":scope > .art-img");
  if (!img) {
    img = document.createElement("img");
    img.className = "art-img";
    img.alt = "";
    el.prepend(img);
  }
  if (item && item.image) {
    img.src = item.image;
    img.hidden = false;
    el.style.backgroundImage = "none";
    return;
  }
  img.hidden = true;
  const hue = item && item.hue != null ? item.hue : 280;
  el.style.background = `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 36) % 360} 42% 16%))`;
}

function paint() {
  const item = tracks[index];
  if (!item) {
    title.textContent = "Seanify";
    artist.textContent = "Nothing playing";
    cover.style.cssText = "";
    likeBtn.classList.remove("on");
    return;
  }
  title.textContent = item.name || "Untitled";
  artist.textContent = item.artists || "";
  setArt(cover, item);
  likeBtn.classList.toggle("on", liked.has(item.id));
}

function setIcon() {
  playIcon.innerHTML = audio.paused || audio.ended ? PLAY : PAUSE;
  playBtn.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
}

function publish(type) {
  const item = tracks[index];
  if (!channel || !item) return;
  channel.postMessage({
    type,
    id: item.id,
    time: audio.currentTime || 0,
    playing: !audio.paused && !audio.ended,
  });
}

async function playAt(next, time) {
  if (!tracks.length) return;
  index = (next + tracks.length) % tracks.length;
  const item = tracks[index];
  paint();
  localStorage.setItem("seanify-now", item.id);
  if (!item.preview_url) return;
  if (!audio.src.endsWith(item.preview_url)) audio.src = item.preview_url;
  if (time) audio.currentTime = time;
  try { await audio.play(); } catch (err) { /* user gesture may be required */ }
  setIcon();
  publish("state");
}

function step(dir) {
  playAt(index + dir);
}

playBtn.addEventListener("click", () => {
  if (remote) return;
  if (!audio.src) playAt(index);
  else if (audio.paused) audio.play();
  else audio.pause();
});
document.querySelector("#prev").addEventListener("click", () => { if (!remote) step(-1); });
document.querySelector("#next").addEventListener("click", () => { if (!remote) step(1); });
likeBtn.addEventListener("click", () => {
  if (remote) return;
  const item = tracks[index];
  if (!item) return;
  if (liked.has(item.id)) liked.delete(item.id);
  else liked.add(item.id);
  localStorage.setItem("sean-sporify-liked", JSON.stringify([...liked]));
  paint();
});
audio.addEventListener("play", () => { setIcon(); publish("state"); });
audio.addEventListener("pause", () => { setIcon(); publish("state"); });
audio.addEventListener("timeupdate", () => {
  if (!audio.duration || remote) return;
  scrub.value = String(Math.round((audio.currentTime / audio.duration) * 1000));
});
audio.addEventListener("ended", () => step(1));
document.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    playBtn.click();
  }
});

const scrub = document.querySelector("#scrub");
let remote = false;
let remoteDuration = 0;
function send(action, extra) {
  if (!channel) return;
  channel.postMessage({ type: "cmd", action, ...extra });
}
function showRemote(data) {
  remote = true;
  remoteDuration = data.duration || 0;
  title.textContent = data.name || "Seanify";
  artist.textContent = data.artists || "";
  setArt(cover, data);
  playIcon.innerHTML = data.playing ? PAUSE : PLAY;
  likeBtn.classList.toggle("on", Boolean(data.liked));
  document.querySelector("#mini-shuffle").classList.toggle("on", Boolean(data.shuffle));
  if (remoteDuration) scrub.value = String(Math.round((data.time / remoteDuration) * 1000));
  if (!audio.paused) audio.pause();
}
if (channel) {
  channel.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "state") showRemote(data);
  };
  channel.postMessage({ type: "hello" });
}
playBtn.addEventListener("click", () => {
  if (remote) send(playIcon.innerHTML === PLAY ? "play" : "pause");
});
document.querySelector("#prev").addEventListener("click", () => { if (remote) send("prev"); });
document.querySelector("#next").addEventListener("click", () => { if (remote) send("next"); });
document.querySelector("#mini-shuffle").addEventListener("click", () => {
  if (remote) {
    send("shuffle");
    return;
  }
  const current = tracks[index];
  const rest = tracks.filter((item) => item !== current);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  tracks = current ? [current, ...rest] : rest;
  index = 0;
  document.querySelector("#mini-shuffle").classList.add("on");
});
likeBtn.addEventListener("click", () => { if (remote) send("like"); });
scrub.addEventListener("input", () => {
  const time = (Number(scrub.value) / 1000) * (remote ? remoteDuration : audio.duration || 0);
  if (remote) send("seek", { time });
  else if (audio.duration) audio.currentTime = time;
});

fetch("/api/library").then((res) => res.json()).then((data) => {
  tracks = data.tracks || [];
  const saved = localStorage.getItem("seanify-now");
  const at = tracks.findIndex((item) => item.id === saved);
  index = at >= 0 ? at : 0;
  paint();
  const params = new URLSearchParams(location.search);
  const start = params.get("track");
  if (start) {
    const hit = tracks.findIndex((item) => item.id === start);
    if (hit >= 0) playAt(hit, Number(params.get("t") || 0));
  }
});
