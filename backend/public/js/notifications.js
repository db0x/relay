// Benachrichtigungen: Glocke am Avatar, Uebersicht der offenen Nachrichten,
// Sprung zur freigegebenen Datei.
//
// "Gelesen" heisst hier geloescht — sowohl in der Anzeige als auch in der
// Datenbank (POST /notifications/read). Es gibt deshalb keinen Zustand
// "gelesen, aber noch da", der irgendwo synchron gehalten werden muesste.
//
// Die Liste ist ein MENUE (wie der Kebab daneben), kein Dialog: Oeffnen,
// Schliessen per Escape und Klick daneben erledigt bindMenuButtons in
// core/dialogs.js — hier bleibt nur das Verhalten der Eintraege.
import { closeMenus } from "./core/dialogs.js";
import { BASE_URL } from "./core/base.js";

// Zeile der Dateiliste zu owner/relpath finden. Freigegebene Dateien stehen
// immer auf der obersten Ebene (siehe routes/browse.js), darum reicht die
// Suche in der aktuellen Liste, sobald dort die Wurzel angezeigt wird.
function rowFor(owner, rel) {
  var rows = document.querySelectorAll("#page table.files tbody tr");
  for (var i = 0; i < rows.length; i++) {
    // Notizen/Bilder tragen die Angaben als data-Attribute …
    var open = rows[i].querySelector('[data-owner="' + CSS.escape(owner) + '"][data-rel="' + CSS.escape(rel) + '"]');
    if (open) return rows[i];
    // … normale Dateien nur im Link auf den Editor/Download
    var link = rows[i].querySelector('a.fname[href*="/edit/"], a[href*="/download/"]');
    if (link) {
      var href = decodeURIComponent(link.getAttribute("href"));
      if (href.indexOf("/" + owner + "/" + rel) !== -1) return rows[i];
    }
  }
  return null;
}

// Zeile kurz hervorheben und ins Bild holen
function highlight(row) {
  if (!row) return;
  row.classList.add("row-highlight");
  row.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(function () { row.classList.remove("row-highlight"); }, 2600);
}

// config: { pageWindow } — das Fenster-Objekt der Dateiliste (core/window.js),
// damit ein zugeklapptes Fenster fuer den Sprung geoeffnet werden kann.
export function initNotifications(config) {
  var btn = document.getElementById("notif-btn");
  var panel = document.getElementById("notif-panel");
  if (!btn || !panel) return;
  var badge = document.getElementById("notif-badge");
  var countEl = document.getElementById("notif-count");
  var listEl = document.getElementById("notif-list");
  var emptyEl = document.getElementById("notif-empty");
  var readAllBtn = document.getElementById("notif-read-all");
  var pageWindow = config && config.pageWindow;
  var pageEl = document.getElementById("page");

  // Zaehler nachfuehren, nachdem eine Nachricht verschwunden ist
  function refreshBadge() {
    var n = listEl ? listEl.querySelectorAll(".notif-item").length : 0;
    if (countEl) countEl.textContent = n > 9 ? "9+" : String(n);
    if (badge) badge.hidden = n === 0;
    if (emptyEl) emptyEl.hidden = n > 0;
    // ohne Nachrichten gibt es nichts wegzuraeumen
    if (readAllBtn) readAllBtn.disabled = n === 0;
  }

  function markRead(id) {
    return fetch(BASE_URL + "/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id: Number(id) }),
    });
  }

  listEl && listEl.addEventListener("click", function (e) {
    var item = e.target.closest(".notif-item");
    if (!item) return;
    var owner = item.dataset.owner, rel = item.dataset.rel;

    // gelesen = weg, sofort und dauerhaft
    markRead(item.dataset.id).catch(function () { /* Anzeige stimmt trotzdem */ });
    var li = item.closest("li");
    if (li) li.remove();
    refreshBadge();
    closeMenus();

    // Dateiliste zeigen (war sie eingeklappt, klappt sie auf)
    if (pageWindow) pageWindow.restore();

    // Freigegebene Dateien stehen nur auf der obersten Ebene. Sind wir schon
    // dort, genuegt das Hervorheben; sonst dorthin navigieren und die Datei
    // per ?hl= mitgeben — nach dem Laden hebt sie der Aufruf unten hervor.
    var row = pageEl && pageEl.dataset.dir === "" ? rowFor(owner, rel) : null;
    if (row) { highlight(row); return; }
    location.assign(BASE_URL + "/?hl=" + encodeURIComponent(owner + "/" + rel));
  });

  refreshBadge();
}

// Nach einem Sprung aus den Nachrichten: die Datei aus ?hl= hervorheben und
// den Parameter wieder aus der Adresse nehmen (er soll nicht im Verlauf
// haengenbleiben und bei jedem Zurueck erneut blinken).
export function highlightFromUrl() {
  var hl = new URLSearchParams(location.search).get("hl");
  if (!hl) return;
  var i = hl.indexOf("/");
  if (i > 0) highlight(rowFor(hl.slice(0, i), hl.slice(i + 1)));
  var url = new URL(location.href);
  url.searchParams.delete("hl");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}
