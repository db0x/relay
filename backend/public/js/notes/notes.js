// Notizen-Aggregator: verdrahtet Editor-Dialog, Hover-Vorschau/Klick-Oeffnen
// und das frei platzierbare Desktop-Layout miteinander. Nur aktiv, wenn der
// Notiz-Dialog ueberhaupt im DOM steht.
import { initNoteDialog } from "./note-dialog.js";
import { initHoverPreview } from "./hover-preview.js";
import { initStatusMenu } from "./status.js";
import { initDesktopLayout } from "../desktop-layout.js";
import { BASE_URL } from "../core/base.js";

// Rueckgabe: { bindNoteOpen, invalidateNote, hideNoteTip } — bindNoteOpen fuer
// die AJAX-Ordnernavigation (Rebind nach einem Ordnerwechsel), der Rest fuer
// Module, die Notizen veraendern (Board). null, wenn keine Notiz-UI da ist.
export function initNotes() {
  var noteForm = document.getElementById("note-form");
  if (!noteForm) return null;
  var baseUrl = BASE_URL;

  var dialog = initNoteDialog(baseUrl);
  var hover = initHoverPreview({
    baseUrl: baseUrl,
    openNote: dialog.openNote,
    knownByUsername: dialog.knownByUsername,
  });
  hover.bindNoteOpen(document);
  // Verweise per @ im Notiztext verhalten sich wie die verlinkte Notiz selbst
  // (Vorschau beim Hinfahren, Oeffnen im selben Dialog) — erst jetzt moeglich,
  // vorher kennen sich Dialog und Lader nicht.
  dialog.setNoteHooks({
    open: hover.openNoteByPath,
    tip: hover.showNoteTip,
    hide: hover.hideNoteTip,
  });

  // MUSS nach der Notiz-Bindung laufen (Icons sind .note-open), aber die
  // Reihenfolge Karte-vor-Icon-Layout kapselt initDesktopLayout selbst.
  initDesktopLayout({ baseUrl: baseUrl, hideNoteTip: hover.hideNoteTip });

  // Rechtsklick auf ein Desktop-Icon: Bearbeitungsstand wechseln. Der Wechsel
  // laeuft ohne Neuladen -> die Hover-Vorschau muss ihren Cache-Eintrag
  // verwerfen, sonst zeigt sie weiter den alten Stand.
  initStatusMenu({
    baseUrl: baseUrl,
    hideNoteTip: hover.hideNoteTip,
    invalidateNote: hover.invalidateNote,
  });

  return {
    bindNoteOpen: hover.bindNoteOpen,
    invalidateNote: hover.invalidateNote,
    hideNoteTip: hover.hideNoteTip,
  };
}
