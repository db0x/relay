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
// Vom Nutzer gezogene Groesse des Dialogs ("BREITExHOEHE"), wie beim
// Notiz-Dialog. Gilt nur fuer die normale Groesse — im Fenstermodus bestimmt
// das Fenster die Masse.
var SIZE_KEY = "relay-video-size";

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
      // Bei jedem Oeffnen wieder mittig: eine frueher beim Ziehen eingefrorene
      // Lage soll nicht ewig kleben bleiben (margin:auto zentriert erneut).
      dlg.style.left = ""; dlg.style.top = ""; dlg.style.margin = "";
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
    // Gemerkte Groesse anwenden — nie groesser als das Fenster, sonst haengt
    // der Griff nach einem Wechsel auf einen kleineren Bildschirm ausserhalb.
    var holeGroesse = function () {
      var g = (localStorage.getItem(SIZE_KEY) || "").split("x");
      var b = parseInt(g[0], 10), h = parseInt(g[1], 10);
      if (!b || !h) return null;
      return { b: Math.min(b, window.innerWidth - 32), h: Math.min(h, window.innerHeight - 32) };
    };
    var setzeGroesse = function () {
      var g = holeGroesse();
      dlg.style.width = g ? g.b + "px" : "";
      dlg.style.height = g ? g.h + "px" : "";
    };

    var setzeGross = function (an) {
      // Der Fenstermodus rechnet in 100vw/100vh — eine gezogene Groesse steht
      // als Inline-Stil davor und wuerde gewinnen. Also im Fenstermodus weg,
      // beim Zurueckschalten wieder her.
      if (an) { dlg.style.width = ""; dlg.style.height = ""; } else { setzeGroesse(); }
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

    // --- Skalieren am Griff unten rechts -------------------------------
    // Gleiches Muster wie beim Notiz-Dialog (js/notes/note-dialog.js): der
    // Dialog haengt an margin:auto und ist damit zentriert — beim Ziehen
    // wuechse er sonst in BEIDE Richtungen und die Ecke liefe dem Zeiger
    // davon. Darum zuerst die aktuelle Lage festnageln.
    var griff = document.getElementById("dlg-video-resize");
    if (griff) {
      griff.addEventListener("pointerdown", function (e) {
        if (e.button !== 0 || dlg.classList.contains("video-max")) return;
        var r = dlg.getBoundingClientRect();
        dlg.style.left = r.left + "px";
        dlg.style.top = r.top + "px";
        dlg.style.margin = "0";
        var sx = e.clientX, sy = e.clientY;
        function move(ev) {
          // Untergrenzen zieht das CSS ein (min-width/min-height)
          dlg.style.width = (r.width + ev.clientX - sx) + "px";
          dlg.style.height = (r.height + ev.clientY - sy) + "px";
        }
        function stop() {
          griff.removeEventListener("pointermove", move);
          griff.removeEventListener("pointerup", stop);
          griff.removeEventListener("pointercancel", stop);
          // offsetWidth/-Height statt getBoundingClientRect: der Dialog faehrt
          // mit transform:scale(.97) auf, das Rechteck enthielte diese
          // Skalierung — gemerkt wuerde er dann bei jedem Mal etwas kleiner.
          localStorage.setItem(SIZE_KEY, dlg.offsetWidth + "x" + dlg.offsetHeight);
        }
        griff.setPointerCapture(e.pointerId);
        griff.addEventListener("pointermove", move);
        griff.addEventListener("pointerup", stop);
        griff.addEventListener("pointercancel", stop);
        e.preventDefault();
      });
    }
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
