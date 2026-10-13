#!/usr/bin/env python3
"""Local music player. No network calls. Files stay on this Mac."""

from __future__ import annotations

import hashlib
import json
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
LIBRARY = ROOT / "library"
INDEX_PATH = LIBRARY / "index.json"
MUSIC_ROOT = Path.home() / "Music" / "Music" / "Media.localized" / "Music"
_catalog: dict[str, Path] = {}
HOST = "127.0.0.1"
PORT = 8765
AUDIO_EXT = {".mp3", ".m4a", ".mp4", ".wav", ".flac", ".aac", ".ogg", ".oga", ".aiff", ".aif", ".webm"}
MIME = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".aiff": "audio/aiff",
    ".aif": "audio/aiff",
    ".webm": "audio/webm",
}

_lock = threading.Lock()
_state: dict | None = None
_lib_lock = threading.Lock()
_DUR: dict[str, int] = {}


def _split_name(stem: str) -> tuple[str, str]:
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return artist.strip() or "Local", title.strip() or stem
    return "Local", stem


def _read_index() -> list[dict]:
    if not INDEX_PATH.exists():
        return []
    try:
        data = json.loads(INDEX_PATH.read_text())
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _write_index(items: list[dict]) -> None:
    LIBRARY.mkdir(parents=True, exist_ok=True)
    INDEX_PATH.write_text(json.dumps(items, indent=2))


_WORDS: set[str] | None = None
_FIX = {
    "im": "I'm",
    "dont": "Don't",
    "cant": "Can't",
    "wont": "Won't",
    "ive": "I've",
    "id": "I'd",
    "ill": "I'll",
    "youre": "You're",
    "its": "It's",
    "thats": "That's",
}


def _words() -> set[str]:
    global _WORDS
    if _WORDS is not None:
        return _WORDS
    found: set[str] = set()
    dictionary = Path("/usr/share/dict/words")
    if dictionary.is_file():
        for line in dictionary.read_text(errors="ignore").splitlines():
            word = line.strip().lower()
            if word.isalpha() and 2 <= len(word) <= 16:
                found.add(word)
    found.update("a i of at the and or to in on for with you me my we it im".split())
    _WORDS = found
    return found


def _segment(token: str) -> list[str]:
    words = _words()
    text = token.lower()
    if text in words or len(text) <= 3:
        return [text]
    best: list[tuple[int, list[str]] | None] = [None] * (len(text) + 1)
    best[0] = (0, [])
    for i in range(len(text)):
        if best[i] is None:
            continue
        score, parts = best[i]
        for j in range(i + 1, min(len(text), i + 16) + 1):
            word = text[i:j]
            if word not in words:
                continue
            bonus = 1 if len(word) == 1 else len(word) * len(word)
            cand = score + bonus
            if best[j] is None or cand > best[j][0]:
                best[j] = (cand, parts + [word])
    if best[-1] is None:
        return [token]
    return best[-1][1]


_GLUE = ("through", "before", "under", "after", "from", "with", "into", "over", "and", "the", "for", "you", "your", "of", "at", "in", "on", "to")


def _known(word: str) -> bool:
    words = _words()
    if word in words or word in _GLUE or word in _FIX:
        return True
    if len(word) > 3 and word.endswith("s") and word[:-1] in words:
        return True
    if len(word) > 4 and word.endswith("es") and word[:-2] in words:
        return True
    return False


def _glue_split(token: str) -> list[str] | None:
    text = token.lower()
    if _known(text):
        return [text]
    hits = []
    for glue in _GLUE:
        start = 0
        while True:
            at = text.find(glue, start)
            if at < 0:
                break
            left, right = text[:at], text[at + len(glue):]
            if left and _known(left) and (not right or len(right) >= 2):
                hits.append((at, len(glue), glue))
            start = at + 1
    if not hits:
        return None
    hits.sort(key=lambda item: (-item[1], item[0]))
    at, size, glue = hits[0]
    left, right = text[:at], text[at + size:]
    parts = _glue_split(left) or [left]
    parts.append(glue)
    if right:
        parts.extend(_glue_split(right) or [right])
    return parts


