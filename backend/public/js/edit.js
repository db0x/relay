// Startet den OnlyOffice-Editor. Die JWT-signierte Config liefert der Server
// als JSON in <script id="editor-config">; hier nur noch auslesen und starten.
//
// Ladehaenger-Behandlung: Der DocumentServer haelt eine gerade geschlossene
// Bearbeitungs-Session ~10s offen (Speicher-Fenster). Wer in diesem Fenster
// oeffnet, bekommt den gleichen (mtime-basierten) Key wie die schliessende
// Session -> der Editor bleibt STILL im Lade-Skelett haengen, oft OHNE ein
// onError/onOutdatedVersion zu feuern (~15% der Oeffnungen). Deshalb ein
// Watchdog: kommt onDocumentReady nicht rechtzeitig, laedt die Seite EINMAL
// neu (frische mtime -> korrekter Key). Hilft auch das nicht, gibt es eine
// sichtbare Meldung statt des ewigen Skeletts.
(function () {
  // Ist dies bereits der Retry-Versuch? (edit.js haengt beim Neuladen
  // "?relay-retry" an -> die /edit-Route vergibt dann einen FRISCHEN Key.)
  function isRetry() { return new URLSearchParams(location.search).has("relay-retry"); }

  function showBox(html) {
    var div = document.createElement("div");
    div.className = "edit-error";
    div.innerHTML = html;
    var ed = document.getElementById("editor");
    if (ed && ed.replaceWith) ed.replaceWith(div);
    else document.body.appendChild(div);
  }
  function fail(msg) {
    showBox("<p></p>");
    document.querySelector(".edit-error p").textContent = msg;
    var a = document.createElement("a");
    a.href = location.href; a.textContent = "Nochmal versuchen";
    document.querySelector(".edit-error").appendChild(a);
  }

  // Neu laden MIT frischem Key (?relay-retry). Ist schon der Retry-Versuch
  // haengengeblieben, geben wir mit sichtbarer Meldung auf (keine Endlosschleife).
  function goRetry(failMsg) {
    stopWatchdog();
    if (isRetry()) { fail(failMsg); return; }
    var url = new URL(location.href);
    url.searchParams.set("relay-retry", "1");
    showBox("<p>Der Editor reagiert nicht — wird neu geladen…</p>");
    setTimeout(function () { location.replace(url.toString()); }, 500);
  }

  // --- Watchdog: ZUERST scharf schalten, damit ein Fehler weiter unten die
  // Erholung nicht verhindert. Kommt onDocumentReady nicht -> goRetry.
  var watchdog = null;
  function stopWatchdog() { if (watchdog) { clearTimeout(watchdog); watchdog = null; } }
  function armWatchdog(ms) {
    stopWatchdog();
    watchdog = setTimeout(function () {
      watchdog = null;
      console.warn("[relay] Editor-Watchdog: onDocumentReady blieb aus -> Retry (frischer Key)");
      goRetry("Der Editor blieb im Ladebildschirm hängen.");
    }, ms);
  }
  armWatchdog(18000); // Grundzeit; nach onAppReady auf 8s verkuerzt

  if (typeof DocsAPI === "undefined") {
    stopWatchdog();
    fail("Der DocumentServer ist nicht erreichbar (api.js konnte nicht geladen werden).");
    return;
  }

  // Editor-Einstellungen erzwingen: Theme und Schriftdarstellung merkt sich der
  // Editor im localStorage seiner eigenen Origin — eine dort gespeicherte Wahl
  // schlaegt das uiTheme aus der Config. Hinter nginx (Relay und DS unter EINER
  // Origin) koennen wir den Speicher vor jedem Start ueberschreiben; laeuft der
  // DS auf eigener Origin (Port-Setup), bleibt uiTheme der Startwert.
  var ed = document.getElementById("editor");
  if (ed.dataset.dsOrigin === location.origin) {
    try {
      if (ed.dataset.theme) {
        localStorage.setItem("ui-theme-id", ed.dataset.theme);
        localStorage.removeItem("ui-theme"); // gecachte Farben des alten Themes
      }
      // Schriftdarstellung "Nativ" (Wert "2") fuer alle Editor-Typen:
      // de=Text, sse=Tabellen, pe=Praesentationen, pdfe=PDF, ve=Visio
      ["de", "sse", "pe", "pdfe", "ve"].forEach(function (p) {
        localStorage.setItem(p + "-settings-fontrender", "2");
      });
      // Toolbar-Tabs gefuellt statt Linie; das -newtheme-Flag muss dazu, sonst
      // erzwingen die modernen Themes (theme-white/night/system) wieder "line"
      localStorage.setItem("settings-tab-style", "fill");
      localStorage.setItem("settings-tab-style-newtheme", "1");
    } catch (e) { /* Speicher blockiert (Privatmodus o.ae.) — dann eben nicht */ }
  }

  var cfg = JSON.parse(document.getElementById("editor-config").textContent);
  // alle Nutzer (id, name, image) fuer onRequestUsers — kommt vom Backend
  var relayUsers = JSON.parse(document.getElementById("relay-users").textContent);

  cfg.events = {
    // Editor laeuft -> Watchdog stoppen; ein etwaiges "?relay-retry" aus der
    // URL putzen (kuenftige Reloads nutzen wieder den normalen Key/Co-Editing)
    onDocumentReady: function () {
      stopWatchdog();
      if (isRetry()) {
        var url = new URL(location.href);
        url.searchParams.delete("relay-retry");
        history.replaceState(null, "", url.toString());
      }
    },
    // Anwendung geladen, aber Dokument evtl. noch nicht -> Fenster verkuerzen,
    // damit ein Doc-Ladehaenger schneller erkannt wird
    onAppReady: function () { if (watchdog) armWatchdog(8000); },
    // Datei wurde nach dem Rendern dieser Seite gespeichert -> Key veraltet
    onOutdatedVersion: function () { goRetry("Das Dokument wurde zwischenzeitlich gespeichert."); },
    onError: function (e) {
      var detail = e && e.data && e.data.errorDescription;
      goRetry("Das Dokument konnte nicht geöffnet werden" + (detail ? ": " + detail : "."));
    },
    // Editor fragt Name + Avatar zu Nutzer-IDs an (Co-Editing-Cursor,
    // Kommentare, Versionshistorie) — aus der eingebetteten Nutzerliste
    onRequestUsers: function (e) {
      if (!e || !e.data || e.data.c !== "info") return;
      var ids = e.data.id || [];
      editor.setUsers({
        c: "info",
        users: relayUsers.filter(function (u) { return ids.indexOf(u.id) >= 0; }),
      });
    },
  };
  var editor = new DocsAPI.DocEditor("editor", cfg);
})();
