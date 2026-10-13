const view = document.querySelector("#view");
const form = document.querySelector("#search-form");
const input = document.querySelector("#q");
const audio = document.querySelector("#audio");
const nowTitle = document.querySelector("#now-title");
const nowArtist = document.querySelector("#now-artist");
const nowArt = document.querySelector("#now-art");
const playBtn = document.querySelector("#play");
const playIcon = document.querySelector("#play-icon");
const seek = document.querySelector("#seek");
const timeNow = document.querySelector("#time-now");
const timeEnd = document.querySelector("#time-end");
const volume = document.querySelector("#volume");
const fileInput = document.querySelector("#file-input");

const PLAY = '<path d="M4.2 2.4v11.2L13.6 8 4.2 2.4z"/>';
const PAUSE = '<path d="M3.2 2.2h3.2v11.6H3.2zm6.4 0h3.2v11.6H9.6z"/>';

const GENRES = [
  ["Pop", "#8d67ab"],
  ["Hip-Hop", "#ba5d07"],
  ["Rock", "#e61e32"],
  ["Jazz", "#1e3264"],
  ["R&B", "#dc148c"],
  ["Country", "#e13300"],
  ["Electronic", "#503750"],
  ["Latin", "#e1118b"],
  ["Indie", "#608108"],
  ["Metal", "#777777"],
  ["Classical", "#7d4b32"],
  ["Blues", "#1e3264"],
];

let library = [];
let albums = [];
let queue = [];
let queueIndex = -1;
let selectedId = null;
let shuffleOn = localStorage.getItem("seanify-shuffle") === "1";
let repeatMode = Number(localStorage.getItem("seanify-repeat") || 0);
let order = [];
let orderAt = 0;
const pinned = new Set();
let sortKey = "title";
let sortDir = 1;
let viewName = "";
let viewTracks = [];
let showRemain = false;
let muted = false;
let seeking = false;
let current = null;
let chip = "playlists";
const liked = new Set(JSON.parse(localStorage.getItem("sean-sporify-liked") || "[]"));
let recentIds = JSON.parse(localStorage.getItem("sean-sporify-recent") || "[]");
const history = [{ view: "search", playlist: "" }];
let restoring = false;
let historyAt = 0;

audio.volume = 0.8;

