// Verlinken per @ im Notiz-Editor.
//
// Ein @ am Wortanfang oeffnet eine Suche ueber alle Dokumente, die man sehen
// darf (eigene und freigegebene) — dieselbe Suche wie im Anwendungs-Menue,
// derselbe Abruf, dieselben Trefferzeilen (js/search-core.js). Aus der Auswahl
// entsteht ein fertiger Markdown-Verweis (js/notes/doclinks.js); die technische
// Klammer-Schreibweise tippt niemand mehr selbst.
//
// "Am Wortanfang" ist die entscheidende Regel: vor dem @ muss ein Leerzeichen
// oder ein Zeilenanfang stehen. Sonst wuerde jede E-Mail-Adresse
// (name@beispiel.de) mitten im Tippen die Auswahl aufklappen.
import { sucheDokumente, fuelleTreffer } from "../search-core.js";
import { markdownVerweis } from "./doclinks.js";

var DEBOUNCE = 160;
var MAX_QUERY = 40; // laenger tippt niemand einen Dateinamen — dann war es kein Verweis

// config: { getCM, pane, baseUrl }
//   getCM  liefert die CodeMirror-Instanz (entsteht erst beim ersten Oeffnen)
//   pane   Bezugsrahmen fuer die Lage der Auswahl (.note-editor-pane)
// Rueckgabe: { schliesse } — der Dialog raeumt beim Oeffnen einer Notiz auf.
export function initMention(config) {
  var baseUrl = config.baseUrl;
  var pane = config.pane;
  if (!pane) return { schliesse: function () {} };

  // Die Auswahl liegt IM Dialog (der ist modal — ausserhalb waere sie nicht
  // bedienbar, dieselbe Falle wie bei Emoji-Palette und Farbwaehler).
  var panel = document.createElement("div");
  panel.className = "mention-panel";
  panel.hidden = true;
  var liste = document.createElement("ul");
  liste.className = "app-search-results mention-list";
  liste.setAttribute("role", "listbox");
  liste.setAttribute("aria-label", "Dokument verlinken");
  var hinweis = document.createElement("p");
  hinweis.className = "app-search-empty mention-hint";
  // Fusszeile nur fuer Bilder: dort gibt es zwei sinnvolle Ergebnisse, und die
  // Wahl steht genau dann da, wenn sie zur Sache gehoert (sonst kein Beiwerk).
  var bildfuss = document.createElement("p");
  bildfuss.className = "mention-foot";
  bildfuss.textContent = "Eingabe: Bild einbetten · Umschalt: als Verweis";
  bildfuss.hidden = true;
  panel.appendChild(liste);
  panel.appendChild(hinweis);
  panel.appendChild(bildfuss);
  pane.appendChild(panel);

  var start = null;    // Position des @ — gesetzt heisst: Auswahl laeuft
  var treffer = [];
  var aktiv = -1;
  var timer = null;
  var token = 0;       // nur die Antwort zur zuletzt gestellten Frage zaehlt
  var keymapAn = false;

  // --- Auswahl anzeigen ---------------------------------------------------

  function position() {
    var cm = config.getCM();
    if (!cm) return;
    var c = cm.cursorCoords(true, "window");
    var r = pane.getBoundingClientRect();
    var breite = panel.offsetWidth || 320;
    // innerhalb der Editor-Spalte bleiben; nach unten kein Platz -> nach oben
    var links = Math.max(0, Math.min(c.left - r.left, r.width - breite - 4));
    var oben = c.bottom - r.top + 4;
    if (c.bottom + panel.offsetHeight > r.bottom && c.top - r.top > panel.offsetHeight)
      oben = c.top - r.top - panel.offsetHeight - 4;
    panel.style.left = links + "px";
    panel.style.top = oben + "px";
  }

  function markiere(i) {
    var els = liste.querySelectorAll(".app-hit");
    if (!els.length) return;
    aktiv = (i + els.length) % els.length;
    Array.prototype.forEach.call(els, function (el, n) {
      el.classList.toggle("app-hit-active", n === aktiv);
      el.setAttribute("aria-selected", n === aktiv ? "true" : "false");
    });
    els[aktiv].scrollIntoView({ block: "nearest" });
    bildfuss.hidden = !(treffer[aktiv] && treffer[aktiv].isImage);
  }

  function zeige(hits) {
    treffer = hits;
    aktiv = -1;
    liste.innerHTML = "";
    hits.forEach(function (h, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "app-hit";
      fuelleTreffer(btn, h, baseUrl);
      // mousedown statt click: der Editor verliert sonst zuerst den Fokus,
      // und die Einfuegestelle waere weg (wie bei der Emoji-Palette)
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        waehle(i, e.shiftKey);
      });
      li.appendChild(btn);
      liste.appendChild(li);
    });
    liste.hidden = !hits.length;
    hinweis.hidden = !!hits.length;
    bildfuss.hidden = true;
    panel.hidden = false;
    position();
    if (hits.length) markiere(0);
  }

  function warte(text) {
    treffer = [];
    aktiv = -1;
    liste.innerHTML = "";
    liste.hidden = true;
    bildfuss.hidden = true;
    hinweis.textContent = text;
    hinweis.hidden = false;
    panel.hidden = false;
    position();
  }

  function schliesse() {
    start = null;
    treffer = [];
    aktiv = -1;
    clearTimeout(timer);
    token++;
    panel.hidden = true;
    var cm = config.getCM();
    if (cm && keymapAn) { cm.removeKeyMap(keymap); keymapAn = false; }
  }

  // --- Auswahl uebernehmen ------------------------------------------------

  // umschalt=true dreht die Vorgabe um. Bei einem Bild ist das Einbetten der
  // Normalfall — wer ein Foto auswaehlt, will es meistens sehen; bei allem
  // anderen gibt es nur den Verweis, ein eingebettetes Textdokument gibt es
  // nicht.
  function waehle(i, umschalt) {
    var cm = config.getCM();
    var hit = treffer[i];
    if (!cm || !hit || !start) return;
    var alsBild = !!hit.isImage && !umschalt;
    var von = { line: start.line, ch: start.ch };
    var bis = cm.getCursor();
    schliesse();
    // Leerzeichen dahinter: weiterschreiben, ohne am Verweis zu kleben
    cm.replaceRange(markdownVerweis(hit.label, hit.owner, hit.relpath, alsBild) + " ", von, bis);
    cm.focus();
  }

  // --- Tastensteuerung, nur solange die Auswahl offen ist -----------------
  // Als CodeMirror-Keymap statt als Listener am Dokument: so bleiben Pfeile
  // und Enter im Editor normal, sobald die Auswahl zu ist — und CodeMirror.Pass
  // reicht die Taste durch, wenn es gerade nichts zu waehlen gibt.
  var keymap = {
    Down: function () { if (!treffer.length) return CodeMirror.Pass; markiere(aktiv + 1); },
    Up: function () { if (!treffer.length) return CodeMirror.Pass; markiere(aktiv - 1); },
    Enter: function () { if (!treffer.length) return CodeMirror.Pass; waehle(aktiv === -1 ? 0 : aktiv); },
    Tab: function () { if (!treffer.length) return CodeMirror.Pass; waehle(aktiv === -1 ? 0 : aktiv); },
    "Shift-Enter": function () {
      if (!treffer.length) return CodeMirror.Pass;
      waehle(aktiv === -1 ? 0 : aktiv, true);
    },
    Esc: function () { schliesse(); },
  };

  // --- Zustand am Editor verfolgen ---------------------------------------

  // Was steht zwischen dem @ und der Schreibmarke? null = die Auswahl ist
  // hinfaellig (Marke davor, andere Zeile, Leerzeichen getippt, @ geloescht).
  function suchbegriff(cm) {
    if (!start) return null;
    var cur = cm.getCursor();
    if (cur.line !== start.line || cur.ch < start.ch + 1) return null;
    if (cm.getRange(start, { line: start.line, ch: start.ch + 1 }) !== "@") return null;
    var text = cm.getRange({ line: start.line, ch: start.ch + 1 }, cur);
    if (/\s/.test(text) || text.length > MAX_QUERY) return null;
    return text;
  }

  function pruefe() {
    var cm = config.getCM();
    if (!cm || !start) return;
    var q = suchbegriff(cm);
    if (q === null) { schliesse(); return; }
    clearTimeout(timer);
    if (!q) { warte("Tippen, um ein Dokument zu suchen …"); return; }
    var meins = ++token;
    timer = setTimeout(function () {
      // true = ohne Bibliothek (siehe search-core.js)
      sucheDokumente(baseUrl, q, true).then(function (hits) {
        if (meins !== token || !start) return;
        if (hits.length) zeige(hits);
        else { treffer = []; warte("Nichts gefunden."); }
      });
    }, DEBOUNCE);
  }

  // An eine CodeMirror-Instanz haengen. Getrennt vom Aufbau oben, weil der
  // Editor erst beim ersten Oeffnen des Dialogs entsteht (wie bindEmoticons).
  function bindeCM(cm) {
    if (!cm || cm._mentionBound) return;
    cm._mentionBound = true;
    cm.on("inputRead", function (inst, change) {
      if (start) return;                       // laeuft schon
      if (!change.text || change.text[0] !== "@") return;
      var cur = inst.getCursor();
      var davor = inst.getRange({ line: cur.line, ch: 0 }, cur).slice(0, -1);
      // Zeilenanfang oder Leerzeichen davor — sonst ist es Teil eines Wortes
      // (name@beispiel.de) und geht uns nichts an.
      if (davor && !/\s$/.test(davor)) return;
      start = { line: cur.line, ch: cur.ch - 1 };
      if (!keymapAn) { inst.addKeyMap(keymap); keymapAn = true; }
      pruefe();
    });
    cm.on("cursorActivity", pruefe);
    cm.on("changes", pruefe);
    cm.on("blur", function () {
      // verzoegert: ein mousedown auf einen Treffer soll noch greifen
      setTimeout(function () { if (start && !cm.hasFocus()) schliesse(); }, 150);
    });
    cm.on("scroll", function () { if (start) position(); });
  }

  return { bindeCM: bindeCM, schliesse: schliesse };
}
