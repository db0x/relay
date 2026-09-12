// Generische Fenster-Mechanik des "Desktops": frei verschiebbar, minimierbar,
// Position und Zustand je Nutzer gemerkt (POST /desktop/layout mit eigenem
// `key`). Die Dateiliste und das Notiz-Board nutzen dieselbe Umsetzung —
// jede weitere Ansicht bekommt einfach eine eigene createWindow()-Instanz.
//
// Erwartetes Markup (siehe views/partials/file-list.ejs bzw. board.ejs):
//   <div class="page" id="…" [data-x data-y]>
//     <header class="page-head">… <button class="page-min-btn">…</button></header>
//     …Inhalt…
//   </div>
// plus ein Umschalter in der Topbar (.view-btn mit aria-pressed).
//
// Jedes so erzeugte Fenster bekommt automatisch die eigenen Bildlaufleisten
// (core/scrollbars.js) — eine neue Ansicht muss sich darum nicht kuemmern.
import { attachScrollbar } from "./scrollbars.js";

import { schreibKopf } from "./base.js";
// Untergrenze fuer alle frei platzierten Elemente: unter der Titelleiste,
// damit nichts hinter ihr verschwindet.
export function deskMinY() {
  var tb = document.querySelector(".topbar");
  return (tb ? tb.getBoundingClientRect().bottom : 0) + 6;
}

// --- Stapelreihenfolge der Fenster -------------------------------------
// Wer zuletzt angefasst wurde, liegt oben. Die z-index-Werte werden dabei
// NEU VERGEBEN statt hochgezaehlt: so bleiben sie immer im Bereich 10..(10+n)
// und geraten nie ueber die Topbar (30) oder die Dialoge (60).
var Z_BASE = 10;
var stack = [];
function applyStack() {
  // Zugleich das "aktive" Fenster markieren: das vorderste SICHTBARE. Es
  // traegt .win-active und wirft damit den kraeftigeren Schatten — wie das
  // Key Window bei macOS. Eingeklappte Fenster (.page-min) zaehlen nicht mit,
  // sonst haette manchmal gar keines die Markierung.
  var top = null;
  stack.forEach(function (w, i) {
    w.style.zIndex = String(Z_BASE + i);
    if (!w.classList.contains("page-min")) top = w;
  });
  stack.forEach(function (w) { w.classList.toggle("win-active", w === top); });
}
function raise(el) {
  var i = stack.indexOf(el);
  if (i === stack.length - 1) return; // liegt schon oben
  if (i !== -1) stack.splice(i, 1);
  stack.push(el);
  applyStack();
}

