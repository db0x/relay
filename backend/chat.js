// Chat: Textnachrichten von Person zu Person, ENDE-ZU-ENDE verschluesselt.
//
// Die wichtigste Aussage ueber dieses Modul ist, was es NICHT tut: es sieht
// keinen einzigen Nachrichtentext. Der Browser des Absenders verschluesselt,
// der Browser des Empfaengers entschluesselt (public/js/chat/crypto.js); hier
// liegen nur `iv` und `ct` als undurchsichtige base64-Zeichenketten.
//
// Verfahren (der Vollstaendigkeit halber, umgesetzt ist es im Browser):
//   * Jeder Nutzer hat ein ECDH-Schluesselpaar (P-256, WebCrypto).
//     Der oeffentliche Teil steht im Klartext in chat_keys — er ist zum
//     Verteilen da. Der private Teil liegt dort NUR umhuellt: AES-GCM mit
//     einem Schluessel, den der Browser per PBKDF2 aus dem Anmeldepasswort
//     ableitet. Der Server kennt das Passwort nicht (bcrypt) und kann die
//     Huelle darum nicht oeffnen.
//   * Fuer ein Gespraech leiten beide Seiten aus ihrem privaten und dem
//     oeffentlichen Schluessel des Gegenuebers DENSELBEN Sitzungsschluessel ab
//     (ECDH ist symmetrisch). Ein Chiffrat genuegt damit fuer beide — es muss
//     nichts doppelt verschluesselt werden.
//
// Was der Server zwangslaeufig sieht: WER wem WANN geschrieben hat und wie
// lang die Nachricht ungefaehr war. Das braucht er zum Zustellen. Was er nicht
// sieht: den Inhalt. Auch nicht, wer die users.db aus dem NAS-Backup zieht.
//
// Zustellung in Echtzeit laeuft ueber Server-Sent Events (siehe abonniere()):
// jede offene Sitzung haelt eine GET-Verbindung, neue Nachrichten werden
// hineingeschrieben. Faellt sie aus, holt der Browser den Rest ueber
// `seit(id)` nach — die fortlaufende id ist die einzige Wahrheit ueber die
// Reihenfolge.
const { db } = require("./db");

// Groesse einer Nachricht. Gemessen wird das CHIFFRAT (base64) — der Server
// kennt ja nichts anderes. AES-GCM haengt 16 Byte Pruefsumme an, base64
// blaeht um ein Drittel: ~8000 Zeichen sind also grob 5900 Zeichen Text.
// Grosszuegig fuer einen Chat und trotzdem eine harte Grenze gegen jemanden,
// der die Datenbank als Ablage missbrauchen will.
const MAX_CT = 8000;
const MAX_IV = 32;

// --- Schluessel --------------------------------------------------------

function keysFor(username) {
  return db().prepare(
    "SELECT username, pub_jwk, priv_iv, priv_ct, kdf, created FROM chat_keys WHERE username=?"
  ).get(username) || null;
}

// Nur der oeffentliche Teil — das ist alles, was ein Gespraechspartner braucht.
function publicKeyFor(username) {
  const row = db().prepare("SELECT pub_jwk FROM chat_keys WHERE username=?").get(username);
  return row ? row.pub_jwk : null;
}

// Schluesselpaar hinterlegen. ERSETZT ein vorhandenes nur, wenn der Aufrufer
// das ausdruecklich will (routes/chat.js verlangt dafuer ein eigenes Flag):
// mit dem alten privaten Schluessel wird der gesamte bisherige Verlauf
// unlesbar, das darf nicht aus Versehen passieren.
function setKeys(username, pubJwk, privIv, privCt, kdf) {
  db().prepare(
    `INSERT INTO chat_keys (username, pub_jwk, priv_iv, priv_ct, kdf, created)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(username) DO UPDATE SET
       pub_jwk=excluded.pub_jwk, priv_iv=excluded.priv_iv,
       priv_ct=excluded.priv_ct, kdf=excluded.kdf, created=excluded.created`
  ).run(username, pubJwk, privIv, privCt, kdf, Date.now());
}

