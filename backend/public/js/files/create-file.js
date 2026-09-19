// Symbol-Buttons "Neue Datei": Dateityp übernehmen, Titel anpassen, Dialog öffnen
//
// Zweiter Weg herein: ?neu=<endung> in der Adresse. Den benutzt eine Voltage-App,
// die fuer genau einen Dateityp zustaendig ist und OHNE Datei gestartet wurde —
// dann ist "neue Datei dieser Art" die einzige sinnvolle Absicht. Im Browser
// passiert nichts Besonderes: der Parameter kommt dort schlicht nicht vor.
import { openDlg, closeMenus } from "../core/dialogs.js";

var createTitles = {
  docx: "Neues Textdokument",
  xlsx: "Neue Tabelle",
  pptx: "Neue Präsentation",
};
var createNameLabels = {
  docx: "Name des Textdokuments",
  xlsx: "Name der Tabelle",
  pptx: "Name der Präsentation",
};

// Dialog fuer eine Dateiart oeffnen. `ganzseitig` merkt sich im Formular, dass
// die neue Datei danach ganzseitig im Editor aufgehen soll statt in der Liste —
// siehe routes/browse.js, /create.
function oeffneCreateDialog(ext, ganzseitig) {
  var createDlg = document.getElementById("dlg-create");
  if (!createDlg || !createTitles[ext]) return false;
  document.getElementById("dlg-create-title").textContent = createTitles[ext] || "Neue Datei";
  document.getElementById("dlg-create-name-label").textContent =
    createNameLabels[ext] || "Name der Datei";
  document.getElementById("dlg-create-ext").value = ext;
  var icon = document.getElementById("dlg-create-icon");
  icon.src = icon.src.replace(/[^/]+$/, ext + ".svg");
  var nameInput = document.getElementById("dlg-create-name");
  nameInput.value = "";
  // Sprache startet bei jedem Oeffnen wieder auf dem Default (Deutsch)
  var langSelect = document.getElementById("dlg-create-lang");
  if (langSelect) langSelect.value = langSelect.dataset.default;
  // Ordner ebenso: bei jedem Oeffnen der, den man gerade ansieht. Eine
  // Wahl vom letzten Mal darf nicht stillschweigend haengenbleiben —
  // sonst laege die Datei woanders, als man es erwartet.
  var dirSelect = document.getElementById("dlg-create-dir");
  var pageEl = document.getElementById("page");
  if (dirSelect && pageEl) dirSelect.value = pageEl.dataset.dir || "";
  var flagge = document.getElementById("dlg-create-ganzseitig");
  if (flagge) flagge.value = ganzseitig ? "1" : "";
  // Werte wurden programmatisch gesetzt -> Button-Zustand neu bewerten
  nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  openDlg(createDlg);
  nameInput.focus();
  return true;
}

// root-skopiert: Die Erstellen-Knoepfe sitzen in der Titelleiste des
// Dateifensters und werden beim Ordnerwechsel mitgetauscht (folder-nav.js) —
// ohne erneutes Binden waeren sie nach der ersten Navigation wirkungslos.
// Der Dialog selbst liegt ausserhalb von #page und bleibt bestehen.
export function bindCreateButtons(root) {
  if (!document.getElementById("dlg-create")) return;
  root.querySelectorAll("[data-create]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeMenus(); // dieselben Knoepfe sitzen auch im Anwendungs-Menue
      oeffneCreateDialog(btn.dataset.create, false);
    });
  });
}

// ?neu=<endung> auswerten und die Marke danach aus der Adresse nehmen —
// dasselbe Muster wie ?open= und ?hl=: ein Neuladen soll den Dialog nicht
// erneut aufreissen, und die Adresse soll teilbar bleiben.
function ausUrl() {
  var ext;
  try { ext = new URL(location.href).searchParams.get("neu"); } catch (e) { return; }
  if (!ext) return;
  var sauber = new URL(location.href);
  sauber.searchParams.delete("neu");
  history.replaceState(null, "", sauber.pathname + sauber.search + sauber.hash);
  oeffneCreateDialog(ext, true);
}

export function initCreateFileDialog() {
  bindCreateButtons(document);
  ausUrl();
}
