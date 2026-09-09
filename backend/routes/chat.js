// Chat-Routen. Der Server ist hier reine Poststelle: er nimmt fertig
// verschluesselte Paeckchen an, legt sie ab und stellt sie zu. Was drinsteht,
// erfaehrt er nicht (Begruendung und Verfahren: ../chat.js).
//
// Alle Routen verlangen eine Sitzung. Der Absender kommt IMMER aus
// req.session.user, nie aus dem Rumpf — sonst koennte man in fremdem Namen
// schreiben.
const express = require("express");

const chat = require("../chat");
const users = require("../users");
const avatars = require("../avatars");
const notifications = require("../notifications");
const { loginRequired } = require("./auth");

const router = express.Router();

// Wer darf mit wem? Jeder angemeldete Nutzer mit jedem anderen, der existiert
// und nicht gesperrt ist. Bewusst OHNE die Admin-Ausnahme aus knownUsers
// (Personen-Auswahl der Notizen): dort geht es um fachliche Zuordnung, hier
// ums Reden — ein Admin ist auch nur jemand, dem man schreiben koennen muss.
function partner(name) {
  const row = users.get(name);
  return row && !row.locked ? row : null;
}

// Selbstgespraeche gibt es nicht: sie waeren mit ECDH zwar darstellbar, aber
// die Kontaktliste, die Glocke und der Lesestand haetten alle keinen Sinn.
function zielPruefen(me, to) {
  const name = String(to || "").trim();
  if (!name || name === me) return null;
  return partner(name);
}

// --- Schluessel --------------------------------------------------------

// Der eigene Schluesselbund: oeffentlicher Teil im Klartext, privater Teil
// umhuellt. Nur der Nutzer selbst bekommt ihn — und nur er kann die Huelle
// oeffnen (das Passwort dazu kennt der Server nicht).
router.get("/chat/keys/me", loginRequired, (req, res) => {
  const k = chat.keysFor(req.session.user);
  if (!k) return res.json({ hasKeys: false });
  res.json({
    hasKeys: true,
    pubJwk: JSON.parse(k.pub_jwk),
    priv: { iv: k.priv_iv, ct: k.priv_ct },
    kdf: JSON.parse(k.kdf),
  });
});

// Schluesselpaar hinterlegen. Ohne `replace: true` legt das NUR an: ein
// vorhandenes Paar zu ueberschreiben macht den kompletten bisherigen Verlauf
// unlesbar. Genau das will man nach einem Passwort-Reset durch den Admin
// (der alte private Schluessel ist dann verloren) — aber eben bewusst.
router.post("/chat/keys", loginRequired, express.json({ limit: "16kb" }), (req, res) => {
  const b = req.body || {};
  const pub = b.pubJwk, iv = b.privIv, ct = b.privCt, kdf = b.kdf;
  if (!pub || typeof pub !== "object" || !chat.gueltigesChiffrat(iv, ct) || !kdf)
    return res.status(400).json({ error: "ungueltig" });
  const vorhanden = chat.keysFor(req.session.user);
  if (vorhanden && b.replace !== true)
    return res.status(409).json({ error: "vorhanden" });
  // Reihenfolge: erst aufraeumen, dann das neue Paar hinterlegen. Ein neues
  // Schluesselpaar entwertet jedes bisherige Chiffrat — die stehenzulassen
  // hiesse, dem Nutzer dauerhaft unlesbare Zeilen anzuzeigen.
  let verworfen = 0;
  if (vorhanden) verworfen = chat.clearMessages(req.session.user);
  chat.setKeys(req.session.user, JSON.stringify(pub), iv, ct, JSON.stringify(kdf));
  res.json({ ok: true, replaced: !!vorhanden, discarded: verworfen });
});

// Oeffentlicher Schluessel eines Gespraechspartners. Nicht geheim, aber auch
// nichts fuer Unangemeldete: die Liste, wer ueberhaupt einen hat, verriete
// sonst die Nutzernamen der Instanz.
router.get("/chat/pub/:user", loginRequired, (req, res) => {
  const ziel = partner(req.params.user);
  if (!ziel) return res.status(404).json({ error: "unbekannt" });
  const pub = chat.publicKeyFor(ziel.username);
  if (!pub) return res.status(404).json({ error: "kein schluessel" });
  res.json({ user: ziel.username, pubJwk: JSON.parse(pub) });
});

// --- Kontakte ----------------------------------------------------------

