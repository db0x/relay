// Dokumente in OnlyOffice oeffnen, OHNE Relay zu verlassen.
//
// Der Editor laeuft in einem FENSTER des Desktops (views/partials/
// editor-window.ejs erklaert das Warum): verschiebbar, minimierbar, in der
// Groesse zu ziehen — die ganze Mechanik kommt aus core/window.js, genau wie
// bei Dateiliste, Board und Chat. Dieses Modul steuert nur den Inhalt:
//
//   1. Klicks auf Editor-Links abfangen und das Fenster oeffnen
//   2. Den Umschalter in der Topbar ein-/ausblenden — er hat nur einen Sinn,
//      solange ein Dokument offen ist
//   3. Beim Schliessen ERST speichern lassen, dann die Sitzung kappen
//
// Punkt 3 ist der heikle: reisst man den iframe einfach heraus, endet die
// Sitzung zum DocumentServer abrupt. Der haelt sein Speicherfenster rund fuenf
// Sekunden offen — die letzten Aenderungen waeren weg. Darum das forcesave.
//
// AUSBLICK mehrere Dokumente: alles, was an EINEM Dokument haengt, steht in
// `offen`; alles andere kennt nur `win` und die DOM-Knoten. Fuer mehrere
// Fenster wuerde aus beidem eine Liste — die Trennung ist schon so gezogen.
import { BASE_URL, schreibKopf } from "../core/base.js";

var win = null;        // Fenster-Objekt aus core/window.js
var el = {};
var offen = null;      // { owner, rel } des gerade gezeigten Dokuments
var schliesstGerade = false;

// Wie lange auf das Speichern gewartet wird, bevor trotzdem zugemacht wird.
// Gemessen braucht der Aufruf lokal ~0,1 s; fuenf Sekunden sind sehr viel Luft
// und trotzdem keine spuerbare Haengepartie.
var FORCESAVE_FRIST_MS = 5000;

// Aus einer Editor-Adresse Besitzer und Pfad holen. Zwei Formen:
//   /edit/<owner>/<pfad>       eigene und freigegebene Dateien
//   /lib/edit/<pfad>           die geteilte Bibliothek (nur Ansicht)
// Rueckgabe null = keine Adresse, die wir im Fenster oeffnen.
function zerlege(href) {
  var pfad;
  try { pfad = new URL(href, location.href).pathname; } catch (e) { return null; }
  if (BASE_URL && pfad.indexOf(BASE_URL) === 0) pfad = pfad.slice(BASE_URL.length);
  // Bibliothek: nur Ansicht, es gibt nichts zu speichern
  if (pfad.indexOf("/lib/edit/") === 0) return { owner: null, rel: null, lib: true };
  var m = /^\/edit\/([^/]+)\/(.+)$/.exec(pfad);
  if (!m) return null;
  return {
    owner: decodeURIComponent(m[1]),
    rel: m[2].split("/").map(decodeURIComponent).join("/"),
    lib: false,
  };
}

// Icon zur Endung — dieselbe Zuordnung wie ueberall sonst (mimeicons.js)
function iconUrl(name) {
  var ext = (name.split(".").pop() || "").toLowerCase();
  return BASE_URL + "/fileicon/" + encodeURIComponent(ext || "bin");
}

// Der Umschalter in der Topbar hat nur einen Sinn, solange etwas offen ist:
// ohne Dokument gaebe es nichts zurueckzuholen.
function zeigeUmschalter(an) {
  if (!el.toggle) return;
  el.toggle.hidden = !an;
  el.toggle.setAttribute("aria-pressed",
    an && win && !win.isMinimized() ? "true" : "false");
}

// Der Umschalter steht fuer DAS DOKUMENT, nicht fuer die Anwendung — also
// traegt er dessen Symbol und Namen. Ein PDF sieht damit aus wie ein PDF, eine
// Tabelle wie eine Tabelle. Dieselbe Zuordnung wie in der Dateiliste
// (mimeicons.js ueber die Route /fileicon/<endung>).
//
// Sobald es mehrere Dokumente gibt, wird genau das der Unterschied zwischen
// den Eintraegen — darum steht es schon hier und nicht erst dann.
function beschrifteUmschalter(name) {
  if (!el.toggle) return;
  var bild = el.toggle.querySelector("img");
  if (bild) bild.src = name ? iconUrl(name) : BASE_URL + "/static/img/onlyoffice.svg";
  var text = name || "Dokument";
  el.toggle.setAttribute("data-tip", text);
  el.toggle.setAttribute("aria-label", name
    ? name + " anzeigen oder ausblenden"
    : "Editor anzeigen oder ausblenden");
}

function oeffne(href, beschriftung) {
  var ziel = zerlege(href);
  if (!ziel || !win) return false;

  // Ein anderes Dokument war offen -> erst sauber schliessen (speichern!),
  // dann das neue laden. Bis es mehrere Fenster gibt, teilen sie sich eines.
  if (offen && el.frame.src && el.frame.src.indexOf("about:blank") !== 0) {
    schliesse(function () { oeffne(href, beschriftung); });
    return true;
  }

  offen = ziel;
  schliesstGerade = false;
  el.titel.textContent = beschriftung || "Dokument";
  el.icon.src = iconUrl(beschriftung || href);
  el.newtab.href = href;
  if (el.busy) el.busy.hidden = true;
  // Adresse erst JETZT setzen: vorher soll nichts geladen werden
  el.frame.src = href;

  win.restore();          // aufklappen und nach vorn holen
  beschrifteUmschalter(beschriftung);
  zeigeUmschalter(true);
  return true;
}

