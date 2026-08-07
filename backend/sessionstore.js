// Sitzungen in SQLite statt im Arbeitsspeicher.
//
// Vorher lagen sie im MemoryStore von express-session. Drei Folgen, alle
// unangenehm, sobald Relay nicht mehr nur im Wohnzimmer steht:
//   - jeder Neustart (auch jedes `docker compose up -d --build`) meldete ALLE
//     ab, auch die Familie unterwegs,
//   - der Speicherverbrauch wuchs mit jeder je begonnenen Sitzung,
//   - eine einzelne Sitzung liess sich nicht gezielt beenden (verlorenes Handy).
//
// Bewusst KEIN connect-sqlite3: das brächte einen zweiten SQLite-Treiber mit
// nativer Kompilierung ins Image. Wir haben bereits eine Verbindung (db.js),
// und der Store-Vertrag von express-session ist klein.
const session = require("express-session");

const { db } = require("./db");

// Aufraeumen: abgelaufene Zeilen fliegen beim Start und danach stuendlich raus.
// Ohne das waere die Tabelle die neue Variante des Speicherlecks.
const AUFRAEUM_MS = 60 * 60 * 1000;

class SqliteStore extends session.Store {
  constructor() {
    super();
    db().exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid     TEXT PRIMARY KEY,
        expires INTEGER NOT NULL,
        data    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires);
    `);
    this.raeumeAuf();
    // unref: dieser Zeitgeber darf den Prozess nicht am Beenden hindern
    this.timer = setInterval(() => this.raeumeAuf(), AUFRAEUM_MS);
    if (this.timer.unref) this.timer.unref();
  }

  raeumeAuf() {
    try { db().prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now()); }
    catch (e) { console.error("Sitzungen aufraeumen fehlgeschlagen:", e.message); }
  }

  // Ablaufzeitpunkt: was im Cookie steht, sonst die Standardlaufzeit
  static ablauf(sess) {
    const c = sess && sess.cookie;
    if (c && c.expires) return new Date(c.expires).getTime();
    if (c && c.originalMaxAge) return Date.now() + c.originalMaxAge;
    return Date.now() + 90 * 24 * 3600 * 1000;
  }

  get(sid, cb) {
    try {
      const row = db().prepare("SELECT data, expires FROM sessions WHERE sid=?").get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) {
        db().prepare("DELETE FROM sessions WHERE sid=?").run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      db().prepare("INSERT INTO sessions (sid, expires, data) VALUES (?,?,?) "
        + "ON CONFLICT(sid) DO UPDATE SET expires=excluded.expires, data=excluded.data")
        .run(sid, SqliteStore.ablauf(sess), JSON.stringify(sess));
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try { db().prepare("DELETE FROM sessions WHERE sid=?").run(sid); cb(null); }
    catch (e) { cb(e); }
  }

  // touch haelt eine aktive Sitzung am Leben, ohne die Daten neu zu schreiben
  touch(sid, sess, cb) {
    try {
      db().prepare("UPDATE sessions SET expires=? WHERE sid=?")
        .run(SqliteStore.ablauf(sess), sid);
      cb(null);
    } catch (e) { cb(e); }
  }

  length(cb) {
    try { cb(null, db().prepare("SELECT COUNT(*) AS c FROM sessions").get().c); }
    catch (e) { cb(e); }
  }

  clear(cb) {
    try { db().prepare("DELETE FROM sessions").run(); cb(null); }
    catch (e) { cb(e); }
  }
}

// Alle Sitzungen EINES Nutzers beenden — fuer "überall abmelden" und fuer
// den Fall, dass ein Zugang gesperrt oder geloescht wird. Die Nutzerkennung
// steckt im JSON, deshalb der LIKE-Vergleich auf das serialisierte Feld.
function beendeSitzungenVon(username) {
  const muster = `%"user":${JSON.stringify(username)}%`;
  return db().prepare("DELETE FROM sessions WHERE data LIKE ?").run(muster).changes;
}

module.exports = { SqliteStore, beendeSitzungenVon };
