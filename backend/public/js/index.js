// Einstiegspunkt der Startseite: Bootstrap + Verdrahtung aller Module.
// Läuft als ES-Modul (type="module"), daher automatisch erst nach dem
// Parsen des DOM und nur einmal ausgewertet.
import { initDialogCore } from "./core/dialogs.js";
import { initTooltips } from "./core/tooltips.js";
import { initConfirmDialog } from "./core/confirm.js";
import { initFormWatch } from "./core/form-watch.js";
import { initAccountDialog } from "./account/account-dialog.js";
import { initCreateFileDialog } from "./files/create-file.js";
import { initUpload } from "./files/upload.js";
import { initOwnFilter } from "./files/own-filter.js";
import { initNotes } from "./notes/notes.js";
import { initBackupDialog } from "./backup.js";
import { initFolderNav } from "./folder-nav.js";

// Zurueck-Navigation aus dem Editor: der Browser stellt die Seite sonst aus
// dem bfcache wieder her — eingefroren mit offenem Dialog und veralteter
// Dateiliste. Bei einer bfcache-Wiederherstellung deshalb frisch laden.
window.addEventListener("pageshow", function (e) {
  if (e.persisted) location.reload();
});

// Statusmeldungen unten mittig: nach 2,5s ausblenden und aus dem Layout
// nehmen (der Fade dauert .4s, danach display:none -> keine Klick-Sperre).
var flashTray = document.getElementById("flash-tray");
if (flashTray) {
  setTimeout(function () {
    flashTray.classList.add("flash-hide");
    flashTray.addEventListener("transitionend", function () {
      flashTray.hidden = true;
    }, { once: true });
  }, 2500);
}

initDialogCore();
initTooltips();
initConfirmDialog();
initFormWatch();
initAccountDialog();
initCreateFileDialog();
initUpload();
initOwnFilter();
// notes-Modul MUSS vor der Ordnernavigation initialisiert sein: die
// zurueckgegebene bindNoteOpen-Funktion wird beim Rebind nach einem
// Ordnerwechsel gebraucht.
var bindNoteOpen = initNotes();
initBackupDialog();
initFolderNav({ bindNoteOpen: bindNoteOpen });