function fmt(ms) {
  const total = Math.max(0, Math.floor((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function setArt(el, item) {
  if (!el) return;
  let img = el.querySelector(":scope > .art-img");
  if (!img) {
    img = document.createElement("img");
    img.className = "art-img";
    img.alt = "";
    el.prepend(img);
  }
  const url = item && item.image;
  if (url) {
    img.src = url;
    img.hidden = false;
    el.style.backgroundImage = "none";
    return;
  }
  img.removeAttribute("src");
  img.hidden = true;
  const hue = item && item.hue != null ? item.hue : 280;
  el.style.background = `linear-gradient(135deg, hsl(${hue} 62% 46%), hsl(${(hue + 36) % 360} 42% 16%))`;
}

function setNav(name) {
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.classList.toggle("on", el.dataset.view === name);
  });
}

function pushHistory(entry) {
  if (restoring) return;
  const cur = history[historyAt];
  if (cur && cur.view === entry.view && cur.playlist === (entry.playlist || "")) return;
  history.splice(historyAt + 1);
  history.push({ view: entry.view, playlist: entry.playlist || "" });
  historyAt = history.length - 1;
  document.querySelector("#back").disabled = historyAt <= 0;
  document.querySelector("#forward").disabled = historyAt >= history.length - 1;
}

function restore(entry) {
  restoring = true;
  if (entry.view === "playlist") openAlbum(entry.playlist);
  else if (entry.view === "artist") openArtist(entry.playlist);
  else go(entry.view, false);
  restoring = false;
  document.querySelector("#back").disabled = historyAt <= 0;
  document.querySelector("#forward").disabled = historyAt >= history.length - 1;
}

function go(name, push = true) {
  if (push) pushHistory({ view: name });
  document.querySelector("#back").disabled = historyAt <= 0;
  document.querySelector("#forward").disabled = historyAt >= history.length - 1;
  setNav(name);
  if (name === "home") renderHome();
  else if (name === "library") renderLibrary();
  else if (name === "upload") renderUpload();
  else renderSearchEmpty();
}

function playable(item) {
  return Boolean(item && (item.playable || item.preview_url || item.source === "local"));
}

function setNpvOpen(open) {
  document.querySelector("#app").dataset.transition = open ? "right-sidebar-open" : "idle";
  document.querySelector("#npv-toggle").classList.toggle("on", open);
}

function paintPlayer() {
  const npvTitle = document.querySelector("#npv-title");
  const npvArtist = document.querySelector("#npv-artist");
  const npvArt = document.querySelector("#npv-art");
  if (!current) {
    nowTitle.textContent = "Choose a song";
    nowArtist.textContent = "Click a row. The now playing panel slides open.";
    nowArt.style.cssText = "";
    npvTitle.textContent = "Nothing playing";
    npvArtist.textContent = "Pick a row. This panel slides open.";
    npvArt.style.cssText = "";
    setArt(nowArt, null);
    setArt(npvArt, null);
    paintLike();
    return;
  }
  nowTitle.textContent = current.name || "Untitled";
  nowArtist.textContent = current.artists || "";
  nowArt.style.cssText = "";
  setArt(nowArt, current);
  npvTitle.textContent = current.name || "Untitled";
  npvArtist.textContent = current.artists || "";
  setArt(npvArt, current);
  paintLike();
}

function markRows() {
  const playingId = current && current.id;
  document.querySelectorAll(".row, .card").forEach((el) => {
    const on = el.dataset.id === playingId;
    el.classList.toggle("selected", el.dataset.id === selectedId || on);
    el.classList.toggle("playing", on && !audio.paused && !audio.ended);
  });
}

function paintQueue() {
  const box = document.querySelector("#npv-queue");
  if (!box) return;
  box.replaceChildren();
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "qhead";
  clear.textContent = "Clear queue";
  clear.addEventListener("click", () => clearQueue());
  box.append(clear);
  const ids = order.length ? order.slice(orderAt + 1) : [];
  const nextUp = ids.filter((id) => pinned.has(id));
  const later = ids.filter((id) => !pinned.has(id));
  const addHead = (label) => {
    const h = document.createElement("div");
    h.className = "qhead";
    h.textContent = label;
    box.append(h);
  };
  const addRow = (id) => {
    const item = queue.find((row) => row.id === id);
    if (!item) return;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "qrow";
    row.textContent = `${item.name || "Untitled"} · ${item.artists || ""}`;
    row.addEventListener("click", () => playItem(item, null, true));
    box.append(row);
  };
  if (nextUp.length) {
    addHead("Next up");
    nextUp.forEach(addRow);
  }
  if (later.length) {
    addHead("Next from playlist");
    later.forEach(addRow);
  }
}

function setPlayIcon() {
  playIcon.innerHTML = audio.paused || audio.ended ? PLAY : PAUSE;
  playBtn.setAttribute("aria-label", audio.paused ? "Play" : "Pause");
}

async function playItem(item, list, keepOrder) {
  if (!item) return;
  current = item;
  remember(item);
  if (list) {
    queue = list.filter(playable);
    if (!keepOrder) rebuildOrder(item);
  }
  queueIndex = queue.findIndex((row) => row.id === item.id);
  if (keepOrder) orderAt = Math.max(0, order.indexOf(item.id));
  paintPlayer();
  setNpvOpen(true);
  paintQueue();
  const src = item.preview_url || "";
  if (!src) {
    audio.removeAttribute("src");
    nowArtist.textContent = "No audio file for this row.";
    setPlayIcon();
    markRows();
    return;
  }
  if (audio.src !== new URL(src, location.href).href) {
    audio.src = src;
  }
  try {
    await audio.play();
  } catch (err) {
    nowArtist.textContent = "Playback blocked by the browser. Press the play button.";
  }
  setPlayIcon();
  markRows();
  syncOutside();
}

function mix(ids) {
  const copy = ids.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function rebuildOrder(start) {
  const ids = queue.map((item) => item.id);
  if (!shuffleOn) order = ids;
  else order = start ? [start.id, ...mix(ids.filter((id) => id !== start.id))] : mix(ids);
  orderAt = Math.max(0, order.indexOf(start && start.id));
}

function paintModes() {
  const shuffle = document.querySelector("#shuffle");
  const repeat = document.querySelector("#repeat");
  shuffle.classList.toggle("on", shuffleOn);
  repeat.classList.toggle("on", repeatMode > 0);
  repeat.classList.toggle("one", repeatMode === 2);
  repeat.setAttribute("aria-label", ["Repeat off", "Repeat playlist", "Repeat song"][repeatMode] || "Repeat");
}

function step(dir) {
  if (!queue.length || !order.length) return;
  if (dir < 0 && audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  let next = orderAt + dir;
  if (next >= order.length) {
    if (repeatMode !== 1) return;
    order = shuffleOn ? mix(queue.map((item) => item.id)) : queue.map((item) => item.id);
    next = 0;
  }
  if (next < 0) next = 0;
  orderAt = next;
  const item = queue.find((row) => row.id === order[orderAt]);
  if (item) playItem(item, null, true);
}

function queueNext(item) {
  if (!item) return;
  if (!queue.length) {
    playItem(item, [item]);
    return;
  }
  if (!queue.some((row) => row.id === item.id)) queue.push(item);
  const at = order.indexOf(item.id);
  if (at >= 0) order.splice(at, 1);
  order.splice(Math.min(orderAt + 1, order.length), 0, item.id);
  pinned.add(item.id);
  paintQueue();
  setNpvOpen(true);
}

function queueAdd(item) {
  if (!item) return;
  if (!queue.length) {
    playItem(item, [item]);
    return;
  }
  if (!queue.some((row) => row.id === item.id)) queue.push(item);
  if (!order.includes(item.id)) order.push(item.id);
  pinned.add(item.id);
  paintQueue();
  setNpvOpen(true);
}

function clearQueue() {
  order = current ? [current.id] : [];
  orderAt = 0;
  pinned.clear();
  paintQueue();
}

function rowButton(item, index, list) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "row";
  el.dataset.id = item.id || "";
  el.innerHTML = `
    <span class="num"><span class="idx idx-num">${index + 1}</span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="play-mini" aria-hidden="true"><svg viewBox="0 0 16 16">${PLAY}</svg></span></span>
    <span><span class="thumb"></span><span><span class="title"></span><span class="subline"></span></span></span>
    <span class="album-col"></span>
    <span class="dur"></span>`;
  el.querySelector(".title").textContent = item.name || "Untitled";
  setArt(el.querySelector(".thumb"), item);
  el.draggable = true;
  el.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", item.id);
    event.dataTransfer.effectAllowed = "copyMove";
  });
  el.addEventListener("dragover", (event) => {
    event.preventDefault();
    el.classList.add("row-over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("row-over"));
  el.addEventListener("drop", (event) => {
    event.preventDefault();
    el.classList.remove("row-over");
    const id = event.dataTransfer.getData("text/plain");
    if (!id || id === item.id) return;
    const ids = sorted(viewTracks).map((track) => track.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(item.id);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    localStorage.setItem(`seanify-rows:${viewName}`, JSON.stringify(ids));
    sortKey = "manual";
    const rank = new Map(ids.map((tid, at) => [tid, at]));
    renderPlaylist(viewName, viewTracks.slice().sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999)));
  });
  const artist = el.querySelector(".subline");
  artist.textContent = item.artists || "";
  artist.classList.add("link");
  artist.addEventListener("click", (event) => {
    event.stopPropagation();
    openArtist(item.artists);
  });
  const album = el.querySelector(".album-col");
  album.textContent = item.album || "";
  album.classList.add("link");
  album.addEventListener("click", (event) => {
    event.stopPropagation();
    openAlbum(item.album);
  });
  el.querySelector(".dur").textContent = item.duration_ms ? fmt(item.duration_ms) : (playable(item) ? "" : "—");
  el.addEventListener("click", () => {
    selectedId = item.id;
    markRows();
  });
  el.addEventListener("dblclick", () => playItem(item, list));
  el.querySelector(".play-mini").addEventListener("click", (event) => {
    event.stopPropagation();
    playItem(item, list);
  });
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMenu(event.clientX, event.clientY, item);
  });
  return el;
}

function sorted(items) {
  const copy = items.slice();
  const saved = sortKey === "manual" ? JSON.parse(localStorage.getItem(`seanify-rows:${viewName}`) || "null") : null;
  if (saved) {
    const rank = new Map(saved.map((id, index) => [id, index]));
    return copy.sort((a, b) => (rank.get(a.id) ?? 9999) - (rank.get(b.id) ?? 9999));
  }
  const value = {
    title: (item) => (item.name || "").toLowerCase(),
    artist: (item) => (item.artists || "").toLowerCase(),
    album: (item) => (item.album || "").toLowerCase(),
    added: (item) => item.added_ms || 0,
  }[sortKey];
  if (!value) return copy;
  copy.sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (left < right) return -sortDir;
    if (left > right) return sortDir;
    return 0;
  });
  return copy;
}

