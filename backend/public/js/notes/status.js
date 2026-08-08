// Bearbeitungsstand einer Notiz: Offen / In Arbeit / Erledigt.
//
// Unabhaengig vom ToDo-Schalter — auch eine Notiz ohne ToDo hat einen Status.
// Gesetzt wird er an zwei Stellen: in der Detailzeile des Notiz-Dialogs
// (Auswahlbox, laeuft ueber den normalen Speichern-Weg) und per Rechtsklick
// auf ein Desktop-Icon (dieses Modul, sofortiger POST ohne Neuladen).
//
// ACHTUNG: Zwillinge im Backend — die Labels stehen ebenso in
// routes/notes.js (STATUS_PILL, fuer den PDF-Export), die gueltigen Werte in
// notemeta.js (STATUS).
import { closeMenus, showNotice } from "../core/dialogs.js";

import { schreibKopf } from "../core/base.js";
export var NOTE_STATUS = [
  { value: "open", label: "Offen" },
  { value: "wip", label: "In Arbeit" },
  { value: "closed", label: "Erledigt" },
];

export function statusLabel(value) {
  var found = NOTE_STATUS.filter(function (s) { return s.value === value; })[0];
  return (found || NOTE_STATUS[0]).label;
}

// Badge fuer die Lese-Zusammenfassung im Dialog und die Hover-Vorschau.
// Faerbung kommt aus .badge-status-* (index.css) — bewusst nicht das
// Bernstein der ToDo-Badges, die direkt daneben stehen koennen.
export function statusBadge(value) {
  var v = NOTE_STATUS.some(function (s) { return s.value === value; }) ? value : "open";
  var el = document.createElement("span");
  el.className = "note-summary-badge badge-status-" + v;
  el.textContent = statusLabel(v);
  return el;
}

// "Erledigt"-Icons bleiben liegen, treten aber optisch zurueck.
// Gilt fuer JEDE Darstellung derselben Notiz — Desktop-Icon und Board-Karte
// koennen gleichzeitig sichtbar sein und muessen denselben Stand zeigen.
function paintNoteIcons(owner, rel, value) {
  document.querySelectorAll(".note-open").forEach(function (el) {
    if (el.dataset.owner !== owner || el.dataset.rel !== rel) return;
    el.dataset.status = value;
    el.classList.toggle("note-desk-done", value === "closed");
  });
}

// Status setzen: EIN Weg fuer Kontextmenue und Board. Aktualisiert nach
// Erfolg alle Darstellungen der Notiz und verwirft den Vorschau-Cache
// (die Hover-Vorschau ginge sonst weiter vom alten Stand aus).
// Rueckgabe: Promise, das bei Misserfolg abgelehnt wird — der Aufrufer kann
// dann seine optimistische Darstellung zuruecknehmen.
export function setNoteStatus(config) {
  var owner = config.owner, rel = config.rel, status = config.status;
  return fetch(config.baseUrl + "/notes/status", {
    method: "POST",
    headers: schreibKopf({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify({ owner: owner, filename: rel, status: status }),
  }).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    paintNoteIcons(owner, rel, status);
    if (config.invalidateNote) config.invalidateNote(owner, rel);
    // Wer sonst noch von dieser Notiz abhaengt, sortiert sich selbst um
    // (das Board hoert darauf). Ereignis statt Rueckruf: so muessen Board
    // und Kontextmenue nicht in einer bestimmten Reihenfolge starten.
    document.dispatchEvent(new CustomEvent("relay-note-status", {
      detail: { owner: owner, rel: rel, status: status },
    }));
    return status;
  });
}

// Kontextmenue der Desktop-Icons. EIN gemeinsames Panel (#note-status-menu)
// statt eines pro Icon; es traegt die Klasse .menu-panel, damit die
// bestehenden Schliess-Wege aus core/dialogs.js (Klick daneben, Escape,
// Scrollen) ohne Zusatzcode greifen.
// config: { baseUrl, hideNoteTip, invalidateNote } — die beiden Funktionen
// kommen aus hover-preview.js: die Vorschau muss beim Oeffnen des Menues weg
// und ihr Cache-Eintrag nach dem Wechsel verworfen werden.
export function initStatusMenu(config) {
  var baseUrl = config.baseUrl;
  var hideNoteTip = config.hideNoteTip || function () {};
  var invalidateNote = config.invalidateNote || function () {};
  var menu = document.getElementById("note-status-menu");
  if (!menu) return;
  var current = null; // Icon, auf das rechtsgeklickt wurde

  function openAt(icon, x, y) {
    current = icon;
    // aktuellen Stand markieren
    menu.querySelectorAll("[data-status]").forEach(function (btn) {
      btn.classList.toggle("menu-item-active", btn.dataset.status === icon.dataset.status);
    });
    closeMenus();           // ein anderes offenes Menue zuerst zu
    menu.hidden = false;    // messen kann man nur, was sichtbar ist
    var top = y, left = x;
    if (left + menu.offsetWidth > window.innerWidth - 8)
      left = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
    if (top + menu.offsetHeight > window.innerHeight - 8)
      top = Math.max(8, y - menu.offsetHeight);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  // Alles, was eine Notiz mit Status darstellt: Desktop-Icons UND Board-Karten.
  // Die Listenzeilen (.fname.note-open) tragen kein data-status und bleiben aussen vor.
  document.querySelectorAll(".note-open[data-status]").forEach(function (icon) {
    icon.addEventListener("contextmenu", function (e) {
      // Nur-lesende Freigaben duerfen den Status nicht aendern -> gar nicht
      // erst ein Menue anbieten (der Server lehnt es ohnehin ab)
      if (icon.dataset.canedit !== "1") return;
      e.preventDefault();
      // Rechtsklick loest kein hideNoteTip aus (das haengt am Ziehen mit der
      // linken Taste) -> die Vorschau laege sonst ueber dem Menue
      hideNoteTip();
      openAt(icon, e.clientX, e.clientY);
    });
  });

  menu.querySelectorAll("[data-status]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var icon = current;
      closeMenus();
      if (!icon) return;
      var status = btn.dataset.status;
      if (status === icon.dataset.status) return; // nichts zu tun
      setNoteStatus({
        baseUrl: baseUrl, owner: icon.dataset.owner, rel: icon.dataset.rel,
        status: status, invalidateNote: invalidateNote,
      }).catch(function () {
        showNotice("Fehler", "Der Status konnte nicht geändert werden.", { danger: true });
      });
    });
  });
}
