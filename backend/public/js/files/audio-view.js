// Ton-Wiedergabe: Klick auf eine Tondatei in der Dateiliste spielt sie im
// Dialog (#dlg-audio) ab — mit dem eingebauten <audio> des Browsers, ohne
// jede zusaetzliche Bibliothek. Das Springen erledigt der Browser selbst ueber
// Bereichsabrufe; die Server-Route beantwortet sie (routes/media.js).
//
// Der Unterschied zum Video-Dialog ist die WIEDERGABELISTE, und sie ist der
// eigentliche Zweck: Lehrmaterial liegt als Dutzende Einzelstuecke vor (ein
// Hoerbuch als 88 Kapitel zu je acht Minuten). Jedes davon einzeln aus der
// Dateiliste zu suchen waere zwar "abspielbar", aber unbenutzbar.
//
// Die Liste kostet dabei KEINEN Server-Abruf: die anderen Tondateien stehen
// bereits als Schaltflaechen in der Seite.
//
// SORTIERT wird sie aber NACH NAMEN, aufsteigend und mit Zahlenverstaendnis —
// ausdruecklich NICHT in der Reihenfolge der Dateiliste. Das war zuerst anders
// gedacht ("zeig es so, wie es dasteht"), ist aber falsch: die Liste steht per
// Vorgabe auf Datum, neueste zuerst (foldersort.js). Ein Hoerbuch liefe damit
// rueckwaerts — gemessen: Kapitel 12, 11, 10. Und die Kopierzeitpunkte einer
// eingespielten Sammlung sagen ohnehin nichts ueber die Reihenfolge.
// Wo die Reihenfolge eines Hoerbuchs wirklich steht, ist der Dateiname
// ("...-01-kapitel", "...-02-kapitel"), und "numeric" sorgt dafuer, dass
// Kapitel 9 vor 10 kommt statt dazwischen.
//
// bindAudioOpen ist root-skopiert: die Liste wird beim Ordnerwechsel getauscht
// (js/folder-nav.js ruft die Funktion erneut auf).
import { openDlg } from "../core/dialogs.js";

// Gehoerte Stellen, je Quelle eine Sekundenzahl. Bei Stuecken von acht Minuten
// ist "wo war ich?" die haeufigste Frage nach dem Wiederoeffnen — und bei
// einem Hoerbuch die einzige, die zaehlt.
var POS_KEY = "relay-audio-pos";
// Ob automatisch weitergespielt wird. Wer Hoerbuecher hoert, will das immer;
// wer Uebungsstuecke einzeln braucht, nie. Also merken statt jedes Mal fragen.
var AUTO_KEY = "relay-audio-auto";
// Obergrenze der gemerkten Stellen. Ohne sie wuechse der Eintrag mit jeder je
// geoeffneten Datei weiter — bei einer grossen Sammlung endlos. Beim
// Ueberlauf fliegen die aeltesten heraus (der Eintrag ist nach Alter
// geordnet: neu Geschriebenes wandert ans Ende).
var POS_MAX = 300;
// Unter dieser Sekundenzahl lohnt sich Merken nicht (man hat gerade erst
// angefangen), und so kurz vor Schluss ebenso wenig — dort waere Fortsetzen
// nur laestig, weil sofort wieder das Ende kaeme.
var POS_MIN_SEK = 15;
var POS_REST_SEK = 20;

// --- gemerkte Stellen -------------------------------------------------
// localStorage kann fehlschlagen (privates Fenster, gesperrte Seitendaten).
// Das darf die Wiedergabe nie aufhalten — im Zweifel wird eben nichts gemerkt.
function stellen() {
  try { return JSON.parse(localStorage.getItem(POS_KEY) || "{}") || {}; }
  catch (e) { return {}; }
}
function merkeStelle(src, sek) {
  try {
    var alle = stellen();
    // Erst loeschen, dann setzen: so steht der Schluessel hinten und die
    // Reihenfolge im Objekt bleibt "aelteste zuerst".
    delete alle[src];
    alle[src] = Math.floor(sek);
    var schluessel = Object.keys(alle);
    for (var i = 0; i < schluessel.length - POS_MAX; i++) delete alle[schluessel[i]];
    localStorage.setItem(POS_KEY, JSON.stringify(alle));
  } catch (e) { /* ohne Gedaechtnis weiterspielen ist besser als abbrechen */ }
}
function vergissStelle(src) {
  try {
    var alle = stellen();
    delete alle[src];
    localStorage.setItem(POS_KEY, JSON.stringify(alle));
  } catch (e) { /* egal */ }
}

// mm:ss, und ab einer Stunde h:mm:ss
function zeit(sek) {
  if (!isFinite(sek) || sek < 0) return "";
  var s = Math.floor(sek % 60), m = Math.floor(sek / 60) % 60, h = Math.floor(sek / 3600);
  var zwei = function (n) { return (n < 10 ? "0" : "") + n; };
  return h ? h + ":" + zwei(m) + ":" + zwei(s) : m + ":" + zwei(s);
}

