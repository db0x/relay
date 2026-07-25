// Notizen-Aggregator: verdrahtet Editor-Dialog, Hover-Vorschau/Klick-Oeffnen
// und das frei platzierbare Desktop-Layout miteinander. Nur aktiv, wenn der
// Notiz-Dialog ueberhaupt im DOM steht.
import { initNoteDialog } from "./note-dialog.js";
import { initHoverPreview } from "./hover-preview.js";
import { initDesktopLayout } from "../desktop-layout.js";

// Rueckgabe: bindNoteOpen(root) fuer die AJAX-Ordnernavigation (Rebind nach
// einem Ordnerwechsel), oder null, wenn keine Notiz-UI vorhanden ist.
export function initNotes() {
  var noteForm = document.getElementById("note-form");
  if (!noteForm) return null;
  var baseUrl = noteForm.action.replace(/\/notes\/create$/, "");

  var dialog = initNoteDialog(baseUrl);
  var hover = initHoverPreview({
    baseUrl: baseUrl,
    openNote: dialog.openNote,
    knownByUsername: dialog.knownByUsername,
  });
  hover.bindNoteOpen(document);

  // MUSS nach der Notiz-Bindung laufen (Icons sind .note-open), aber die
  // Reihenfolge Karte-vor-Icon-Layout kapselt initDesktopLayout selbst.
  initDesktopLayout({ baseUrl: baseUrl, hideNoteTip: hover.hideNoteTip });

  return hover.bindNoteOpen;
}
