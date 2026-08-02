// Symbol-Buttons "Neue Datei": Dateityp übernehmen, Titel anpassen, Dialog öffnen
import { openDlg, closeMenus } from "../core/dialogs.js";

// root-skopiert: Die Erstellen-Knoepfe sitzen in der Titelleiste des
// Dateifensters und werden beim Ordnerwechsel mitgetauscht (folder-nav.js) —
// ohne erneutes Binden waeren sie nach der ersten Navigation wirkungslos.
// Der Dialog selbst liegt ausserhalb von #page und bleibt bestehen.
export function bindCreateButtons(root) {
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
  root.querySelectorAll("[data-create]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      closeMenus(); // dieselben Knoepfe sitzen auch im Anwendungs-Menue
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
      // Ordner ebenso: bei jedem Oeffnen der, den man gerade ansieht. Eine
      // Wahl vom letzten Mal darf nicht stillschweigend haengenbleiben —
      // sonst laege die Datei woanders, als man es erwartet.
      var dirSelect = document.getElementById("dlg-create-dir");
      var pageEl = document.getElementById("page");
      if (dirSelect && pageEl) dirSelect.value = pageEl.dataset.dir || "";
      // Werte wurden programmatisch gesetzt -> Button-Zustand neu bewerten
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      openDlg(createDlg);
      nameInput.focus();
    });
  });
}

export function initCreateFileDialog() {
  bindCreateButtons(document);
}
