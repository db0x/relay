// Tooltips (data-tip + Freigabe-Tooltip) sind position:fixed, damit sie im
// scrollbaren Tabellen-Wrapper keine Scrollbalken erzeugen — die Zielposition
// (mittig unter dem Element) wird hier beim Hover/Fokus als CSS-Variablen gesetzt

// Nach unten reichender Platz fuer einen einzeiligen Tooltip (Hoehe + Abstand).
// Reicht er nicht, klappt der Tooltip nach OBEN — sonst laege er bei Elementen
// am unteren Bildschirmrand (Dock!) ausserhalb des Sichtbereichs.
var TIP_SPACE = 56;

function placeTip(el) {
  var r = el.getBoundingClientRect();
  var flip = r.bottom + TIP_SPACE > window.innerHeight;
  // Der Tooltip ist ein ::after — seine Breite laesst sich nur ueber
  // getComputedStyle erfragen (er ist visibility:hidden, hat also Layout).
  // Damit bleibt er auch nahe am Bildschirmrand vollstaendig sichtbar,
  // statt (mittig verankert) links oder rechts abgeschnitten zu werden.
  var half = (parseFloat(getComputedStyle(el, "::after").width) || 0) / 2;
  var cx = r.left + r.width / 2;
  if (half) cx = Math.min(Math.max(cx, 8 + half), window.innerWidth - 8 - half);
  el.style.setProperty("--tip-x", cx + "px");
  el.style.setProperty("--tip-y", (flip ? r.top - 6 : r.bottom + 6) + "px");
  // --tip-shift verschiebt den Tooltip beim Hochklappen um seine eigene
  // Hoehe nach oben (die kennt nur das CSS, es ist ein ::after)
  if (flip) el.style.setProperty("--tip-shift", "-100%");
  else el.style.removeProperty("--tip-shift");
}

// Koordinaten nach dem Ausblenden wieder entfernen: waehrend der
// Dialog-Animationen (transform!) wuerde ein Dialog kurz zum Bezugsrahmen
// der fixen Tooltips — gespeicherte Viewport-Koordinaten laegen dann weit
// ausserhalb und erzeugten fluechtige Scrollbalken im Dialog.
function clearTip(el) {
  setTimeout(function () { // erst nach dem .12s-Fade, sonst springt er beim Ausblenden
    el.style.removeProperty("--tip-x");
    el.style.removeProperty("--tip-y");
    el.style.removeProperty("--tip-shift");
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
