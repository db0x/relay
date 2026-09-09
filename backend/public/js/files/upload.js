// Hochladen: ein Knopf öffnet die Dateiauswahl, die Auswahl lädt direkt hoch.
// Es dürfen MEHRERE Dateien auf einmal sein (`multiple` am Input).
//
// Vorher wird geprüft, was sich im Browser prüfen lässt — Anzahl und Größe
// (MAX_UPLOAD_MB / MAX_UPLOAD_FILES aus der .env bzw. browse.js, über
// data-max-mb und data-max-files am Formular). Beides prüft das Backend
// nochmal; hier geht es darum, einen aussichtslosen Upload gar nicht erst zu
// starten und zu sagen, WORAN es liegt.
import { showNotice } from "../core/dialogs.js";

// Dateityp-Icon zum Namen (gleiche Gruppen wie iconFor im Backend);
// Unbekanntes bekommt das neutrale Fragezeichen
function iconForName(name) {
  var ext = (name.split(".").pop() || "").toLowerCase();
  var map = {
    xlsx: "xlsx", xls: "xlsx", ods: "xlsx", csv: "xlsx",
    pptx: "pptx", ppt: "pptx", odp: "pptx", pdf: "pdf",
    docx: "docx", doc: "docx", odt: "docx", rtf: "docx", txt: "docx",
  };
  return map[ext] || "unknown";
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 });
}

// Zu grosse Dateien AUSSORTIEREN statt den ganzen Vorgang abzublasen: wer
// zwölf Dateien auswählt und eine davon ist zu gross, will die anderen elf
// trotzdem hochladen. Der Input bekommt dafür eine neue Dateiliste, gebaut
// über DataTransfer — der einzige Weg, `input.files` zu setzen.
// Kann der Browser das nicht, bleibt es beim bisherigen Verhalten
// (alles verwerfen); die Meldung sagt dann entsprechend etwas anderes.
function ohneZuGrosse(input, behalten) {
  if (typeof DataTransfer !== "function") return false;
  try {
    var dt = new DataTransfer();
    behalten.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    return true;
  } catch (e) {
    return false;
  }
}

// Meldung "… ist zu groß" bzw. "… sind zu groß", Dateinamen fett.
// Rückgabe ist ein DocumentFragment, weil showNotice DOM-Knoten annimmt.
function zuGrossMeldung(zuGross, maxMb, restGeht) {
  var frag = document.createDocumentFragment();
  if (zuGross.length === 1) {
    var s = document.createElement("strong");
    s.textContent = "„" + zuGross[0].name + "“";
    frag.appendChild(s);
    frag.appendChild(document.createTextNode(
      " ist " + mb(zuGross[0].size) + " MB groß — erlaubt sind maximal " + maxMb + " MB."));
  } else {
    // Bewusst als Fliesstext statt als <ul>: der Hinweis-Dialog schreibt in
    // ein <p> (core/dialogs.js), eine Liste darin waere ungueltiges Markup.
    frag.appendChild(document.createTextNode(
      zuGross.length + " Dateien sind größer als die erlaubten " + maxMb + " MB: "));
    zuGross.forEach(function (f, i) {
      if (i) frag.appendChild(document.createTextNode(", "));
      var st = document.createElement("strong");
      st.textContent = f.name;
      frag.appendChild(st);
      frag.appendChild(document.createTextNode(" (" + mb(f.size) + " MB)"));
    });
    frag.appendChild(document.createTextNode("."));
  }
  frag.appendChild(document.createTextNode(restGeht
    ? " Die übrigen werden hochgeladen."
    : " Es wurde nichts hochgeladen."));
  return frag;
}

// root-skopiert: Das Upload-Formular sitzt in der Titelleiste des
// Dateifensters und wird beim Ordnerwechsel mitgetauscht (folder-nav.js) —
// ohne erneutes Binden verpufft die Dateiauswahl nach der ersten Navigation.
export function bindUpload(root) {
  var uploadForm = root.querySelector(".upload-form");
  if (!uploadForm) return;
  var uploadInput = uploadForm.querySelector("input[type=file]");
  // Basis-URL aus der Formular-Action ableiten (beruecksichtigt BASE_PATH)
  var basis = uploadForm.action.replace(/\/upload(\?.*)?$/, "");

  uploadForm.querySelector(".upload-btn").addEventListener("click", function () {
    uploadInput.click();
  });

  uploadInput.addEventListener("change", function () {
    var dateien = Array.prototype.slice.call(uploadInput.files);
    if (!dateien.length) return;
    var maxMb = parseInt(uploadForm.dataset.maxMb, 10) || 128;
    var maxFiles = parseInt(uploadForm.dataset.maxFiles, 10) || 50;

    // Zu viele auf einmal: das lässt sich nicht sinnvoll aussortieren
    // (welche wären die richtigen?) — hier hilft nur eine klare Ansage.
    if (dateien.length > maxFiles) {
      showNotice("Zu viele Dateien", "Es wurden " + dateien.length
        + " Dateien ausgewählt — hochladen lassen sich höchstens " + maxFiles
        + " auf einmal. Bitte in mehreren Schritten hochladen.", { danger: true });
      uploadInput.value = "";
      return;
    }

    var zuGross = dateien.filter(function (f) { return f.size > maxMb * 1024 * 1024; });
    if (zuGross.length) {
      var rest = dateien.filter(function (f) { return f.size <= maxMb * 1024 * 1024; });
      var restGeht = rest.length > 0 && ohneZuGrosse(uploadInput, rest);
      showNotice(zuGross.length === 1 ? "Datei zu groß" : "Dateien zu groß",
        zuGrossMeldung(zuGross, maxMb, restGeht), {
          danger: true,
          // Ein Symbol ergibt nur bei genau einer Datei Sinn — bei mehreren
          // waere die Wahl willkuerlich.
          icon: zuGross.length === 1
            ? basis + "/static/img/" + iconForName(zuGross[0].name) + ".svg"
            : null,
        });
      if (!restGeht) {
        uploadInput.value = ""; // Auswahl verwerfen, sonst haengt sie im Formular
        return;
      }
      // Der Hinweis muss auch gelesen werden koennen: ein sofortiges submit()
      // navigiert die Seite weg und reisst den gerade geoeffneten Dialog im
      // selben Moment mit. Also erst hochladen, wenn er weggeklickt ist.
      var dlg = document.getElementById("dlg-notice");
      if (dlg && dlg.open) {
        dlg.addEventListener("close", function () { uploadForm.submit(); }, { once: true });
        return;
      }
      // ohne Dialog (Rueckfallebene window.alert): direkt weiter
    }

    uploadForm.submit();
  });
}

export function initUpload() {
  bindUpload(document);
}