def _pretty(stem: str) -> str:
    bare = re.sub(r"^[0-9a-f]{8}-", "", stem)
    alias = {
        "dontletmediealone": "Don't Let Me Die Alone",
        "wrestlinthedevil": "Wrestlin' the Devil",
        "itslonglonelyhighway": "It's a Long Lonely Highway",
        "goingoutwithabang": "Going Out With a Bang",
        "saltonroad": "Salt on the Road",
    }.get(re.sub(r"[^a-z0-9]", "", bare.lower()))
    if alias:
        return alias
    text = bare.replace("_", " ")
    text = re.sub(r"([a-z])([A-Z])", r"\1 \2", text)
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", text)
    text = re.sub(r"([A-Za-z])(\d)", r"\1 \2", text)
    words = _words()
    out: list[str] = []
    for token in re.sub(r"\s+", " ", text).split():
        low = token.lower()
        if any(ch.isdigit() for ch in token) or low in words or low in _FIX:
            out.append(_FIX.get(low, token[:1].upper() + token[1:]))
            continue
        pieces = _glue_split(token) if len(token) >= 6 else None
        if not pieces:
            out.append(token[:1].upper() + token[1:])
            continue
        for part in pieces:
            out.append(_FIX.get(part, part[:1].upper() + part[1:]))
    return " ".join(out) or stem


def _duration_ms(path: Path) -> int | None:
    cached = _DUR.get(str(path))
    if cached:
        return cached
    ms = None
    if path.suffix.lower() == ".wav":
        import wave

        try:
            with wave.open(str(path)) as handle:
                rate = handle.getframerate() or 1
                ms = int(handle.getnframes() / rate * 1000)
        except (wave.Error, EOFError, OSError):
            ms = None
    else:
        import subprocess

        try:
            proc = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                check=False,
                capture_output=True,
                text=True,
                timeout=8,
            )
            ms = int(float(proc.stdout.strip()) * 1000) if proc.stdout.strip() else None
        except (OSError, subprocess.TimeoutExpired, ValueError):
            ms = None
    if ms:
        _DUR[str(path)] = ms
    return ms


def _cover(path: Path, track_id: str) -> str | None:
    if path.suffix.lower() not in {".mp3", ".m4a", ".flac", ".mp4", ".aac"}:
        return None
    art_dir = LIBRARY / "art"
    dest = art_dir / f"{track_id}.jpg"
    if dest.is_file() and dest.stat().st_size > 0:
        return f"/art/{track_id}"
    art_dir.mkdir(parents=True, exist_ok=True)
    import subprocess

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(path), "-an", "-frames:v", "1", str(dest)],
            check=False,
            capture_output=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if dest.is_file() and dest.stat().st_size > 0:
        return f"/art/{track_id}"
    dest.unlink(missing_ok=True)
    return None


def _allowed_root(path: Path) -> bool:
    resolved = path.resolve()
    for root in (MUSIC_ROOT, LIBRARY):
        if not root.exists():
            continue
        base = root.resolve()
        if str(resolved).startswith(str(base)):
            return True
    return False


COVERS = LIBRARY / "covers.json"
EDITS = LIBRARY / "edits.json"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def _album_name(raw: str) -> str:
    name = re.sub(r"[\\/]+", " ", raw or "").strip()
    name = re.sub(r"\s+", " ", name)[:80]
    return name or "Your music"


def _album_dir(name: str) -> Path:
    root = (LIBRARY / "albums").resolve()
    path = (root / name).resolve()
    if not str(path).startswith(str(root)):
        raise ValueError("Bad album name")
    return path


