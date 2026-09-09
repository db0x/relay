// Suche mit Autovervollstaendigung im Anwendungs-Menue.
//
// Der Server (GET /search) liefert je Treffer schon alles zum Oeffnen — und
// zwar in denselben Feldern, die auch die Dateiliste benutzt. Darum bauen wir
// hier Elemente mit denselben Haken (.note-open, .image-open bzw. ein
// /edit-Link) und lassen sie von den VORHANDENEN Handlern binden. So oeffnet
// ein Treffer garantiert genauso wie ein Klick in der Liste — und wenn sich
// dort etwas aendert, gilt es hier automatisch mit.
import { closeMenus } from "./core/dialogs.js";
import { bindImageOpen } from "./files/image-view.js";
import { bindVideoOpen } from "./files/video-view.js";
import { sucheDokumente, fuelleTreffer } from "./search-core.js";

var DEBOUNCE = 160;

// config: { baseUrl, bindNoteOpen } — bindNoteOpen aus initNotes(), damit
// gefundene Notizen im Notiz-Dialog aufgehen statt im Editor.
export function initSearch(config) {
  var input = document.getElementById("app-search");
  var list = document.getElementById("app-search-results");
  var empty = document.getElementById("app-search-empty");
  var out = document.getElementById("app-search-out"); // faehrt die Hoehe auf/zu
  if (!input || !list) return;
  var baseUrl = config.baseUrl;
  var bindNoteOpen = config.bindNoteOpen;

  var timer = null;
  var token = 0;   // nur die Antwort zur zuletzt gestellten Frage zaehlt
  var active = -1; // Tastatur-Auswahl

  // --- Hoehe der Trefferliste weich fahren ---------------------------------
  // Die Hoehe wird als PIXELWERT gesetzt statt per Klasse auf auto: nur so
  // laeuft der Uebergang auch dann, wenn sich die Trefferzahl beim Tippen
  // aendert (8 -> 3 -> 1). Zwischen zwei "auto" wuerde CSS gar nichts merken.
  // Gemessen wird das innere Element — dessen max-height deckelt schon.
  function applyHeight() {
    if (!out) return;
    var inner = out.firstElementChild;
    var offen = !list.hidden || !empty.hidden;
    out.style.height = offen ? inner.getBoundingClientRect().height + "px" : "0px";
  }

  // Zu heisst: Behaelter faehrt auf 0. Den Inhalt raeumen wir erst NACH dem
  // Zufahren weg — sonst klappt es hart zusammen statt zu gleiten.
  var clearTimer = null;
  function clear() {
    if (out) out.style.height = "0px";
    input.setAttribute("aria-expanded", "false");
    active = -1;
    clearTimeout(clearTimer);
    clearTimer = setTimeout(function () {
      list.innerHTML = "";
      list.hidden = true;
      empty.hidden = true;
    }, 260);
  }

  function items() {
    return Array.prototype.slice.call(list.querySelectorAll(".app-hit"));
  }

  function highlight(i) {
    var els = items();
    if (!els.length) return;
    active = (i + els.length) % els.length;
    els.forEach(function (el, n) {
      el.classList.toggle("app-hit-active", n === active);
      el.setAttribute("aria-selected", n === active ? "true" : "false");
    });
    els[active].scrollIntoView({ block: "nearest" });
  }

  // Ein Treffer: aussen immer ein <li role="option">, innen das Element, das
  // die vorhandenen Handler erwarten.
  function render(hits) {
    list.innerHTML = "";
    hits.forEach(function (h) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");

      var el;
      if (h.isNote) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "app-hit note-open";
        el.dataset.owner = h.owner;
        el.dataset.rel = h.relpath;
        el.dataset.label = h.label;
        el.dataset.canedit = h.canedit ? "1" : "0";
      } else if (h.isImage || h.isVideo) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "app-hit " + (h.isVideo ? "video-open" : "image-open");
        el.dataset.src = h.src;
        el.dataset.download = h.download;
        el.dataset.label = h.label;
      } else {
        el = document.createElement("a");
        el.className = "app-hit";
        el.href = h.href;
      }

      fuelleTreffer(el, h, baseUrl);
      li.appendChild(el);
      list.appendChild(li);
    });

    // Genau hier zahlt sich die Wiederverwendung aus: Notizen und Bilder
    // bekommen ihre echten Oeffnen-Handler, root-skopiert auf die Trefferliste.
    if (bindNoteOpen) bindNoteOpen(list);
    bindImageOpen(list);
    bindVideoOpen(list);

    clearTimeout(clearTimer); // ein neues Ergebnis hebt ein laufendes Zufahren auf
    list.hidden = !hits.length;
    empty.hidden = !!hits.length;
    applyHeight();
    input.setAttribute("aria-expanded", hits.length ? "true" : "false");
    active = -1;
  }

  function search(q) {
    var mine = ++token;
    sucheDokumente(baseUrl, q)
      .then(function (hits) { if (mine === token) render(hits); })
      .catch(function () { if (mine === token) clear(); });
  }

  input.addEventListener("input", function () {
    clearTimeout(timer);
    var q = input.value.trim();
    if (!q) { token++; clear(); return; }
    timer = setTimeout(function () { search(q); }, DEBOUNCE);
  });

  // Tastensteuerung am DOKUMENT, in der Capture-Phase — nicht am Eingabefeld.
  //
  // Warum: waehrend die Trefferliste aufgeht, baut OverlayScrollbars den
  // Behaelter um; dabei rutscht der Fokus fuer einen Wimpernschlag auf <body>.
  // Haengt die Steuerung am Feld, laufen Pfeiltaste und Enter in genau diesem
  // Moment ins Leere — der Treffer wird markiert, aber Enter tut nichts.
  // Capture, damit Escape wie bisher zuerst die Suche raeumt und erst danach
  // (beim zweiten Mal) das Menue schliesst: der Escape-Handler von
  // core/dialogs.js haengt am Dokument und wuerde sonst vorher zuschlagen.
  document.addEventListener("keydown", function (e) {
    var panel = document.getElementById("app-panel");
    if (!panel || panel.hidden) return;   // nur bei offenem Anwendungs-Menue
    // Die Anwendungs-Kacheln sind Knoepfe und behalten ihre eigene Enter-Taste
    if (e.target.closest && e.target.closest(".app-btn")) return;

    if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); return; }
    if (e.key === "Enter") {
      var els = items();
      if (!els.length) return;
      e.preventDefault();
      els[active === -1 ? 0 : active].click();
      return;
    }
    if (e.key === "Escape") {
      // Erst die Vorschlaege wegraeumen, das Menue bleibt offen. Ist nichts
      // mehr da, soll Escape wie ueberall das Menue schliessen -> durchlassen.
      if (!list.hidden || input.value) {
        e.stopPropagation();
        input.value = "";
        clear();
      }
    }
  }, true);

  // Waehrend die Trefferliste aufgeht, baut OverlayScrollbars den Behaelter um
  // und die Hoehe animiert — in diesem Moment verliert das Feld gelegentlich
  // fuer einen Wimpernschlag den Fokus (focusout OHNE Ziel, Fokus faellt auf
  // <body>). Wer dann tippt oder Pfeil/Enter drueckt, laeuft ins Leere. Also
  // zurueckholen — aber nur, wenn der Fokus wirklich nirgendwo gelandet ist.
  input.addEventListener("focusout", function (e) {
    if (e.relatedTarget) return; // bewusst woandershin gegangen
    var panel = document.getElementById("app-panel");
    if (!panel || panel.hidden) return; // Menue zu, nichts zu retten
    setTimeout(function () {
      if (!panel.hidden && document.activeElement === document.body) input.focus();
    }, 0);
  });

  // Ein angeklickter Treffer schliesst das Menue. Der Link navigiert ohnehin;
  // Notiz und Bild oeffnen einen Dialog — der darf nicht hinter dem offenen
  // Menue liegen.
  list.addEventListener("click", function (e) {
    if (e.target.closest(".app-hit")) closeMenus();
  });

  // Menue frisch oeffnen heisst: leeres Feld, Fokus drin.
  var btn = document.getElementById("app-menu-btn");
  if (btn) {
    btn.addEventListener("click", function () {
      input.value = "";
      // hart zuruecksetzen: beim Oeffnen soll nichts nachwehen
      clearTimeout(clearTimer);
      list.innerHTML = ""; list.hidden = true; empty.hidden = true;
      if (out) out.style.height = "0px";
      input.setAttribute("aria-expanded", "false");
      active = -1;
      // erst nach dem Einblenden fokussieren (bindMenuButtons schaltet hidden)
      setTimeout(function () {
        var panel = document.getElementById("app-panel");
        if (panel && !panel.hidden) input.focus();
      }, 0);
    });
  }
}
