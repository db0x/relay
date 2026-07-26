// "Desktop"-Layout: die frei platzierbaren Notiz-Icons neben den Fenstern.
// Die Fenster selbst (Dateiliste, Board) laufen ueber die generische Mechanik
// in core/window.js — hier bleibt nur, was die Icons betrifft.
//
// config: { baseUrl, hideNoteTip } — hideNoteTip blendet die Notiz-Hover-
// Vorschau aus, sobald ein Icon gezogen wird.
import { deskMinY } from "./core/window.js";

export function initDesktopLayout(config) {
  var baseUrl = config.baseUrl;
  var hideNoteTip = config.hideNoteTip;

  // Standard-Platzierung ohne gemerkte Position: abwechselnd linker/rechter
  // freier Rand neben der Liste, von oben (unter der Topbar) nach unten
  function layoutDeskDefaults(icons) {
    if (!icons.length) return;
    // Ist die Karte eingeklappt, hat sie keine Masse (display:none) — dann
    // wie ohne Karte rechnen, sonst klebten alle Icons am linken Rand.
    var pageEl = document.querySelector(".page:not(.page-min)");
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