def _read_covers() -> dict[str, str]:
    if not COVERS.is_file():
        return {}
    try:
        data = json.loads(COVERS.read_text())
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _read_edits() -> dict[str, dict]:
    if not EDITS.is_file():
        return {}
    try:
        data = json.loads(EDITS.read_text())
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _clip(value: object, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _cover_url(name: str, covers: dict[str, str] | None = None) -> str | None:
    slug = (covers if covers is not None else _read_covers()).get(name)
    if not slug or not re.fullmatch(r"[0-9a-f]{16}", str(slug)):
        return None
    if (LIBRARY / "covers" / f"{slug}.jpg").is_file():
        return f"/cover/{slug}"
    return None


def scan_disk() -> list[dict]:
    global _catalog
    catalog: dict[str, Path] = {}
    tracks: list[dict] = []
    covers = _read_covers()
    edits = _read_edits()
    album_root = (LIBRARY / "albums").resolve()
    roots = [root for root in (MUSIC_ROOT, LIBRARY) if root.exists()]
    for root in roots:
        base = root.resolve()
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in AUDIO_EXT or path.name == "index.json":
                continue
            resolved = path.resolve()
            if not str(resolved).startswith(str(base)):
                continue
            tid = hashlib.sha256(str(resolved).encode()).hexdigest()[:16]
            if tid in catalog:
                continue
            catalog[tid] = resolved
            album = path.parent.name
            artist = path.parent.parent.name
            under_album = path.parent.parent.resolve() == album_root
            if under_album:
                album = path.parent.name
                artist_file = path.parent / "artist.txt"
                artist = artist_file.read_text().strip() if artist_file.is_file() else "Sean"
            elif album in {"Unknown Album", "library"} or path.parent.resolve() == LIBRARY.resolve():
                album = "Your music"
            if artist in {"Unknown Artist", "Music", "Media.localized", "Sean Sporify Clone", "app", "albums"} or path.parent.resolve() == LIBRARY.resolve():
                artist = "Sean"
            edit = edits.get(tid) or {}
            if edit.get("hidden"):
                continue
            name = _clip(edit.get("name"), 120) or _pretty(path.stem)
            artists = _clip(edit.get("artists"), 80) or artist
            album = _clip(edit.get("album"), 80) or album
            tracks.append(
                {
                    "kind": "track",
                    "source": "local",
                    "id": tid,
                    "uri": f"local:{tid}",
                    "name": name,
                    "artists": artists,
                    "album": album,
                    "image": _cover_url(album, covers) or _cover(path, tid),
                    "hue": int(hashlib.sha256(path.stem.encode()).hexdigest()[:2], 16) % 360,
                    "duration_ms": _duration_ms(path),
                    "added_ms": int(path.stat().st_mtime * 1000),
                    "explicit": False,
                    "preview_url": f"/media/{tid}",
                    "playable": True,
                }
            )
    _catalog = catalog
    tracks.sort(key=lambda item: (item["album"] != "Your music", item["name"].lower()))
    return tracks


LISTS = LIBRARY / "playlists.json"


def _read_lists() -> list[str]:
    if not LISTS.is_file():
        return []
    try:
        data = json.loads(LISTS.read_text())
    except json.JSONDecodeError:
        return []
    return [str(item) for item in data] if isinstance(data, list) else []


def create_playlist(name: str) -> dict:
    clean = _album_name(name)
    if clean in {"Your music", "Liked Songs"}:
        raise ValueError("Pick another name")
    names = _read_lists()
    if clean not in names:
        names.append(clean)
        LISTS.write_text(json.dumps(names, indent=2))
    return library_payload()


def _retarget_album(old: str, new: str) -> None:
    edits = _read_edits()
    for track in scan_disk():
        if track.get("album") != old:
            continue
        current = dict(edits.get(track["id"]) or {})
        current["name"] = current.get("name") or track["name"]
        current["artists"] = current.get("artists") or track["artists"]
        current["album"] = new
        edits[track["id"]] = current
    EDITS.write_text(json.dumps(edits, indent=2))
    covers = _read_covers()
    if old in covers and new not in covers:
        covers[new] = covers.pop(old)
        COVERS.write_text(json.dumps(covers, indent=2))


def rename_playlist(old: str, new: str) -> dict:
    source = _album_name(old)
    target = _album_name(new)
    if source in {"Your music", "Liked Songs"} or target in {"Your music", "Liked Songs"}:
        raise ValueError("That name is reserved")
    names = [target if item == source else item for item in _read_lists()]
    if target not in names:
        names.append(target)
    LISTS.write_text(json.dumps(names, indent=2))
    _retarget_album(source, target)
    return library_payload()


def delete_playlist(name: str) -> dict:
    source = _album_name(name)
    if source in {"Your music", "Liked Songs"}:
        raise ValueError("That playlist stays")
    LISTS.write_text(json.dumps([item for item in _read_lists() if item != source], indent=2))
    _retarget_album(source, "Your music")
    return library_payload()


def library_payload() -> dict:
    tracks = scan_disk()
    counts: dict[str, int] = {}
    for track in tracks:
        counts[track["album"]] = counts.get(track["album"], 0) + 1
    for name in _read_lists():
        counts.setdefault(name, 0)
    covers = _read_covers()
    albums = [
        {
            "name": name,
            "count": count,
            "hue": int(hashlib.sha256(name.encode()).hexdigest()[:2], 16) % 360,
            "image": _cover_url(name, covers),
        }
        for name, count in counts.items()
    ]
    albums.sort(key=lambda item: (-item["count"], item["name"]))
    return {"tracks": tracks, "albums": albums}


def library_tracks() -> list[dict]:
    with _lib_lock:
        items = [item for item in _read_index() if (LIBRARY / str(item.get("file", ""))).is_file()]
        known = {item.get("file") for item in items}
        changed = len(items) != len(_read_index())
        if LIBRARY.exists():
            for path in sorted(LIBRARY.iterdir()):
                if path.suffix.lower() not in AUDIO_EXT or path.name in known:
                    continue
                artist, title = _split_name(path.stem)
                items.append(
                    {
                        "id": uuid.uuid4().hex,
                        "file": path.name,
                        "name": title,
                        "artists": artist,
                        "album": "Your music",
                    }
                )
                changed = True
        if changed:
            _write_index(items)
    out = []
    for item in items:
        out.append(
            {
                "kind": "track",
                "source": "local",
                "id": item["id"],
                "uri": f"local:{item['id']}",
                "name": item.get("name") or "Untitled",
                "artists": item.get("artists") or "Local",
                "album": item.get("album") or "Your music",
                "image": None,
                "duration_ms": item.get("duration_ms"),
                "explicit": False,
                "preview_url": f"/media/{item['id']}",
                "playable": True,
            }
        )
    return out


def _safe_filename(name: str) -> str:
    base = Path(name).name
    stem = re.sub(r"[^A-Za-z0-9._ -]+", "", Path(base).stem).strip(" .") or "track"
    ext = Path(base).suffix.lower()
    if ext not in AUDIO_EXT:
        raise ValueError(f"Unsupported audio type: {ext or 'none'}")
    return f"{uuid.uuid4().hex[:8]}-{stem[:80]}{ext}"


def _save_cover(album: str, data: bytes, filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in IMAGE_EXT:
        raise ValueError("Cover must be jpg, png, webp, or gif")
    if len(data) > 8_000_000:
        raise ValueError("Cover is too large")
    slug = hashlib.sha256(album.encode()).hexdigest()[:16]
    dest_dir = LIBRARY / "covers"
    dest_dir.mkdir(parents=True, exist_ok=True)
    raw = dest_dir / f"{slug}.upload"
    dest = dest_dir / f"{slug}.jpg"
    raw.write_bytes(data)
    import subprocess

    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw), "-frames:v", "1", str(dest)],
            check=False,
            capture_output=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raw.unlink(missing_ok=True)
        raise ValueError("Could not read that image") from exc
    raw.unlink(missing_ok=True)
    if not dest.is_file() or dest.stat().st_size == 0:
        dest.unlink(missing_ok=True)
        raise ValueError("Could not read that image")
    covers = _read_covers()
    covers[album] = slug
    COVERS.write_text(json.dumps(covers, indent=2))
    return f"/cover/{slug}"