function table(items) {
  const wrap = document.createElement("div");
  const head = document.createElement("div");
  head.className = "table-head";
  const num = document.createElement("span");
  num.textContent = "#";
  head.append(num);
  const titleBtn = document.createElement("button");
  titleBtn.type = "button";
  titleBtn.className = "sort";
  titleBtn.textContent = sortKey === "artist" ? "Artist" : "Title";
  titleBtn.addEventListener("click", () => {
    if (sortKey === "title") sortKey = "artist";
    else if (sortKey === "artist") { sortKey = "title"; sortDir = -sortDir; }
    else sortKey = "title";
    renderPlaylist(viewName, viewTracks);
  });
  const albumBtn = document.createElement("button");
  albumBtn.type = "button";
  albumBtn.className = "album-col sort";
  albumBtn.textContent = "Album" + (sortKey === "album" ? (sortDir > 0 ? " ↑" : " ↓") : "");
  albumBtn.addEventListener("click", () => {
    sortDir = sortKey === "album" ? -sortDir : 1;
    sortKey = "album";
    renderPlaylist(viewName, viewTracks);
  });
  const addedBtn = document.createElement("button");
  addedBtn.type = "button";
  addedBtn.className = "dur sort";
  addedBtn.textContent = "Added" + (sortKey === "added" ? (sortDir > 0 ? " ↑" : " ↓") : "");
  addedBtn.addEventListener("click", () => {
    sortDir = sortKey === "added" ? -sortDir : 1;
    sortKey = "added";
    renderPlaylist(viewName, viewTracks);
  });
  head.append(titleBtn, albumBtn, addedBtn);
  wrap.append(head);
  sorted(items).forEach((item, index) => wrap.append(rowButton(item, index, items)));
  return wrap;
}

function openAlbum(name) {
  if (!name) return;
  if (!restoring) pushHistory({ view: "playlist", playlist: name });
  setNav("library");
  renderPlaylist(name, library.filter((track) => track.album === name));
}

function openArtist(name) {
  if (!name) return;
  if (!restoring) pushHistory({ view: "artist", playlist: name });
  setNav("library");
  renderPlaylist(name, library.filter((track) => track.artists === name));
}

async function saveOne(item, fields) {
  const body = new FormData();
  body.append("album", item.album || "Your music");
  body.append("album_name", fields.album || item.album || "Your music");
  body.append("tracks", JSON.stringify([{ id: item.id, name: item.name, artists: item.artists, album: fields.album || item.album, hidden: Boolean(fields.hidden) }]));
  const res = await fetch("/api/edit", { method: "POST", body });
  const data = await res.json();
  if (!res.ok || data.error) return;
  library = data.tracks || library;
  albums = data.albums || albums;
  paintPlaylists();
  if (fields.hidden || (fields.album && viewName === item.album)) {
    renderPlaylist(viewName, library.filter((track) => track.album === viewName));
  }
}

