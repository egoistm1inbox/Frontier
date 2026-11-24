# Lobby App — preview

Runnable preview of the Lobby UI from `streamlinkinbox/Frontier`.

## Run

```bash
python3 LobbyApp/Serve.py        # http://0.0.0.0:8096/
# open http://localhost:8096/Lobby.html
```

Or any static server on this folder, e.g. `python3 -m http.server 8096 --directory LobbyApp`.

## Provenance

- Original: `streamlinkinbox/Frontier`, `app/lobby.html`, branch `arena/01a06c6c-frontier`, commit `1f2126870aee94c57c32631ccd8ad0cefa461de1`
  (per `Docs/NetworkingLobbyPlan.md` and `Frontier/Projects/Project-Networking/Reference/README.md` in this repo).
  That branch/commit no longer exists upstream (deleted), so the surviving copy is used.
- Surviving copy in this repo: `Frontier/Projects/Project-Networking/Reference/Lobby.html` at `c79c8d9` (this branch's base).
  `LobbyApp/Lobby.html` here is a byte-identical copy of that file. `LobbyApp/REFERENCE-README.md` is its provenance note.

## What it is

Single-file HTML (inline CSS/JS, ~92 KB): lobby hero/navigation (Home / Lobby / Leaderboard),
lobby browse list with search/filters, room view with player-card roster, voice strip (EOS RTC simulated),
lobby chat, right-side match panel, and a Create Lobby modal (EOS_Lobby_CreateLobby settings mock-up).

Entry fees are shown as `Free / 5 CR / 10 CR / 25 CR` with "Fee is held in escrow until the race starts" —
that credit/entry system is the wallet-like part of this UI.

## Wallet — searched, not found as a separate app

Searched all surviving branches of `streamlinkinbox/Frontier` (14 branches), `egoistm1inbox/Frontier` (25 branches),
and the first 30 branches of `eosclient0001-rgb/Frontier` for `wallet`, `app/`, `lobby.html` paths and file contents:
no separate `wallet.html` / wallet app exists in any surviving tip tree. The only Lobby copies are:

- This Networking Lobby (`Reference/Lobby.html`, above)
- `Experimental/CabinHmi/Lobby/Lobby.html` at `c79c8d9` — procedural garage car configurator (3D, needs `Experimental/Shared`)
- `Experimental/LevelDesigner/Lobby.js` on `egoistm1inbox` branch `arena/9f5191f2-frontier` — Level Designer showroom lobby (`Serve.py` on :8096, needs `Experimental/Shared`)

The wallet/store implementation in this repo is native C++, not a web app:
`Frontier/Projects/Project-Networking/Source/XsollaStore.{h,cpp}` (Shop Builder REST + Pay Station, Nitron virtual currency packs),
plan in `Docs/XsollaStorePlan.md`. It cannot be previewed in a browser without the native host.

## Caveats (from Reference/README.md)

- EOS JavaScript is simulated; only visual structure is reusable. Do not ship simulated success messages as real SDK results.
- External font `fonts/inter-latin-wght-normal.woff2` and the Home page `index.html` from the original `app/` folder are not included upstream; the page falls back to system fonts, and `LobbyApp/index.html` here is a new landing page linking to `Lobby.html` (the Lobby page's Home tab points at it).