def save_uploads(body: bytes, content_type: str) -> dict:
    boundary = ""
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part.split("=", 1)[1].strip().strip('"')
    if not boundary:
        raise ValueError("Missing upload boundary")
    marker = ("--" + boundary).encode()
    album = "Your music"
    artist = "Sean"
    cover: tuple[str, bytes] | None = None
    audio: list[tuple[str, bytes]] = []
    LIBRARY.mkdir(parents=True, exist_ok=True)
    for chunk in body.split(marker):
        if b"name=" not in chunk:
            continue
        header, _, data = chunk.partition(b"\r\n\r\n")
        if data.endswith(b"\r\n"):
            data = data[:-2]
        disp = header.decode(errors="replace")
        name = ""
        if 'name="' in disp:
            name = disp.split('name="', 1)[1].split('"', 1)[0]
        filename = ""
        if 'filename="' in disp:
            filename = disp.split('filename="', 1)[1].split('"', 1)[0]
        if name == "album" and not filename:
            album = _album_name(data.decode(errors="replace"))
        elif name == "artist" and not filename:
            artist = re.sub(r"\s+", " ", data.decode(errors="replace")).strip()[:80] or "Sean"
        elif name == "cover" and filename and data:
            cover = (filename, data)
        elif filename and data:
            audio.append((filename, data))
    if not audio and cover is None:
        raise ValueError("Add a song or a cover")
    if len(body) > 200_000_000:
        raise ValueError("Upload is too large")
    if audio:
        folder = _album_dir(album)
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "artist.txt").write_text(artist)
        for raw_name, data in audio:
            (folder / _safe_filename(raw_name)).write_bytes(data)
    if cover is not None:
        _save_cover(album, cover[1], cover[0])
    return library_payload()


