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
    var vw = window.innerWidth, vh = window.innerHeight, w = el.offsetWidth, minY = deskMinY();
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
    el.style.maxHeight = (vh - top - 16) + "px";
  }

  function saveLayout(minimized) {
    fetch(baseUrl + "/desktop/layout", {
      method: "POST", headers: schreibKopf({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify({
        key: key,
        x: parseFloat(el.style.left) || 0,
        y: parseFloat(el.style.top) || 0,
        minimized: !!minimized,
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
  attachScrollbar(el); // eigene Bildlaufleiste — gilt fuer JEDES Fenster

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
      el.style.maxHeight = (vh - top - 16) + "px";
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

  return { place: place, minimize: minimize, restore: restore, toggle: toggle, isMinimized: isMinimized };
}
