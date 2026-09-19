// Chat-Fenster: Kontaktliste, Verlauf, Eingabe, Live-Strom.
//
// Die Verschluesselung steckt vollstaendig in crypto.js — hier geht es um
// Ablauf und Anzeige. Merksatz fuer alles, was folgt: was vom Server kommt,
// ist Geheimtext. Er wird beim Anzeigen entschluesselt und beim Senden
// verschluesselt; dazwischen liegt nie Klartext auf der Leitung.
//
// Drei Zustaende, die die Oberflaeche auseinanderhalten muss:
//   OFFEN      der private Schluessel liegt (nicht auslesbar) im Browser.
//   ZU         er ist da, aber nur umhuellt — es fehlt das Passwort
//              (anderer Browser, Speicher geleert). -> #chat-lock
//   OHNE       es gibt noch gar kein Schluesselpaar. Wird beim ersten Mal
//              still angelegt, sobald das Passwort greifbar ist.
import { BASE_URL, schreibKopf } from "../core/base.js";
import { scrollElement } from "../core/scrollbars.js";
import {
  hauptschluessel, erzeugePaar, umhuelle, oeffneHuelle, importierePrivat,
  gespraechsschluessel, verschluessele, entschluessele,
  merkeSchluessel, gemerkterSchluessel, holePending, KDF_AKTUELL,
} from "./crypto.js";

// Zustand des Moduls
var me = "";
var privKey = null;          // eigener privater Schluessel (nicht auslesbar)
var pubJwk = null;
var aktuell = null;          // Name des angezeigten Gespraechspartners
var paarSchluessel = new Map();   // peer -> AES-Schluessel des Gespraechs
var pubCache = new Map();    // peer -> oeffentlicher Schluessel
var letzteId = 0;            // hoechste gesehene Nachrichten-id (SSE-Nachhol)
var gesehen = new Set();     // ids, die schon im Verlauf stehen (SSE + POST)
var letzterTag = "";         // zuletzt gesetzter Tagestrenner im Verlauf
var strom = null;
var warSichtbar = false;   // letzter bekannter Sichtbarkeitszustand des Fensters
var chatWindow = null;

// DOM
var el = {};

export function initChat(config) {
  var wurzel = document.getElementById("chat");
  if (!wurzel) return null;
  me = wurzel.dataset.me || "";
  chatWindow = (config && config.chatWindow) || null;

  el = {
    wurzel: wurzel,
    peerListe: document.getElementById("chat-peer-list"),
    kopf: document.getElementById("chat-thread-head"),
    kopfName: document.getElementById("chat-thread-name"),
    log: document.getElementById("chat-log"),
    logBody: document.getElementById("chat-log-body"),
    leer: document.getElementById("chat-empty"),
    schloss: document.getElementById("chat-lock"),
    schlossText: document.getElementById("chat-lock-text"),
    schlossForm: document.getElementById("chat-lock-form"),
    schlossPw: document.getElementById("chat-unlock-pw"),
    schlossFehler: document.getElementById("chat-lock-err"),
    schlossReset: document.getElementById("chat-lock-reset"),
    form: document.getElementById("chat-form"),
    eingabe: document.getElementById("chat-input"),
    senden: document.getElementById("chat-send"),
    hinweis: document.getElementById("chat-note"),
    neu: document.getElementById("chat-new"),
  };

  // Ohne sichere Herkunft gibt es keine WebCrypto — dann kann der Chat nicht
  // halten, was er verspricht, und sagt das lieber deutlich, statt Nachrichten
  // ungeschuetzt zu verschicken.
  if (!window.crypto || !crypto.subtle) {
    zeigeHinweis("Der Chat braucht eine verschlüsselte Verbindung (HTTPS). "
      + "Über eine unverschlüsselte Adresse stellt der Browser die nötigen "
      + "Krypto-Funktionen nicht bereit.");
    if (el.peerListe) el.peerListe.setAttribute("aria-disabled", "true");
    return null;
  }

  verdrahteBedienung();
  // Der Ereignisstrom haengt NICHT am Aufschliessen: er transportiert
  // Geheimtext, und um zu merken, DASS etwas angekommen ist (Zaehler,
  // Glocke), braucht es keinen Schluessel. Frueher stand er in offen() —
  // ein zugesperrter Chat bekam dadurch gar nichts mit.
  verbindeStrom();
  aufschliessen();

  return { oeffne: oeffneGespraech };
}

