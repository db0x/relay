// Nutzerdatenbank. Passwoerter gehasht (bcrypt), plus API-Token pro Nutzer.
//
// bcrypt laeuft hier durchgaengig ASYNCHRON. Das ist keine Stilfrage: mit
// Kostenfaktor 12 braucht ein Durchlauf ~250ms, und die synchrone Variante
// belegt dabei den einzigen Node-Thread. Gemessen legten 60 gleichzeitige
// Anmeldeversuche Relay ueber 16 Sekunden lang fuer ALLE lahm — ein
// Denial-of-Service, der kein einziges Passwort erraten muss.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { db } = require("./db");

const COST = 12;

// url-sicheres Zufalls-Token wie Pythons secrets.token_urlsafe(24)
function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

// In der Datenbank steht NUR die Pruefsumme, nie das Token selbst.
// Grund: users.db wird vom Backup aufs NAS gespiegelt, die .env nicht. Lagen
// die Token dort im Klartext, haette ein Blick ins Backup fuer JEDEN Nutzer
// vollen Kontozugriff bedeutet — an Passwort (bcrypt) und zweiter Stufe
// (verschluesselt) vorbei. Ein schneller Hash reicht: das Token sind 192 Bit
// Zufall, da ist nichts zu raten.
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

// mustChange: der Nutzer kommt nur bis zur Passwort-Seite, bis er ein eigenes
// Passwort gesetzt hat (routes/auth.js). Gedacht fuer den Bootstrap-Admin.
async function addUser(username, displayName, password, isAdmin = false, mustChange = false) {
  const hash = await bcrypt.hash(password, COST);
  // Es wird ein Token angelegt, aber NIEMAND kennt es (nur der Hash landet in
  // der DB). Wer die Datei-API nutzen will, erzeugt sich im Konto eines —
  // dasselbe Muster wie bei den Wiederherstellungscodes.
  db().prepare(
    "INSERT INTO users (username, display_name, pw_hash, api_token, is_admin, must_change) VALUES (?,?,?,?,?,?)"
  ).run(username, displayName, hash, hashToken(newToken()), isAdmin ? 1 : 0, mustChange ? 1 : 0);
}

// Admin-Rechte geben oder entziehen. Gesperrte Nutzer koennen keine Admins
// werden (erst entsperren) — gilt auch fuer die CLI.
function setAdmin(username, isAdmin) {
  const row = get(username);
  if (!row) throw new Error(`Unbekannter Nutzer: ${username}`);
  if (isAdmin && row.locked)
    throw new Error(`'${username}' ist gesperrt — erst entsperren, dann Admin machen.`);
  db().prepare("UPDATE users SET is_admin=? WHERE username=?")
    .run(isAdmin ? 1 : 0, username);
  // Verwaltungszugaenge haben KEIN API-Token: ein Token ist ein vollwertiger
  // Kontozugang ohne Passwort und ohne zweite Stufe — genau das, was bei einem
  // Admin nicht sein darf. Beim Ernennen wird ein vorhandenes deshalb
  // verworfen (ersetzt durch die Pruefsumme eines Zufallswerts, den niemand
  // kennt; die Spalte ist NOT NULL UNIQUE).
  if (isAdmin) {
    db().prepare("UPDATE users SET api_token=? WHERE username=?")
      .run(hashToken(newToken()), username);
  }
}

// Nutzer sperren/entsperren: gesperrt = kein Login, keine Session, kein API-Token.
// Admins koennen nicht gesperrt werden (erst Admin-Rechte entziehen) — auch per CLI.
function setLocked(username, locked) {
  const row = get(username);
  if (!row) throw new Error(`Unbekannter Nutzer: ${username}`);
  if (locked && row.is_admin)
    throw new Error(`'${username}' ist Admin — erst die Admin-Rechte entziehen, dann sperren.`);
  db().prepare("UPDATE users SET locked=? WHERE username=?")
    .run(locked ? 1 : 0, username);
}

// Nutzerzeile, wenn Name+Passwort stimmen, sonst null.
// Auch fuer einen unbekannten Namen wird ein Hash geprueft (gegen einen
// Wegwerf-Hash), damit die Antwortzeit nicht verraet, ob es den Zugang gibt.
const DUMMY_HASH = bcrypt.hashSync("nicht-vergeben", 10);
async function verify(username, password) {
  const row = db().prepare("SELECT * FROM users WHERE username=?").get(username);
  const ok = await bcrypt.compare(password || "", row ? row.pw_hash : DUMMY_HASH);
  return row && ok ? row : null;
}