// config: { el, toggleBtn, minBtn, key, baseUrl, minWidth }
//   el        das Fenster (.page)
//   toggleBtn Umschalter in der Topbar (optional)
//   minBtn    CSS-Selektor des Minimieren-Knopfes IM Fenster; wird delegiert
//             gebunden, damit er einen innerHTML-Tausch ueberlebt
//   key       Schluessel in desktop_layout (z.B. "page", "board")
// Rueckgabe: { place, minimize, restore, isMinimized, toggle }
export function createWindow(config) {
  var el = config.el;
  if (!el) return null;
  var toggleBtn = config.toggleBtn || null;
  // Knopf "Auf Fenstergroesse" (optional). Hier oben deklariert, weil setMax
  // ihn braucht und nicht von der Reihenfolge weiter unten abhaengen soll.
  var maxBtn = config.maxBtn ? el.querySelector(config.maxBtn) : null;
  var baseUrl = config.baseUrl;
  var key = config.key;
  // wie viel vom Fenster mindestens sichtbar bleiben muss (Rest darf ueber
  // den Rand hinaus); beim Ziehen wie beim Einpassen dieselbe Regel
  var KEEP = 140;

  function isMinimized() { return el.classList.contains("page-min"); }

  function syncToggle() {
    if (toggleBtn) toggleBtn.setAttribute("aria-pressed", isMinimized() ? "false" : "true");
  }

  // Position anwenden: gemerkte Lage (data-x/data-y) oder Default (zentriert
  // unter der Titelleiste). max-height sorgt dafuer, dass lange Inhalte INNEN
  // scrollen statt das Fenster aus dem Viewport wachsen zu lassen.
  function place() {
    // Eingeklappt hat das Fenster keine Masse (display:none) — Rechnen wuerde
    // die gemerkte Position mit offsetWidth 0 verfaelschen. restore() ruft
    // place() ohnehin nach.
    if (isMinimized()) return;
    if (isMaximized()) return passeMaxAn();
    var vw = window.innerWidth, vh = window.innerHeight, minY = deskMinY();

    // Gemerkte Groesse ZUERST: die Position wird unten gegen die Breite
    // geklemmt, und die haengt davon ab.
    if (el.dataset.w) {
      el.style.width = Math.min(parseFloat(el.dataset.w), vw - 16) + "px";
    }
    if (el.dataset.h) {
      el.style.height = Math.min(parseFloat(el.dataset.h), vh - minY - 16) + "px";
    }

    var w = el.offsetWidth;
    var left, top;
    if (el.dataset.x !== undefined) {
      left = parseFloat(el.dataset.x); top = parseFloat(el.dataset.y);
    } else {
      // Ohne gemerkte Lage zentriert unter der Titelleiste. Zweit- und
      // Drittfenster versetzt (cascade), sonst laegen sie beim ersten Oeffnen
      // exakt uebereinander und wirkten wie EIN Fenster.
      var step = (config.cascade || 0) * 36;
      left = Math.round((vw - w) / 2) + step; top = minY + 10 + step;
    }
    left = Math.max(KEEP - w, Math.min(left, vw - KEEP));
    top = Math.max(minY, Math.min(top, vh - 160));
    el.style.left = left + "px"; el.style.top = top + "px";
    // Ohne gezogene Hoehe begrenzt maxHeight, damit langer Inhalt INNEN rollt
    // statt das Fenster aus dem Bild wachsen zu lassen. MIT gezogener Hoehe
    // gilt genau die — sonst zoege maxHeight sie beim naechsten Laden wieder
    // zusammen.
    el.style.maxHeight = el.dataset.h ? "none" : (vh - top - 16) + "px";
  }

  function saveLayout(minimized) {
    var x = parseFloat(el.style.left) || 0;
    var y = parseFloat(el.style.top) || 0;
    // data-x/y sind die Quelle, aus der place() rechnet — sie kamen bisher NUR
    // vom Seitenaufbau. Wer sein Fenster zog, aenderte damit style.left, nicht
    // den Datensatz: beim naechsten place() (Verkleinern aus dem Vollbild,
    // Fenstergroesse geaendert) sprang es zurueck auf die Kaskaden-Vorgabe.
    // Hier, wo der Stand ohnehin festgehalten wird, gehoert beides zusammen.
    el.dataset.x = String(x);
    el.dataset.y = String(y);
    fetch(baseUrl + "/desktop/layout", {
      method: "POST", headers: schreibKopf({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify({
        key: key,
        x: x,
        y: y,
        minimized: !!minimized,
        // nur senden, was der Nutzer wirklich gezogen hat — sonst zementierte
        // der erste Klick die zufaellige Startgroesse aus dem CSS
        w: el.dataset.w ? parseFloat(el.dataset.w) : null,
        h: el.dataset.h ? parseFloat(el.dataset.h) : null,
      }),
    }).catch(function () { /* Merken ist optional — die Ansicht stimmt trotzdem */ });
  }

  function minimize() {
    if (isMinimized()) return;
    // Position VOR dem Ausblenden sichern: danach liefert das Fenster keine
    // brauchbaren Masse mehr
    saveLayout(true);
    el.classList.add("page-min");
    syncToggle();
    applyStack(); // das aktive Fenster ist jetzt ein anderes
  }

  function restore() {
    if (!isMinimized()) return;
    el.classList.remove("page-min");
    syncToggle();
    raise(el);      // wiederhergestellt heisst: nach vorn, nicht hinter andere
    applyStack();   // raise() steigt aus, wenn es schon oben lag — die
                    // .win-active-Markierung muss trotzdem neu gesetzt werden

    place(); // Bildschirm koennte inzwischen kleiner sein -> neu einpassen
    saveLayout(false);
  }

  function toggle() { if (isMinimized()) restore(); else minimize(); }

  // --- Maximieren ------------------------------------------------------
  // Auf Fenstergroesse, ohne die gezogenen Masse zu verlieren: die gemerkte
  // Lage bleibt in data-x/y/w/h stehen und place() stellt sie beim
  // Verkleinern wieder her. Gespeichert wird der MAXIMIERTE Zustand bewusst
  // NICHT — er ist eine Ansicht, keine Groesse.
  function isMaximized() { return el.classList.contains("win-max"); }

  function passeMaxAn() {
    var minY = deskMinY();
    el.style.left = "0px";
    el.style.top = minY + "px";
    el.style.width = window.innerWidth + "px";
    el.style.height = (window.innerHeight - minY) + "px";
    el.style.maxHeight = "none";
  }

  function setMax(an) {
    if (an === isMaximized()) return;
    el.classList.toggle("win-max", an);
    if (maxBtn) {
      maxBtn.setAttribute("aria-pressed", an ? "true" : "false");
      var t = an ? "Auf normale Größe verkleinern" : "Auf Fenstergröße vergrößern";
      maxBtn.setAttribute("data-tip", t);
      maxBtn.setAttribute("aria-label", t);
    }
    if (an) passeMaxAn();
    else {
      // Inline-Masse wegnehmen, damit place() wieder aus data-* bzw. dem CSS
      // rechnet — ohne das bliebe die Bildschirmgroesse als Inline-Stil stehen.
      el.style.width = ""; el.style.height = "";
      place();
    }
  }

  // Minimieren-Knopf delegiert binden: er sitzt IM Fenster und kann bei
  // Inhaltstausch (AJAX-Ordnernavigation) ausgewechselt werden.
  if (config.minBtn) {
    el.addEventListener("click", function (e) {
      if (e.target.closest(config.minBtn)) minimize();
    });
  }
  if (toggleBtn) toggleBtn.addEventListener("click", toggle);

  // Angefasstes Fenster nach vorn — in der Capture-Phase, damit es auch dann
  // greift, wenn der Zeiger auf einem Bedienelement landet (die Zieh-Logik
  // unten steigt bei solchen Zielen aus).
  el.addEventListener("pointerdown", function () { raise(el); }, true);
  stack.push(el);
  applyStack();

  place();
  window.addEventListener("resize", place);
  // Eigene Bildlaufleiste — gilt fuer JEDES Fenster, haengt aber am ROLLENDEN
  // Teil: Kopf- und Fusszeile bleiben stehen (siehe .page-body in index.css).
  // Fenster ohne eigenen Rumpf bekommen sie wie bisher als Ganzes.
  // Ausnahme `scroll:false`: wessen Inhalt selbst rollt (der Editor traegt
  // einen iframe), bekaeme sonst eine Huelle um etwas, das keine braucht.
  if (config.scroll !== false) attachScrollbar(el.querySelector(".page-body") || el);

  // Maximieren-Knopf (optional). Wie der Minimieren-Knopf DELEGIERT gebunden:
  // er sitzt im Fenster und kann bei einem Inhaltstausch ausgewechselt werden.
  if (config.maxBtn) {
    el.addEventListener("click", function (e) {
      if (e.target.closest(config.maxBtn)) setMax(!isMaximized());
    });
  }

  // --- Groesse ziehen ---------------------------------------------------
  //
  // Der Griff wird HIER erzeugt, nicht in den Vorlagen: so bekommt ihn jedes
  // Fenster automatisch — dieselbe Regel wie bei den Bildlaufleisten. Vier
  // Vorlagen anzufassen hiesse, die fuenfte zu vergessen.
  //
  // Er liegt ausserhalb von .page-head, faellt also von selbst aus der
  // Zieh-Logik heraus (die startet nur auf der Titelleiste).
  var griff = document.createElement("div");
  griff.className = "win-resize";
  griff.setAttribute("aria-hidden", "true");
  el.appendChild(griff);

  var MIN_W = config.minWidth || 320;
  var MIN_H = config.minHeight || 200;

  griff.addEventListener("pointerdown", function (e) {
    if (e.button !== 0 || isMaximized()) return;
    e.preventDefault();
    e.stopPropagation();          // nicht zugleich das Fenster anfassen
    var r = el.getBoundingClientRect();
    var startX = e.clientX, startY = e.clientY;
    var startW = el.offsetWidth, startH = el.offsetHeight;
    try { griff.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    el.classList.add("resizing");

    function move(ev) {
      // Nach unten/rechts bis an den Bildschirmrand, nicht darueber hinaus
      var w = Math.max(MIN_W, Math.min(startW + (ev.clientX - startX),
        window.innerWidth - r.left - 8));
      var h = Math.max(MIN_H, Math.min(startH + (ev.clientY - startY),
        window.innerHeight - r.top - 8));
      el.style.width = w + "px";
      el.style.height = h + "px";
      // maxHeight muss weichen, sonst schnitte es die gezogene Hoehe ab
      el.style.maxHeight = "none";
    }
    function up() {
      el.classList.remove("resizing");
      griff.removeEventListener("pointermove", move);
      griff.removeEventListener("pointerup", up);
      griff.removeEventListener("pointercancel", up);
      // offsetWidth/-Height statt getBoundingClientRect: ein Fenster mit
      // transform (Oeffnen-Animation) laege sonst skaliert im Speicher und
      // schrumpfte mit jedem Mal — genau so passiert beim Notiz-Dialog.
      el.dataset.w = String(el.offsetWidth);
      el.dataset.h = String(el.offsetHeight);
      saveLayout(isMinimized());
    }
    griff.addEventListener("pointermove", move);
    griff.addEventListener("pointerup", up);
    griff.addEventListener("pointercancel", up);
  });

  // Gezogen wird NUR an der Titelleiste — wie bei einem echten Fenster und wie
  // beim Notiz-Dialog (.dialog-note .dialog-head). Frueher war die ganze Karte
  // Greif-Flaeche; das machte jeden Griff daneben zum versehentlichen Verschieben.
  //
  // Die Bildlaufleiste braucht dadurch keine Ausnahme mehr: sie haengt neben
  // dem Inhalt am Fenster, nicht IN der Titelleiste, und faellt schon durch
  // die closest()-Pruefung heraus.
  var DRAG_SKIP = "a,button,input,select,textarea,label,summary,[data-dialog],[data-create]";
  el.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    if (!e.target.closest(".page-head")) return; // nur die Titelleiste zieht
    if (e.target.closest(DRAG_SKIP)) return;     // Bedienelemente darin nicht
    var r = el.getBoundingClientRect();
    var ox = e.clientX - r.left, oy = e.clientY - r.top, moved = false;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
    el.classList.add("dragging");
    function move(ev) {
      var vw = window.innerWidth, vh = window.innerHeight, w = el.offsetWidth, minY = deskMinY();
      var left = Math.max(KEEP - w, Math.min(ev.clientX - ox, vw - KEEP));
      var top = Math.max(minY, Math.min(ev.clientY - oy, vh - 160));
      el.style.left = left + "px"; el.style.top = top + "px";
      // Dieselbe Regel wie in place(): eine vom Nutzer GEZOGENE Hoehe gilt,
      // sonst begrenzt maxHeight auf den Rest des Bildschirms. Ohne die
      // Unterscheidung quetschte ein Verschieben nach unten das Fenster
      // zusammen — und das Mass kam beim Hochschieben nicht zurueck.
      el.style.maxHeight = el.dataset.h ? "none" : (vh - top - 16) + "px";
      moved = true;
    }
    function up() {
      el.classList.remove("dragging");
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (moved) saveLayout(isMinimized());
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });

  return {
    place: place, minimize: minimize, restore: restore, toggle: toggle,
    isMinimized: isMinimized, isMaximized: isMaximized, setMax: setMax,
  };
}
