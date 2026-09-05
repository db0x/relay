# Relay

[![platform](https://img.shields.io/badge/platform-docker-2496ED?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)
[![License](https://img.shields.io/badge/License-AGPL_v3-blue?style=flat-square)](LICENSE)
[![editor](https://img.shields.io/badge/editor-OnlyOffice-FF6F3D?style=flat-square)](https://www.onlyoffice.com/)
[![E2E Tests](https://img.shields.io/github/actions/workflow/status/db0x/relay/e2e.yml?branch=main&style=flat-square&logo=github&label=E2E%20Tests)](https://github.com/db0x/relay/actions/workflows/e2e.yml)

Family document server for the home network: OnlyOffice editor in the browser,
multiple users with login, per-user files and sharing between users. Auto-save
to disk, JWT-secured between backend and DocumentServer.

The name matches its sister project **Voltage** (desktop shell): Relay switches
through and passes things on — documents between family members.

## Components

- **documentserver** — OnlyOffice DocumentServer (editor engine), port `5000`.
- **backend** — small Node.js/Express service: login, file list,
  upload/download, WOPI-style integration (signed file links + JWT config +
  callback) and the file API. Web UI on port `5001`. Split by domain:
  - `app.js` — Express setup, middleware, router mounting
  - `config.js` — environment variables and constants
  - `storage.js` — path safety & filesystem (user isolation)
  - `access.js` — central authorization (`accessFor`)
  - `routes/auth.js` — login/logout/password/token (+ `loginRequired`)
  - `routes/admin.js` — user management (admins only)
  - `routes/api.js` — token-authenticated file API for sync/Voltage incl. forcesave
  - `routes/browse.js` — home page, file/folder actions, shares
  - `routes/editor.js` — OnlyOffice: `/edit`, signed `/files` links, `/callback`
  - `db.js`/`users.js`/`shares.js` (SQLite), `manage.js` (CLI),
    `views/` (EJS templates), `blank/` (empty Office templates for "New file")
- **documents/** — the files live **directly on local disk** here, one
  subfolder per user (`documents/<username>/`) with arbitrary nested folders
  inside. Everyone sees only their own files and the ones shared with them;
  files placed directly in `documents/` are invisible.
- **state/** — database (`users.db`: hashed passwords, API tokens, shares).

## First start

1. Copy `.env.example` to `.env`, set `SERVER_HOST` to this machine's LAN
   address and roll all four secrets (`openssl rand -hex 32`).
   Optionally set `INSTANCE_NAME` — that name appears in the UI instead of
   "Relay" (page title, header, login).
   Optionally set `BASE_PATH` (e.g. `/relay`) to serve Relay under a sub-path
   behind a reverse proxy, e.g. `http://moria/relay` — see
   `deploy/nginx-relay.conf.example`. All UI links, redirects and the file API
   then live under that prefix (API base becomes `<host>/relay/api/files`).
   The DocumentServer is reachable directly on port `5000` by default; to put
   it behind nginx as well (`PUBLIC_DS_URL=http://moria/ds`, only port 80
   exposed via `BIND_ADDR=127.0.0.1`), see the same example file.
2. `docker compose up -d --build`
3. On the very first start with an empty user database, Relay creates the
   admin account **`admin` with a random one-time password** and prints it
   once into the container log:
   ```bash
   docker compose logs backend | grep -A2 "Einmal-Passwort"
   ```
   (Set `ADMIN_PASSWORD` in `.env` beforehand to choose it yourself.)
4. Browser (any device on the LAN): `http://<SERVER_HOST>:5001` — log in as
   `admin` with that password. Relay then **requires** a new password before
   anything else is reachable. Afterwards create the first users via
   menu → "Nutzerverwaltung" (user management).

For an installation reachable from the internet, use
`deploy/nginx-relay-tls.conf.example` — it needs `BIND_ADDR=127.0.0.1` and
`TRUST_PROXY=1` in addition to the settings above.

Alternatively, users can still be created via CLI (prompts for the password
interactively):
```bash
docker compose exec backend node manage.js add thomas "Thomas"
```

## User management

**Admins** can create new users in the UI (menu → "Nutzerverwaltung"),
optionally with admin rights right away, grant or revoke admin rights for
other users, **lock/unlock** users, and **delete** users including all their
data (files, shares in both directions, avatar, profile — irreversible;
admins must have their rights revoked first, you cannot delete yourself). Locked means: no login, running
browser sessions end immediately, and the API token (sync/Voltage) is
blocked; the user's files and shares remain untouched.
You cannot revoke your own admin rights and you cannot lock yourself —
this prevents locking yourself out; the CLI is the fallback.
Admin and lock are mutually exclusive: admins cannot be locked (revoke the
rights first), locked users cannot become admins (unlock first) — this also
applies in the CLI.

Every row carries **one kebab menu** with the actions that apply to that user
(same pattern as a file row). Side by side they were up to five buttons that
ran out of the dialog and became unreachable; in a menu the width no longer
matters and further per-user settings fit without a rebuild. "Bibliothek" is
the one entry that also exists for your own account and for admins — see
[Shared library](#shared-library-videos-read-only).

If there are no users at all (fresh installation), Relay automatically
creates **`admin`/`admin`** as an admin on startup; after the first login,
a notice reminds you to change the password.

CLI commands (inside the running container):

```bash
docker compose exec backend node manage.js add <name> "<display name>"
docker compose exec backend node manage.js list                # [admin] marks admins
docker compose exec backend node manage.js passwd <name>
docker compose exec backend node manage.js token <name>    # API token (for sync)
docker compose exec backend node manage.js admin <name> on|off
docker compose exec backend node manage.js lock <name> on|off
docker compose exec backend node manage.js del <name>
```

Every user can change their own password, display name and an **optional
e-mail address** on the home page (menu → "Mein Konto"; password needs old +
2× new; the e-mail is format-checked client- and server-side, leaving it
empty removes it). `manage.js passwd` remains the emergency path in case
someone forgot their password.

## Avatars

Every user can upload a profile picture (menu → "Mein Konto", pencil button
on the picture; PNG/JPEG/WebP, resized server-side to 128×128 via sharp). It shows up next to the user name
on the home page and inside the editor: header, co-editing cursors, comments
and version history. Storage is one file per user in `state/avatars/`
(no DB column — file existence is the truth; deleted with the user).
The editor loads the images via **HMAC-signed URLs** (like the `/files`
links), because the editor iframe may run on a different origin where
session cookies are not sent; the other users' avatars are answered from
the embedded user list via the `onRequestUsers` API event.

## Document language for new files

The "New file" dialog offers a language picker (default: German) that sets
the **document language** of the fresh file — spellcheck works right away.
The list covers the DocumentServer's dictionary languages; the language is
patched into the copied blank template (docx/pptx) at creation time.
**Admins** can hide languages from the picker via menu → "Einstellungen"
(stored in the `settings` table in `users.db`); the German default cannot
be hidden and unknown/hidden codes are rejected server-side.

## Folders

Every user can create subfolders in their own area ("Neuer Ordner" in the
toolbar) and navigate into them by clicking (the breadcrumb bar leads back).
New files and uploads land in the currently open folder.

- **Move** — the arrow icon in a file row moves one of your own files into
  another folder (or back to the top level). Existing shares of the file
  move along with it.
- **Delete only when empty** — a folder with content must be emptied first.
- **Folders cannot be shared** — only individual files are shareable; they
  appear at the recipient's top level with their path shown.

File rows carry a type icon derived from `DOCTYPE` (so it stays in sync when a
format is added there) plus notes, images and videos. Anything Relay does not
recognise — `.iso`, `.zip`, a name without an extension — gets the neutral
`unknown.svg` rather than the text-document icon, which used to claim a type
that was not there. The same rule runs in the browser for document links inside
notes (`iconFuer` in `js/notes/doclinks.js`).

## PDF

PDFs can be uploaded (and shared) like any other file and open in the
OnlyOffice **PDF viewer** — always read-only (download and print allowed, no
editing, no save callback), regardless of share permissions. Creating and
editing remain limited to the office formats.

## Notes

Markdown notes with their own editor — the first feature that does not use
OnlyOffice. The note icon in the toolbar opens a modal editor (90% of the
viewport): **CodeMirror 5** with markdown syntax highlighting on the left,
a **live HTML preview** (50/50 split) on the right, rendered by **marked**,
sanitized with **DOMPurify** (shared notes must not inject script) and with
**highlight.js** for fenced code blocks; parser errors show up in a status
line. All four libraries are vendored locally under `public/vendor/` — the
LAN server must not depend on a CDN. The editor is prefilled with `# Titel`. Saving stores
the note as `{uuid}-{title}.md` in the user's **Notizen** folder (created on
demand); the title is the first line (leading `#` stripped). Lists and
dialogs show only the title — never the UUID (underscores render as spaces).
Clicking a note reopens the editor; if the owner changes the title line, the
file is renamed (UUID stays, shares move along). Shared notes open read-only
("Nur lesen") or editable ("Bearbeiten") accordingly. Otherwise notes are
normal files: share, move, delete, download and sync API all work unchanged.

## Shares

Every user can share their own files with other users — via the share icon
in the file row. The permission is chosen per user:

- **Edit** — real live co-editing (both in the same OnlyOffice document).
- **Read-only** — the editor opens in view mode, download allowed, saving not.

Shared files appear in the recipient's list, labeled "von *owner*" (from
*owner*). Sharing is **by reference**: the file physically stays in the
owner's folder, there is no copy.

- Revoke shares: same share icon → "entziehen" (revoke).
- **Only the owner may delete**; deleting a file removes all of its shares.
- If a user is deleted (`manage.js del`), their shares disappear as well.
- The **file API stays owner-scoped** — via `/api/files`, a token sees only
  its own files, never shared ones.

This is enforced server-side in `accessFor()` (access.js) on all browser
routes (`/edit`, `/download`, `/delete`); read-only mode is additionally baked
into the **JWT-signed** OnlyOffice config and cannot be tampered with
client-side.

## Shared library (videos, read-only)

Beside the per-user folders, Relay can show a **library that belongs to the
server** — typically a video collection on a NAS. Set `SHARED_LIB` in the
`.env` to the host path; docker-compose mounts it **read-only** (`:ro`) at
`/data/library`. Empty = no library at all.

- **Granting access** — an admin opens "Nutzerverwaltung" → per-user row menu →
  **Bibliothek**: the library's folder **tree**, indented, with a checkbox on
  every node. Folders can be granted at **any level** — all of `Doku` plus a
  single subfolder out of `fsk6`. A grant covers everything below it, so
  subfolders of a checked node are shown ticked and disabled, and a grant
  already covered by one further up is dropped on save (`nurWurzeln`). Unlike
  shares, admins can be granted access too — the library belongs to the
  server, not to a user. The tree **collapses**: it opens showing only the top
  level plus the paths leading to grants already given, so a real collection
  stays workable; a collapsed folder whose subtree contains a grant highlights
  its caret, and "Alle aufklappen" opens everything at once. Coverage is
  computed independently of what is folded away — a collapsed subtree is
  covered by a checked ancestor just the same. The tree is capped (500 nodes,
  6 levels) and cached for 60 s; the cap also bounds a symlink pointing at one
  of its own ancestors.
- **Display name** — every granted folder can get a name of its own, next to
  its checkbox: the user sees "Filme ab 6" where the filesystem says `fsk6`.
  The name belongs to the **grant, not the folder** (column `label` on
  `library_access`), so two users can see the same folder under different
  names — and renaming for one changes nothing for the other. Empty (or equal
  to the folder name) stores NULL and falls back to the filesystem name. The
  name is what shows in the file list, in the breadcrumb, and in search — both
  as the hit label and inside its "Bibliothek · …" hint, so the filesystem
  name does not leak back in through the side door. For the same reason the
  list badge drops its origin hint once a name is set.
- **In the file list** — a granted folder is also the **entry point**: it shows
  up at the top level next to the user's own folders, with a purple folder icon
  and a "Bibliothek" badge that names its place in the library when it is
  nested ("Bibliothek · fsk6") — two grants may share a name. Navigating uses
  the same `?p=` parameter with a `lib:` marker (`?p=lib:Filme/2024`), so
  breadcrumbs, sorting and the AJAX folder navigation work unchanged.
  Breadcrumbs stop at the granted folder: a crumb above it would be a dead
  click, the user has no access there.
- **Read-only, really** — there is no route that writes into the library:
  no upload, no new folder, no move, no rename, no delete. The `:ro` mount
  enforces it a second time at the kernel level.
- **Videos** play in a dialog with the browser's built-in `<video>` — no extra
  library. `res.sendFile` answers range requests, so seeking works. Formats
  come from the `VIDEO_TYPES` whitelist (mp4/m4v, webm, ogv, mov, mkv, avi);
  whether mkv/avi actually play depends on the codec, and the dialog falls back
  to a download hint when the browser cannot. The dialog header has a
  **window-size toggle**: it drops its own frame and hands the whole browser
  window to the player (aspect ratio kept — this is *not* the player's own
  fullscreen, the title bar stays). Playback starts on its own; the click on
  the file name is the user gesture browsers require for sound, and a refused
  start is caught so the play button simply stays put. Everything else in the
  library can be downloaded; images open the existing preview dialog.
- **Documents, spreadsheets, presentations and PDFs open in OnlyOffice**, in
  **view mode**, via `/lib/edit/*` — a separate path, because "lib" would be a
  valid username and `/edit/lib/...` could not be told apart from a user's
  files. The config carries `edit:false`, `mode:"view"` and, deliberately, **no
  `callbackUrl`**: without one the DocumentServer has no way to write anything
  back (the mount is read-only anyway, so a write would fail regardless). The
  DocumentServer fetches the file from `/lib/files/*` under its own HMAC
  signature (namespaced `lib:`, so a library link can never pass as a user-file
  link), served as an attachment with nosniff; that route additionally
  re-checks the path stays inside the library. The participant list stays
  empty — nothing is co-edited here, so no names end up in the page source.
  Anything else (`.zip`, a stray `.md`, …) still downloads.
- **Search** covers the library too: the app-menu search finds granted folders
  (jump into them) and their files (play/download), labeled "Bibliothek · path".
  The index per top-level folder is cached for 60 s — search runs on every
  keystroke and a media collection on a network share is expensive to walk.
  The `@`-mention list in the note editor asks with `lib=0` and leaves the
  library out: its links are owner + path, and a library file has no owner.
- Videos in a user's **own** folder (they can only get there via the file API —
  the upload dialog does not offer video formats) behave the same way.

**The library is never backed up.** "Backup ausführen" mirrors `documents/`
and `state/`; the library is a separate mount outside both, so rsync never
sees it — it is the server's, read-only, and backed up on its own level (NAS).
A symlink in a user folder does not change that either: `rsync -a` copies
symlinks as symlinks, not their target. The one configuration that *would*
break this is a `SHARED_LIB` pointing **inside** `DOCUMENTS_DIR` — the same
collection then sits in the middle of the user tree and is an ordinary folder
to rsync. `library.insideDocs()` detects it (same device + inode, which a bind
mount preserves), the backup excludes it, and the log tells the admin it
happened. What *does* get backed up is the grants table including display
names — without it a restore would lose who may see what.

Path safety here deliberately does **not** use `secureFilename`: library names
are not Relay's own and may contain umlauts, spaces and brackets. Instead
`library.js` rejects path tricks (`..`, backslash, NUL) and resolves the path
(`realpath`), verifying it stays below the resolved library root — so a symlink
inside the library cannot lead out of it.

## File API (token auth)

For sync/automation (Voltage, rclone, scripts). Authentication via the user's
API token, either as `Authorization: Bearer <token>` or `?token=<token>`.
Each token only sees its own user folder.

The database stores only the token's **SHA-256 checksum**, never the token
itself — `users.db` is mirrored to the backup target, and a token grants full
account access. Consequence: a token is shown **once**, right after it is
created (menu → "Mein Konto" → "neu erzeugen"); whoever loses it creates a new
one. `manage.js token <name>` likewise creates a new token and prints it once.

Existing installations keep working: on first start the stored plaintext
tokens are replaced by their checksum in place, so clients that already hold a
token (Voltage, rclone) continue unchanged.

| Method   | Path                       | Purpose                                       |
|----------|----------------------------|-----------------------------------------------|
| `GET`    | `/api/files`               | File list, top level (JSON, flat names)       |
| `GET`    | `/api/files?recursive=1`   | File list, recursive (relative paths)         |
| `PUT`    | `/api/files/<path>`        | Upload/overwrite (raw body)                   |
| `GET`    | `/api/files/<path>`        | Download                                      |
| `DELETE` | `/api/files/<path>`        | Delete                                        |

`<path>` may contain subfolders (`taxes/2026.xlsx`); `PUT` creates missing
folders automatically. Without `?recursive=1` the list behaves as it did
before folder support (top level only) — existing sync clients stay
compatible. Empty folders do not appear in the API.

```bash
TOKEN=$(docker compose exec -T backend node manage.js token thomas)
BASE=http://localhost:5001/api/files
curl -H "Authorization: Bearer $TOKEN" $BASE                      # list
curl -T letter.docx -H "Authorization: Bearer $TOKEN" $BASE/letter.docx   # upload
curl -H "Authorization: Bearer $TOKEN" -o letter.docx $BASE/letter.docx   # download
curl -X DELETE -H "Authorization: Bearer $TOKEN" $BASE/letter.docx        # delete
```

## Operations

```bash
docker compose logs -f backend          # shows saves (callback)
docker compose ps                        # status
docker compose down                      # stop (data survives in volumes/folders)
docker compose up -d                      # start
```

Documents live in `./documents/`, the user database in `./state/` — both
locations are configurable via `DOCUMENTS_DIR` / `STATE_DIR` in `.env`
(e.g. `/srv/relay/documents` on a server), so `docker-compose.yml` never
needs local edits. DocumentServer data (DB, cache) lives in the Docker
volumes `ds_db`, `ds_lib`, `ds_data` and survives restarts.

**Backup**: set `BACKUP` in `.env` to a host directory; it's mounted into the
backend container at `/data/backup`. Admins get a "Backup" entry in the
menu with a single "Backup ausführen" action, which mirrors `documents/`
and `state/` into it via `rsync -a --delete` (the backup directory always
matches the current state — nothing removed at the source stays in the
backup either).

## Tests

End-to-end tests (Playwright) live in `tests/` and cover **Relay's own layer**
— login/session, user management and sharing — deliberately *not* OnlyOffice
itself. They build the backend image and run it as a throwaway container with
an empty database, so no DocumentServer and no secrets are needed:

```bash
cd tests
npm install
npm test                                  # builds the image, runs, cleans up
npx playwright test sharing.spec.js       # single file
npx playwright test --headed              # watch it click
```

Useful environment variables:

| Variable | Effect |
| --- | --- |
| `RELAY_TEST_PORT` | host port of the throwaway container (default `5998`) |
| `RELAY_TEST_BASE_URL` | test an already running instance instead of starting a container |
| `RELAY_TEST_CHROMIUM` | path to an existing Chromium (skips Playwright's own download) |
| `RELAY_TEST_KEEP=1` | keep the container after the run (to inspect logs/database) |

Besides the happy paths, the suite asserts the **authorization rules** —
a user cannot reach another user's file by URL, a recipient cannot delete a
shared file, a non-admin cannot reach the admin routes. These checks bypass
the UI (`page.request`) so they verify the server, not just a hidden button.
CI runs the same suite on every push (`.github/workflows/e2e.yml`).

## Security / status

- **Login** (session cookie, valid 90 days) protects all browser routes
  (`/`, `/edit`, `/upload`, `/download`). Passwords hashed in `state/users.db`.
- The logged-in user appears in the editor — co-editing shows real names.
- **JWT active** between backend and DocumentServer (`JWT_SECRET`); tampered
  configs/callbacks are rejected.
- **Signed `/files` links** (`FILE_SECRET`, valid 12h) — the DocumentServer
  can only fetch files via URLs issued by the backend. That's why `/files` and
  `/callback` need **no** login cookie. The owner is part of the signature —
  a link never opens another user's files.
- Every user has an **API token** (`manage.js token`) for the file API,
  intended for sync (rclone, Voltage desktop).
- Secrets in `.env` are sensitive — don't share them, don't commit them.
- Intended for the **home network** only: no TLS, no protection against
  brute force from the internet. Exposing it externally would require a
  reverse proxy with HTTPS in front.

## Important implementation details (do not "clean up")

- `documentserver/local.json` is **copied into the image via the Dockerfile**,
  NOT mounted. A single-file bind mount would prevent the startup script from
  writing into it via `json -I` (temp + `mv`) → broken secrets.
- `local.json` deliberately contains the **complete `token`/`secret`
  skeleton**. The `json` tool does not create missing intermediate objects;
  without the skeleton, the startup script's JWT writes fail silently and JWT
  stays off.
- `request-filtering-agent.allowPrivateIPAddress=true`: otherwise OnlyOffice
  blocks downloads via the private Docker IPs (SSRF protection).
- `FileConverter.converter.maxDownloadBytes`: the DocumentServer default
  (100 MB) refuses to **open** larger files. `relay-entry.sh` (wrapper
  entrypoint of the DS image) writes `MAX_FILE_MB` (default 512) into
  `local.json` at container start — the same value caps the file API, so
  everything Relay can store can also be opened. The `FileConverter`
  skeleton must stay in `local.json` (`json` creates no missing objects).
- The `document.key` is based on the file's mtime: multiple open tabs share
  the same editor session; after a save, a new version begins.
- `/edit/<file>` (without owner) is a compatibility route for Voltage:
  authenticates via **API token** (`?token=`, Voltage knows no user), builds
  the login session from it, redirects to `/edit/<user>/<path>`, and if
  needed finds the file by name search in the user's own folder tree.

## License

Relay is licensed under the **GNU AGPL-3.0** (see [LICENSE](LICENSE)).
Copyright (C) 2026 db0x.

The deployment pulls in the OnlyOffice DocumentServer (Community Edition),
which is itself AGPL-3.0 licensed — Relay integrates it via its documented
API (api.js, JWT-signed config, save callbacks) and matches its license, the
same model OnlyOffice uses for its own connectors. The repository contains
no OnlyOffice source code; `documentserver/` only holds build/config files
for the official image.
