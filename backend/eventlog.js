// Ereignisprotokoll: wer hat sich wann von wo angemeldet, was hat ein Admin
// getan, welche Freigabe wurde erteilt.
//
// Vorher gab es davon nichts. Solange Relay im Wohnzimmer stand, war das
// verschmerzbar; seit die Anmeldemaske im Internet steht, fehlte damit die
// Antwort auf zwei Fragen: "rüttelt jemand an der Tür?" und, nach einem
// Vorfall, "was ist passiert?". Ausserdem hat fail2ban ohne Protokoll nichts,
// woran es ansetzen koennte.
//
// Geschrieben wird an ZWEI Stellen, mit Absicht:
//   - eine Zeile nach stdout: landet in `docker compose logs` bzw. im
//     Journal, ist greppbar und ueberlebt auch das Loeschen der Datenbank.
//   - eine Zeile in SQLite: der Admin-Dialog kann sie zeigen, ohne dass
//     jemand auf den Server muss.
//
// WICHTIG: Hier landen NIEMALS Geheimnisse. Keine Passwoerter, keine
// API-Token, keine TOTP-Codes, keine Query-Strings. Wer das Protokoll
// erweitert, prueft das mit.
const { db } = require("./db");
const { zoneVon } = require("./zone");

// Wie lange wird aufbewahrt? 180 Tage sind lang genug, um einen Vorfall
// aufzuarbeiten, und kurz genug, dass die Datei nicht unbegrenzt waechst.
const TAGE = 180;
const AUFRAEUM_MS = 24 * 60 * 60 * 1000;

let bereit = false;
function vorbereiten() {
  if (bereit) return;
  db().exec(`
    CREATE TABLE IF NOT EXISTS events (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      at       INTEGER NOT NULL,
      art      TEXT NOT NULL,     -- 'login.ok', 'login.fail', 'admin.user.create', ...
      username TEXT,              -- Betroffener bzw. Handelnder, wenn bekannt
      ip       TEXT,
      zone     TEXT,              -- 'lan' | 'wan'
      detail   TEXT               -- kurze Klartextergaenzung, nie Geheimnisse
    );
    CREATE INDEX IF NOT EXISTS events_by_time ON events(at);
  `);
  bereit = true;
  raeumeAuf();
  const t = setInterval(raeumeAuf, AUFRAEUM_MS);
  if (t.unref) t.unref();
}

function raeumeAuf() {
  try {
    db().prepare("DELETE FROM events WHERE at < ?").run(Date.now() - TAGE * 86400000);
  } catch (e) { /* Protokollpflege darf nie den Betrieb stoeren */ }
}

// req ist optional — die CLI (manage.js) hat keinen.
function notiere(art, req, username, detail = "") {
  try {
    vorbereiten();
    const jetzt = Date.now();
    const ip = req ? String(req.ip || "") : "";
    const zone = req ? zoneVon(req) : "";
    db().prepare("INSERT INTO events (at, art, username, ip, zone, detail) VALUES (?,?,?,?,?,?)")
      .run(jetzt, art, username || null, ip, zone, String(detail).slice(0, 300));
    // eine Zeile, feste Reihenfolge — so laesst sie sich greppen und von
    // fail2ban lesen
    console.log(`[relay] ${new Date(jetzt).toISOString()} ${art}`
      + ` user=${username || "-"} ip=${ip || "-"} zone=${zone || "-"}`
      + (detail ? ` detail=${JSON.stringify(String(detail).slice(0, 300))}` : ""));
  } catch (e) {
    // Ein kaputtes Protokoll darf keine Anmeldung verhindern
    console.error("Ereignis konnte nicht protokolliert werden:", e.message);
  }
}

// Die letzten Eintraege fuer den Admin-Dialog.
function letzte(anzahl = 200) {
  vorbereiten();
  return db().prepare("SELECT at, art, username, ip, zone, detail FROM events "
    + "ORDER BY at DESC LIMIT ?").all(Math.min(Math.max(1, anzahl), 1000));
}

function zaehleSeit(art, msZurueck) {
  vorbereiten();
  return db().prepare("SELECT COUNT(*) AS c FROM events WHERE art=? AND at>?")
    .get(art, Date.now() - msZurueck).c;
}

module.exports = { notiere, letzte, zaehleSeit, TAGE };
