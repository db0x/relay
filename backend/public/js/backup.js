// --- Backup-Dialog: Formular per fetch senden, Dialog bleibt offen -----
// (Wartungssperre serverseitig, siehe routes/admin.js/maintenance.js) --
// waehrend des Laufs zeigt der Knopf "Backup läuft …", danach wird er zum
// "Schließen"-Knopf und das Ergebnis (Zeitpunkt, Dauer, Log) erscheint
// inline, statt dass man den Dialog neu oeffnen muss.
export function initBackupDialog() {
  var form = document.getElementById("backup-form");
  var btn = document.getElementById("backup-run-btn");
  var dlg = document.getElementById("dlg-backup");
  if (!form || !btn || !dlg) return;
  var result = document.getElementById("backup-result");
  var badge = document.getElementById("backup-badge");
  var meta = document.getElementById("backup-meta");
  // Das <code> IM <pre>: der <pre> ist der Scroll-Behaelter mit der
  // Bildlaufleiste, sein Innenleben gehoert ihr (siehe backup.ejs)
  var log = document.getElementById("backup-log-text");
  var running = false;

  function showResult(data) {
    result.hidden = false;
    badge.className = "badge " + (data.ok ? "badge-ok" : "badge-err");
    badge.textContent = data.ok ? "Erfolg" : "Fehler";
    meta.textContent = data.atStr ? (data.atStr + " Uhr · Dauer " + data.durationStr) : "";
    log.textContent = data.log;
  }
  function setDone() {
    running = false;
    btn.disabled = false;
    btn.type = "button";
    btn.textContent = "Schließen";
  }
  function resetButton() {
    btn.disabled = false;
    btn.type = "submit";
    btn.textContent = "Backup ausführen";
  }

  btn.addEventListener("click", function () {
    if (btn.type === "button") dlg.close();
  });
  // "×" oder Reopen mitten im Lauf: Knopf nur zuruecksetzen, wenn der Lauf
  // schon fertig ist -- sonst wuerde ein zwischenzeitliches Schliessen den
  // "Backup läuft"-Zustand verlieren, obwohl der fetch im Hintergrund weiterlaeuft.
  dlg.addEventListener("close", function () { if (!running) resetButton(); });

  form.addEventListener("relay-confirmed", function () {
    running = true;
    btn.disabled = true;
    btn.textContent = "Backup läuft …";
    fetch(form.action, { method: "POST", credentials: "same-origin",
      headers: { "X-Requested-With": "fetch" } })
      .then(function (r) { return r.json(); })
      .then(function (data) { showResult(data); setDone(); })
      .catch(function () {
        showResult({ ok: false, atStr: "", durationStr: "", log: "Backup fehlgeschlagen (Netzwerkfehler)." });
        setDone();
      });
  });
}