// Nur die Huelle erneuern (Passwortwechsel): derselbe private Schluessel,
// neu umhuellt mit dem aus dem NEUEN Passwort abgeleiteten Schluessel. Der
// oeffentliche Teil bleibt, alle bisherigen Nachrichten bleiben lesbar.
// Gibt false zurueck, wenn der Nutzer (noch) gar keine Schluessel hat.
function rewrap(username, privIv, privCt, kdf) {
  return db().prepare(
    "UPDATE chat_keys SET priv_iv=?, priv_ct=?, kdf=? WHERE username=?"
  ).run(privIv, privCt, kdf, username).changes > 0;
}

// --- Nachrichten -------------------------------------------------------

// Der Server prueft, was er pruefen KANN: Laenge und Form der beiden base64-
// Felder. Ob der Inhalt sinnvoll ist, weiss nur der Empfaenger — das ist der
// Preis (und der Sinn) der Ende-zu-Ende-Verschluesselung.
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function gueltigesChiffrat(iv, ct) {
  return typeof iv === "string" && typeof ct === "string"
    && iv.length > 0 && iv.length <= MAX_IV && B64_RE.test(iv)
    && ct.length > 0 && ct.length <= MAX_CT && B64_RE.test(ct);
}

function add(sender, recipient, iv, ct) {
  const created = Date.now();
  const r = db().prepare(
    "INSERT INTO chat_messages (sender, recipient, iv, ct, created) VALUES (?,?,?,?,?)"
  ).run(sender, recipient, iv, ct, created);
  return { id: r.lastInsertRowid, from: sender, to: recipient, iv, ct, created };
}

// Verlauf eines Gespraechs, aufsteigend (aelteste zuerst — so wird es auch
// angezeigt). `since` holt nur das Neuere nach; `limit` begrenzt das erste
// Laden, damit ein langer Verlauf die Seite nicht ausbremst.
function conversation(me, peer, since = 0, limit = 200) {
  const rows = db().prepare(
    `SELECT id, sender, recipient, iv, ct, created, read_at
       FROM chat_messages
      WHERE ((sender=? AND recipient=?) OR (sender=? AND recipient=?))
        AND id > ?
      ORDER BY id DESC LIMIT ?`
  ).all(me, peer, peer, me, since, limit);
  // DESC + LIMIT holt die NEUESTEN; angezeigt wird aufsteigend
  return rows.reverse().map(zeile);
}

function zeile(r) {
  return {
    id: r.id, from: r.sender, to: r.recipient,
    iv: r.iv, ct: r.ct, created: r.created,
    read: r.read_at != null,
  };
}

// Alles, was mich betrifft und neuer ist als `since` — ueber ALLE Gespraeche.
// Gebraucht, wenn der Live-Strom abgerissen war: der Browser meldet die
// zuletzt gesehene id und bekommt genau die Luecke zurueck.
function sinceFor(me, since, limit = 500) {
  return db().prepare(
    `SELECT id, sender, recipient, iv, ct, created, read_at
       FROM chat_messages
      WHERE (sender=? OR recipient=?) AND id > ?
      ORDER BY id ASC LIMIT ?`
  ).all(me, me, since, limit).map(zeile);
}

// Ungelesenes je Absender: {username: anzahl}. Grundlage fuer den Punkt an
// der Kontaktzeile und fuer die Glocke.
function unreadBySender(me) {
  const out = {};
  db().prepare(
    "SELECT sender, COUNT(*) AS n FROM chat_messages WHERE recipient=? AND read_at IS NULL GROUP BY sender"
  ).all(me).forEach((r) => { out[r.sender] = r.n; });
  return out;
}

function unreadTotal(me) {
  return db().prepare(
    "SELECT COUNT(*) AS n FROM chat_messages WHERE recipient=? AND read_at IS NULL"
  ).get(me).n;
}

// Gespraech als gelesen markieren. Wirkt NUR auf Nachrichten AN mich — sonst
// koennte man den Lesestand des Gegenuebers setzen.
function markRead(me, peer) {
  return db().prepare(
    "UPDATE chat_messages SET read_at=? WHERE recipient=? AND sender=? AND read_at IS NULL"
  ).run(Date.now(), me, peer).changes;
}

// Wann zuletzt etwas zwischen mir und wem lief — die Kontaktliste sortiert
// danach, damit das aktive Gespraech oben steht.
function lastActivity(me) {
  const out = {};
  db().prepare(
    `SELECT CASE WHEN sender=? THEN recipient ELSE sender END AS peer,
            MAX(created) AS last
       FROM chat_messages WHERE sender=? OR recipient=? GROUP BY peer`
  ).all(me, me, me).forEach((r) => { out[r.peer] = r.last; });
  return out;
}

