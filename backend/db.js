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
      locked       INTEGER NOT NULL DEFAULT 0,
      -- Notiz-Icons auf dem Desktop zeigen? Je Nutzer umschaltbar (Mein Konto)
      desk_notes   INTEGER NOT NULL DEFAULT 1
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

    -- Strukturierte Zusatzattribute einer Notiz (owner/filename), die bewusst
    -- nicht in der .md landen (notemeta.js). people: JSON-Array von Namen.
    CREATE TABLE IF NOT EXISTS note_meta (
      owner    TEXT NOT NULL,
      filename TEXT NOT NULL,
      is_todo  INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,
      people   TEXT,
      ort      TEXT,
      color    TEXT,   -- '#rrggbb' fuer das Notiz-Icon; NULL = Standardfarbe
      status   TEXT,   -- 'open' | 'wip' | 'closed'; NULL = 'open' (Default)
      title    TEXT,   -- Anzeigetitel MIT Emojis/Umlauten; NULL = aus dem
                       -- Dateinamen ableiten (Altbestand, siehe browse.js)
      PRIMARY KEY (owner, filename)
    );

    -- Benachrichtigungen: wer hat mir was freigegeben. Eine Zeile je Ereignis
    -- und Empfaenger (notifications.js). GELESENE werden SOFORT geloescht —
    -- es gibt bewusst kein read-Flag, die Tabelle bleibt so von selbst klein.
    CREATE TABLE IF NOT EXISTS notifications (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,   -- Empfaenger
      owner    TEXT NOT NULL,   -- wer freigegeben hat
      filename TEXT NOT NULL,   -- Pfad relativ zum Ordner des Besitzers
      perm     TEXT NOT NULL,   -- 'edit' | 'view' (zum Zeitpunkt der Freigabe)
      created  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_by_user ON notifications(username);

    -- Frei platzierbare Notiz-Icons auf der Dateiliste ("Desktop"). Position
    -- ist je BETRACHTER (username) und Notiz (owner/filename) — jeder Nutzer
    -- hat sein eigenes Layout (notemeta.js: Desktop-Funktionen).
    CREATE TABLE IF NOT EXISTS note_desktop (
      username TEXT NOT NULL,
      owner    TEXT NOT NULL,
      filename TEXT NOT NULL,
      x        REAL NOT NULL,
      y        REAL NOT NULL,
      PRIMARY KEY (username, owner, filename)
    );

    -- Frei verschiebbare UI-Elemente je Nutzer (z.B. key='page' fuer die
    -- Dokumentenliste). notemeta.js: getLayout/setLayout.
    CREATE TABLE IF NOT EXISTS desktop_layout (
      username  TEXT NOT NULL,
      key       TEXT NOT NULL,
      x         REAL NOT NULL,
      y         REAL NOT NULL,
      minimized INTEGER NOT NULL DEFAULT 0, -- eingeklappt zum Taskleisten-Icon
      PRIMARY KEY (username, key)
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
  // Schalter "Notizen auf dem Desktop" (Mein Konto). Default 1: Bestandsnutzer
  // finden ihren Desktop unveraendert vor.
  if (!cols.includes("desk_notes"))
    _db.exec("ALTER TABLE users ADD COLUMN desk_notes INTEGER NOT NULL DEFAULT 1");
  // note_meta.color kam mit den farbigen Notiz-Icons dazu, status mit dem
  // Bearbeitungsstand (Offen/In Arbeit/Erledigt). Beide vertragen NULL:
  // Altbestand liest sich als Standardfarbe bzw. als "open".
  const metaCols = _db.prepare("PRAGMA table_info(note_meta)").all().map((c) => c.name);
  if (!metaCols.includes("color"))
    _db.exec("ALTER TABLE note_meta ADD COLUMN color TEXT");
  if (!metaCols.includes("status"))
    _db.exec("ALTER TABLE note_meta ADD COLUMN status TEXT");
  // title kam dazu, weil der Dateiname nur ASCII traegt: "🎉 Geburtstag"
  // wuerde darin zu "Geburtstag". NULL = alte Notiz, Anzeige faellt auf den
  // Dateinamen zurueck.
  if (!metaCols.includes("title"))
    _db.exec("ALTER TABLE note_meta ADD COLUMN title TEXT");
  // desktop_layout.minimized kam mit dem Minimieren der Dateiliste dazu
  const layoutCols = _db.prepare("PRAGMA table_info(desktop_layout)").all().map((c) => c.name);
  if (!layoutCols.includes("minimized"))
    _db.exec("ALTER TABLE desktop_layout ADD COLUMN minimized INTEGER NOT NULL DEFAULT 0");
  return _db;
}

module.exports = { db };
