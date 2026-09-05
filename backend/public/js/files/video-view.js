// Video-Wiedergabe: Klick auf einen Videonamen in der Dateiliste spielt es im
// Dialog (#dlg-video) ab — mit dem eingebauten <video> des Browsers, ohne
// jede zusaetzliche Bibliothek. Das Springen im Film erledigt der Browser
// selbst ueber Bereichsabrufe; die Server-Route beantwortet sie
// (routes/media.js).
//
// bindVideoOpen ist root-skopiert: die Liste wird beim Ordnerwechsel
// getauscht (js/folder-nav.js ruft die Funktion erneut auf).
import { openDlg } from "../core/dialogs.js";

// Merkt sich, ob der Dialog zuletzt auf Fenstergroesse stand — wer Filme so
// schaut, will das beim naechsten auch (gleiches Muster wie beim Filter
// "Nur eigene Dateien").
var MAX_KEY = "relay-video-max";

export function bindVideoOpen(root) {
  var dlg = document.getElementById("dlg-video");
  if (!dlg) return;
  var video = document.getElementById("dlg-video-player");
  var title = document.getElementById("dlg-video-title");
  var err = document.getElementById("dlg-video-err");
  var dl = document.getElementById("dlg-video-download");

  root.querySelectorAll(".video-open").forEach(function (btn) {
    btn.addEventListener("click", function () {
      title.textContent = btn.dataset.label;
      dl.href = btn.dataset.download;
      err.hidden = true;
      video.hidden = false;
      // Quelle erst jetzt setzen: sonst begaenne die Startseite fuer JEDES
      // Video schon die Kopfdaten zu holen
      video.src = btn.dataset.src;
      openDlg(dlg);
      // Sofort losspielen. Der Klick auf den Dateinamen IST die Nutzergeste,
      // die Browser fuer Ton verlangen. Lehnt einer trotzdem ab (strenge
      // Autoplay-Einstellung), bleibt einfach der Abspielknopf stehen — das
      // ist der Grund fuer play() hier statt eines autoplay-Attributs: nur so
      // laesst sich die Ablehnung abfangen, statt sie in der Konsole landen
      // zu lassen.
      var gestartet = video.play();
      if (gestartet && gestartet.catch) gestartet.catch(function () { /* Nutzer startet selbst */ });
    });
  });
}

// Einmalige Verdrahtung des Dialogs selbst (nicht der Liste): Aufraeumen beim
// Schliessen und der Rueckfall fuer Formate, die der Browser nicht kann.
export function initVideoView() {
  var dlg = document.getElementById("dlg-video");
  if (dlg) {
    var video = document.getElementById("dlg-video-player");
    var err = document.getElementById("dlg-video-err");
    // "Auf Fenstergroesse": vergroessert den DIALOG, nicht den Bildschirm.
    // Das echte Vollbild bleibt der Knopf des Players — dort verschwindet
    // alles andere, hier bleiben Kopfzeile und Seite dahinter sichtbar.
    var maxBtn = document.getElementById("dlg-video-max");
    var setzeGross = function (an) {
      dlg.classList.toggle("video-max", an);
      maxBtn.setAttribute("aria-pressed", an ? "true" : "false");
      var text = an ? "Auf normale Größe" : "Auf Fenstergröße vergrößern";
      maxBtn.dataset.tip = text;
      maxBtn.setAttribute("aria-label", text);
      localStorage.setItem(MAX_KEY, an ? "1" : "0");
    };
    maxBtn.addEventListener("click", function () {
      setzeGross(!dlg.classList.contains("video-max"));
    });
    setzeGross(localStorage.getItem(MAX_KEY) === "1");
    // Schliessen muss die Quelle WEGNEHMEN, nicht nur pausieren: sonst laedt
    // der Browser im Hintergrund weiter und der Ton kann weiterlaufen.
    // removeAttribute + load() ist der dafuer vorgesehene Weg.
    dlg.addEventListener("close", function () {
      video.pause();
      video.removeAttribute("src");
      video.load();
    });
    // Kann der Browser das Format nicht (mkv/avi mit fremdem Codec), bleibt
    // sonst ein schwarzes Rechteck stehen — stattdessen der Hinweis mit dem
    // Weg zum Herunterladen.
    video.addEventListener("error", function () {
      if (!video.getAttribute("src")) return; // Aufraeumen beim Schliessen
      video.hidden = true;
      err.hidden = false;
    });
  }
  bindVideoOpen(document);
}