// --- Zustand des offenen Dialogs --------------------------------------
// Bewusst ein Modulzustand und kein Feld am Element: es gibt genau einen
// Ton-Dialog, und die Liste gilt nur, solange er offen ist.
var liste = [];      // [{ src, download, label }]
var stelle = -1;     // Index des laufenden Stuecks in `liste`

export function bindAudioOpen(root) {
  var dlg = document.getElementById("dlg-audio");
  if (!dlg) return;

  root.querySelectorAll(".audio-open").forEach(function (btn) {
    btn.addEventListener("click", function () {
      // Die Wiedergabeliste ist das, was in DERSELBEN Liste steht wie der
      // angeklickte Knopf. `root` waere falsch: beim Ordnerwechsel ist das
      // der getauschte Seitenteil, bei der Suche die Trefferliste — der
      // naechstgelegene gemeinsame Behaelter trifft beides richtig.
      var behaelter = btn.closest(".files, .app-search-scroll") || document;
      var knoepfe = Array.prototype.slice.call(behaelter.querySelectorAll(".audio-open"));
      if (knoepfe.indexOf(btn) === -1) knoepfe = [btn];   // Sonderfall: allein
      liste = knoepfe.map(function (k) {
        return { src: k.dataset.src, download: k.dataset.download, label: k.dataset.label };
      }).sort(function (a, b) {
        return a.label.localeCompare(b.label, "de", { numeric: true, sensitivity: "base" });
      });
      zeichneListe(dlg);
      dlg.style.left = ""; dlg.style.top = ""; dlg.style.margin = "";
      openDlg(dlg);
      // Der Index gilt in der SORTIERTEN Liste, nicht im DOM — nach dem
      // Umsortieren steht das angeklickte Stueck woanders.
      var start = liste.findIndex(function (x) { return x.src === btn.dataset.src; });
      spiele(dlg, start === -1 ? 0 : start);
    });
  });
}

// Ein Stueck laden und starten.
function spiele(dlg, index) {
  if (index < 0 || index >= liste.length) return;
  var audio = document.getElementById("dlg-audio-player");
  var titel = document.getElementById("dlg-audio-title");
  var dl = document.getElementById("dlg-audio-download");
  var err = document.getElementById("dlg-audio-err");

  // Die Stelle des BISHERIGEN Stuecks sichern, bevor die Quelle wechselt.
  sichereStelle(audio);

  stelle = index;
  var stueck = liste[index];
  titel.textContent = stueck.label;
  dl.href = stueck.download;
  err.hidden = true;
  audio.hidden = false;
  // Quelle erst jetzt setzen: sonst begaenne die Seite fuer JEDE Tondatei
  // schon die Kopfdaten zu holen.
  audio.src = stueck.src;

  markiere(dlg);
  standText();

  // Sofort losspielen. Der Klick IST die Nutzergeste, die Browser fuer Ton
  // verlangen. Lehnt einer trotzdem ab (strenge Autoplay-Einstellung), bleibt
  // der Abspielknopf stehen — darum play() statt eines autoplay-Attributs:
  // nur so laesst sich die Ablehnung abfangen.
  var gestartet = audio.play();
  if (gestartet && gestartet.catch) gestartet.catch(function () { /* Nutzer startet selbst */ });
}

function sichereStelle(audio) {
  var src = audio.getAttribute("src");
  if (!src) return;
  var t = audio.currentTime, d = audio.duration;
  if (!isFinite(t)) return;
  if (t >= POS_MIN_SEK && (!isFinite(d) || t < d - POS_REST_SEK)) merkeStelle(src, t);
  else vergissStelle(src);
  zeigeMarke(src);
}

// Die Marke EINER Zeile auf den aktuellen Stand bringen. Ohne das blieb eine
// einmal gezeichnete Marke stehen, bis der Dialog neu geoeffnet wurde — nach
// dem Durchhoeren stand in der Liste also noch "bei 0:47", obwohl die Stelle
// laengst vergessen war.
function zeigeMarke(src) {
  var i = liste.findIndex(function (x) { return x.src === src; });
  if (i === -1) return;
  var li = document.getElementById("dlg-audio-liste").children[i];
  if (!li) return;
  var btn = li.querySelector(".audio-stueck-btn");
  if (!btn) return;
  var alt = btn.querySelector(".audio-marke");
  var sek = stellen()[src];
  if (!sek) { if (alt) alt.remove(); return; }
  var marke = alt || document.createElement("span");
  marke.className = "audio-marke";
  marke.textContent = "bei " + zeit(sek);
  if (!alt) btn.appendChild(marke);
}

