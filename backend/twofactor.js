// Zweite Stufe bei der Anmeldung: Einrichtung, Pruefung, Wiederherstellungs-
// codes und Vertrauens-Geraete. Der Algorithmus selbst steht in totp.js.
//
// Gilt nur fuer ADMINS (Entscheidung des Betreibers): Verwaltungsrechte sind
// das, was zu schuetzen ist. Normale Zugaenge bleiben bei Name + Passwort.
//
// Der Zwang haengt an ADMIN_2FA (config.js) und ist standardmaessig AUS —
// wer ihn einschaltet, ohne dass die Admins eingerichtet sind, schickt sie
// beim naechsten Anmelden auf die Einrichtungsseite (kein Aussperren).
// Ein Admin, der die zweite Stufe EINGERICHTET hat, muss sie immer
// durchlaufen, auch wenn der Zwang aus ist — sonst waere sie wertlos.
const crypto = require("crypto");

const { db } = require("./db");
const totp = require("./totp");

const TAGE_VERTRAUEN = 30;
const ANZAHL_CODES = 10;

// --- Einrichtung --------------------------------------------------------
// Das Geheimnis wird sofort verschluesselt abgelegt, aber noch NICHT aktiv:
// erst wenn der Nutzer einen gueltigen Code getippt hat, wird scharfgeschaltet.
// Ohne diese Probe koennte sich jemand aussperren, dessen App etwas anderes
// gespeichert hat als die Datenbank.
function beginneEinrichtung(username) {
  const geheimnis = totp.neuesGeheimnis();
  db().prepare("UPDATE users SET totp_secret=?, totp_active=0, totp_step=0 WHERE username=?")
    .run(totp.verschluessele(geheimnis), username);
  return geheimnis;
}

function geheimnisVon(username) {
  const row = db().prepare("SELECT totp_secret FROM users WHERE username=?").get(username);
  return row && row.totp_secret ? totp.entschluessele(row.totp_secret) : null;
}

function istAktiv(row) {
  return !!(row && row.totp_active);
}

// Probe-Code beim Einrichten: stimmt er, ist die zweite Stufe scharf.
function schliesseEinrichtungAb(username, code) {
  const geheimnis = geheimnisVon(username);
  if (!geheimnis) return null;
  const schritt = totp.pruefe(geheimnis, code);
  if (schritt === null) return null;
  db().prepare("UPDATE users SET totp_active=1, totp_step=? WHERE username=?")
    .run(schritt, username);
  return neueWiederherstellungscodes(username);
}

function schalteAb(username) {
  db().prepare("UPDATE users SET totp_secret=NULL, totp_active=0, totp_step=0 WHERE username=?")
    .run(username);
  db().prepare("DELETE FROM totp_recovery WHERE username=?").run(username);
  vergissAlleGeraete(username);
}

// --- Pruefung bei der Anmeldung -----------------------------------------
// Rueckgabe: true, wenn der Code (oder ein Wiederherstellungscode) stimmt.
function pruefeCode(username, eingabe) {
  const row = db().prepare("SELECT totp_secret, totp_step FROM users WHERE username=?").get(username);
  if (!row || !row.totp_secret) return false;
  const geheimnis = totp.entschluessele(row.totp_secret);
  if (!geheimnis) return false;
  const schritt = totp.pruefe(geheimnis, eingabe, row.totp_step || 0);
  if (schritt === null) return false;
  // benutzten Zeitschritt merken -> derselbe Code gilt kein zweites Mal
  db().prepare("UPDATE users SET totp_step=? WHERE username=?").run(schritt, username);
  return true;
}

// --- Wiederherstellungscodes --------------------------------------------
// Zehn Stueck, einmal anzeigen, nur als Hash gespeichert. Sie sind mit ~50 Bit
// Zufall lang genug, dass ein schneller Hash reicht (raten wird ausserdem von
// loginguard.js gebremst) — bcrypt waere hier nur Zierde.
function hashCode(code) {
  return crypto.createHash("sha256").update(code.toUpperCase().replace(/\s|-/g, "")).digest("hex");
}

function neueWiederherstellungscodes(username) {
  const stmt = db();
  stmt.prepare("DELETE FROM totp_recovery WHERE username=?").run(username);
  const codes = [];
  const einfuegen = stmt.prepare("INSERT INTO totp_recovery (username, code_hash) VALUES (?,?)");
  for (let i = 0; i < ANZAHL_CODES; i++) {
    // Basis32 ohne aehnlich aussehende Zeichen waere huebscher, aber die
    // Codes werden kopiert, nicht abgetippt — Zufall aus dem Alphabet reicht.
    const roh = crypto.randomBytes(6).toString("hex").toUpperCase(); // 12 Zeichen
    const code = `${roh.slice(0, 4)}-${roh.slice(4, 8)}-${roh.slice(8)}`;
    codes.push(code);
    einfuegen.run(username, hashCode(code));
  }
  return codes;
}

