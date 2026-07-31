// Notiz-Board: Karten per Zeigegeste zwischen den Spalten ziehen — das Ablegen
// setzt den Bearbeitungsstand der Notiz.
//
// Bewusst Pointer-Events statt HTML5-Drag-and-Drop: die uebrige App zieht
// ueberall so (Fenster, Desktop-Icons), es funktioniert auf Touch-Geraeten
// und die Karte laesst sich waehrenddessen frei darstellen.
//
// Die Karte wird beim Ziehen NICHT aus dem Dokument geloest, sondern nur
// visuell versetzt (transform) — so bleibt ihr Platz erhalten, und schlaegt
// der Serveraufruf fehl, springt sie einfach zurueck.
import { setNoteStatus } from "./notes/status.js";
import { showNotice } from "./core/dialogs.js";

// config: { baseUrl, notes } — notes ist die Rueckgabe von initNotes()
// (fuer invalidateNote/hideNoteTip); fehlt sie, laeuft das Board trotzdem.
export function initBoard(config) {
  var board = document.getElementById("board");
  if (!board) return;
  var baseUrl = config.baseUrl;
  var notes = config.notes || {};
  var hideNoteTip = notes.hideNoteTip || function () {};

  var cols = Array.prototype.slice.call(board.querySelectorAll(".board-col"));
  function dropZone(col) { return col.querySelector(".board-drop"); }

  // Spalte unter dem Zeiger (oder null, wenn daneben)
  function colAt(x, y) {
    for (var i = 0; i < cols.length; i++) {
      var r = cols[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return cols[i];
    }
    return null;
  }

  function highlight(col) {
    cols.forEach(function (c) { c.classList.toggle("board-col-over", c === col); });
  }

  // Karte in die Spalte ihres Status einsortieren — nach denselben Regeln wie
  // der Server: datierte ToDos nach Termin zuerst, dann alphabetisch.
  function placeCard(card, status) {
    var col = cols.filter(function (c) { return c.dataset.status === status; })[0];
    if (!col) return;
    var zone = dropZone(col);
    var due = card.dataset.due || "";
    var label = (card.dataset.label || "").toLowerCase();
    var before = null;
    Array.prototype.slice.call(zone.querySelectorAll(".board-card")).forEach(function (other) {
      if (before || other === card) return;
      var oDue = other.dataset.due || "";
      var oLabel = (other.dataset.label || "").toLowerCase();
      var after = due && oDue ? due < oDue
        : due ? true
        : oDue ? false
        : label < oLabel;
      if (after) before = other;
    });
    zone.insertBefore(card, before);
    updateCounts();
  }

  function updateCounts() {
    cols.forEach(function (col) {
      // Nur SICHTBARE Karten zaehlen: der Filter "Nur eigene Notizen" blendet
      // fremde aus, und ein Zaehler ueber Unsichtbares waere irrefuehrend.
      var n = col.querySelectorAll(".board-card:not([hidden])").length;
      col.querySelector(".board-col-count").textContent = n;
      // Platzhalter nur zeigen, wenn die Spalte wirklich leer ist
      var empty = col.querySelector(".board-empty");
      if (empty) empty.hidden = n > 0;
    });
  }

  // Aendert jemand anders den Status (Kontextmenue), sortiert sich das Board
  // selbst um — status.js meldet das per Ereignis.
  document.addEventListener("relay-note-status", function (e) {
    var d = e.detail || {};
    var card = board.querySelector('.board-card[data-owner="' + CSS.escape(d.owner)
      + '"][data-rel="' + CSS.escape(d.rel) + '"]');
    if (card) placeCard(card, d.status);
  });

  function setupCard(card) {
    // Nur-lesende Freigaben duerfen den Status nicht aendern -> nicht ziehbar
    if (card.dataset.canedit !== "1") { card.classList.add("board-card-fixed"); return; }
    var dragged = false;
    // Klick NACH einem Zug unterdruecken, sonst oeffnete sich die Notiz
    // (Capture-Phase laeuft vor dem .note-open-Handler)
    card.addEventListener("click", function (e) {
      if (dragged) { e.stopImmediatePropagation(); e.preventDefault(); dragged = false; }
    }, true);

    card.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      hideNoteTip();
      var sx = e.clientX, sy = e.clientY, moved = false;
      var startCol = card.closest(".board-col");
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }

      function move(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return; // Klick, kein Zug
        moved = true;
        card.classList.add("board-card-dragging");
        card.style.transform = "translate(" + dx + "px," + dy + "px)";
        highlight(colAt(ev.clientX, ev.clientY));
      }

      function up(ev) {
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerup", up);
        card.removeEventListener("pointercancel", up);
        card.classList.remove("board-card-dragging");
        card.style.transform = "";
        highlight(null);
        if (!moved) return;
        dragged = true;
        var target = colAt(ev.clientX, ev.clientY);
        if (!target || target === startCol) return; // daneben oder gleiche Spalte
        var status = target.dataset.status;
        var prev = card.dataset.status;
        // optimistisch umsortieren, damit es sich unmittelbar anfuehlt …
        card.dataset.status = status;
        placeCard(card, status);
        setNoteStatus({
          baseUrl: baseUrl, owner: card.dataset.owner, rel: card.dataset.rel,
          status: status, invalidateNote: notes.invalidateNote,
        }).catch(function () {
          // … und bei einem Fehler zurueck an den alten Platz
          card.dataset.status = prev;
          placeCard(card, prev);
          showNotice("Fehler", "Der Status konnte nicht geändert werden.", { danger: true });
        });
      }

      card.addEventListener("pointermove", move);
      card.addEventListener("pointerup", up);
      card.addEventListener("pointercancel", up);
      e.preventDefault(); // kein Text-/Bild-Ziehen des Knopfes
    });
  }

  // Fusszeilen-Filter "Nur eigene Notizen": blendet die mir freigegebenen
  // Karten aus. Eigener localStorage-Schluessel neben dem der Dateiliste —
  // es sind zwei Ansichten, die man unabhaengig voneinander einstellen will.
  // Die Fusszeile gibt es nur, wenn ueberhaupt Fremdes dabei ist (board.ejs).
  var OWN_KEY = "relay-board-own-only";
  var ownOnly = board.querySelector("#board-own-only");
  function applyOwnFilter() {
    board.querySelectorAll(".board-card.card-foreign").forEach(function (card) {
      card.hidden = ownOnly.checked;
    });
    localStorage.setItem(OWN_KEY, ownOnly.checked ? "1" : "0");
    updateCounts(); // Zaehler und "nichts hier" richten sich danach
  }
  if (ownOnly) {
    ownOnly.checked = localStorage.getItem(OWN_KEY) === "1";
    ownOnly.addEventListener("change", applyOwnFilter);
    applyOwnFilter();
  }

  board.querySelectorAll(".board-card").forEach(setupCard);
}