def apply_edits(body: bytes, content_type: str) -> dict:
    boundary = ""
    for part in content_type.split(";"):
        part = part.strip()
        if part.startswith("boundary="):
            boundary = part.split("=", 1)[1].strip().strip('"')
    if not boundary:
        raise ValueError("Missing upload boundary")
    marker = ("--" + boundary).encode()
    fields: dict[str, str] = {}
    cover: tuple[str, bytes] | None = None
    for chunk in body.split(marker):
        if b"name=" not in chunk:
            continue
        header, _, data = chunk.partition(b"\r\n\r\n")
        if data.endswith(b"\r\n"):
            data = data[:-2]
        disp = header.decode(errors="replace")
        name = disp.split('name="', 1)[1].split('"', 1)[0] if 'name="' in disp else ""
        filename = disp.split('filename="', 1)[1].split('"', 1)[0] if 'filename="' in disp else ""
        if name == "cover" and filename and data:
            cover = (filename, data)
        elif name and not filename:
            fields[name] = data.decode(errors="replace")
    try:
        rows = json.loads(fields.get("tracks") or "[]")
    except json.JSONDecodeError as exc:
        raise ValueError("Bad track list") from exc
    if not isinstance(rows, list) or not rows:
        raise ValueError("Nothing to save")
    if not _catalog:
        scan_disk()
    old_album = _album_name(fields.get("album") or "")
    new_album = _album_name(fields.get("album_name") or old_album)
    edits = _read_edits()
    kept = 0
    for item in rows:
        if not isinstance(item, dict):
            continue
        tid = str(item.get("id") or "")
        if not re.fullmatch(r"[0-9a-f]{16}", tid) or tid not in _catalog:
            continue
        current = dict(edits.get(tid) or {})
        if item.get("hidden"):
            current["hidden"] = True
        else:
            current.pop("hidden", None)
            title = _clip(item.get("name"), 120)
            artist = _clip(item.get("artists"), 80)
            album = _album_name(str(item.get("album") or new_album))
            if title:
                current["name"] = title
            if artist:
                current["artists"] = artist
            current["album"] = album
            kept += 1
        edits[tid] = current
    if kept == 0 and not any(isinstance(item, dict) and item.get("hidden") for item in rows):
        raise ValueError("Nothing to save")
    EDITS.write_text(json.dumps(edits, indent=2))
    covers = _read_covers()
    if old_album != new_album and old_album in covers and new_album not in covers:
        covers[new_album] = covers.pop(old_album)
        COVERS.write_text(json.dumps(covers, indent=2))
    if cover is not None:
        _save_cover(new_album, cover[1], cover[0])
    return library_payload()