function openMenu(x, y, item) {
  document.querySelector(".menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const add = (label, fn) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.remove();
      fn();
    });
    menu.append(btn);
  };
  add("Play next", () => queueNext(item));
  add("Add to queue", () => queueAdd(item));
  albums.filter((album) => album.name !== item.album && album.name !== "Liked Songs").forEach((album) => {
    add(`Add to ${album.name}`, () => saveOne(item, { album: album.name }));
  });
  if (item.album && item.album !== "Your music") add("Remove from this playlist", () => saveOne(item, { album: "Your music" }));
  add("Remove from library", () => saveOne(item, { hidden: true }));
  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  if (box.right > window.innerWidth) menu.style.left = `${window.innerWidth - box.width - 8}px`;
  if (box.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - box.height - 8}px`;
}

function card(item, list) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "card";
  el.dataset.id = item.id || "";
  el.innerHTML = `<div class="card-art"><span class="card-play"><svg viewBox="0 0 16 16">${PLAY}</svg></span></div><strong></strong><em></em>`;
  el.querySelector("strong").textContent = item.name || "Untitled";
  el.querySelector("em").textContent = item.artists || item.album || "";
  setArt(el.querySelector(".card-art"), item);
  el.addEventListener("click", () => playItem(item, list));
  return el;
}

function renderPlaylist(name, tracks) {
  viewName = name;
  viewTracks = tracks;
  view.replaceChildren();
  const hue = (tracks[0] && tracks[0].hue) || 280;
  const hero = document.createElement("div");
  hero.className = "playlist-hero";
  hero.style.background = `linear-gradient(180deg, hsl(${hue} 42% 28%) 0%, #121212 78%)`;
  hero.innerHTML = `<div class="hero-art"></div><div><p class="kicker">Playlist</p><h1></h1><p class="hero-sub"></p><div class="hero-actions"><button type="button" class="hero-play">Play</button><button type="button" class="shuffle-hero">Shuffle</button><button type="button" class="edit-open">Edit</button></div></div>`;
  setArt(hero.querySelector(".hero-art"), tracks[0] || { hue });
  hero.querySelector("h1").textContent = name;
  hero.querySelector(".hero-sub").textContent = `Sean · ${tracks.length} songs`;
  const play = hero.querySelector(".hero-play");
  play.innerHTML = `<svg viewBox="0 0 16 16"><path d="M4.2 2.4v11.2L13.6 8 4.2 2.4z"/></svg>`;
  play.setAttribute("aria-label", "Play");
  play.addEventListener("click", () => {
    if (!tracks.length) return;
    const start = shuffleOn ? tracks[Math.floor(Math.random() * tracks.length)] : tracks[0];
    playItem(start, tracks);
  });
  const shuffleHero = hero.querySelector(".shuffle-hero");
  shuffleHero.addEventListener("click", () => {
    if (!tracks.length) return;
    shuffleOn = true;
    localStorage.setItem("seanify-shuffle", "1");
    paintModes();
    playItem(tracks[Math.floor(Math.random() * tracks.length)], tracks);
  });
  const edit = hero.querySelector(".edit-open");
  if (albums.some((album) => album.name === name)) edit.addEventListener("click", () => renderEdit(name));
  else edit.hidden = true;
  view.append(hero);
  if (tracks.length) view.append(table(tracks));
  markRows();
}

function renderEdit(name) {
  const tracks = library.filter((track) => track.album === name);
  view.replaceChildren();
  const box = document.createElement("section");
  box.className = "upload";
  const album = albums.find((item) => item.name === name);
  box.innerHTML = `
    <h1>Edit</h1>
    <p>Changes how these songs show here. Files in Music are not rewritten.</p>
    <label>Album<input id="edit-album" type="text" maxlength="80"></label>
    <div class="cover-row">
      <div id="cover-preview" class="cover-preview"></div>
      <div>
        <button type="button" class="save-upload ghost" id="pick-cover">Replace cover</button>
        <p>jpg, png, or webp. Applies to this album.</p>
      </div>
    </div>
    <input id="cover-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" hidden>
    <div class="edit-head"><span>Title</span><span>Artist</span><span>Album</span><span></span></div>
    <div id="edit-list"></div>
    <button type="button" class="save-upload" id="save-edit">Save</button>
    <p id="upload-status"></p>`;
  view.append(box);
  box.querySelector("#edit-album").value = name;
  const preview = box.querySelector("#cover-preview");
  if (album && album.image) setArt(preview, album);
  else if (tracks[0]) setArt(preview, tracks[0]);
  const coverInput = box.querySelector("#cover-input");
  box.querySelector("#pick-cover").addEventListener("click", () => coverInput.click());
  coverInput.addEventListener("change", () => {
    const file = coverInput.files && coverInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setArt(preview, { image: reader.result }); };
    reader.readAsDataURL(file);
  });
  const list = box.querySelector("#edit-list");
  const removed = new Set();
  tracks.forEach((track) => {
    const row = document.createElement("div");
    row.className = "edit-row";
    row.dataset.id = track.id;
    row.innerHTML = `<input class="t" maxlength="120"><input class="a" maxlength="80"><input class="al" maxlength="80"><button type="button" class="edit-remove">Remove</button>`;
    row.querySelector(".t").value = track.name || "";
    row.querySelector(".a").value = track.artists || "";
    row.querySelector(".al").value = track.album || name;
    row.querySelector(".edit-remove").addEventListener("click", () => {
      removed.add(track.id);
      row.classList.add("gone");
    });
    list.append(row);
  });
  box.querySelector("#edit-album").addEventListener("change", () => {
    const next = box.querySelector("#edit-album").value.trim();
    if (!next) return;
    list.querySelectorAll(".edit-row:not(.gone) .al").forEach((input) => {
      if (input.value.trim() === name) input.value = next;
    });
  });
  box.querySelector("#save-edit").addEventListener("click", () => saveEdit(box, name, removed));
}

async function saveEdit(box, oldName, removed) {
  const status = box.querySelector("#upload-status");
  const albumName = box.querySelector("#edit-album").value.trim() || oldName;
  const rows = [...box.querySelectorAll(".edit-row")].map((row) => ({
    id: row.dataset.id,
    name: row.querySelector(".t").value,
    artists: row.querySelector(".a").value,
    album: row.querySelector(".al").value.trim() || albumName,
    hidden: removed.has(row.dataset.id),
  }));
  const body = new FormData();
  body.append("album", oldName);
  body.append("album_name", albumName);
  body.append("tracks", JSON.stringify(rows));
  const cover = box.querySelector("#cover-input").files && box.querySelector("#cover-input").files[0];
  if (cover) body.append("cover", cover, cover.name);
  status.textContent = "Saving…";
  box.querySelector("#save-edit").disabled = true;
  const res = await fetch("/api/edit", { method: "POST", body });
  const data = await res.json();
  box.querySelector("#save-edit").disabled = false;
  if (!res.ok || data.error) {
    status.textContent = data.message || "Save failed.";
    return;
  }
  library = data.tracks || [];
  albums = data.albums || [];
  paintPlaylists();
  const next = library.filter((track) => track.album === albumName);
  setNav("library");
  renderPlaylist(albumName, next.length ? next : library.filter((track) => track.album === oldName));
}

