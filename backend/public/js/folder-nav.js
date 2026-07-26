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
    bindUpload(pageEl); // Upload-Formular sitzt jetzt im Fensterkopf
    if (bindNoteOpen) bindNoteOpen(pageEl);
    bindConfirmForms(pageEl);
    // Zeilen-Dialoge: Backdrop-Buchhaltung beim Schliessen + "Freigabe entziehen"
    bindDialogClose(rowDialogsEl);
    bindConfirmForms(rowDialogsEl);
  }

  // Formulare, die in einen Ordner schreiben (Hochladen, Neuer Ordner, Neue
  // Datei), schicken den Zielordner als verstecktes dir-Feld mit. Die Dialoge
  // dlg-create/dlg-mkdir liegen AUSSERHALB von #page und werden beim
  // Ordnerwechsel darum nicht mitgetauscht — ohne dieses Nachziehen behielten
  // sie den Ordner vom Seitenaufbau und legten alles in der Wurzel an.
  function syncDirFields(dir) {
    document.querySelectorAll('input[name="dir"]').forEach(function (inp) {
      inp.value = dir;
    });
  }

  function swapFolder(doc) {
    // offene Menues/Dialoge zu, bevor ihre Knoten verschwinden
    closeAllDialogs();
    var newPage = doc.getElementById("page");
    if (!newPage) return false; // kein Listen-Dokument (z.B. Login) -> Vollreload
    var newRows = doc.getElementById("row-dialogs");
    pageEl.innerHTML = newPage.innerHTML;
    rowDialogsEl.innerHTML = newRows ? newRows.innerHTML : "";
    pageEl.dataset.dir = newPage.dataset.dir || "";
    syncDirFields(pageEl.dataset.dir);
    pageEl.scrollTop = 0;
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
