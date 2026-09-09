// Benachrichtigungen fuer die Glocke am Avatar. Es gibt zwei Arten, die
// Spalte `kind` unterscheidet sie:
//   'share' — "X hat Datei Y fuer dich freigegeben" (der urspruengliche Fall).
//             owner = wer freigegeben hat, filename = die Datei, perm = Recht.
//   'chat'  — "X hat dir geschrieben" (chat.js). owner = der Absender,
//             filename und perm bleiben LEER: es gibt keine Datei dazu, und
//             der Inhalt ist ende-zu-ende verschluesselt — der Server koennte
//             ihn gar nicht in die Nachricht schreiben.
// Je Absender gibt es hoechstens EINE Chat-Zeile; weitere Nachrichten frischen
// sie auf, statt die Glocke vollaufen zu lassen.
//
// Bewusst OHNE gelesen-Flag: eine gelesene Nachricht wird sofort geloescht
// (Nutzerwunsch). Die Tabelle enthaelt damit immer genau die offenen Punkte
// und waechst nicht mit der Zeit.
//
// Die Zeilen zeigen auf owner/filename. Verschwindet die Datei oder wird die
// Freigabe entzogen, muessen sie mit weg — sonst zeigte eine Nachricht auf
// etwas, das der Empfaenger gar nicht mehr sehen darf. Dafuer sorgen die
// remove*-Funktionen; browse.js ruft sie an denselben Stellen wie shares.
const { db } = require("./db");

// Neue Freigabe -> Nachricht fuer den Empfaenger. Mehrfaches Freigeben
// derselben Datei (z.B. Recht geaendert) erzeugt KEINE zweite Nachricht,
// sondern frischt die vorhandene auf — sonst sammelten sich Dubletten.
function add(username, owner, filename, perm, kind = "share") {
  const existing = db().prepare(
    "SELECT id FROM notifications WHERE username=? AND owner=? AND filename=? AND kind=?"
  ).get(username, owner, filename, kind);
  if (existing) {
    db().prepare("UPDATE notifications SET perm=?, created=? WHERE id=?")
      .run(perm, Date.now(), existing.id);
    return;
  }
  db().prepare(
    "INSERT INTO notifications (username, owner, filename, perm, created, kind) VALUES (?,?,?,?,?,?)"
  ).run(username, owner, filename, perm, Date.now(), kind);
}

// Neue Chat-Nachricht von `from` an `username`. Nutzt dieselbe Auffrisch-
// Logik wie oben: eine Zeile je Absender, deren Zeitstempel nachrueckt.
function addChat(username, from) {
  add(username, from, "", "", "chat");
}

// Das Gespraech mit `from` wurde geoeffnet -> die Glocke dazu ist erledigt.
function removeChat(username, from) {
  db().prepare("DELETE FROM notifications WHERE username=? AND owner=? AND kind='chat'")
    .run(username, from);
}

// Offene Nachrichten eines Nutzers, neueste zuerst
function listFor(username) {
  return db().prepare(
    "SELECT id, owner, filename, perm, created, kind FROM notifications WHERE username=? ORDER BY created DESC, id DESC"
  ).all(username);
}

// Als gelesen markieren = loeschen. Die Pruefung auf den Empfaenger gehoert
// dazu: sonst koennte jemand fremde Nachrichten wegraeumen.
function markRead(username, id) {
  return db().prepare("DELETE FROM notifications WHERE id=? AND username=?")
    .run(id, username).changes > 0;
}

function markAllRead(username) {
  return db().prepare("DELETE FROM notifications WHERE username=?").run(username).changes;
}

// Freigabe entzogen -> die zugehoerige Nachricht ist gegenstandslos
function removeForShare(owner, filename, target) {
  db().prepare("DELETE FROM notifications WHERE owner=? AND filename=? AND username=? AND kind='share'")
    .run(owner, filename, target);
}

// Datei geloescht -> alle Nachrichten dazu weg
function removeForFile(owner, filename) {
  db().prepare("DELETE FROM notifications WHERE owner=? AND filename=? AND kind='share'")
    .run(owner, filename);
}

// Datei umbenannt/verschoben (Notiz-Titel geaendert): Nachrichten mitziehen
function rename(owner, from, to) {
  db().prepare("UPDATE notifications SET filename=? WHERE owner=? AND filename=? AND kind='share'")
    .run(to, owner, from);
}

// Nutzer geloescht: seine eigenen Nachrichten und die, die er ausgeloest hat
function removeForUser(username) {
  db().prepare("DELETE FROM notifications WHERE username=? OR owner=?").run(username, username);
}

module.exports = {
  add, addChat, listFor, markRead, markAllRead, removeChat,
  removeForShare, removeForFile, rename, removeForUser,
};