function paintPlaylists() {
  const scroll = document.querySelector(".plist-scroll");
  const q = (document.querySelector("#lib-q").value || "").trim().toLowerCase();
  scroll.replaceChildren();
  const rows = [];
  if (chip === "artists") {
    const names = [...new Set(library.map((track) => track.artists).filter(Boolean))].sort();
    names.forEach((name) => rows.push({ name, count: library.filter((track) => track.artists === name).length, hue: 200, kind: "artist" }));
  } else if (chip === "albums") {
    albums.forEach((album) => rows.push(album));
  } else {
    const yours = albums.find((album) => album.name === "Your music");
    rows.push({ name: "Your music", count: library.filter((track) => track.album === "Your music").length, hue: 280, image: yours && yours.image });
    if (liked.size) rows.push({ name: "Liked Songs", count: library.filter((track) => liked.has(track.id)).length, hue: 265 });
    for (const album of albums) {
      if (album.name !== "Your music") rows.push(album);
    }
  }
  rows.sort((a, b) => {
    const mode = document.querySelector("#lib-sort").value;
    if (mode === "recent") {
      const rank = (name) => {
        const hit = recentIds.map((id) => library.find((track) => track.id === id)).find((track) => track && (track.album === name || track.artists === name));
        return hit ? recentIds.indexOf(hit.id) : 9999;
      };
      return rank(a.name) - rank(b.name);
    }
    if (mode === "added") {
      const newest = (name) => Math.max(0, ...library.filter((track) => track.album === name || track.artists === name).map((track) => track.added_ms || 0));
      return newest(b.name) - newest(a.name);
    }
    return a.name.localeCompare(b.name);
  });
  for (const album of rows) {
    if (chip === "liked" && album.name !== "Liked Songs") continue;
    if (q && !album.name.toLowerCase().includes(q)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "plist";
    btn.innerHTML = `<span class="liked"></span><span><strong></strong><small></small></span>`;
    btn.querySelector("strong").textContent = album.name;
    btn.querySelector("small").textContent = album.kind === "artist" ? `Artist · ${album.count} songs` : `Playlist · ${album.count} songs`;
    const artEl = btn.querySelector(".liked");
    if (album.image) setArt(artEl, album);
    else if (album.name === "Your music" || album.name === "Liked Songs") {
      artEl.style.background = "linear-gradient(135deg, #450af5, #8e8ee5 45%, #c4efd9)";
    } else {
      artEl.style.background = `linear-gradient(135deg, hsl(${album.hue} 60% 42%), #1a1a1a)`;
    }
    btn.addEventListener("click", () => {
      const tracks = album.kind === "artist"
        ? library.filter((track) => track.artists === album.name)
        : album.name === "Liked Songs"
        ? library.filter((track) => liked.has(track.id))
        : library.filter((track) => track.album === album.name);
      setNav("library");
      if (album.kind === "artist") openArtist(album.name);
      else if (album.name === "Liked Songs") renderPlaylist(album.name, tracks);
      else openAlbum(album.name);
    });
    btn.addEventListener("dragover", (event) => {
      event.preventDefault();
      btn.classList.add("drop");
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("drop"));
    btn.addEventListener("drop", (event) => {
      event.preventDefault();
      btn.classList.remove("drop");
      const track = library.find((item) => item.id === event.dataTransfer.getData("text/plain"));
      if (track && album.name !== "Liked Songs" && album.kind !== "artist") saveOne(track, { album: album.name });
    });
    btn.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (album.name === "Your music" || album.name === "Liked Songs" || album.kind === "artist") return;
      openListMenu(event.clientX, event.clientY, album.name);
    });
    scroll.append(btn);
  }
}

function openListMenu(x, y, name) {
  document.querySelector(".menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const add = (label, fn) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      menu.remove();
      fn();
    });
    menu.append(btn);
  };
  add("Rename", async () => {
    const next = window.prompt("Playlist name", name);
    if (!next || !next.trim() || next.trim() === name) return;
    const res = await fetch("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename", name, new_name: next.trim() }),
    });
    const data = await res.json();
    if (!res.ok) return;
    library = data.tracks || library;
    albums = data.albums || albums;
    paintPlaylists();
    openAlbum(next.trim());
  });
  add("Delete playlist", async () => {
    const res = await fetch("/api/playlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", name }),
    });
    const data = await res.json();
    if (!res.ok) return;
    library = data.tracks || library;
    albums = data.albums || albums;
    paintPlaylists();
    go("library");
  });
  document.body.append(menu);
}

function paintLike() {
  const button = document.querySelector("#like");
  if (!current) {
    button.hidden = true;
    return;
  }
  button.hidden = false;
  button.classList.toggle("on", liked.has(current.id));
}