// Ein Wiederherstellungscode gilt genau einmal.
function verbraucheWiederherstellungscode(username, eingabe) {
  const h = hashCode(String(eingabe || ""));
  const r = db().prepare("DELETE FROM totp_recovery WHERE username=? AND code_hash=?")
    .run(username, h);
  return r.changes > 0;
}

function offeneCodes(username) {
  return db().prepare("SELECT COUNT(*) AS c FROM totp_recovery WHERE username=?")
    .get(username).c;
}

// --- Vertrauens-Geraete --------------------------------------------------
// Ein zufaelliges Merkmal im Cookie, in der Datenbank nur als Hash. So laesst
// sich ein verlorenes Geraet gezielt aussperren ("alle Geraete vergessen"),
// und ein Blick in die Datenbank verraet kein gueltiges Merkmal.
function merkeGeraet(username) {
  const merkmal = crypto.randomBytes(32).toString("base64url");
  const jetzt = Date.now();
  db().prepare("INSERT INTO trusted_devices (token_hash, username, created, expires) VALUES (?,?,?,?)")
    .run(hashCode(merkmal), username, jetzt, jetzt + TAGE_VERTRAUEN * 86400000);
  return merkmal;
}

function geraetBekannt(username, merkmal) {
  if (!merkmal) return false;
  const row = db().prepare("SELECT expires FROM trusted_devices WHERE token_hash=? AND username=?")
    .get(hashCode(String(merkmal)), username);
  if (!row) return false;
  if (row.expires < Date.now()) {
    db().prepare("DELETE FROM trusted_devices WHERE token_hash=?").run(hashCode(String(merkmal)));
    return false;
  }
  return true;
}

function vergissAlleGeraete(username) {
  return db().prepare("DELETE FROM trusted_devices WHERE username=?").run(username).changes;
}

function geraeteZahl(username) {
  return db().prepare("SELECT COUNT(*) AS c FROM trusted_devices WHERE username=? AND expires>?")
    .get(username, Date.now()).c;
}

// abgelaufene Eintraege gelegentlich wegraeumen (beim Anmelden aufgerufen)
function raeumeAuf() {
  db().prepare("DELETE FROM trusted_devices WHERE expires < ?").run(Date.now());
}

// Name des Cookies fuer das Vertrauens-Geraet und ein winziger Leser dafuer.
// Express bringt res.cookie zum Setzen mit, aber keinen Parser zum Lesen —
// cookie-parser waere fuer diese fuenf Zeilen eine Abhaengigkeit zu viel.
const KEKS = "relay_td";
function keksWert(req, name) {
  for (const teil of String(req.headers.cookie || "").split(";")) {
    const i = teil.indexOf("=");
    if (i > 0 && teil.slice(0, i).trim() === name) {
      try { return decodeURIComponent(teil.slice(i + 1).trim()); } catch (e) { return null; }
    }
  }
  return null;
}

// Eine Eingabe pruefen, ohne dass der Nutzer sagen muss, WAS er tippt:
// ein Wiederherstellungscode ist laenger als die sechs Ziffern und enthaelt
// Bindestriche. Wiederherstellungscodes werden dabei VERBRAUCHT.
// Eine Stelle fuer beide Aufrufer — die Anmeldung (routes/twofactor.js) und
// das Zuruecksetzen eines Passworts durch einen Admin (routes/admin.js);
// sonst driftet auseinander, was als zweite Stufe gilt.
function pruefeEingabe(username, eingabe) {
  const roh = String(eingabe || "").trim();
  if (!roh) return false;
  return roh.replace(/\s|-/g, "").length > totp.STELLEN
    ? verbraucheWiederherstellungscode(username, roh)
    : pruefeCode(username, roh);
}

module.exports = {
  TAGE_VERTRAUEN, ANZAHL_CODES, KEKS, keksWert, pruefeEingabe,
  beginneEinrichtung, geheimnisVon, istAktiv, schliesseEinrichtungAb, schalteAb,
  pruefeCode, neueWiederherstellungscodes, verbraucheWiederherstellungscode, offeneCodes,
  merkeGeraet, geraetBekannt, vergissAlleGeraete, geraeteZahl, raeumeAuf,
};
