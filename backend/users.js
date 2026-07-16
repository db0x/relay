// Nutzerdatenbank. Passwoerter gehasht (bcrypt), plus API-Token pro Nutzer.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { db } = require("./db");

// url-sicheres Zufalls-Token wie Pythons secrets.token_urlsafe(24)
function newToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function addUser(username, displayName, password, isAdmin = false) {
  db().prepare(
    "INSERT INTO users (username, display_name, pw_hash, api_token, is_admin) VALUES (?,?,?,?,?)"
  ).run(username, displayName, bcrypt.hashSync(password, 12), newToken(), isAdmin ? 1 : 0);
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

// Nutzerzeile, wenn Name+Passwort stimmen, sonst null
function verify(username, password) {
  const row = db().prepare("SELECT * FROM users WHERE username=?").get(username);
  if (row && bcrypt.compareSync(password, row.pw_hash)) return row;
  return null;
}

function get(username) {
  return db().prepare("SELECT * FROM users WHERE username=?").get(username) || null;
}

// Nutzerzeile zum API-Token, sonst null. Fuer die Sync-/Datei-API.
function getByToken(token) {
  if (!token) return null;
  return db().prepare("SELECT * FROM users WHERE api_token=?").get(token) || null;
}

// Wuerfelt ein neues API-Token, macht das alte damit ungueltig.
function resetToken(username) {
  const tok = newToken();
  const r = db().prepare("UPDATE users SET api_token=? WHERE username=?").run(tok, username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
  return tok;
}

function setPassword(username, password) {
  const r = db().prepare("UPDATE users SET pw_hash=? WHERE username=?")
    .run(bcrypt.hashSync(password, 12), username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
}

function setDisplayName(username, displayName) {
  const r = db().prepare("UPDATE users SET display_name=? WHERE username=?")
    .run(displayName, username);
  if (r.changes === 0) throw new Error(`Unbekannter Nutzer: ${username}`);
}

// optionale E-Mail-Adresse; null loescht sie wieder
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
// geloescht), wird "admin" mit Passwort "admin" als Admin angelegt, damit man
// sich einloggen und die ersten Nutzer anlegen kann. Passwort danach aendern!
if (db().prepare("SELECT COUNT(*) AS c FROM users").get().c === 0) {
  addUser("admin", "Admin", "admin", true);
  console.log('Kein Nutzer vorhanden — Standard-Admin "admin" (Passwort "admin") angelegt.');
}

module.exports = {
  addUser, setAdmin, setLocked, verify, get, getByToken, resetToken, setPassword,
  setDisplayName, setEmail, del, listUsers,
};