function remember(item) {
  if (!item || !item.id) return;
  recentIds = [item.id, ...recentIds.filter((id) => id !== item.id)].slice(0, 12);
  localStorage.setItem("sean-sporify-recent", JSON.stringify(recentIds));
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function renderHome() {
  view.replaceChildren();
  const wash = document.createElement("div");
  wash.className = "home-wash";
  const greet = document.createElement("h1");
  greet.className = "greet";
  greet.textContent = greeting();
  const quick = document.createElement("div");
  quick.className = "quick";
  const yours = library.filter((track) => track.album === "Your music");
  const likedTracks = library.filter((track) => liked.has(track.id));
  const tiles = [{ name: "Your music", tracks: yours.length ? yours : library, hue: 280 }];
  if (likedTracks.length) tiles.push({ name: "Liked Songs", tracks: likedTracks, hue: 265 });
  for (const album of albums) {
    if (album.name === "Your music") continue;
    tiles.push({
      name: album.name,
      tracks: library.filter((track) => track.album === album.name),
      hue: album.hue,
      image: library.find((track) => track.album === album.name && track.image)?.image,
    });
  }
  for (const id of recentIds) {
    const track = library.find((item) => item.id === id);
    if (track) tiles.push({ name: track.name, tracks: library, hue: track.hue, image: track.image, single: track });
  }
  for (const tile of tiles.slice(0, 6)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile";
    btn.innerHTML = `<span class="qa"></span><span></span>`;
    btn.querySelector("span:last-child").textContent = tile.name;
    setArt(btn.querySelector(".qa"), tile.image ? { image: tile.image, hue: tile.hue } : { hue: tile.hue });
    btn.addEventListener("click", () => {
      if (tile.single) playItem(tile.single, library);
      else {
        setNav("library");
        renderPlaylist(tile.name, tile.tracks);
      }
    });
    quick.append(btn);
  }
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = recentIds.length ? "Jump back in" : "Your music";
  const grid = document.createElement("div");
  grid.className = "cards";
  const shown = recentIds.map((id) => library.find((item) => item.id === id)).filter(Boolean);
  (shown.length ? shown : library.slice(0, 12)).forEach((item) => grid.append(card(item, library)));
  wash.append(greet, quick, heading, grid);
  view.append(wash);
  markRows();
}

function renderLibrary() {
  const yours = library.filter((track) => track.album === "Your music");
  renderPlaylist("Your music", yours.length ? yours : library);
}

function renderSearchEmpty() {
  view.replaceChildren();
  const title = document.createElement("h2");
  title.className = "section-title";
  title.textContent = "Browse all";
  const grid = document.createElement("div");
  grid.className = "genres";
  for (const [name, color] of GENRES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "genre";
    btn.style.background = color;
    btn.textContent = name;
    const swatch = document.createElement("i");
    swatch.style.background = color;
    btn.append(swatch);
    btn.addEventListener("click", () => {
      input.value = name;
      const hits = library.filter((track) => `${track.name} ${track.album}`.toLowerCase().includes(name.toLowerCase()));
      setNav("search");
      renderPlaylist(name, hits);
    });
    grid.append(btn);
  }
  view.append(title, grid);
}

function renderSearch(data) {
  view.replaceChildren();
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = data.query;
  view.append(title);
  if (data.tracks && data.tracks.length) {
    const h = document.createElement("h2");
    h.className = "section-title";
    h.textContent = "Songs";
    view.append(h, table(data.tracks));
  }
  const cardsFor = (label, items) => {
    if (!items || !items.length) return;
    const h = document.createElement("h2");
    h.className = "section-title";
    h.textContent = label;
    const grid = document.createElement("div");
    grid.className = "cards";
    items.forEach((item) => grid.append(card(item, items)));
    view.append(h, grid);
  };
  cardsFor("Albums", data.albums);
  cardsFor("Artists", data.artists);
  cardsFor("Playlists", data.playlists);
  if (!data.tracks?.length && !data.albums?.length && !data.artists?.length) {
    const p = document.createElement("p");
    p.className = "notice";
    p.textContent = "No results.";
    view.append(p);
  }
  markRows();
}

async function loadLibrary() {
  const res = await fetch("/api/library");
  const data = await res.json();
  library = data.tracks || [];
  albums = data.albums || [];
  paintPlaylists();
}

let staged = [];

function renderUpload() {
  view.replaceChildren();
  const box = document.createElement("section");
  box.className = "upload";
  box.innerHTML = `
    <h1>Add music</h1>
    <p>Songs and the cover stay on this Mac.</p>
    <label>Album<input id="up-album" type="text" maxlength="80" value="Your music" list="album-names"></label>
    <datalist id="album-names"></datalist>
    <label>Artist<input id="up-artist" type="text" maxlength="80" value="Sean"></label>
    <div class="cover-row">
      <div id="cover-preview" class="cover-preview"></div>
      <div>
        <button type="button" class="save-upload ghost" id="pick-cover">Choose cover</button>
        <p>jpg, png, or webp. Used for every song in this album.</p>
      </div>
    </div>
    <input id="cover-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif" hidden>
    <button type="button" class="drop-audio" id="drop-audio">Drop songs here, or choose files</button>
    <input id="audio-input" type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.aac,.ogg,.aiff" multiple hidden>
    <ul id="file-list" class="file-list"></ul>
    <button type="button" class="save-upload" id="save-upload">Save</button>
    <p id="upload-status"></p>`;
  view.append(box);
  const names = box.querySelector("#album-names");
  for (const album of albums) {
    const opt = document.createElement("option");
    opt.value = album.name;
    names.append(opt);
  }
  const list = box.querySelector("#file-list");
  const paintFiles = () => {
    list.replaceChildren();
    staged.forEach((file) => {
      const li = document.createElement("li");
      li.textContent = file.name;
      list.append(li);
    });
  };
  paintFiles();
  const preview = box.querySelector("#cover-preview");
  const coverInput = box.querySelector("#cover-input");
  box.querySelector("#pick-cover").addEventListener("click", () => coverInput.click());
  coverInput.addEventListener("change", () => {
    const file = coverInput.files && coverInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setArt(preview, { image: reader.result }); };
    reader.readAsDataURL(file);
  });
  const audioInput = box.querySelector("#audio-input");
  const takeAudio = (files) => {
    staged = [...staged, ...files];
    paintFiles();
  };
  box.querySelector("#drop-audio").addEventListener("click", () => audioInput.click());
  audioInput.addEventListener("change", () => {
    if (audioInput.files?.length) takeAudio([...audioInput.files]);
    audioInput.value = "";
  });
  const drop = box.querySelector("#drop-audio");
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("over");
    const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("audio/") || /\.(mp3|m4a|wav|flac|aac|ogg|aiff|aif)$/i.test(file.name));
    if (files.length) takeAudio(files);
  });
  box.querySelector("#save-upload").addEventListener("click", () => saveUpload(box));
}