// --- Aufschliessen -----------------------------------------------------

async function aufschliessen() {
  // 1. Schon in diesem Browser entpackt? Der uebliche Fall.
  var gemerkt = await gemerkterSchluessel(me);
  if (gemerkt && gemerkt.priv) {
    privKey = gemerkt.priv;
    pubJwk = gemerkt.pubJwk;
    return offen();
  }

  // 2. Frisch angemeldet: der Hauptschluessel liegt auf dem Uebergabeplatz
  //    (js/chat/login-key.js). Damit laesst sich die Huelle vom Server
  //    oeffnen — oder, wenn es noch keine gibt, das erste Paar anlegen.
  var mk = await holePending(me);
  var bund = await holeBund();
  if (!bund) return zeigeSchloss("Der Schlüsselbund ließ sich nicht laden.", false);

  if (mk) {
    try {
      if (bund.hasKeys) await entpacke(bund, mk);
      else await legeAn(mk);
      return offen();
    } catch (e) {
      // Das Passwort passt nicht zur Huelle: typischerweise wurde es auf
      // einem anderen Geraet geaendert, waehrend hier noch das alte galt.
    }
  }

  // 3. Kein Passwort greifbar -> nachfragen.
  if (!bund.hasKeys) {
    return zeigeSchloss("Für den Chat wird einmalig dein Passwort gebraucht — "
      + "daraus entsteht dein persönlicher Schlüssel.", false);
  }
  zeigeSchloss(null, true);
}

function holeBund() {
  return fetch(BASE_URL + "/chat/keys/me", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });
}

// Huelle oeffnen und den privaten Schluessel benutzbar machen
async function entpacke(bund, mk) {
  var pkcs8 = await oeffneHuelle(bund.priv, mk);  // wirft bei falschem Passwort
  privKey = await importierePrivat(pkcs8);
  pubJwk = bund.pubJwk;
  await merkeSchluessel(me, privKey, pubJwk);
}

