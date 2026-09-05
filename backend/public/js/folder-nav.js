// --- AJAX-Ordnernavigation --------------------------------------------
// Ordnerwechsel, Breadcrumb und Sortierung tauschen nur die Liste (#page-
// Innenteil) und die Zeilen-Dialoge (#row-dialogs) aus. Titelleiste,
// Hintergrund, die Karte selbst und die Notiz-Icons bleiben stehen -> kein
// Neuaufbau, kein erneutes Einblenden, und schneller. #page/#row-dialogs
// bleiben als Container erhalten; nur ihr innerHTML wird ersetzt.
import { bindMenuButtons, bindRowMenuItemClose, bindDataDialog, bindDialogClose, closeAllDialogs } from "./core/dialogs.js";
import { bindTips } from "./core/tooltips.js";
import { bindConfirmForms } from "./core/confirm.js";
import { bindOwnOnly } from "./files/own-filter.js";
import { bindUpload } from "./files/upload.js";
import { bindCreateButtons } from "./files/create-file.js";
import { bindImageOpen, bindImageThumbs } from "./files/image-view.js";
import { bindVideoOpen } from "./files/video-view.js";
import { detachScrollbars, bindScrollbars } from "./core/scrollbars.js";

// config: { bindNoteOpen } — bindNoteOpen(root) aus dem Notiz-Modul, oder
// null, wenn keine Notiz-UI vorhanden ist.
export function initFolderNav(config) {
  var bindNoteOpen = config.bindNoteOpen;
  var pageEl = document.getElementById("page");
  var rowDialogsEl = document.getElementById("row-dialogs");
  if (!pageEl || !rowDialogsEl) return;

  // Pfad der Listen-Seite selbst (BASE_PATH + "/"): beim initialen Laden
  // dieser Seite ist location.pathname bereits genau dieser Pfad, egal
  // welcher Unterordner ueber ?p= angezeigt wird.
  var listPath = location.pathname;
  var navToken = 0;

  // Navigiert dieser Link INNERHALB der Liste (Ordner, Breadcrumb, Sort)?
  // Nur solche fangen wir ab — /edit/ (Editor) und /download/ nicht.
  function isListNav(a) {
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return false;
    var u;
    try { u = new URL(a.href); } catch (e) { return false; }
    return u.origin === location.origin && u.pathname === listPath;
  }

  function rebindFolder() {
    bindMenuButtons(pageEl);
    bindRowMenuItemClose(pageEl);
    bindDataDialog(pageEl);
    bindTips(pageEl);
    bindOwnOnly(pageEl);
    bindUpload(pageEl);        // Upload-Formular sitzt im Fensterkopf
    bindCreateButtons(pageEl); // ebenso die "Neue Datei"-Icons
    bindImageOpen(pageEl);     // Bildnamen oeffnen die Vorschau
    bindImageThumbs(pageEl);   // Rueckfall-Icon fuer kaputte Vorschaubilder
    bindVideoOpen(pageEl);     // Videonamen oeffnen den Abspiel-Dialog
    if (bindNoteOpen) bindNoteOpen(pageEl);
    bindConfirmForms(pageEl);
    // Bildlaufleisten im neuen Inhalt aufbauen (ihre Huelle ist beim
    // innerHTML-Tausch mit weggefallen). Der rollende Rumpf .page-body steht
    // in AREAS und ist damit mit erledigt — das Fenster selbst rollt nicht.
    bindScrollbars(pageEl);
    // Zeilen-Dialoge: Backdrop-Buchhaltung beim Schliessen + "Freigabe entziehen"
    bindDialogClose(rowDialogsEl);
    bindConfirmForms(rowDialogsEl);
    bindScrollbars(rowDialogsEl);
  }

  // Formulare, die in einen Ordner schreiben (Hochladen, Neuer Ordner, Neue
  // Datei), schicken den Zielordner als verstecktes dir-Feld mit. Die Dialoge
  // dlg-create/dlg-mkdir liegen AUSSERHALB von #page und werden beim
  // Ordnerwechsel darum nicht mitgetauscht — ohne dieses Nachziehen behielten
  // sie den Ordner vom Seitenaufbau und legten alles in der Wurzel an.
  // Auch das <select> im "Neue Datei"-Dialog traegt name="dir" — es zeigt den
  // Zielordner und muss beim Ordnerwechsel genauso nachziehen wie die
  // versteckten Felder.
  function syncDirFields(dir) {
    document.querySelectorAll('input[name="dir"],select[name="dir"]').forEach(function (el) {
      el.value = dir;
    });
  }

  function swapFolder(doc) {
    // offene Menues/Dialoge zu, bevor ihre Knoten verschwinden
    closeAllDialogs();
    var newPage = doc.getElementById("page");
    if (!newPage) return false; // kein Listen-Dokument (z.B. Login) -> Vollreload
    var newRows = doc.getElementById("row-dialogs");
    // ERST die Bildlaufleisten aufloesen: OverlayScrollbars baut seine Huelle
    // in die Container hinein. Wird sie ueberschrieben, bleibt eine Instanz
    // zurueck, die sich fuer lebendig haelt und nie wieder etwas zeichnet.
    detachScrollbars(pageEl);
    detachScrollbars(rowDialogsEl);
    pageEl.innerHTML = newPage.innerHTML;
    rowDialogsEl.innerHTML = newRows ? newRows.innerHTML : "";
    pageEl.dataset.dir = newPage.dataset.dir || "";
    syncDirFields(pageEl.dataset.dir);
    // Nach oben: die Bildlaufleiste wird gleich frisch aufgebaut und startet
    // ohnehin bei 0 — die Zeile greift, wenn OverlayScrollbars nicht geladen
    // ist und der Rumpf selbst der Scroller bleibt. (Der Rumpf ist neu, der
    // Ausdruck muss also NACH dem innerHTML-Tausch stehen.)
    var rumpf = pageEl.querySelector(".page-body");
    if (rumpf) rumpf.scrollTop = 0;
    rebindFolder();
    return true;
  }

  function navigateTo(url, push) {
    var token = ++navToken;
    fetch(url, { headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return Promise.all([r.text(), r.url]);
      })
      .then(function (res) {
        if (token !== navToken) return; // eine neuere Navigation hat uebernommen
        var doc = new DOMParser().parseFromString(res[0], "text/html");
        if (!swapFolder(doc)) { location.assign(url); return; }
        if (push) history.pushState({ relayNav: true }, "", res[1] || url);
        var t = doc.querySelector("title");
        if (t) document.title = t.textContent;
      })
      .catch(function () { location.assign(url); }); // Fehler -> normale Navigation
  }

  // Delegation auf dem BLEIBENDEN #page -> ueberlebt jeden innerHTML-Tausch
  pageEl.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0
      || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest("a");
    if (!isListNav(a)) return;
    e.preventDefault();
    navigateTo(a.href, true);
  });
  // Ausgangs-URL in die History, damit der erste Zurueck-Schritt hierher fuehrt
  history.replaceState({ relayNav: true }, "", location.href);
  window.addEventListener("popstate", function () {
    navigateTo(location.href, false);
  });
}