async function saveUpload(box) {
  const status = box.querySelector("#upload-status");
  const album = box.querySelector("#up-album").value.trim() || "Your music";
  const artist = box.querySelector("#up-artist").value.trim() || "Sean";
  const cover = box.querySelector("#cover-input").files && box.querySelector("#cover-input").files[0];
  if (!staged.length && !cover) {
    status.textContent = "Add a song or a cover.";
    return;
  }
  const body = new FormData();
  body.append("album", album);
  body.append("artist", artist);
  if (cover) body.append("cover", cover, cover.name);
  for (const file of staged) body.append("file", file, file.name);
  status.textContent = "Saving on this Mac…";
  box.querySelector("#save-upload").disabled = true;
  const res = await fetch("/api/library", { method: "POST", body });
  const data = await res.json();
  box.querySelector("#save-upload").disabled = false;
  if (!res.ok || data.error) {
    status.textContent = data.message || "Upload failed.";
    return;
  }
  library = data.tracks || [];
  albums = data.albums || [];
  staged = [];
  paintPlaylists();
  const tracks = library.filter((track) => track.album === album);
  setNav("library");
  renderPlaylist(album, tracks);
}

document.querySelectorAll("[data-view]").forEach((el) => {
  el.addEventListener("click", () => go(el.dataset.view));
});
document.querySelector("#back").addEventListener("click", () => {
  if (historyAt > 0) {
    historyAt -= 1;
    restore(history[historyAt]);
  }
});
document.querySelector("#forward").addEventListener("click", () => {
  if (historyAt < history.length - 1) {
    historyAt += 1;
    restore(history[historyAt]);
  }
});
document.querySelector("#add-music").addEventListener("click", () => go("upload"));
input.addEventListener("input", () => {
  const query = input.value.trim().toLowerCase();
  if (!query) {
    setNav("search");
    renderSearchEmpty();
    return;
  }
  const hits = library.filter((track) => `${track.name} ${track.artists} ${track.album}`.toLowerCase().includes(query));
  setNav("search");
  renderPlaylist(`Search · ${input.value.trim()}`, hits);
});
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = input.value.trim().toLowerCase();
  if (!query) return;
  const hits = library.filter((track) => `${track.name} ${track.artists} ${track.album}`.toLowerCase().includes(query));
  if (hits.length) {
    setNav("search");
    renderPlaylist(`Search · ${input.value.trim()}`, hits);
    return;
  }
  setNav("search");
  renderPlaylist(`Search · ${input.value.trim()}`, []);
});
playBtn.addEventListener("click", () => {
  if (!audio.src) {
    if (current && playable(current)) playItem(current, queue.length ? queue : [current]);
    return;
  }
  if (audio.paused) audio.play();
  else audio.pause();
});
document.querySelector("#prev").addEventListener("click", () => step(-1));
document.querySelector("#next").addEventListener("click", () => step(1));
document.querySelector("#shuffle").addEventListener("click", () => {
  shuffleOn = !shuffleOn;
  localStorage.setItem("seanify-shuffle", shuffleOn ? "1" : "0");
  if (queue.length) rebuildOrder(current);
  paintModes();
  paintQueue();
});
document.querySelector("#repeat").addEventListener("click", () => {
  repeatMode = (repeatMode + 1) % 3;
  localStorage.setItem("seanify-repeat", String(repeatMode));
  audio.loop = false;
  paintModes();
});
volume.addEventListener("input", () => {
  muted = false;
  audio.muted = false;
  document.querySelector("#mute").classList.remove("on");
  audio.volume = Number(volume.value) / 100;
  localStorage.setItem("seanify-volume", volume.value);
});
seek.addEventListener("pointerdown", () => { seeking = true; });
seek.addEventListener("input", () => {
  if (!audio.duration) return;
  const pct = Number(seek.value) / 1000;
  seek.style.setProperty("--pct", `${pct * 100}%`);
  timeNow.textContent = fmt(pct * audio.duration * 1000);
});
seek.addEventListener("change", () => {
  if (audio.duration) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
  seeking = false;
});
audio.addEventListener("timeupdate", () => {
  if (!audio.duration || seeking) return;
  const pct = audio.currentTime / audio.duration;
  seek.value = String(Math.round(pct * 1000));
  seek.style.setProperty("--pct", `${pct * 100}%`);
  timeNow.textContent = fmt(audio.currentTime * 1000);
  timeEnd.textContent = showRemain ? `-${fmt(Math.max(0, audio.duration - audio.currentTime) * 1000)}` : fmt(audio.duration * 1000);
  syncOutside();
});
audio.addEventListener("play", () => { setPlayIcon(); markRows(); syncOutside(); });
audio.addEventListener("pause", () => { setPlayIcon(); markRows(); syncOutside(); });
audio.addEventListener("ended", () => {
  if (repeatMode === 2) {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  const atEnd = orderAt >= order.length - 1;
  if (atEnd && repeatMode !== 1) {
    setPlayIcon();
    markRows();
    return;
  }
  step(1);
});
view.addEventListener("dragover", (event) => {
  event.preventDefault();
  view.classList.add("drop");
});
view.addEventListener("dragleave", () => view.classList.remove("drop"));
view.addEventListener("drop", (event) => {
  event.preventDefault();
  view.classList.remove("drop");
  const files = [...(event.dataTransfer?.files || [])].filter((file) => file.type.startsWith("audio/") || /\.(mp3|m4a|wav|flac|aac|ogg|aiff|aif)$/i.test(file.name));
  if (files.length) {
    staged = [...staged, ...files];
    go("upload");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.target === input || event.target.id === "lib-q" || event.target.closest(".upload")) return;
  if (event.code === "Space") {
    event.preventDefault();
    playBtn.click();
  }
});

loadLibrary().then(() => {
  paintModes();
  const savedVolume = localStorage.getItem("seanify-volume");
  if (savedVolume != null) {
    volume.value = savedVolume;
    audio.volume = Number(savedVolume) / 100;
  }
  go("home", false);
});

const libraryPanel = document.querySelector("#library-panel");
const splitter = document.querySelector("#splitter");
const savedWidth = Number(localStorage.getItem("sean-sporify-library-width"));
if (savedWidth >= 180 && savedWidth <= 480) libraryPanel.style.width = `${savedWidth}px`;

splitter.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  splitter.setPointerCapture(event.pointerId);
  libraryPanel.classList.add("dragging");
  const startX = event.clientX;
  const startW = libraryPanel.getBoundingClientRect().width;
  function move(ev) {
    const width = Math.max(180, Math.min(480, startW + ev.clientX - startX));
    libraryPanel.style.width = `${width}px`;
  }
  function up(ev) {
    libraryPanel.classList.remove("dragging");
    localStorage.setItem("sean-sporify-library-width", String(parseInt(libraryPanel.style.width, 10)));
    splitter.removeEventListener("pointermove", move);
    splitter.removeEventListener("pointerup", up);
  }
  splitter.addEventListener("pointermove", move);
  splitter.addEventListener("pointerup", up);
});