// Erstes Schluesselpaar. `ersetzen` verwirft ein vorhandenes samt Verlauf —
// der Notausgang, wenn das alte Passwort unwiederbringlich weg ist.
async function legeAn(mk, ersetzen) {
  var paar = await erzeugePaar();
  var huelle = await umhuelle(paar.pkcs8, mk);
  var antwort = await fetch(BASE_URL + "/chat/keys", {
    method: "POST",
    headers: schreibKopf({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify({
      pubJwk: paar.pubJwk, privIv: huelle.iv, privCt: huelle.ct,
      kdf: KDF_AKTUELL, replace: ersetzen === true,
    }),
  });
  if (!antwort.ok) throw new Error("Schlüssel konnten nicht hinterlegt werden");
  privKey = await importierePrivat(paar.pkcs8);
  pubJwk = paar.pubJwk;
  await merkeSchluessel(me, privKey, pubJwk);
}

function offen() {
  if (el.schloss) el.schloss.hidden = true;
  paarSchluessel.clear();
  // Der eigene oeffentliche Schluessel ist jetzt hinterlegt — die Liste kann
  // sich geaendert haben (auch fuer die anderen).
  frischePeersAuf();
  if (aktuell) oeffneGespraech(aktuell);
}

// `mitReset`: zusaetzlich den Notausgang anbieten (neues Paar, alter Verlauf
// verloren). Nur sinnvoll, wenn es ueberhaupt eine Huelle gibt.
function zeigeSchloss(text, mitReset) {
  if (!el.schloss) return;
  if (text && el.schlossText) el.schlossText.textContent = text;
  el.schloss.hidden = false;
  if (el.leer) el.leer.hidden = true;
  if (el.form) el.form.hidden = true;
  if (el.schlossReset) el.schlossReset.hidden = !mitReset;
}

// --- Bedienung ---------------------------------------------------------

function verdrahteBedienung() {
  el.peerListe && el.peerListe.addEventListener("click", function (e) {
    var knopf = e.target.closest(".chat-peer");
    if (knopf) oeffneGespraech(knopf.dataset.user);
  });

  // Pille "Neue Nachricht" -> ans Ende
  el.neu && el.neu.addEventListener("click", function () { ansEnde(true); });

  // Rollt der Nutzer selbst ans Ende, hat sich die Pille erledigt. Das
  // scroll-Ereignis kommt vom Viewport INNERHALB von .chat-log und steigt
  // nicht auf — mit capture:true wird es trotzdem gesehen.
  el.log && el.log.addEventListener("scroll", function () {
    if (amEnde()) zeigeNeuePille(false);
  }, true);

  // Sichtbar-Werden des Fensters beobachten. Auf- und Zuklappen laeuft ueber
  // die Klasse page-min (core/window.js) — ein Beobachter deckt damit ALLE
  // Wege ab: Umschalter in der Topbar, Minimieren-Knopf und den Sprung aus
  // der Glocke. Einzelne Klick-Handler wuerden immer einen davon vergessen.
  new MutationObserver(pruefeSichtbarkeit)
    .observe(el.wurzel, { attributes: true, attributeFilter: ["class"] });
  // Tab-Wechsel zaehlt genauso: ein offenes Fenster in einem Hintergrundtab
  // hat niemand gesehen.
  document.addEventListener("visibilitychange", pruefeSichtbarkeit);
  warSichtbar = sichtbar();

  el.form && el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    sendeAktuelle();
  });

  // Enter sendet, Umschalt+Enter macht einen Absatz — die Erwartung an jedes
  // Eingabefeld dieser Art.
  el.eingabe && el.eingabe.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      sendeAktuelle();
    }
  });
  // Mitwachsendes Feld, gedeckelt: ein langer Text soll das Fenster nicht
  // auffressen.
  el.eingabe && el.eingabe.addEventListener("input", function () {
    el.eingabe.style.height = "auto";
    el.eingabe.style.height = Math.min(el.eingabe.scrollHeight, 120) + "px";
  });

  el.schlossForm && el.schlossForm.addEventListener("submit", function (e) {
    e.preventDefault();
    entsperrenMitPasswort();
  });

  // Bestaetigter Notausgang (die Rueckfrage macht core/confirm.js)
  el.schlossReset && el.schlossReset.addEventListener("relay-confirmed", function () {
    neuEinrichten();
  });
}

async function entsperrenMitPasswort() {
  var pw = el.schlossPw ? el.schlossPw.value : "";
  if (!pw) return;
  schlossFehler("");
  var bund = await holeBund();
  if (!bund) return schlossFehler("Der Schlüsselbund ließ sich nicht laden.");
  try {
    var mk = await hauptschluessel(me, pw, bund.kdf);
    if (bund.hasKeys) await entpacke(bund, mk);
    else await legeAn(mk);
    if (el.schlossPw) el.schlossPw.value = "";
    offen();
  } catch (e) {
    schlossFehler("Das Passwort passt nicht zu deinem Schlüssel.");
    if (el.schlossReset) el.schlossReset.hidden = false;
  }
}

async function neuEinrichten() {
  var pw = el.schlossPw ? el.schlossPw.value : "";
  if (!pw) return schlossFehler("Bitte erst das aktuelle Passwort eingeben.");
  schlossFehler("");
  try {
    await legeAn(await hauptschluessel(me, pw), true);
    if (el.schlossPw) el.schlossPw.value = "";
    leereVerlauf();
    offen();
  } catch (e) {
    schlossFehler("Das hat nicht geklappt. Stimmt das Passwort?");
  }
}

function schlossFehler(text) {
  if (!el.schlossFehler) return;
  el.schlossFehler.textContent = text;
  el.schlossFehler.hidden = !text;
}

