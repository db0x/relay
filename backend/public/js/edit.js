// Startet den OnlyOffice-Editor. Die JWT-signierte Config liefert der Server
// als JSON in <script id="editor-config">; hier nur noch auslesen und starten.
//
// Fehlerbehandlung: der DocumentServer speichert erst ~10s nachdem der letzte
// Bearbeiter geschlossen hat (Callback schreibt die Datei, mtime aendert sich
// erst dann). Wer in diesem Fenster oeffnet, bekommt noch den Key der gerade
// schliessenden Session — der DS lehnt ab und der Editor bliebe stumm im
// Lade-Skelett haengen. Ein einmaliger Reload holt die Config mit frischem
// Key; hilft auch das nicht, gibt es eine sichtbare Meldung statt des Skeletts.
(function () {
  var retryKey = "relay-edit-retry:" + location.pathname;

  function fail(msg) {
    var div = document.createElement("div");
    div.className = "edit-error";
    var p = document.createElement("p");
    p.textContent = msg;
    var a = document.createElement("a");
    a.href = location.href;
    a.textContent = "Nochmal versuchen";
    div.appendChild(p);
    div.appendChild(a);
    document.getElementById("editor").replaceWith(div);
  }

  // ein Reload-Versuch pro Editor-Seite; der Marker verhindert Reload-Schleifen
  function retryOnce(msg) {
    if (!sessionStorage.getItem(retryKey)) {
      sessionStorage.setItem(retryKey, "1");
      location.reload();
    } else {
      sessionStorage.removeItem(retryKey);
      fail(msg);
    }
  }

  if (typeof DocsAPI === "undefined") {
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
    // Editor laeuft -> ein etwaiger Retry-Marker ist erledigt
    onDocumentReady: function () { sessionStorage.removeItem(retryKey); },
    // Datei wurde nach dem Rendern dieser Seite gespeichert -> Key veraltet
    onOutdatedVersion: function () {
      retryOnce("Das Dokument wurde zwischenzeitlich gespeichert.");
    },
    onError: function (e) {
      var detail = e && e.data && e.data.errorDescription;
      retryOnce("Das Dokument konnte nicht geöffnet werden" +
        (detail ? ": " + detail : "."));
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