document.querySelector("#npv-toggle").addEventListener("click", () => {
  const open = document.querySelector("#app").dataset.transition !== "right-sidebar-open";
  setNpvOpen(open);
});
document.querySelector("#npv-close").addEventListener("click", () => setNpvOpen(false));
document.querySelector("#mini-open").addEventListener("click", () => {
  if (current) localStorage.setItem("seanify-now", current.id);
  const popup = window.open("/mini", "seanify-mini", "width=320,height=390,resizable=yes");
  if (!popup) nowArtist.textContent = "Allow pop-ups to open the mini player.";
  else syncOutside();
});
document.querySelector("#like").addEventListener("click", () => {
  if (!current) return;
  if (liked.has(current.id)) liked.delete(current.id);
  else liked.add(current.id);
  localStorage.setItem("sean-sporify-liked", JSON.stringify([...liked]));
  paintLike();
  paintPlaylists();
  syncOutside();
});
document.querySelector("#lib-q").addEventListener("input", () => paintPlaylists());
document.querySelector("#lib-sort").addEventListener("change", () => paintPlaylists());
document.querySelector("#mute").addEventListener("click", () => {
  muted = !muted;
  audio.muted = muted;
  document.querySelector("#mute").classList.toggle("on", muted);
});
document.querySelector("#time-end").addEventListener("click", () => {
  showRemain = !showRemain;
  if (!audio.duration) return;
  timeEnd.textContent = showRemain ? `-${fmt(Math.max(0, audio.duration - audio.currentTime) * 1000)}` : fmt(audio.duration * 1000);
});
document.querySelectorAll("[data-chip]").forEach((btn) => {
  btn.addEventListener("click", () => {
    chip = btn.dataset.chip;
    document.querySelectorAll("[data-chip]").forEach((el) => el.classList.toggle("on", el === btn));
    paintPlaylists();
  });
});
view.addEventListener("scroll", () => {
  document.querySelector(".topbar").classList.toggle("solid", view.scrollTop > 20);
});
document.addEventListener("keydown", (event) => {
  if (event.target === input || event.target.id === "lib-q" || event.target.closest(".upload")) return;
  if (event.code === "ArrowRight" && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  if (event.code === "ArrowLeft" && audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
});
document.addEventListener("click", () => document.querySelector(".menu")?.remove());
document.querySelector("#lib-collapse").addEventListener("click", () => {
  document.querySelector("#library-panel").classList.toggle("collapsed");
});
document.querySelector("#new-list").addEventListener("click", async () => {
  const name = window.prompt("Playlist name");
  if (!name || !name.trim()) return;
  const res = await fetch("/api/playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    nowArtist.textContent = data.message || "Could not create that playlist.";
    return;
  }
  library = data.tracks || library;
  albums = data.albums || albums;
  paintPlaylists();
  openAlbum(name.trim());
});
const bus = "BroadcastChannel" in window ? new BroadcastChannel("seanify") : null;
function syncOutside() {
  if (!current) return;
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.name || "Seanify",
      artist: current.artists || "",
      album: current.album || "",
    });
    navigator.mediaSession.playbackState = audio.paused ? "paused" : "playing";
  }
  if (!bus) return;
  bus.postMessage({
    type: "state",
    id: current.id,
    name: current.name,
    artists: current.artists,
    album: current.album,
    image: current.image,
    hue: current.hue,
    time: audio.currentTime || 0,
    duration: audio.duration || (current.duration_ms || 0) / 1000,
    liked: current ? liked.has(current.id) : false,
    shuffle: shuffleOn,
    playing: !audio.paused && !audio.ended,
  });
}
if (bus) {
  bus.onmessage = (event) => {
    const data = event.data || {};
    if (data.type === "hello") syncOutside();
    if (data.type !== "cmd") return;
    if (data.action === "play") audio.play();
    if (data.action === "pause") audio.pause();
    if (data.action === "next") step(1);
    if (data.action === "prev") step(-1);
    if (data.action === "seek" && Number.isFinite(data.time)) audio.currentTime = data.time;
    if (data.action === "like" && current) document.querySelector("#like").click();
    if (data.action === "shuffle") document.querySelector("#shuffle").click();
  };
}
if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", () => audio.play());
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
}