function zeigeHinweis(text) {
  if (!el.hinweis) return;
  el.hinweis.textContent = text;
  el.hinweis.hidden = !text;
}

// --- Gespraech ---------------------------------------------------------

// Von aussen aufrufbar (Klick auf eine Chat-Nachricht in der Glocke).
export async function oeffneGespraech(peer) {
  if (!peer || peer === me) return;
  aktuell = peer;
  markierePeer(peer);
  if (el.leer) el.leer.hidden = true;
  if (el.kopf) el.kopf.hidden = false;
  if (el.kopfName) el.kopfName.textContent = nameVon(peer);
  leereVerlauf();
  if (!privKey) return;   // noch zu — das Schloss steht schon

  if (el.form) el.form.hidden = false;
  zeigeHinweis("");

  var key = await schluesselFuer(peer);
  if (!key) {
    if (el.form) el.form.hidden = true;
    return zeigeHinweis(nameVon(peer) + " hat noch keinen Chat-Schlüssel. "
      + "Sobald sich diese Person das nächste Mal anmeldet, könnt ihr schreiben.");
  }

  var antwort = await fetch(
    BASE_URL + "/chat/messages?peer=" + encodeURIComponent(peer),
    { credentials: "same-origin" });
  if (!antwort.ok) return zeigeHinweis("Der Verlauf ließ sich nicht laden.");
  var daten = await antwort.json();
  // Zwischenzeitlicher Wechsel auf ein anderes Gespraech: dann gehoert diese
  // Antwort nicht mehr auf den Bildschirm.
  if (aktuell !== peer) return;
  for (var i = 0; i < daten.messages.length; i++) await haengeAn(daten.messages[i], key);
  ansEnde();
  gelesenMelden(peer);
  if (el.eingabe) el.eingabe.focus();
}

// Gespraechsschluessel, einmal je Partner gerechnet und dann gemerkt.
// null = der andere hat noch keinen oeffentlichen Schluessel.
async function schluesselFuer(peer) {
  if (paarSchluessel.has(peer)) return paarSchluessel.get(peer);
  var pub = pubCache.get(peer);
  if (!pub) {
    var antwort = await fetch(BASE_URL + "/chat/pub/" + encodeURIComponent(peer),
      { credentials: "same-origin" });
    if (!antwort.ok) return null;
    pub = (await antwort.json()).pubJwk;
    pubCache.set(peer, pub);
  }
  var key = await gespraechsschluessel(privKey, pub, me, peer);
  paarSchluessel.set(peer, key);
  return key;
}

