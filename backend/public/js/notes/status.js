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

// "Erledigt"-Icons bleiben auf dem Desktop liegen, treten aber optisch zurueck
function paintDeskIcon(icon, value) {
  icon.dataset.status = value;
  icon.classList.toggle("note-desk-done", value === "closed");
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

  document.querySelectorAll(".note-desk").forEach(function (icon) {
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
      fetch(baseUrl + "/notes/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          owner: icon.dataset.owner, filename: icon.dataset.rel, status: status,
        }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          // an Ort und Stelle aktualisieren: die Karte und die uebrigen Icons
          // sollen nicht neu aufgebaut werden (wie beim Ordnerwechsel)
          paintDeskIcon(icon, status);
          // Die Hover-Vorschau haelt Inhalt+Metadaten gecacht und wuerde ohne
          // das hier weiter den alten Status zeigen — sie geht bisher davon
          // aus, dass jede Aenderung die Seite neu laedt.
          invalidateNote(icon.dataset.owner, icon.dataset.rel);
        })
        .catch(function () {
          showNotice("Fehler", "Der Status konnte nicht geändert werden.", { danger: true });
        });
    });
  });
}
