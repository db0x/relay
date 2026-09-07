// --- AJAX-Ordnernavigation --------------------------------------------
// Ordnerwechsel, Breadcrumb und Sortierung tauschen nur die Liste (#page-
// Innenteil) und die Zeilen-Dialoge (#row-dialogs) aus. Titelleiste,
// Hintergrund, die Karte selbst und die Notiz-Icons bleiben stehen -> kein
// Neuaufbau, kein erneutes Einblenden, und schneller. #page/#row-dialogs
// bleiben als Container erhalten; nur ihr innerHTML wird ersetzt.
import { bindMenuButtons, bindRowMenuItemClose, bindDataDialog, bindDialogClose, closeAllDialogs, dlgStack } from "./core/dialogs.js";
import { bindTips } from "./core/tooltips.js";
import { bindConfirmForms } from "./core/confirm.js";
import { bindOwnOnly } from "./files/own-filter.js";
import { bindUpload } from "./files/upload.js";
import { bindCreateButtons } from "./files/create-file.js";
import { bindImageOpen, bindImageThumbs } from "./files/image-view.js";
import { bindVideoOpen } from "./files/video-view.js";
import { detachScrollbars, bindScrollbars, scrollbarOf } from "./core/scrollbars.js";

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

  // Die Rollposition des Fensterrumpfs. Mit OverlayScrollbars rollt nicht
  // .page-body selbst, sondern der Viewport, den die Bibliothek hineinbaut —
  // ohne sie bleibt der Rumpf der Scroller.
  function rollFlaeche() {
    var rumpf = pageEl.querySelector(".page-body");
    if (!rumpf) return null;
    var inst = scrollbarOf(rumpf);
    return inst ? inst.elements().viewport : rumpf;
  }

  // leise: selbsttaetiges Nachladen desselben Ordners. Dann bleibt die
  // Rollposition stehen — wer gerade unten in einer langen Liste liest, soll
  // nicht dadurch nach oben gerissen werden, dass jemand anders eine Datei
  // hochgeladen hat.
  function swapFolder(doc, leise) {
    var rollVorher = leise ? (rollFlaeche() || {}).scrollTop || 0 : 0;
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
    pageEl.dataset.fp = newPage.dataset.fp || "";
    syncDirFields(pageEl.dataset.dir);
    // Nach oben: die Bildlaufleiste wird gleich frisch aufgebaut und startet
    // ohnehin bei 0 — die Zeile greift, wenn OverlayScrollbars nicht geladen
    // ist und der Rumpf selbst der Scroller bleibt. (Der Rumpf ist neu, der
    // Ausdruck muss also NACH dem innerHTML-Tausch stehen.)
    var rumpf = pageEl.querySelector(".page-body");
    if (rumpf) rumpf.scrollTop = 0;
    rebindFolder();
    // NACH rebindFolder: erst dort entsteht die neue Bildlaufleiste, und nur
    // ihr Viewport nimmt die Position an.
    if (leise && rollVorher) {
      var flaeche = rollFlaeche();
      if (flaeche) flaeche.scrollTop = rollVorher;
    }
    return true;
  }

  function navigateTo(url, push, leise) {
    var token = ++navToken;
    fetch(url, { headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return Promise.all([r.text(), r.url]);
      })
      .then(function (res) {
        if (token !== navToken) return; // eine neuere Navigation hat uebernommen
        var doc = new DOMParser().parseFromString(res[0], "text/html");
        if (!swapFolder(doc, leise)) { location.assign(url); return; }
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

  // --- Selbsttaetiges Nachladen ------------------------------------------
  // Legt jemand anders eine Datei ab, gibt etwas frei oder waechst die
  // Bibliothek, soll die Liste das von allein merken — ohne dass man F5
  // drueckt.
  //
  // Gefragt wird NICHT nach der Liste, sondern nach einem Fingerabdruck
  // (GET /changed): gemessen kostet die volle Liste rund 13 ms und 68 KB, der
  // Fingerabdruck einen Bruchteil einer Millisekunde und ein paar Byte. Der
  // teure Weg (navigateTo, derselbe wie beim Ordnerwechsel) laeuft erst, wenn
  // der Wert wirklich abweicht — im Normalfall also nie.
  var POLL_MS = 10000;

  // Nur solange jemand hinsieht. Ein vergessener Hintergrund-Tab soll nicht
  // tage lang im Takt fragen — und beim Zurueckkommen ist die Liste ohnehin
  // sofort dran (siehe visibilitychange).
  function sichtbar() { return document.visibilityState === "visible"; }

  // Tauschen wuerde offene Dialoge und Menues wegreissen (swapFolder ruft
  // closeAllDialogs). Wer gerade eine Freigabe einstellt, verlöre seine
  // Eingabe — also warten wir einfach bis zum naechsten Takt.
  function darfTauschen() {
    if (dlgStack.length) return false;
    return !document.querySelector(".menu-panel:not([hidden])");
  }

  // Die Aenderungsabfrage liegt neben der Liste (BASE + "/changed") und
  // bekommt denselben Ordner mit, den die Seite gerade zeigt.
  function changedUrl() {
    var p = "";
    try { p = new URL(location.href).searchParams.get("p") || ""; } catch (e) { p = ""; }
    return listPath + "changed" + (p ? "?p=" + encodeURIComponent(p) : "");
  }

  var pruefeLaeuft = false;
  function pruefeAenderung() {
    if (!sichtbar() || pruefeLaeuft) return;
    var fp = pageEl.dataset.fp;
    if (!fp) return;                    // ohne Ausgangswert nichts zu vergleichen
    pruefeLaeuft = true;
    fetch(changedUrl(), { headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        pruefeLaeuft = false;
        if (!d || d.fp === pageEl.dataset.fp) return;
        // Zwischenzeitlich woandershin navigiert? Dann galt die Antwort einem
        // anderen Ordner — der naechste Takt fragt den richtigen.
        if (fp !== pageEl.dataset.fp) return;
        if (!darfTauschen()) return;
        navigateTo(location.href, false, true);
      })
      .catch(function () { pruefeLaeuft = false; });  // Netz weg: einfach weiter
  }

  setInterval(pruefeAenderung, POLL_MS);
  // Zurueck im Tab: sofort nachsehen statt bis zum naechsten Takt zu warten —
  // genau in diesem Moment schaut man ja auf die Liste.
  document.addEventListener("visibilitychange", function () {
    if (sichtbar()) pruefeAenderung();
  });
}
