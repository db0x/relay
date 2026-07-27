// Bild-Vorschau: Klick auf einen Bildnamen in der Dateiliste zeigt das Bild
// gross im Dialog (#dlg-image) statt es an OnlyOffice zu geben — das kann mit
// Bildern nichts anfangen.
//
// Beide Funktionen sind root-skopiert: Liste und Vorschaubilder werden beim
// Ordnerwechsel mitgetauscht (js/folder-nav.js ruft sie erneut auf).
import { openDlg } from "../core/dialogs.js";

export function bindImageOpen(root) {
  var dlg = document.getElementById("dlg-image");
  if (!dlg) return;
  var img = document.getElementById("dlg-image-img");
  var title = document.getElementById("dlg-image-title");
  var dl = document.getElementById("dlg-image-download");

  root.querySelectorAll(".image-open").forEach(function (btn) {
    btn.addEventListener("click", function () {
      title.textContent = btn.dataset.label;
      img.alt = btn.dataset.label;
      // Quelle erst jetzt setzen: sonst laed die Startseite jedes Bild in
      // voller Groesse mit, obwohl man vielleicht keines ansieht
      img.src = btn.dataset.src;
      dl.href = btn.dataset.download;
      openDlg(dlg);
    });
  });
}

// Vorschaubilder in der Liste: laesst sich eines nicht darstellen (kaputte
// Datei, unbekannte Variante), tritt das allgemeine Bild-Icon an seine Stelle.
// Ohne das bliebe ein leerer Rahmen stehen.
export function bindImageThumbs(root) {
  function fallback(el) {
    if (el.dataset.failed) return; // nur einmal tauschen
    el.dataset.failed = "1";
    el.src = el.dataset.fallback;
    el.classList.remove("ficon-thumb");
  }
  root.querySelectorAll(".ficon-thumb[data-fallback]").forEach(function (el) {
    el.addEventListener("error", function () { fallback(el); });
    // WICHTIG: Das Bild laedt schon waehrend des Parsens, dieses Modul laeuft
    // als ES-Modul aber erst danach — ein Fehler kann also laengst passiert
    // sein, bevor der Listener haengt. Darum den Zustand zusaetzlich pruefen:
    // fertig geladen (complete) UND ohne Masse (naturalWidth 0) = gescheitert.
    if (el.complete && el.naturalWidth === 0) fallback(el);
  });
}

export function initImageView() {
  bindImageOpen(document);
  bindImageThumbs(document);
}
