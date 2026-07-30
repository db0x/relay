// Einstiegspunkt der Startseite: Bootstrap + Verdrahtung aller Module.
// Läuft als ES-Modul (type="module"), daher automatisch erst nach dem
// Parsen des DOM und nur einmal ausgewertet.
import { BASE_URL } from "./core/base.js";
import { createWindow } from "./core/window.js";
import { initDialogCore } from "./core/dialogs.js";
import { initTooltips } from "./core/tooltips.js";
import { initBoard } from "./board.js";
import { initNotifications, highlightFromUrl } from "./notifications.js";
import { initConfirmDialog } from "./core/confirm.js";
import { initFormWatch } from "./core/form-watch.js";
import { initAccountDialog } from "./account/account-dialog.js";
import { initCreateFileDialog } from "./files/create-file.js";
import { initUpload } from "./files/upload.js";
import { initOwnFilter } from "./files/own-filter.js";
import { initImageView } from "./files/image-view.js";
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
initImageView();

// Fenster des "Desktops" — jedes mit eigenem Schluessel in desktop_layout.
// MUESSEN vor initNotes() stehen: das Standard-Layout der Notiz-Icons richtet
// sich nach der Lage der Dateiliste, die hier erst gesetzt wird.
var pageWindow = createWindow({
  el: document.getElementById("page"),
  toggleBtn: document.getElementById("page-toggle"),
  minBtn: "#page-minimize", key: "page", baseUrl: BASE_URL,
});
createWindow({
  el: document.getElementById("board"),
  toggleBtn: document.getElementById("board-toggle"),
  minBtn: "#board-minimize", key: "board", baseUrl: BASE_URL,
  cascade: 1, // versetzt zur Dateiliste starten, solange keine Lage gemerkt ist
});

// notes-Modul MUSS vor der Ordnernavigation initialisiert sein: die
// zurueckgegebene bindNoteOpen-Funktion wird beim Rebind nach einem
// Ordnerwechsel gebraucht.
var notes = initNotes();
initBoard({ baseUrl: BASE_URL, notes: notes });
initBackupDialog();
initFolderNav({ bindNoteOpen: notes && notes.bindNoteOpen });

// Nachrichten (Glocke am Avatar). Braucht das Fenster der Dateiliste, um beim
// Sprung zu einer Datei ein eingeklapptes Fenster wieder aufzuklappen.
initNotifications({ pageWindow: pageWindow });
highlightFromUrl();