// Die Liste einmal aufbauen. Danach wird nur noch die Markierung umgehaengt —
// die Eintraege selbst aendern sich nicht, solange der Dialog offen ist.
function zeichneListe(dlg) {
  var behaelter = document.getElementById("dlg-audio-playlist");
  var ul = document.getElementById("dlg-audio-liste");
  var steuer = document.getElementById("dlg-audio-steuer");
  // Ein einzelnes Stueck braucht weder Liste noch Vor/Zurueck — dann ist der
  // Dialog genau das, was er beim Video auch ist.
  var mehrere = liste.length > 1;
  behaelter.hidden = !mehrere;
  steuer.hidden = !mehrere;
  ul.textContent = "";
  if (!mehrere) return;

  var alle = stellen();
  liste.forEach(function (stueck, i) {
    var li = document.createElement("li");
    li.className = "audio-stueck";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "audio-stueck-btn";
    var nr = document.createElement("span");
    nr.className = "audio-nr";
    nr.textContent = String(i + 1);
    var name = document.createElement("span");
    name.className = "audio-name";
    name.textContent = stueck.label;
    btn.appendChild(nr);
    btn.appendChild(name);
    // Angehoert und mittendrin stehengeblieben? Das gehoert sichtbar in die
    // Liste — sonst muesste man jedes Stueck einzeln oeffnen, um es zu sehen.
    if (alle[stueck.src]) {
      var marke = document.createElement("span");
      marke.className = "audio-marke";
      marke.textContent = "bei " + zeit(alle[stueck.src]);
      btn.appendChild(marke);
    }
    btn.addEventListener("click", function () { spiele(dlg, i); });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// Laufendes Stueck hervorheben und ins Bild holen.
function markiere(dlg) {
  var ul = document.getElementById("dlg-audio-liste");
  var kinder = ul.children;
  for (var i = 0; i < kinder.length; i++) {
    var an = i === stelle;
    kinder[i].classList.toggle("audio-laeuft", an);
    if (an && kinder[i].scrollIntoView) {
      kinder[i].scrollIntoView({ block: "nearest" });
    }
  }
  var prev = document.getElementById("dlg-audio-prev");
  var next = document.getElementById("dlg-audio-next");
  prev.disabled = stelle <= 0;
  next.disabled = stelle >= liste.length - 1;
}

function standText() {
  var stand = document.getElementById("dlg-audio-stand");
  stand.textContent = liste.length > 1 ? "Stück " + (stelle + 1) + " von " + liste.length : "";
}

// Einmalige Verdrahtung des Dialogs selbst (nicht der Liste).
export function initAudioView() {
  var dlg = document.getElementById("dlg-audio");
  if (dlg) {
    var audio = document.getElementById("dlg-audio-player");
    var err = document.getElementById("dlg-audio-err");
    var auto = document.getElementById("dlg-audio-auto");

    auto.checked = localStorage.getItem(AUTO_KEY) !== "0";
    auto.addEventListener("change", function () {
      try { localStorage.setItem(AUTO_KEY, auto.checked ? "1" : "0"); } catch (e) { /* egal */ }
    });

    document.getElementById("dlg-audio-prev").addEventListener("click", function () {
      spiele(dlg, stelle - 1);
    });
    document.getElementById("dlg-audio-next").addEventListener("click", function () {
      spiele(dlg, stelle + 1);
    });

    // Gemerkte Stelle anfahren, sobald die Laufzeit bekannt ist. Erst dann
    // laesst sich currentTime setzen — vorher weiss der Browser nicht, wohin.
    audio.addEventListener("loadedmetadata", function () {
      var src = audio.getAttribute("src");
      var sek = src ? stellen()[src] : 0;
      if (sek && isFinite(audio.duration) && sek < audio.duration - POS_REST_SEK) {
        audio.currentTime = sek;
      }
    });

    // Laufend sichern, nicht erst beim Schliessen: ein geschlossener Laptop
    // oder ein abgestuerzter Reiter feuert kein "close".
    var zuletzt = 0;
    audio.addEventListener("timeupdate", function () {
      var jetzt = Date.now();
      if (jetzt - zuletzt < 5000) return;   // timeupdate feuert ~4x je Sekunde
      zuletzt = jetzt;
      sichereStelle(audio);
    });

    // Durchgehoert: die Stelle ist wertlos geworden, und wenn gewuenscht geht
    // es weiter. Am Ende der Liste bleibt es stehen — von vorn zu beginnen
    // waere bei einem Hoerbuch das Gegenteil des Gewollten.
    audio.addEventListener("ended", function () {
      var src = audio.getAttribute("src");
      if (src) { vergissStelle(src); zeigeMarke(src); }
      if (auto.checked && stelle < liste.length - 1) spiele(dlg, stelle + 1);
      else markiere(dlg);
    });

    // Schliessen muss die Quelle WEGNEHMEN, nicht nur pausieren: sonst laedt
    // der Browser im Hintergrund weiter und der Ton kann weiterlaufen.
    dlg.addEventListener("close", function () {
      sichereStelle(audio);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      liste = [];
      stelle = -1;
    });

    // Kann der Browser das Format nicht, bliebe sonst ein toter Player stehen
    // — stattdessen der Hinweis mit dem Weg zum Herunterladen.
    audio.addEventListener("error", function () {
      if (!audio.getAttribute("src")) return;   // Aufraeumen beim Schliessen
      audio.hidden = true;
      err.hidden = false;
    });
  }
  bindAudioOpen(document);
}
