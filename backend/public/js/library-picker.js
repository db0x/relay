// Ordnerauswahl im Bibliotheks-Dialog (Nutzerverwaltung).
//
// Der Baum ist eine flache Liste in VORORDNUNG: jeder Ordner steht direkt vor
// seinen Kindern, die Tiefe steht in data-tiefe (routes/browse.js:
// library.folderTree). Damit reicht EIN Durchlauf von oben nach unten, um
// beides zu bestimmen — was eingeklappt ist und was von einer Freigabe weiter
// oben abgedeckt wird.
//
// Aufklappen: Standard ist ZU. Eine echte Filmsammlung hat hunderte Ordner,
// die alle auf einmal waeren nicht handhabbar. Aufgeklappt startet nur, was
// zu einem bereits erteilten Recht fuehrt — so sieht der Admin den aktuellen
// Stand, ohne zu suchen.
//
// Abdeckung: eine Freigabe gilt fuer ALLES darunter; die abgedeckten
// Unterordner werden angehakt, gesperrt und gedaempft. Gesperrte Felder
// schickt der Browser nicht mit — genau richtig, denn library.setGrants
// wuerde sie ohnehin verwerfen. Die eigene Wahl geht dabei nicht verloren:
// sie liegt in data-eigen und kehrt zurueck, sobald der Haken oben faellt.
// WICHTIG: Die Abdeckung wird unabhaengig von der Sichtbarkeit gerechnet —
// ein eingeklappter Zweig wird genauso abgedeckt wie ein offener.
export function initLibraryPicker() {
  document.querySelectorAll(".lib-list").forEach(function (liste) {
    var zeilen = Array.prototype.slice.call(liste.querySelectorAll(".lib-row"));
    if (!zeilen.length) return;
    var rahmen = liste.closest(".stack-form") || liste.closest("dialog") || document;
    var alleBtn = rahmen.querySelector(".lib-alle");

    var tiefeVon = function (z) { return Number(z.dataset.tiefe); };
    var boxVon = function (z) { return z.querySelector('input[type="checkbox"]'); };
    // ein ECHTES Recht: angehakt und nicht bloss von oben abgedeckt
    var eigenesRecht = function (z) { var b = boxVon(z); return b.checked && !b.disabled; };

    function anwenden() {
      // Zwei unabhaengige Zaehler, ein Durchlauf:
      //   deckel    — Tiefe des obersten gesetzten Hakens (-1 = nichts abgedeckt)
      //   zuAb      — Tiefe des obersten eingeklappten Ordners (-1 = alles sichtbar)
      var deckel = -1;
      var zuAb = -1;
      zeilen.forEach(function (z) {
        var tiefe = tiefeVon(z);
        var box = boxVon(z);
        var alias = z.querySelector(".lib-alias");

        // --- Sichtbarkeit ---
        if (zuAb !== -1 && tiefe <= zuAb) zuAb = -1;   // Zweig verlassen
        z.hidden = zuAb !== -1;
        if (!z.hidden && z.dataset.kinder === "1" && z.dataset.offen !== "1") zuAb = tiefe;

        // --- Abdeckung (gilt auch fuer eingeklappte Zeilen) ---
        if (deckel !== -1 && tiefe <= deckel) deckel = -1;
        if (deckel !== -1) {
          if (z.dataset.eigen === undefined) z.dataset.eigen = box.checked ? "1" : "0";
          box.checked = true;
          box.disabled = true;
          z.classList.add("lib-node-abgedeckt");
          alias.disabled = true;
          return;
        }
        if (z.dataset.eigen !== undefined) {
          box.checked = z.dataset.eigen === "1";
          delete z.dataset.eigen;
        }
        box.disabled = false;
        z.classList.remove("lib-node-abgedeckt");
        alias.disabled = !box.checked;
        if (box.checked) deckel = tiefe;
      });

      // Ein zugeklappter Ordner darf nicht verschweigen, dass in ihm etwas
      // freigegeben ist — sonst sucht der Admin den Haken, den er gesetzt hat.
      // Sein Pfeil wird dann hervorgehoben.
      zeilen.forEach(function (z, i) {
        var pfeil = z.querySelector("button.lib-twist");
        if (!pfeil) return;
        var offen = z.dataset.offen === "1";
        pfeil.setAttribute("aria-expanded", offen ? "true" : "false");
        var drin = false;
        for (var j = i + 1; j < zeilen.length && tiefeVon(zeilen[j]) > tiefeVon(z); j++) {
          if (eigenesRecht(zeilen[j])) { drin = true; break; }
        }
        z.classList.toggle("lib-row-gefuellt", drin && !offen);
      });

      if (alleBtn) {
        var zuKlappende = zeilen.filter(function (z) { return z.dataset.kinder === "1"; });
        var alleOffen = zuKlappende.length > 0
          && zuKlappende.every(function (z) { return z.dataset.offen === "1"; });
        alleBtn.setAttribute("aria-expanded", alleOffen ? "true" : "false");
        alleBtn.textContent = alleOffen ? "Alle zuklappen" : "Alle aufklappen";
      }
    }

    // Startzustand: die Wege zu den bereits erteilten Rechten offen legen.
    // In der Vorordnung sind die Vorfahren einer Zeile genau die Eintraege,
    // die bei kleinerer Tiefe zuletzt vor ihr kamen — ein mitgefuehrter
    // Stapel liefert sie ohne Suche. (Hier ist noch nichts gesperrt, ein
    // Haken bedeutet also wirklich ein eigenes Recht.)
    (function oeffneErteilte() {
      var stapel = [];
      zeilen.forEach(function (z) {
        var t = tiefeVon(z);
        stapel.length = t;                      // tiefere Ebenen verwerfen
        if (eigenesRecht(z)) {
          stapel.forEach(function (v) { if (v) v.dataset.offen = "1"; });
        }
        stapel[t] = z;
      });
    })();

    liste.addEventListener("change", anwenden);
    liste.addEventListener("click", function (e) {
      var pfeil = e.target.closest("button.lib-twist");
      if (!pfeil) return;
      var z = pfeil.closest(".lib-row");
      z.dataset.offen = z.dataset.offen === "1" ? "0" : "1";
      anwenden();
    });
    if (alleBtn) {
      alleBtn.addEventListener("click", function () {
        var auf = alleBtn.getAttribute("aria-expanded") !== "true";
        zeilen.forEach(function (z) {
          if (z.dataset.kinder === "1") z.dataset.offen = auf ? "1" : "0";
        });
        anwenden();
      });
    }
    anwenden();
  });
}
