// Symbol-Buttons "Neue Datei": Dateityp übernehmen, Titel anpassen, Dialog öffnen
import { openDlg } from "../core/dialogs.js";

export function initCreateFileDialog() {
  var createDlg = document.getElementById("dlg-create");
  if (!createDlg) return;
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
  document.querySelectorAll("[data-create]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var ext = btn.dataset.create;
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
      // Werte wurden programmatisch gesetzt -> Button-Zustand neu bewerten
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      openDlg(createDlg);
      nameInput.focus();
    });
  });
}
