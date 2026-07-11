# Relay

Family document server for the home network: OnlyOffice editor in the browser,
multiple users with login, per-user files and sharing between users. Auto-save
to disk, JWT-secured between backend and DocumentServer.

The name matches its sister project **Voltage** (desktop shell): Relay switches
through and passes things on — documents between family members.

## Components

- **documentserver** — OnlyOffice DocumentServer (editor engine), port `8080`.
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

1. In `.env`, set `SERVER_HOST` to this machine's LAN address and review the
   secrets (fresh installation: roll all four secrets anew).
   Optionally set `INSTANCE_NAME` — that name appears in the UI instead of
   "Relay" (page title, header, login).
2. `docker compose up -d --build`
3. Browser (any device on the LAN): `http://<SERVER_HOST>:5001` — with an empty
   user database, the user **`admin` with password `admin`** exists (with admin
   rights). Log in with it, **change the password immediately**, and create the
   first users via menu → "Nutzerverwaltung" (user management).

Alternatively, users can still be created via CLI (prompts for the password
interactively):
```bash
docker compose exec backend node manage.js add thomas "Thomas"
```

## User management

**Admins** can create new users in the UI (menu → "Nutzerverwaltung"),
optionally with admin rights right away, grant or revoke admin rights for
other users, and **lock/unlock** users. Locked means: no login, running
browser sessions end immediately, and the API token (sync/Voltage) is
blocked; the user's files and shares remain untouched.
You cannot revoke your own admin rights and you cannot lock yourself —
this prevents locking yourself out; the CLI is the fallback.
Admin and lock are mutually exclusive: admins cannot be locked (revoke the
rights first), locked users cannot become admins (unlock first) — this also
applies in the CLI.

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

Every user can change their own password on the home page ("Passwort ändern",
old + 2× new password). `manage.js passwd` remains the emergency path in case
someone forgot their password.

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

## File API (token auth)

For sync/automation (Voltage, rclone, scripts). Authentication via the user's
API token, either as `Authorization: Bearer <token>` or `?token=<token>`.
Each token only sees its own user folder.

Every user finds their token after login on the **home page** under
"API-Token" (with copy and "regenerate" buttons). `manage.js token <name>`
remains the admin path.

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

Documents live in `./documents/`, the user database in `./state/`.
DocumentServer data (DB, cache) lives in the Docker volumes `ds_db`,
`ds_lib`, `ds_data` and survives restarts.

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
- The `document.key` is based on the file's mtime: multiple open tabs share
  the same editor session; after a save, a new version begins.
- `/edit/<file>` (without owner) is a compatibility route for Voltage:
  authenticates via **API token** (`?token=`, Voltage knows no user), builds
  the login session from it, redirects to `/edit/<user>/<path>`, and if
  needed finds the file by name search in the user's own folder tree.