async function sendeAktuelle() {
  var text = (el.eingabe ? el.eingabe.value : "").trim();
  if (!text || !aktuell || !privKey) return;
  var peer = aktuell;
  var key = await schluesselFuer(peer);
  if (!key) return;

  el.eingabe.value = "";
  el.eingabe.style.height = "auto";
  if (el.senden) el.senden.disabled = true;
  try {
    var paket = await verschluessele(key, text, me, peer);
    var antwort = await fetch(BASE_URL + "/chat/send", {
      method: "POST",
      headers: schreibKopf({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify({ to: peer, iv: paket.iv, ct: paket.ct }),
    });
    if (!antwort.ok) throw new Error("abgelehnt");
    // Anzeigen, ohne auf den Live-Strom zu warten: der eigene Text soll
    // sofort dastehen. gesehen[] verhindert, dass er gleich doppelt kommt.
    var msg = (await antwort.json()).message;
    if (aktuell === peer) { await haengeAn(msg, key); ansEnde(); }
  } catch (e) {
    // Text zurueck ins Feld — er soll nicht verlorengehen
    if (!el.eingabe.value) el.eingabe.value = text;
    zeigeHinweis("Die Nachricht konnte nicht gesendet werden.");
  } finally {
    if (el.senden) el.senden.disabled = false;
    if (el.eingabe) el.eingabe.focus();
  }
}

// --- Anzeige des Verlaufs ----------------------------------------------

function leereVerlauf() {
  if (el.logBody) el.logBody.textContent = "";
  gesehen.clear();
  letzterTag = "";   // sonst fehlt im naechsten Gespraech der erste Trenner
  zeigeNeuePille(false);
}

// Eine Nachricht anhaengen. Der Klartext entsteht ERST hier.
async function haengeAn(msg, key) {
  if (!el.logBody || gesehen.has(msg.id)) return;
  gesehen.add(msg.id);
  if (msg.id > letzteId) letzteId = msg.id;

  var text, lesbar = true;
  try {
    text = await entschluessele(key, msg);
  } catch (e) {
    // Eine einzelne unlesbare Zeile darf den Verlauf nicht kippen. Passiert,
    // wenn jemand seinen Schluessel neu erzeugt hat.
    text = "Diese Nachricht lässt sich nicht mehr entschlüsseln.";
    lesbar = false;
  }

  tagestrennerWennNoetig(msg.created);

  var zeile = document.createElement("div");
  zeile.className = "chat-msg" + (msg.from === me ? " chat-msg-own" : "")
    + (lesbar ? "" : " chat-msg-broken");
  zeile.dataset.id = String(msg.id);

  var blase = document.createElement("div");
  blase.className = "chat-bubble";
  // textContent, nie innerHTML: der Inhalt kommt von einem anderen Nutzer.
  blase.textContent = text;
  zeile.appendChild(blase);

  var zeit = document.createElement("span");
  zeit.className = "chat-time";
  zeit.textContent = uhrzeit(msg.created);
  zeile.appendChild(zeit);

  el.logBody.appendChild(zeile);
}

function tagestrennerWennNoetig(ms) {
  var tag = new Date(ms).toLocaleDateString("de-DE",
    { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  if (tag === letzterTag) return;
  letzterTag = tag;
  var t = document.createElement("div");
  t.className = "chat-day";
  t.textContent = istHeute(ms) ? "Heute" : tag;
  el.logBody.appendChild(t);
}

function istHeute(ms) {
  var a = new Date(ms), b = new Date();
  return a.toDateString() === b.toDateString();
}

function uhrzeit(ms) {
  return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// Der rollende Teil des Verlaufs. NICHT .chat-log selbst: dort haengt die
// Leiste, gerollt wird der Viewport darin (core/scrollbars.js erklaert es).
function roller() {
  return el.log ? scrollElement(el.log) : null;
}

// Ans Ende springen. `weich` nur fuer den Klick auf die Pille — bei einer
// ankommenden Nachricht soll es nicht sichtbar hinterherfahren.
function ansEnde(weich) {
  var r = roller();
  if (!r) return;
  if (weich && r.scrollTo) r.scrollTo({ top: r.scrollHeight, behavior: "smooth" });
  else r.scrollTop = r.scrollHeight;
  zeigeNeuePille(false);
}

// Hinweis "Neue Nachricht", wenn etwas ankommt, waehrend man zurueckblaettert.
// Ungefragt ans Ende zu springen waere in dem Moment das Falsche — die Stelle,
// die man gerade liest, gehoert einem selbst.
function zeigeNeuePille(an) {
  if (el.neu) el.neu.hidden = !an;
}

// --- Kontaktliste ------------------------------------------------------

function nameVon(peer) {
  var knopf = knopfFuer(peer);
  return knopf ? knopf.dataset.name : peer;
}

function knopfFuer(peer) {
  return el.peerListe
    ? el.peerListe.querySelector('.chat-peer[data-user="' + CSS.escape(peer) + '"]')
    : null;
}

function markierePeer(peer) {
  if (!el.peerListe) return;
  el.peerListe.querySelectorAll(".chat-peer").forEach(function (b) {
    b.classList.toggle("chat-peer-active", b.dataset.user === peer);
  });
}

function setzeUngelesen(peer, n) {
  var knopf = knopfFuer(peer);
  if (!knopf) return;
  var punkt = knopf.querySelector(".chat-peer-unread");
  if (!punkt) return;
  punkt.textContent = n > 9 ? "9+" : String(n);
  punkt.hidden = n <= 0;
}

// Nach dem Anlegen eigener Schluessel bzw. beim Auffrischen: hasKeys und die
// Zaehler koennen sich geaendert haben. Die Zeilen werden aktualisiert, nicht
// neu gebaut — so bleibt die Auswahl stehen.
function frischePeersAuf() {
  fetch(BASE_URL + "/chat/peers", { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      d.peers.forEach(function (p) {
        var knopf = knopfFuer(p.username);
        if (!knopf) return;
        knopf.dataset.haskeys = p.hasKeys ? "1" : "0";
        knopf.classList.toggle("chat-peer-nokeys", !p.hasKeys);
        setzeUngelesen(p.username, p.unread);
      });
    })
    .catch(function () { /* die Liste steht ja schon */ });
}

function gelesenMelden(peer) {
  setzeUngelesen(peer, 0);
  entferneGlocke(peer);
  fetch(BASE_URL + "/chat/read", {
    method: "POST",
    headers: schreibKopf({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify({ peer: peer }),
  }).catch(function () { /* beim naechsten Oeffnen erneut */ });
}

// Die Glocken-Zeile dieses Absenders aus der Kopfzeile nehmen. Der Server hat
// sie schon geloescht (POST /chat/read) — hier geht es nur um die Anzeige,
// damit man nicht neu laden muss.
function entferneGlocke(peer) {
  document.querySelectorAll('.notif-item[data-kind="chat"][data-owner="'
    + CSS.escape(peer) + '"]').forEach(function (item) {
    var li = item.closest("li");
    if (li) li.remove();
  });
  document.dispatchEvent(new CustomEvent("relay-notif-changed"));
}

// --- Live-Strom --------------------------------------------------------

function verbindeStrom() {
  if (strom) return;
  // EventSource verbindet nach einem Abriss von selbst neu und schickt dabei
  // Last-Event-ID mit — der Server liefert dann genau die Luecke nach
  // (routes/chat.js). ?since= deckt den ERSTEN Aufbau ab.
  strom = new EventSource(BASE_URL + "/chat/stream?since=" + letzteId);
  strom.addEventListener("msg", function (e) {
    try { empfangen(JSON.parse(e.data)); } catch (err) { /* kaputtes Paket */ }
  });
  strom.addEventListener("read", function () {
    // Der Gegenueber hat gelesen. Angezeigt wird das (noch) nicht — der
    // Lesestand steht aber schon zur Verfuegung, falls Haken dazukommen.
  });
}

// Schaut gerade wirklich jemand auf das Gespraech? "Ausgewaehlt" allein
// reicht NICHT: das Fenster kann eingeklappt sein (page-min = display:none)
// oder der Tab im Hintergrund liegen. Genau diese Verwechslung sorgte dafuer,
// dass eine Nachricht bei zugeklapptem Fenster still als gelesen galt — ohne
// Glocke, ohne Zaehler, und beim Aufklappen stand sie einfach da.
function sichtbar() {
  return !!el.wurzel
    && !el.wurzel.classList.contains("page-min")
    && document.visibilityState === "visible";
}

// Wird das Fenster sichtbar, gilt das offene Gespraech als gesehen — und die
// Kontaktliste wird aufgefrischt (sie ist so alt wie die Seite). Der
// Vorher-Nachher-Vergleich ist noetig, weil der Beobachter bei JEDER
// Klassenaenderung anschlaegt, auch bei win-active und dragging.
function pruefeSichtbarkeit() {
  var jetzt = sichtbar();
  if (jetzt === warSichtbar) return;
  warSichtbar = jetzt;
  if (!jetzt) return;
  if (privKey) frischePeersAuf();
  if (aktuell && privKey) {
    gelesenMelden(aktuell);
    ansEnde();   // waehrend des Zuklappens Angekommenes ins Bild holen
  }
}

// Zaehler an der Kontaktzeile hoch und ab in die Glocke. Braucht keinen
// Schluessel — DASS etwas angekommen ist, steht schon in den Metadaten.
function meldeUngelesen(peer) {
  var knopf = knopfFuer(peer);
  var punkt = knopf && knopf.querySelector(".chat-peer-unread");
  var n = punkt && !punkt.hidden ? parseInt(punkt.textContent, 10) || 0 : 0;
  setzeUngelesen(peer, n + 1);
  glockeAuffrischen(peer);
}

async function empfangen(msg) {
  if (msg.id > letzteId) letzteId = msg.id;
  var peer = msg.from === me ? msg.to : msg.from;

  // Gehoert die Nachricht zum offenen Gespraech, kommt sie in den Verlauf —
  // auch wenn das Fenster gerade zu ist. Dann steht sie beim Aufklappen
  // bereits da; "gelesen" ist sie deswegen aber NICHT (siehe unten).
  var eingehaengt = false;
  if (peer === aktuell && privKey) {
    var key = await schluesselFuer(peer);
    if (key) {
      var warUnten = amEnde();
      await haengeAn(msg, key);
      // Nur mitscrollen, wenn man ohnehin unten stand — sonst reisst es
      // einem beim Zurueckblaettern die Stelle weg. Stattdessen die Pille.
      if (warUnten) ansEnde();
      else if (msg.from !== me) zeigeNeuePille(true);
      eingehaengt = true;
    }
  }

  // Eigene Nachricht von einem anderen Geraet: anzeigen, sonst nichts.
  if (msg.from === me) return;

  // Gelesen ist sie nur, wenn sie auch jemand sehen KONNTE.
  if (eingehaengt && sichtbar()) gelesenMelden(peer);
  else meldeUngelesen(peer);
}

// Eine Chat-Zeile in der Glocke anlegen oder auffrischen. Genau EINE je
// Absender — dieselbe Regel wie im Backend (notifications.addChat).
function glockeAuffrischen(peer) {
  var liste = document.getElementById("notif-list");
  if (!liste) return;
  var vorhanden = liste.querySelector('.notif-item[data-kind="chat"][data-owner="'
    + CSS.escape(peer) + '"]');
  var li = vorhanden ? vorhanden.closest("li") : baueGlockenZeile(peer);
  if (!li) return;
  var wann = li.querySelector(".notif-when");
  if (wann) wann.textContent = jetztText();
  liste.insertBefore(li, liste.firstChild);   // neueste zuoberst
  document.dispatchEvent(new CustomEvent("relay-notif-changed"));
}

function baueGlockenZeile(peer) {
  var li = document.createElement("li");
  var knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "menu-item notif-item";
  knopf.dataset.kind = "chat";
  knopf.dataset.owner = peer;
  knopf.dataset.rel = "";
  // Ohne id: die Zeile stammt nicht aus einem Server-Rendering. Sie wird beim
  // Oeffnen des Gespraechs weggeraeumt (POST /chat/read), nicht ueber
  // /notifications/read — dafuer braeuchte es die id.
  var text = document.createElement("span");
  text.className = "notif-text";
  var stark = document.createElement("strong");
  stark.textContent = nameVon(peer);
  text.appendChild(stark);
  text.appendChild(document.createTextNode(" hat dir geschrieben"));
  var wann = document.createElement("span");
  wann.className = "notif-when";
  knopf.appendChild(text);
  knopf.appendChild(wann);
  li.appendChild(knopf);
  return li;
}

function jetztText() {
  return new Date().toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Steht der Verlauf (nahezu) am Ende? Nur dann wird bei einer neuen Nachricht
// automatisch nachgerollt.
function amEnde() {
  var r = roller();
  if (!r) return true;
  return r.scrollHeight - r.scrollTop - r.clientHeight < 40;
}

// Aus der Glocke heraus ein Gespraech oeffnen: Fenster auf, Partner waehlen.
export function oeffneChatFenster(peer) {
  if (chatWindow) chatWindow.restore();
  oeffneGespraech(peer);
}