// Speichern erzwingen, Sitzung kappen, Fenster wegraeumen.
//
// Mehrfach betretbar (zweimal geklickt, Schliessen waehrend es laeuft) —
// darum die Sperre. Und es darf NIE haengenbleiben: klappt das Speichern
// nicht, ist die Karenz des DocumentServers immer noch da, die Datei geht also
// nicht verloren. Ein Editor, der sich nicht schliessen laesst, waere das
// groessere Uebel.
async function schliesse(danach) {
  if (schliesstGerade) return;
  schliesstGerade = true;
  var ziel = offen;

  // Bibliothek und Nur-Ansicht (PDF) haben nichts zu speichern
  if (ziel && ziel.owner) {
    if (el.busy) el.busy.hidden = false;
    var abbruch = new AbortController();
    var frist = setTimeout(function () { abbruch.abort(); }, FORCESAVE_FRIST_MS);
    try {
      await fetch(BASE_URL + "/forcesave/" + encodeURIComponent(ziel.owner) + "/"
        + ziel.rel.split("/").map(encodeURIComponent).join("/"), {
        method: "POST",
        headers: schreibKopf(),
        credentials: "same-origin",
        signal: abbruch.signal,
      });
    } catch (e) { /* s.o.: Schliessen geht trotzdem weiter */ }
    clearTimeout(frist);
  }

  // about:blank statt removeAttribute("src") — Letzteres laesst die alte Seite
  // in manchen Browsern stehen.
  el.frame.src = "about:blank";
  if (el.busy) el.busy.hidden = true;
  offen = null;
  schliesstGerade = false;

  if (win) {
    if (win.isMaximized()) win.setMax(false);  // sonst kaeme es maximiert zurueck
    win.minimize();
  }
  zeigeUmschalter(false);
  // Zuruecksetzen, damit beim naechsten Oeffnen nicht kurz das Symbol des
  // VORIGEN Dokuments steht, bevor das neue gesetzt ist.
  beschrifteUmschalter(null);
  if (typeof danach === "function") danach();
}

// ?open=<owner>/<relpath> aus der Adresse auswerten und wieder entfernen.
// /create leitet so zurueck, damit auch ein frisch angelegtes Dokument im
// Fenster landet statt auf der Vollseite (dasselbe Muster wie ?hl= in
// js/notifications.js).
function oeffneAusUrl() {
  var wert = new URLSearchParams(location.search).get("open");
  if (!wert) return;
  var i = wert.indexOf("/");
  if (i > 0) {
    var owner = wert.slice(0, i), rel = wert.slice(i + 1);
    oeffne(BASE_URL + "/edit/" + encodeURIComponent(owner) + "/"
      + rel.split("/").map(encodeURIComponent).join("/"),
      rel.split("/").pop());
  }
  var url = new URL(location.href);
  url.searchParams.delete("open");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

// config: { win } — das Fenster-Objekt aus createWindow (index.js erzeugt es,
// damit alle Fenster an einer Stelle stehen).
export function initEditorView(config) {
  var wurzel = document.getElementById("editor-win");
  if (!wurzel) return;
  win = (config && config.win) || null;
  el = {
    wurzel: wurzel,
    frame: document.getElementById("editor-win-frame"),
    titel: document.getElementById("editor-win-title"),
    icon: document.getElementById("editor-win-icon"),
    newtab: document.getElementById("editor-win-newtab"),
    busy: document.getElementById("editor-win-busy"),
    toggle: document.getElementById("editor-toggle"),
  };

  // Klicks auf Editor-Links abfangen. DELEGIERT am Dokument: die Links stehen
  // in der Dateiliste (wird beim Ordnerwechsel getauscht), in Suchtreffern und
  // in Verweisen im Notiztext — ein Handler deckt alle ab und ueberlebt jeden
  // Austausch (siehe js/folder-nav.js).
  document.addEventListener("click", function (e) {
    // Mittelklick, Strg/Cmd/Umschalt/Alt: der Browser soll seinen eigenen Weg
    // gehen duerfen (neuer Tab, neues Fenster, Ziel speichern).
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href*="/edit/"]');
    if (!a || a.target === "_blank") return;
    if (!zerlege(a.getAttribute("href"))) return;
    e.preventDefault();
    oeffne(a.href, (a.textContent || "").trim());
  });

  document.getElementById("editor-win-close")
    .addEventListener("click", function () { schliesse(); });

  // Minimieren und der Umschalter binden createWindow selbst; danach muss nur
  // aria-pressed am Umschalter stimmen. Beim Minimieren bleibt das Dokument
  // OFFEN — anders als beim Schliessen laeuft die Sitzung weiter.
  wurzel.addEventListener("click", function (e) {
    if (e.target.closest("#editor-win-minimize")) zeigeUmschalter(true);
  });
  if (el.toggle) {
    el.toggle.addEventListener("click", function () { zeigeUmschalter(true); });
  }

  oeffneAusUrl();
}
