// Gemeinsame SQLite-Verbindung + Schema. users.js und shares.js teilen sich diese
// eine Verbindung (eine Datei: /data/state/users.db).
const crypto = require("crypto");
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
      desk_notes   INTEGER NOT NULL DEFAULT 1,
      -- Zugang muss erst ein eigenes Passwort bekommen (Bootstrap-Admin):
      -- solange gesetzt, fuehrt jede Seite zur Passwort-Aenderung
      must_change  INTEGER NOT NULL DEFAULT 0,
      -- zweite Stufe bei der Anmeldung (nur Admins, siehe twofactor.js).
      -- Das Geheimnis liegt VERSCHLUESSELT hier (AES-GCM, Schluessel aus der
      -- .env) — das Backup spiegelt diese Datei aufs NAS, die .env nicht.
      totp_secret  TEXT,
      totp_active  INTEGER NOT NULL DEFAULT 0,
      -- zuletzt benutzter 30-Sekunden-Schritt: derselbe Code gilt kein zweites Mal
      totp_step    INTEGER NOT NULL DEFAULT 0
    );

    -- Wiederherstellungscodes, nur als Hash. Ein Code verschwindet beim
    -- Einloesen (DELETE) — dadurch gilt jeder genau einmal.
    CREATE TABLE IF NOT EXISTS totp_recovery (
      username  TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      PRIMARY KEY (username, code_hash)
    );

    -- "Diesem Geraet 30 Tage vertrauen": Merkmal im Cookie, hier nur der Hash.
    CREATE TABLE IF NOT EXISTS trusted_devices (
      token_hash TEXT PRIMARY KEY,
      username   TEXT NOT NULL,
      created    INTEGER NOT NULL,
      expires    INTEGER NOT NULL
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

    -- Leserecht auf einen Ordner der geteilten Bibliothek (library.js).
    -- folder ist IMMER ein Ordner der obersten Ebene unterhalb von
    -- SHARED_LIB; das Recht gilt fuer alles darunter. Bewusst keine
    -- Fremdschluessel auf users: geloescht wird ueber users.del mit.
    CREATE TABLE IF NOT EXISTS library_access (
      username TEXT NOT NULL,
      folder   TEXT NOT NULL,
      -- abweichender Anzeigename fuer DIESEN Nutzer; NULL = so heissen wie im
      -- Dateisystem. Entkoppelt die Ablage von dem, was der Nutzer sieht.
      label    TEXT,
      PRIMARY KEY (username, folder)
    );

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
  // must_change: Zugang muss erst ein eigenes Passwort bekommen (Bootstrap-Admin).
  // Default 0 — Bestandsnutzer sind davon nicht betroffen.
  if (!cols.includes("must_change"))
    _db.exec("ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0");
  // zweite Stufe kam mit dem Internet-Betrieb dazu
  if (!cols.includes("totp_secret"))
    _db.exec("ALTER TABLE users ADD COLUMN totp_secret TEXT");
  if (!cols.includes("totp_active"))
    _db.exec("ALTER TABLE users ADD COLUMN totp_active INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("totp_step"))
    _db.exec("ALTER TABLE users ADD COLUMN totp_step INTEGER NOT NULL DEFAULT 0");
  // API-Token lagen frueher im KLARTEXT in dieser Datei — und die wird vom
  // Backup aufs NAS gespiegelt. Bestandstoken werden hier einmalig durch ihre
  // Pruefsumme ersetzt; dadurch gelten sie WEITER (der Client schickt
  // unveraendert denselben Wert), sind aber aus der Datei nicht mehr ablesbar.
  // Erkennungsmerkmal: ein Hash ist 64 Hex-Zeichen, ein Token 32 base64url.
  const roheToken = _db.prepare("SELECT username, api_token FROM users").all()
    .filter((r) => r.api_token && !/^[0-9a-f]{64}$/.test(r.api_token));
  if (roheToken.length) {
    const setzen = _db.prepare("UPDATE users SET api_token=? WHERE username=?");
    for (const r of roheToken) {
      setzen.run(crypto.createHash("sha256").update(r.api_token).digest("hex"), r.username);
    }
    console.log(`API-Token von ${roheToken.length} Nutzer(n) auf Pruefsummen umgestellt `
      + "— bestehende Token gelten unveraendert weiter.");
  }

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
  // library_access.label kam mit den abweichenden Anzeigenamen dazu.
  // NULL vertraegt sich mit dem Altbestand: dort steht weiter der Ordnername.
  const libCols = _db.prepare("PRAGMA table_info(library_access)").all().map((c) => c.name);
  if (libCols.length && !libCols.includes("label"))
    _db.exec("ALTER TABLE library_access ADD COLUMN label TEXT");
  // desktop_layout.minimized kam mit dem Minimieren der Dateiliste dazu
  const layoutCols = _db.prepare("PRAGMA table_info(desktop_layout)").all().map((c) => c.name);
  if (!layoutCols.includes("minimized"))
    _db.exec("ALTER TABLE desktop_layout ADD COLUMN minimized INTEGER NOT NULL DEFAULT 0");
  return _db;
}

module.exports = { db };