def media_path(track_id: str) -> Path | None:
    if track_id not in _catalog:
        scan_disk()
    path = _catalog.get(track_id)
    if path is not None and path.is_file() and _allowed_root(path):
        return path
    library_root = LIBRARY.resolve()
    for item in _read_index():
        if item.get("id") != track_id:
            continue
        path = (LIBRARY / str(item.get("file", ""))).resolve()
        if str(path).startswith(str(library_root)) and path.is_file():
            return path
    return None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        line = fmt % args
        if "Authorization" in line or "access_token" in line or "refresh_token" in line:
            return
        super().log_message("%s", line)

    def _send(self, status: int, payload: dict | None = None, raw: bytes | None = None, content_type: str = "application/json", extra: dict | None = None) -> None:
        body = raw if raw is not None else json.dumps(payload or {}).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def _static(self, rel: str) -> None:
        path = (STATIC / rel).resolve()
        if not str(path).startswith(str(STATIC.resolve())) or not path.is_file():
            self._send(404, {"error": True, "message": "Not found"})
            return
        kind = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".png": "image/png",
        }.get(path.suffix, "application/octet-stream")
        self._send(200, raw=path.read_bytes(), content_type=kind)

    def _media(self, track_id: str) -> None:
        path = media_path(track_id)
        if path is None:
            self._send(404, {"error": True, "message": "Track not found"})
            return
        size = path.stat().st_size
        content_type = MIME.get(path.suffix.lower(), "application/octet-stream")
        start, end = 0, max(size - 1, 0)
        status = 200
        range_header = self.headers.get("Range")
        if range_header and range_header.startswith("bytes=") and size:
            spec = range_header.split("=", 1)[1].split(",", 1)[0]
            start_s, _, end_s = spec.partition("-")
            try:
                start = int(start_s) if start_s else 0
                end = int(end_s) if end_s else size - 1
            except ValueError:
                self._send(416, {"error": True, "message": "Bad range"}, extra={"Content-Range": f"bytes */{size}"})
                return
            end = min(end, size - 1)
            if start > end or start < 0:
                self._send(416, {"error": True, "message": "Bad range"}, extra={"Content-Range": f"bytes */{size}"})
                return
            status = 206
        length = end - start + 1 if size else 0
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if not length:
            return
        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining:
                chunk = handle.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_GET(self) -> None:  # noqa: N802
        parsed = parse.urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self._static("index.html")
            return
        if parsed.path in ("/app.css", "/app.js", "/logo.png", "/mini.css", "/mini.js"):
            self._static(parsed.path.lstrip("/"))
            return
        if parsed.path == "/mini":
            self._static("mini.html")
            return
        if parsed.path == "/api/health":
            self._send(200, {"ok": True, "local": True})
            return
        if parsed.path == "/api/library":
            self._send(200, library_payload())
            return
        if parsed.path.startswith("/media/"):
            self._media(parsed.path.rsplit("/", 1)[-1])
            return
        if parsed.path.startswith("/cover/"):
            slug = parsed.path.rsplit("/", 1)[-1]
            art = (LIBRARY / "covers" / f"{slug}.jpg").resolve()
            root = (LIBRARY / "covers").resolve()
            if re.fullmatch(r"[0-9a-f]{16}", slug) and str(art).startswith(str(root)) and art.is_file():
                self._send(200, raw=art.read_bytes(), content_type="image/jpeg")
                return
            self._send(404, {"error": True, "message": "Not found"})
            return
        if parsed.path.startswith("/art/"):
            art = (LIBRARY / "art" / f"{parsed.path.rsplit('/', 1)[-1]}.jpg").resolve()
            root = (LIBRARY / "art").resolve()
            if str(art).startswith(str(root)) and art.is_file():
                self._send(200, raw=art.read_bytes(), content_type="image/jpeg")
                return
            self._send(404, {"error": True, "message": "Not found"})
            return
        self._send(404, {"error": True, "message": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        if parsed.path == "/api/playlist":
            try:
                payload = json.loads(body.decode() or "{}")
                action = payload.get("action") or "create"
                if action == "rename":
                    result = rename_playlist(str(payload.get("name") or ""), str(payload.get("new_name") or ""))
                elif action == "delete":
                    result = delete_playlist(str(payload.get("name") or ""))
                else:
                    result = create_playlist(str(payload.get("name") or ""))
            except (ValueError, json.JSONDecodeError) as exc:
                self._send(400, {"error": True, "message": str(exc)})
                return
            self._send(200, result)
            return
        if parsed.path == "/api/edit":
            try:
                payload = apply_edits(body, self.headers.get("Content-Type") or "")
            except ValueError as exc:
                self._send(400, {"error": True, "message": str(exc)})
                return
            self._send(200, payload)
            return
        if parsed.path != "/api/library":
            self._send(404, {"error": True, "message": "Not found"})
            return
        try:
            tracks = save_uploads(body, self.headers.get("Content-Type") or "")
        except ValueError as exc:
            self._send(400, {"error": True, "message": str(exc)})
            return
        self._send(200, tracks)


def main() -> None:
    LIBRARY.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
