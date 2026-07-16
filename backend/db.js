// Gemeinsame SQLite-Verbindung + Schema. users.js und shares.js teilen sich diese
// eine Verbindung (eine Datei: /data/state/users.db).
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const STATE_DIR = process.env.STATE_DIR || "/data/state";
const DB_PATH = path.join(STATE_DIR, "users.db");

let _db = null;

function db() {
  if (_db) return _db;
  fs.mkdirSync(STATE_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      username     TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      pw_hash      TEXT NOT NULL,
      api_token    TEXT NOT NULL UNIQUE,
      is_admin     INTEGER NOT NULL DEFAULT 0,
      locked       INTEGER NOT NULL DEFAULT 0
    );

    -- Freigabe einer Datei (owner/filename) an einen anderen Nutzer (target).
    -- perm: 'edit' = Bearbeiten (Live-Co-Editing), 'view' = nur lesen.
    CREATE TABLE IF NOT EXISTS shares (
      owner    TEXT NOT NULL,
      filename TEXT NOT NULL,
      target   TEXT NOT NULL,
      perm     TEXT NOT NULL CHECK (perm IN ('edit','view')),
      created  INTEGER NOT NULL,
      PRIMARY KEY (owner, filename, target)
    );
    CREATE INDEX IF NOT EXISTS shares_by_target ON shares(target);

    -- App-weite Einstellungen (Admin-Dialog), Werte JSON-kodiert (settings.js)
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Migration fuer Bestands-Datenbanken: is_admin und locked kamen spaeter dazu
  const cols = _db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("is_admin"))
    _db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("locked"))
    _db.exec("ALTER TABLE users ADD COLUMN locked INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("email"))
    _db.exec("ALTER TABLE users ADD COLUMN email TEXT"); // optional, NULL = nicht gepflegt
  return _db;
}

module.exports = { db };
