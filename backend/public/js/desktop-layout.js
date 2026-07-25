// Frei platzierbares "Desktop"-Layout: die Dokumentenliste (.page-Karte) und
// die Notiz-Icons lassen sich beide frei ziehen; Positionen werden gemerkt
// (POST /desktop/layout bzw. /notes/desktop). Beide teilen sich dieselbe
// Ziehmechanik und Untergrenze (nie hinter der Titelleiste).
//
// config: { baseUrl, hideNoteTip } — hideNoteTip blendet die Notiz-Hover-
// Vorschau aus, sobald ein Icon gezogen wird.
export function initDesktopLayout(config) {
  var baseUrl = config.baseUrl;
  var hideNoteTip = config.hideNoteTip;

  // Untergrenze fuer alle frei platzierten Elemente: unter der Titelleiste,
  // damit nichts hinter ihr verschwindet
  function deskMinY() {
    var tb = document.querySelector(".topbar");
    return (tb ? tb.getBoundingClientRect().bottom : 0) + 6;
  }

  // --- Frei verschiebbare Dokumentenliste (die .page-Karte) -------------
  // position:fixed; index.js setzt Position (Default zentriert unter der
  // Titelleiste) und max-height, damit lange Listen INNEN scrollen. Ziehen
  // aus nicht-interaktiven Bereichen; Position wird gemerkt (POST /desktop/layout).
  // MUSS vor dem Icon-Layout laufen, da dieses die Kartenposition ausliest.
  var page = document.getElementById("page");
  function placePage() {
    var vw = window.innerWidth, vh = window.innerHeight, w = page.offsetWidth, minY = deskMinY();
    var left, top;
    if (page.dataset.x !== undefined) {
      left = parseFloat(page.dataset.x); top = parseFloat(page.dataset.y);
    } else {
      left = Math.round((vw - w) / 2); top = minY + 10;
    }
    // stets zu einem grossen Teil sichtbar und nie hinter der Titelleiste
    left = Math.max(140 - w, Math.min(left, vw - 140));
    top = Math.max(minY, Math.min(top, vh - 160));
    page.style.left = left + "px"; page.style.top = top + "px";
    page.style.maxHeight = (vh - top - 16) + "px";
  }
  if (page) {
    placePage();
    window.addEventListener("resize", placePage);

    var pageDragSkip = "a,button,input,select,textarea,label,summary,"
      + ".fname,.row-menu,.share-badge,[data-dialog],[data-create],th .sort";
    page.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      // nur aus nicht-interaktiven Flaechen ziehen (Klicks auf Inhalte bleiben)
      if (e.target.closest(pageDragSkip)) return;
      // interne Scrollleiste nicht als Ziehen kapern
      if (e.clientX > page.getBoundingClientRect().right - 16) return;
      var r = page.getBoundingClientRect();
      var ox = e.clientX - r.left, oy = e.clientY - r.top, moved = false;
      try { page.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      page.classList.add("dragging");
      function move(ev) {
        var vw = window.innerWidth, vh = window.innerHeight, w = page.offsetWidth, minY = deskMinY();
        var left = Math.max(140 - w, Math.min(ev.clientX - ox, vw - 140));
        var top = Math.max(minY, Math.min(ev.clientY - oy, vh - 160));
        page.style.left = left + "px"; page.style.top = top + "px";
        page.style.maxHeight = (vh - top - 16) + "px";
        moved = true;
      }
      function up() {
        page.classList.remove("dragging");
        page.removeEventListener("pointermove", move);
        page.removeEventListener("pointerup", up);
        page.removeEventListener("pointercancel", up);
        if (moved) {
          fetch(baseUrl + "/desktop/layout", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: "page", x: parseFloat(page.style.left) || 0, y: parseFloat(page.style.top) || 0 }),
          }).catch(function () { /* Position merken ist optional */ });
        }
      }
      page.addEventListener("pointermove", move);
      page.addEventListener("pointerup", up);
      page.addEventListener("pointercancel", up);
    });
  }

  // Standard-Platzierung ohne gemerkte Position: abwechselnd linker/rechter
  // freier Rand neben der Liste, von oben (unter der Topbar) nach unten
  function layoutDeskDefaults(icons) {
    if (!icons.length) return;
    var pageEl = document.querySelector(".page");
    var pr = pageEl ? pageEl.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    var top0 = deskMinY() + 8;
    var iconW = 72, stepY = 74;
    var leftX = Math.max(6, pr.left - iconW - 14);
    var rightX = Math.min(window.innerWidth - iconW - 6, pr.right + 14);
    icons.forEach(function (icon, i) {
      var side = i % 2, idx = Math.floor(i / 2);
      icon.style.left = (side === 0 ? leftX : rightX) + "px";
      icon.style.top = Math.min(top0 + idx * stepY, window.innerHeight - stepY) + "px";
    });
  }

  function saveDeskPos(icon) {
    fetch(baseUrl + "/notes/desktop", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: icon.dataset.owner, filename: icon.dataset.rel,
        x: parseFloat(icon.style.left) || 0, y: parseFloat(icon.style.top) || 0,
      }),
    }).catch(function () { /* Position merken ist optional */ });
  }

  function setupDeskDrag(icon) {
    var dragged = false;
    // Klick NACH einem Drag unterdruecken (Capture-Phase laeuft vor dem
    // .note-open-Klick; stopImmediatePropagation blockt diesen)
    icon.addEventListener("click", function (e) {
      if (dragged) { e.stopImmediatePropagation(); e.preventDefault(); dragged = false; }
    }, true);
    icon.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      hideNoteTip();
      var r = icon.getBoundingClientRect();
      var ox = e.clientX - r.left, oy = e.clientY - r.top;
      var sx = e.clientX, sy = e.clientY, moved = false;
      try { icon.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      icon.classList.add("dragging");
      function move(ev) {
        var nx = Math.max(4, Math.min(ev.clientX - ox, window.innerWidth - icon.offsetWidth - 4));
        // nicht unter die Titelleiste schiebbar
        var ny = Math.max(deskMinY(), Math.min(ev.clientY - oy, window.innerHeight - icon.offsetHeight - 4));
        icon.style.left = nx + "px"; icon.style.top = ny + "px";
        if (Math.abs(ev.clientX - sx) > 4 || Math.abs(ev.clientY - sy) > 4) moved = true;
      }
      function up() {
        icon.classList.remove("dragging");
        icon.removeEventListener("pointermove", move);
        icon.removeEventListener("pointerup", up);
        icon.removeEventListener("pointercancel", up);
        if (moved) { dragged = true; saveDeskPos(icon); }
      }
      icon.addEventListener("pointermove", move);
      icon.addEventListener("pointerup", up);
      icon.addEventListener("pointercancel", up);
      e.preventDefault(); // kein Text-/Bild-Ziehen des Buttons
    });
  }

  // --- Frei platzierbare Notiz-Icons ("Desktop") ------------------------
  // Die Icons sind zugleich .note-open -> Klick (oeffnen) und Hover
  // (Vorschau) laufen ueber die Handler des Notiz-Moduls. Hier nur
  // Position + Ziehen.
  var deskIcons = Array.prototype.slice.call(document.querySelectorAll(".note-desk"));
  if (deskIcons.length) {
    var deskAuto = [];
    deskIcons.forEach(function (icon) {
      if (icon.dataset.x !== undefined && icon.dataset.y !== undefined) {
        icon.style.left = icon.dataset.x + "px";
        // gemerkte Position nie unter die Titelleiste (Altbestand absichern)
        icon.style.top = Math.max(deskMinY(), parseFloat(icon.dataset.y)) + "px";
      } else {
        deskAuto.push(icon); // ohne gemerkte Position -> automatisch platzieren
      }
    });
    layoutDeskDefaults(deskAuto);
    deskIcons.forEach(setupDeskDrag);
  }

  // Karte UND Icons sind jetzt an ihrer (ggf. gemerkten) Position -> weich
  // einblenden. Ein Frame Verzoegerung, damit die Endposition schon steht:
  // sonst saehe man doch den Sprung von der Default-Stelle. (CSS haelt beide
  // bis dahin auf opacity:0; ohne JS greift der scripting:none-Fallback.)
  requestAnimationFrame(function () {
    document.body.classList.add("desk-ready");
  });
}