function get(username) {
  return db().prepare("SELECT * FROM users WHERE username=?").get(username) || null;
}

// Nutzerzeile zum API-Token, sonst null. Fuer die Sync-/Datei-API.
// Verglichen wird die Pruefsumme — das Token selbst steht nirgends.
function getByToken(token) {
  if (!token) return null;
  return db().prepare("SELECT * FROM users WHERE api_token=?").get(hashToken(token)) || null;
}

// Wuerfelt ein neues API-Token, macht das alte damit ungueltig.
// Erzeugt ein neues Token, legt seinen Hash ab und gibt es EINMAL im Klartext
// zurueck. Der Aufrufer muss es dem Nutzer zeigen — ein zweites Mal gibt es
// das nicht.
function resetToken(username) {
  const tok = newToken();
  const r = db().prepare("UPDATE users SET api_token=? WHERE username=?")
    .run(hashToken(tok), username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
  return tok;
}

// Setzt das Passwort und loescht damit zugleich den Zwang, es zu aendern.
async function setPassword(username, password) {
  const hash = await bcrypt.hash(password, COST);
  const r = db().prepare("UPDATE users SET pw_hash=?, must_change=0 WHERE username=?")
    .run(hash, username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
}

function setDisplayName(username, displayName) {
  const r = db().prepare("UPDATE users SET display_name=? WHERE username=?")
    .run(displayName, username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
}

// optionale E-Mail-Adresse; null loescht sie wieder
// Notiz-Icons auf dem Desktop ein-/ausschalten (je Nutzer, Mein Konto)
function setDeskNotes(username, on) {
  db().prepare("UPDATE users SET desk_notes=? WHERE username=?").run(on ? 1 : 0, username);
}

function setEmail(username, email) {
  const r = db().prepare("UPDATE users SET email=? WHERE username=?")
    .run(email, username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
}

function del(username) {
  const r = db().prepare("DELETE FROM users WHERE username=?").run(username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
  // Freigaben des/an den Nutzer mit entfernen, sonst bleiben Karteileichen
  db().prepare("DELETE FROM shares WHERE owner=? OR target=?").run(username, username);
  require("./avatars").remove(username); // lazy: vermeidet Zyklus beim Modul-Laden
}

function listUsers() {
  return db().prepare(
    "SELECT username, display_name, is_admin, locked FROM users ORDER BY display_name").all();
}

// Bootstrap: gibt es ueberhaupt keinen Nutzer (Erstinstallation oder alle
// geloescht), wird ein Admin-Zugang angelegt, damit man sich anmelden und die
// ersten Nutzer erzeugen kann.
//
// Das Passwort ist ZUFAELLIG und steht einmalig im Container-Log. Frueher war
// es "admin" — eine bekannte Vorgabe ist im Internet keine Huerde, sondern die
// erste Kombination, die jeder Scanner probiert. Zusaetzlich steht der Zugang
// auf must_change: bis ein eigenes Passwort gesetzt ist, kommt er nur bis zur
// Passwort-Seite.
//
// ADMIN_PASSWORD setzt das Passwort stattdessen fest (Erstinstallation per
// .env, automatisierte Tests). Dann ist es eine bewusste Wahl des Betreibers
// und der Aenderungszwang entfaellt.
async function bootstrap() {
  if (db().prepare("SELECT COUNT(*) AS c FROM users").get().c > 0) return;
  const fest = process.env.ADMIN_PASSWORD || "";
  const pw = fest || crypto.randomBytes(18).toString("base64url");
  await addUser("admin", "Admin", pw, true, !fest);
  if (fest) {
    console.log('Kein Nutzer vorhanden — Admin "admin" mit dem Passwort aus ADMIN_PASSWORD angelegt.');
  } else {
    console.log("\n" + "=".repeat(66));
    console.log('  Kein Nutzer vorhanden — Admin-Zugang "admin" angelegt.');
    console.log(`  Einmal-Passwort: ${pw}`);
    console.log("  Beim ersten Anmelden muss ein eigenes Passwort gesetzt werden.");
    console.log("=".repeat(66) + "\n");
  }
}
// Beim Modul-Laden angestossen; app.js wartet darauf (ready), bevor es lauscht.
const ready = bootstrap();

module.exports = {
  ready, hashToken,
  addUser, setAdmin, setLocked, verify, get, getByToken, resetToken, setPassword,
  setDisplayName, setEmail, setDeskNotes, del, listUsers,
};
