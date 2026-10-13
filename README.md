# Seanify

Local music player for this Mac. Your files stay on disk. Nothing is uploaded and there is no connection to a music service.

## Run

```bash
python3 app/server.py
```

Open http://127.0.0.1:8765

The mini player is http://127.0.0.1:8765/mini or the window button in the player bar.

## What it does

- Plays audio already on the Mac, plus files you add
- Home, library, search, playlists, albums, and artists
- Shuffle, repeat, queue, play next, and drag onto a playlist
- Album covers, edit metadata, mute, and media keys
- A separate mini player that controls the same audio

Library files, covers, and edits live in `app/library/` and are not part of this repo.