// Neues Schluesselpaar -> alles Alte ist unlesbar. Die Chiffrate stehen zu
// lassen hiesse, dem Nutzer dauerhaft Zeilen anzuzeigen, die niemand mehr
// oeffnen kann. Betrifft BEIDE Richtungen: auch was er bekommen hat.
function clearMessages(username) {
  return db().prepare("DELETE FROM chat_messages WHERE sender=? OR recipient=?")
    .run(username, username).changes;
}

// Nutzer geloescht: seine Schluessel und alles, was er geschrieben oder
// bekommen hat. Ohne das blieben Chiffrate liegen, die niemand mehr oeffnen
// kann — und der Name taucht weiter in fremden Verlaeufen auf.
function removeForUser(username) {
  db().prepare("DELETE FROM chat_keys WHERE username=?").run(username);
  db().prepare("DELETE FROM chat_messages WHERE sender=? OR recipient=?")
    .run(username, username);
}

// --- Live-Zustellung (Server-Sent Events) ------------------------------
//
// Je Nutzer koennen mehrere Verbindungen offen sein (mehrere Geraete, mehrere
// Tabs). Darum eine Menge je Name statt einer einzelnen Antwort.
const strome = new Map();

// Haelt die Antwort offen und traegt sie ein. Rueckgabe: die Funktion zum
// Aufraeumen (routes/chat.js haengt sie an req "close").
function abonniere(username, res) {
  let menge = strome.get(username);
  if (!menge) { menge = new Set(); strome.set(username, menge); }
  menge.add(res);
  return function abbestellen() {
    const m = strome.get(username);
    if (!m) return;
    m.delete(res);
    if (m.size === 0) strome.delete(username);
  };
}

// Ein Ereignis an alle offenen Verbindungen EINES Nutzers.
// Schreiben kann fehlschlagen (Verbindung schon tot, ohne dass "close" bei uns
// angekommen ist) — dann fliegt sie hier heraus.
// `id` (optional) landet als SSE-Feld im Block. Nur Nachrichten tragen eine:
// beim automatischen Neuverbinden schickt der Browser die zuletzt gesehene als
// Last-Event-ID zurueck, und genau ab dort wird nachgeliefert.
function sende(username, event, daten, id) {
  const menge = strome.get(username);
  if (!menge || menge.size === 0) return 0;
  const block = (id != null ? `id: ${id}\n` : "")
    + `event: ${event}\ndata: ${JSON.stringify(daten)}\n\n`;
  let n = 0;
  for (const res of [...menge]) {
    try { res.write(block); n += 1; } catch (e) { menge.delete(res); }
  }
  return n;
}

// Neue Nachricht: an den Empfaenger UND zurueck an den Absender. Letzteres
// ist kein Luxus — der Absender kann an mehreren Geraeten angemeldet sein und
// soll seinen eigenen Text ueberall sehen.
function verteile(msg) {
  sende(msg.to, "msg", msg, msg.id);
  if (msg.to !== msg.from) sende(msg.from, "msg", msg, msg.id);
}

// Der Empfaenger hat gelesen -> dem Absender Bescheid geben (Haken in der UI).
function verteileGelesen(leser, peer, bis) {
  sende(peer, "read", { peer: leser, upto: bis });
  sende(leser, "read-self", { peer });
}

// Zeilenkommentar als Herzschlag: haelt die Verbindung durch Proxys mit
// Leerlauf-Zeitgrenze offen und bemerkt tote Gegenstellen.
function herzschlag() {
  for (const [, menge] of strome) {
    for (const res of [...menge]) {
      try { res.write(": ping\n\n"); } catch (e) { menge.delete(res); }
    }
  }
}
const HERZSCHLAG_MS = 25000;
setInterval(herzschlag, HERZSCHLAG_MS).unref();

module.exports = {
  MAX_CT, gueltigesChiffrat,
  keysFor, publicKeyFor, setKeys, rewrap,
  add, conversation, sinceFor, unreadBySender, unreadTotal, markRead, lastActivity,
  clearMessages, removeForUser,
  abonniere, verteile, verteileGelesen,
};
