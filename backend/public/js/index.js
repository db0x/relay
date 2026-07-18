// Verhalten der Startseite: Token kopieren + Rückfrage beim Neu-Erzeugen.
// Läuft per defer erst nach dem Parsen des DOM.
(function () {
  // Zurueck-Navigation aus dem Editor: der Browser stellt die Seite sonst aus
  // dem bfcache wieder her — eingefroren mit offenem Dialog und veralteter
  // Dateiliste. Bei einer bfcache-Wiederherstellung deshalb frisch laden.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) location.reload();
  });

  // Menüs: Topbar-Kebab + ein Kontextmenü pro Dateizeile — es ist immer
  // höchstens eins offen. Die Zeilen-Panels sind position:fixed (im
  // scrollenden Tabellen-Wrapper erzeugte absolute Positionierung
  // Scrollbalken) und werden beim Öffnen am Knopf ausgerichtet;
  // bei Platzmangel unten klappen sie nach oben.
  function closeMenus() {
    document.querySelectorAll(".menu-panel").forEach(function (p) { p.hidden = true; });
    document.querySelectorAll(".menu-btn, .row-menu-btn").forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
  }
  document.querySelectorAll(".menu-btn, .row-menu-btn").forEach(function (btn) {
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
  document.addEventListener("click", closeMenus);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenus(); });
  // Scrollen (auch im Tabellen-Wrapper, daher capture) wuerde fixe Panels
  // von ihrer Zeile trennen -> einfach schliessen
  window.addEventListener("scroll", closeMenus, true);
  // Klick auf einen Menüpunkt (Download-Link, Löschen ...) schließt das Menü
  document.querySelectorAll(".row-menu-panel .menu-item").forEach(function (item) {
    item.addEventListener("click", closeMenus);
  });

  // Menüpunkte mit data-dialog öffnen den passenden <dialog>
  document.querySelectorAll("[data-dialog]").forEach(function (item) {
    item.addEventListener("click", function () {
      var dlg = document.getElementById(item.dataset.dialog);
      if (dlg && dlg.showModal) dlg.showModal();
      closeMenus();
    });
  });

  // Symbol-Buttons "Neue Datei": Dateityp übernehmen, Titel anpassen, Dialog öffnen
  var createDlg = document.getElementById("dlg-create");
  if (createDlg) {
    var createTitles = {
      docx: "Neues Textdokument",
      xlsx: "Neue Tabelle",
      pptx: "Neue Präsentation",
    };
    var createNameLabels = {
      docx: "Name des Textdokuments",
      xlsx: "Name der Tabelle",
      pptx: "Name der Präsentation",
    };
    document.querySelectorAll("[data-create]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var ext = btn.dataset.create;
        document.getElementById("dlg-create-title").textContent = createTitles[ext] || "Neue Datei";
        document.getElementById("dlg-create-name-label").textContent =
          createNameLabels[ext] || "Name der Datei";
        document.getElementById("dlg-create-ext").value = ext;
        var icon = document.getElementById("dlg-create-icon");
        icon.src = icon.src.replace(/[^/]+$/, ext + ".svg");
        var nameInput = document.getElementById("dlg-create-name");
        nameInput.value = "";
        // Sprache startet bei jedem Oeffnen wieder auf dem Default (Deutsch)
        var langSelect = document.getElementById("dlg-create-lang");
        if (langSelect) langSelect.value = langSelect.dataset.default;
        // Werte wurden programmatisch gesetzt -> Button-Zustand neu bewerten
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        createDlg.showModal();
        nameInput.focus();
      });
    });
  }

  // Passwort-Formular: kam der Redirect mit markiertem Feld zurück (Server-
  // Validierung), Dialog und Abschnitt wieder öffnen und das Feld fokussieren
  var invalidField = document.querySelector("#dlg-account .field-invalid");
  if (invalidField) {
    var accDlg = document.getElementById("dlg-account");
    if (accDlg && accDlg.showModal) accDlg.showModal();
    invalidField.focus();
  }

  // neue Passwörter live vergleichen: bei Abweichung Feld markieren und
  // Absenden blockieren (setCustomValidity); Tippen löscht die Markierung
  var pwForm = document.getElementById("pw-form");
  if (pwForm) {
    var pwOld = pwForm.querySelector("input[name=old]");
    var pwNew1 = pwForm.querySelector("input[name=new1]");
    var pwNew2 = pwForm.querySelector("input[name=new2]");
    function pwCheck() {
      var mismatch = pwNew2.value !== "" && pwNew1.value !== pwNew2.value;
      pwNew1.classList.toggle("field-invalid", mismatch);
      pwNew2.classList.toggle("field-invalid", mismatch);
      pwNew2.setCustomValidity(mismatch ? "Die neuen Passwörter stimmen nicht überein." : "");
    }
    pwNew1.addEventListener("input", pwCheck);
    pwNew2.addEventListener("input", pwCheck);
    pwOld.addEventListener("input", function () { pwOld.classList.remove("field-invalid"); });
  }

  // Konto-Dialog: beim Schließen ohne Speichern alles zurücksetzen — Felder
  // auf Ausgangswerte (Anzeigename zurück, Passwörter leer), Fehlermarkierungen
  // und Absende-Sperren weg, Abschnitte wieder eingeklappt
  var accountDlg = document.getElementById("dlg-account");
  if (accountDlg) {
    accountDlg.addEventListener("close", function () {
      accountDlg.querySelectorAll("form").forEach(function (f) { f.reset(); });
      accountDlg.querySelectorAll(".field-invalid").forEach(function (el) {
        el.classList.remove("field-invalid");
        el.setCustomValidity("");
      });
      accountDlg.querySelectorAll("details").forEach(function (d) { d.open = false; });
    });
  }

  // Anzeigename: schon beim Tippen rot markieren, wenn er (effektiv) leer ist,
  // und das Absenden blockieren — passend zu required + pattern im Formular
  var displayInput = document.querySelector("#dlg-account input[name=display]");
  if (displayInput) {
    displayInput.addEventListener("input", function () {
      var empty = displayInput.value.trim() === "";
      displayInput.classList.toggle("field-invalid", empty);
      displayInput.setCustomValidity(empty ? "Der Anzeigename darf nicht leer sein." : "");
    });
  }

  // E-Mail-Adresse: leer ist erlaubt (entfernt sie), sonst live gegen das
  // gleiche Regex wie der Server prüfen und bei Verstoß rot markieren
  var emailInput = document.querySelector("#dlg-account input[name=email]");
  if (emailInput) {
    emailInput.addEventListener("input", function () {
      var v = emailInput.value.trim();
      var bad = v !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      emailInput.classList.toggle("field-invalid", bad);
      emailInput.setCustomValidity(bad ? "Bitte eine gültige E-Mail-Adresse eingeben." : "");
    });
  }

  // Profilbild: der Stift auf dem Avatar öffnet die Dateiauswahl,
  // eine Auswahl lädt direkt hoch (kein eigener Hochladen-Knopf)
  var avatarForm = document.getElementById("avatar-upload");
  if (avatarForm) {
    var avatarInput = avatarForm.querySelector("input[type=file]");
    avatarForm.querySelector(".avatar-edit").addEventListener("click", function () {
      avatarInput.click();
    });
    avatarInput.addEventListener("change", function () {
      if (avatarInput.files.length) avatarForm.submit();
    });
  }

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
  document.querySelectorAll("[data-tip], .share-badge").forEach(function (el) {
    el.addEventListener("mouseenter", function () { placeTip(el); });
    el.addEventListener("focus", function () { placeTip(el); });
    el.addEventListener("mouseleave", function () { clearTip(el); });
    el.addEventListener("blur", function () { clearTip(el); });
  });

  // Lange Dateinamen (Liste) und Dialog-Titel sind per Ellipsis gekuerzt (CSS);
  // der volle Text erscheint als Tooltip — aber nur, wenn wirklich abgeschnitten
  document.querySelectorAll(".fname, .dialog-head h2").forEach(function (el) {
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

  // Hinweis-Dialog mit einer OK-Taste (App-Design statt window.alert).
  // content: String oder DOM-Knoten (fuer Fettdruck u.ae.);
  // opts.danger: roter Kopf ("geht nicht"), opts.icon: Bild-URL im Kopf
  function showNotice(title, content, opts) {
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
    dlg.showModal();
  }

  // Dateityp-Icon zum Namen (gleiche Gruppen wie iconFor im Backend);
  // null, wenn die Endung nicht erkennbar ist
  function iconForName(name) {
    var ext = (name.split(".").pop() || "").toLowerCase();
    var map = {
      xlsx: "xlsx", xls: "xlsx", ods: "xlsx", csv: "xlsx",
      pptx: "pptx", ppt: "pptx", odp: "pptx", pdf: "pdf",
      docx: "docx", doc: "docx", odt: "docx", rtf: "docx", txt: "docx",
    };
    return map[ext] || null;
  }

  // Hochladen: ein Knopf öffnet die Dateiauswahl, die Auswahl lädt direkt hoch.
  // Vorher wird die Dateigröße gegen das Limit geprüft (MAX_UPLOAD_MB aus der
  // .env, via data-max-mb) — zu große Dateien starten den Upload gar nicht erst.
  var uploadForm = document.querySelector(".upload-form");
  if (uploadForm) {
    var uploadInput = uploadForm.querySelector("input[type=file]");
    uploadForm.querySelector(".upload-btn").addEventListener("click", function () {
      uploadInput.click();
    });
    uploadInput.addEventListener("change", function () {
      if (!uploadInput.files.length) return;
      var maxMb = parseInt(uploadForm.dataset.maxMb, 10) || 128;
      var f = uploadInput.files[0];
      if (f.size > maxMb * 1024 * 1024) {
        var mb = (f.size / 1024 / 1024).toLocaleString("de-DE", { maximumFractionDigits: 1 });
        // Dateiname fett, Rest als Text — daher DOM-Knoten statt String
        var msg = document.createDocumentFragment();
        var strong = document.createElement("strong");
        strong.textContent = "„" + f.name + "“";
        msg.appendChild(strong);
        msg.appendChild(document.createTextNode(
          " ist " + mb + " MB groß — erlaubt sind maximal " + maxMb + " MB."));
        var icon = iconForName(f.name);
        showNotice("Datei zu groß", msg, {
          danger: true,
          // Basis-URL aus der Formular-Action ableiten (beruecksichtigt BASE_PATH)
          icon: icon ? uploadForm.action.replace(/\/upload$/, "") + "/static/img/" + icon + ".svg" : null,
        });
        uploadInput.value = ""; // Auswahl verwerfen, sonst haengt sie im Formular
        return;
      }
      uploadForm.submit();
    });
  }

  // Speichern/Anlegen/Erstellen/Ändern nur aktiv, wenn sich gegenüber dem
  // Ausgangszustand etwas geändert hat UND alle Validierungen erfüllt sind.
  // Beobachtet: alle Formulare mit .dialog-submit-Button plus die Nutzeranlage.
  // Der Ausgangszustand ist der serialisierte FormData-Stand beim Laden;
  // form.reset() (Dialog schließen) meldet sich über das reset-Event zurück.
  var watchedForms = [];
  document.querySelectorAll(".dialog-submit").forEach(function (btn) {
    var f = btn.closest("form");
    if (f) watchedForms.push([f, btn]);
  });
  var userCreate = document.querySelector("form.user-create");
  if (userCreate) watchedForms.push([userCreate, userCreate.querySelector("button")]);
  watchedForms.forEach(function (pair) {
    var form = pair[0], btn = pair[1];
    var initial = new URLSearchParams(new FormData(form)).toString();
    function refresh() {
      var now = new URLSearchParams(new FormData(form)).toString();
      btn.disabled = now === initial || !form.checkValidity();
    }
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);
    // reset-Event feuert VOR dem Zuruecksetzen der Werte -> einen Tick warten
    form.addEventListener("reset", function () { setTimeout(refresh, 0); });
    refresh();
  });

  // Rückfrage für alle Formulare mit data-confirm (Token neu erzeugen, Löschen,
  // Freigabe entziehen, sperren ...) — eigener Dialog im App-Design statt
  // window.confirm. "Bestätigen" schickt das gemerkte Formular ab; Abbrechen,
  // × und Escape schließen nur den Dialog.
  var confirmDlg = document.getElementById("dlg-confirm");
  var confirmPending = null;
  document.querySelectorAll("form[data-confirm]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      if (!confirmDlg) { // Sicherheitsnetz, falls der Dialog mal fehlt
        if (!window.confirm(form.dataset.confirm)) e.preventDefault();
        return;
      }
      e.preventDefault();
      confirmPending = form;
      document.getElementById("dlg-confirm-text").textContent = form.dataset.confirm;
      confirmDlg.showModal();
    });
  });
  if (confirmDlg) {
    document.getElementById("dlg-confirm-cancel").addEventListener("click", function () {
      confirmDlg.close();
    });
    document.getElementById("dlg-confirm-ok").addEventListener("click", function () {
      confirmDlg.close();
      // submit() statt requestSubmit(): loest das submit-Event (und damit
      // diese Rueckfrage) nicht erneut aus
      if (confirmPending) confirmPending.submit();
      confirmPending = null;
    });
    confirmDlg.addEventListener("close", function () { confirmPending = null; });
  }
})();