// Alle moeglichen Gespraechspartner mit dem, was die Liste braucht:
// Anzeigename, Avatar, ob sie schon einen Schluessel haben (ohne den kann
// man ihnen nicht schreiben), Ungelesenes und wann zuletzt etwas lief.
router.get("/chat/peers", loginRequired, (req, res) => {
  const me = req.session.user;
  const unread = chat.unreadBySender(me);
  const last = chat.lastActivity(me);
  const peers = users.listUsers()
    .filter((u) => u.username !== me && !u.locked)
    .map((u) => ({
      username: u.username,
      name: u.display_name,
      hasAvatar: avatars.has(u.username),
      hasKeys: !!chat.publicKeyFor(u.username),
      unread: unread[u.username] || 0,
      last: last[u.username] || 0,
    }))
    // aktives Gespraech oben, danach alphabetisch — wer noch nie geschrieben
    // hat, faellt nicht ans Ende der Welt, sondern einfach hinter die aktiven
    .sort((a, b) => (b.last - a.last)
      || a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
  res.json({ me, peers });
});

// --- Nachrichten -------------------------------------------------------

router.get("/chat/messages", loginRequired, (req, res) => {
  const me = req.session.user;
  const ziel = zielPruefen(me, req.query.peer);
  if (!ziel) return res.status(400).json({ error: "kein partner" });
  const since = Number(req.query.since) || 0;
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);
  res.json({ peer: ziel.username, messages: chat.conversation(me, ziel.username, since, limit) });
});

// Einfache Bremse gegen jemanden, der die Datenbank vollschreibt: je Nutzer
// hoechstens SENDE_MAX Nachrichten im gleitenden Fenster. Bewusst im
// Arbeitsspeicher — nach einem Neustart faengt die Zaehlung von vorn an, und
// das ist voellig ausreichend fuer den Zweck.
const SENDE_MAX = 30;
const SENDE_FENSTER_MS = 10000;
const sendeZaehler = new Map();
function zuSchnell(me) {
  const jetzt = Date.now();
  const e = sendeZaehler.get(me);
  if (!e || jetzt > e.bis) {
    sendeZaehler.set(me, { n: 1, bis: jetzt + SENDE_FENSTER_MS });
    return false;
  }
  e.n += 1;
  return e.n > SENDE_MAX;
}

router.post("/chat/send", loginRequired, express.json({ limit: "32kb" }), (req, res) => {
  const me = req.session.user;
  const b = req.body || {};
  const ziel = zielPruefen(me, b.to);
  if (!ziel) return res.status(400).json({ error: "kein partner" });
  if (!chat.gueltigesChiffrat(b.iv, b.ct))
    return res.status(400).json({ error: "ungueltig" });
  if (zuSchnell(me)) return res.status(429).json({ error: "zu schnell" });

  const msg = chat.add(me, ziel.username, b.iv, b.ct);
  // Zustellen: an alle offenen Sitzungen beider Seiten
  chat.verteile(msg);
  // Und in die Glocke, damit es auch bemerkt wird, wenn gerade niemand
  // zusieht. Eine Zeile je Absender, keine Flut (notifications.addChat).
  notifications.addChat(ziel.username, me);
  res.json({ ok: true, message: msg });
});

// Gespraech geoeffnet -> alles davon ist gelesen. Raeumt zugleich die
// Glocken-Zeile dieses Absenders weg (gelesen = geloescht, wie ueberall).
router.post("/chat/read", loginRequired, express.json({ limit: "4kb" }), (req, res) => {
  const me = req.session.user;
  const ziel = zielPruefen(me, (req.body || {}).peer);
  if (!ziel) return res.status(400).json({ error: "kein partner" });
  const n = chat.markRead(me, ziel.username);
  notifications.removeChat(me, ziel.username);
  if (n) chat.verteileGelesen(me, ziel.username, Date.now());
  res.json({ ok: true, marked: n });
});

// --- Live-Strom (Server-Sent Events) -----------------------------------
//
// Eine offene GET-Verbindung je Sitzung. Warum SSE und nicht WebSocket: es ist
// gewoehnliches HTTP — keine zusaetzliche Abhaengigkeit, keine Sonderregel im
// nginx (ausser der Pufferung, die der Kopf unten abschaltet), und der Browser
// baut die Verbindung nach einem Abriss von selbst wieder auf.
router.get("/chat/stream", loginRequired, (req, res) => {
  const me = req.session.user;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  // nginx puffert Antworten normalerweise — ein Ereignisstrom kaeme dann
  // stockweise oder gar nicht an. Dieser Kopf schaltet es fuer DIESE Antwort
  // ab, ohne dass die Server-Konfiguration angefasst werden muss.
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  // Der Standard-Zeitgrenze des Sockets ist eine offene Verbindung verdaechtig
  if (res.socket) {
    res.socket.setTimeout(0);
    res.socket.setNoDelay(true);
    res.socket.setKeepAlive(true);
  }

  // Erst die Luecke schliessen, dann live weiterhoeren. `Last-Event-ID`
  // schickt der Browser beim automatischen Neuverbinden von selbst mit;
  // ?since= ist der Weg fuer den ersten Aufbau.
  const since = Number(req.get("Last-Event-ID") || req.query.since) || 0;
  if (since > 0) {
    for (const m of chat.sinceFor(me, since)) {
      res.write(`id: ${m.id}\nevent: msg\ndata: ${JSON.stringify(m)}\n\n`);
    }
  }
  res.write("event: ready\ndata: {}\n\n");

  const abbestellen = chat.abonniere(me, res);
  req.on("close", abbestellen);
});

module.exports = { router };
