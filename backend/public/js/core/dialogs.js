// Dialoge, Menüs und die Hinweis-Box: die von allen Bereichen genutzte UI-Basis.
//
// Dialoge oeffnen nicht-modal (show statt showModal): showModal legt sie in
// den Top-Layer des Browsers, ueber den eine umgebende Wrapper-App (z.B.
// Voltage) per z-index nicht mehr zeichnen kann — ihr Kontextmenue bliebe
// unter dem Dialog. Backdrop und Stapelreihenfolge deshalb in Eigenregie.

var dlgBackdrop = document.getElementById("dlg-backdrop");
export var dlgStack = [];

export function openDlg(dlg) {
  if (dlgStack.indexOf(dlg) === -1) dlgStack.push(dlg);
  // spaeter geoeffnete Dialoge liegen oben (DOM-Reihenfolge reicht nicht:
  // z.B. oeffnet die Token-Rueckfrage ueber dem spaeter notierten Konto-Dialog)
  dlg.style.zIndex = String(60 + dlgStack.length);
  if (!dlg.open) dlg.show();
  if (dlgBackdrop) dlgBackdrop.classList.add("open");
}

// Alle offenen Dialoge schliessen (z.B. vor einem AJAX-Ordnerwechsel, bevor
// deren DOM-Knoten verschwinden)
export function closeAllDialogs() {
  while (dlgStack.length) dlgStack.pop().close();
  if (dlgBackdrop) dlgBackdrop.classList.remove("open");
}

export function bindDialogClose(root) {
  root.querySelectorAll("dialog.dialog").forEach(function (d) {
    d.addEventListener("close", function () {
      var i = dlgStack.indexOf(d);
      if (i !== -1) dlgStack.splice(i, 1);
      if (!dlgStack.length && dlgBackdrop) dlgBackdrop.classList.remove("open");
    });
  });
}

// Menüs: Topbar-Kebab + ein Kontextmenü pro Dateizeile — es ist immer
// höchstens eins offen. Die Zeilen-Panels sind position:fixed (im
// scrollenden Tabellen-Wrapper erzeugte absolute Positionierung
// Scrollbalken) und werden beim Öffnen am Knopf ausgerichtet;
// bei Platzmangel unten klappen sie nach oben.
export function closeMenus() {
  document.querySelectorAll(".menu-panel").forEach(function (p) { p.hidden = true; });
  document.querySelectorAll(".menu-btn, .row-menu-btn").forEach(function (b) {
    b.setAttribute("aria-expanded", "false");
  });
}

// Menue-Knoepfe (Topbar-Kebab + Zeilen-Kebab) verdrahten. root-skopiert, damit
// nach einem Ordnerwechsel (swapFolder) nur die neuen Zeilen-Knoepfe gebunden
// werden — der Topbar-Kebab bleibt ausserhalb #page und behaelt seine Bindung.
export function bindMenuButtons(root) {
  root.querySelectorAll(".menu-btn, .row-menu-btn").forEach(function (btn) {
    var panel = btn.parentElement.querySelector(".menu-panel");
    if (!panel) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = panel.hidden;
      closeMenus();
      if (!willOpen) return;
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      if (panel.classList.contains("row-menu-panel")) {
        var r = btn.getBoundingClientRect();
        var top = r.bottom + 6;
        if (top + panel.offsetHeight > window.innerHeight - 8)
          top = Math.max(8, r.top - panel.offsetHeight - 6);
        panel.style.top = top + "px";
        panel.style.left = Math.max(8, r.right - panel.offsetWidth) + "px";
        panel.style.right = "auto"; // Basisregel .menu-panel setzt right:0
      }
    });
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
  });
}

// Klick auf einen Menüpunkt (Download-Link, Löschen ...) schließt das Menü
export function bindRowMenuItemClose(root) {
  root.querySelectorAll(".row-menu-panel .menu-item").forEach(function (item) {
    item.addEventListener("click", closeMenus);
  });
}

// Menüpunkte mit data-dialog öffnen den passenden <dialog>
export function bindDataDialog(root) {
  root.querySelectorAll("[data-dialog]").forEach(function (item) {
    item.addEventListener("click", function () {
      var dlg = document.getElementById(item.dataset.dialog);
      if (dlg) openDlg(dlg);
      closeMenus();
    });
  });
}

// Hinweis-Dialog mit einer OK-Taste (App-Design statt window.alert).
// content: String oder DOM-Knoten (fuer Fettdruck u.ae.);
// opts.danger: roter Kopf ("geht nicht"), opts.icon: Bild-URL im Kopf
export function showNotice(title, content, opts) {
  var dlg = document.getElementById("dlg-notice");
  if (!dlg) { // Sicherheitsnetz
    window.alert(typeof content === "string" ? content : content.textContent);
    return;
  }
  opts = opts || {};
  document.getElementById("dlg-notice-title").textContent = title;
  var p = document.getElementById("dlg-notice-text");
  p.textContent = "";
  if (typeof content === "string") p.textContent = content;
  else p.appendChild(content);
  document.getElementById("dlg-notice-head")
    .classList.toggle("dialog-head-danger", !!opts.danger);
  var icon = document.getElementById("dlg-notice-icon");
  icon.hidden = !opts.icon;
  if (opts.icon) icon.src = opts.icon;
  openDlg(dlg);
}

// Globale Verdrahtung: einmalig beim Seitenaufbau aufzurufen.
export function initDialogCore() {
  bindMenuButtons(document);
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    // Im Vollbild gehoert Escape dem Browser: es beendet das Vollbild, sonst
    // nichts. Wuerden wir zusaetzlich den obersten Dialog schliessen, stuende
    // der Nutzer nach EINEM Tastendruck im Vollbild vor einem schwarzen Bild —
    // der Video-Dialog nimmt beim Schliessen die Quelle weg. Genau so gemessen:
    // fullscreen=true, Dialog zu, Quelle weg.
    if (document.fullscreenElement) return;
    closeMenus();
    // nicht-modale Dialoge kennen kein cancel-Event -> selbst schliessen
    if (dlgStack.length) dlgStack[dlgStack.length - 1].close();
  });
  // Scrollen (auch im Tabellen-Wrapper, daher capture) wuerde fixe Panels
  // von ihrer Zeile trennen -> einfach schliessen. ABER: Scrollen INNERHALB
  // eines Menues ist kein Grund dafuer — die Trefferliste der Suche und das
  // Nachrichten-Menue scrollen selbst, und die gingen sonst bei der ersten
  // Radbewegung wieder zu.
  window.addEventListener("scroll", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest(".menu-panel")) return;
    closeMenus();
  }, true);
  bindRowMenuItemClose(document);
  bindDialogClose(document);
  bindDataDialog(document);
}
