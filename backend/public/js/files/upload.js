// Hochladen: ein Knopf öffnet die Dateiauswahl, die Auswahl lädt direkt hoch.
// Vorher wird die Dateigröße gegen das Limit geprüft (MAX_UPLOAD_MB aus der
// .env, via data-max-mb) — zu große Dateien starten den Upload gar nicht erst.
import { showNotice } from "../core/dialogs.js";

// Dateityp-Icon zum Namen (gleiche Gruppen wie iconFor im Backend);
// null, wenn die Endung nicht erkennbar ist
function iconForName(name) {
  var ext = (name.split(".").pop() || "").toLowerCase();
  var map = {
    xlsx: "xlsx", xls: "xlsx", ods: "xlsx", csv: "xlsx",
    pptx: "pptx", ppt: "pptx", odp: "pptx", pdf: "pdf",
    docx: "docx", doc: "docx", odt: "docx", rtf: "docx", txt: "docx",
  };
  return map[ext] || null;
}

// root-skopiert: Das Upload-Formular sitzt in der Titelleiste des
// Dateifensters und wird beim Ordnerwechsel mitgetauscht (folder-nav.js) —
// ohne erneutes Binden verpufft die Dateiauswahl nach der ersten Navigation.
export function bindUpload(root) {
  var uploadForm = root.querySelector(".upload-form");
  if (!uploadForm) return;
  var uploadInput = uploadForm.querySelector("input[type=file]");
  uploadForm.querySelector(".upload-btn").addEventListener("click", function () {
    uploadInput.click();
  });
  uploadInput.addEventListener("change", function () {
    if (!uploadInput.files.length) return;
    var maxMb = parseInt(uploadForm.dataset.maxMb, 10) || 128;
    var f = uploadInput.files[0];
    if (f.size > maxMb * 1024 * 1024) {
      var mb = (f.size / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 });
      // Dateiname fett, Rest als Text — daher DOM-Knoten statt String
      var msg = document.createDocumentFragment();
      var strong = document.createElement("strong");
      strong.textContent = "„" + f.name + "“";
      msg.appendChild(strong);
      msg.appendChild(document.createTextNode(
        " ist " + mb + " MB groß — erlaubt sind maximal " + maxMb + " MB."));
      var icon = iconForName(f.name);
      showNotice("Datei zu groß", msg, {
        danger: true,
        // Basis-URL aus der Formular-Action ableiten (beruecksichtigt BASE_PATH)
        icon: icon ? uploadForm.action.replace(/\/upload$/, "") + "/static/img/" + icon + ".svg" : null,
      });
      uploadInput.value = ""; // Auswahl verwerfen, sonst haengt sie im Formular
      return;
    }
    uploadForm.submit();
  });
}

export function initUpload() {
  bindUpload(document);
}
