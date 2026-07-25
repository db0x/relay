// Tooltips (data-tip + Freigabe-Tooltip) sind position:fixed, damit sie im
// scrollbaren Tabellen-Wrapper keine Scrollbalken erzeugen — die Zielposition
// (mittig unter dem Element) wird hier beim Hover/Fokus als CSS-Variablen gesetzt

function placeTip(el) {
  var r = el.getBoundingClientRect();
  el.style.setProperty("--tip-x", (r.left + r.width / 2) + "px");
  el.style.setProperty("--tip-y", (r.bottom + 6) + "px");
}

// Koordinaten nach dem Ausblenden wieder entfernen: waehrend der
// Dialog-Animationen (transform!) wuerde ein Dialog kurz zum Bezugsrahmen
// der fixen Tooltips — gespeicherte Viewport-Koordinaten laegen dann weit
// ausserhalb und erzeugten fluechtige Scrollbalken im Dialog.
function clearTip(el) {
  setTimeout(function () { // erst nach dem .12s-Fade, sonst springt er beim Ausblenden
    el.style.removeProperty("--tip-x");
    el.style.removeProperty("--tip-y");
  }, 150);
}

// root-skopiert: nach einem Ordnerwechsel nur die neuen Listen-Elemente binden;
// Topbar-/Dialog-Tooltips ausserhalb #page behalten ihre Bindung vom Erststart.
export function bindTips(root) {
  root.querySelectorAll("[data-tip], .share-badge").forEach(function (el) {
    el.addEventListener("mouseenter", function () { placeTip(el); });
    el.addEventListener("focus", function () { placeTip(el); });
    el.addEventListener("mouseleave", function () { clearTip(el); });
    el.addEventListener("blur", function () { clearTip(el); });
  });
  // Lange Dateinamen (Liste) und Dialog-Titel sind per Ellipsis gekuerzt (CSS);
  // der volle Text erscheint als Tooltip — aber nur, wenn wirklich abgeschnitten
  root.querySelectorAll(".fname:not(.note-open), .dialog-head h2").forEach(function (el) {
    el.addEventListener("mouseenter", function () {
      if (el.scrollWidth > el.clientWidth) {
        el.dataset.tip = el.textContent.trim().replace(/\s+/g, " ");
        placeTip(el);
      } else {
        delete el.dataset.tip;
      }
    });
    el.addEventListener("mouseleave", function () { clearTip(el); });
  });
}

export function initTooltips() {
  bindTips(document);
}
