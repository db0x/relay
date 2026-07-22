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
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    closeMenus();
    // nicht-modale Dialoge kennen kein cancel-Event -> selbst schliessen
    if (dlgStack.length) dlgStack[dlgStack.length - 1].close();
  });
  // Scrollen (auch im Tabellen-Wrapper, daher capture) wuerde fixe Panels
  // von ihrer Zeile trennen -> einfach schliessen
  window.addEventListener("scroll", closeMenus, true);
  // Klick auf einen Menüpunkt (Download-Link, Löschen ...) schließt das Menü
  document.querySelectorAll(".row-menu-panel .menu-item").forEach(function (item) {
    item.addEventListener("click", closeMenus);
  });

  // Dialoge oeffnen nicht-modal (show statt showModal): showModal legt sie in
  // den Top-Layer des Browsers, ueber den eine umgebende Wrapper-App (z.B.
  // Voltage) per z-index nicht mehr zeichnen kann — ihr Kontextmenue bliebe
  // unter dem Dialog. Backdrop und Stapelreihenfolge deshalb in Eigenregie.
  var dlgBackdrop = document.getElementById("dlg-backdrop");
  var dlgStack = [];
  function openDlg(dlg) {
    if (dlgStack.indexOf(dlg) === -1) dlgStack.push(dlg);
    // spaeter geoeffnete Dialoge liegen oben (DOM-Reihenfolge reicht nicht:
    // z.B. oeffnet die Token-Rueckfrage ueber dem spaeter notierten Konto-Dialog)
    dlg.style.zIndex = String(60 + dlgStack.length);
    if (!dlg.open) dlg.show();
    if (dlgBackdrop) dlgBackdrop.classList.add("open");
  }
  document.querySelectorAll("dialog.dialog").forEach(function (d) {
    d.addEventListener("close", function () {
      var i = dlgStack.indexOf(d);
      if (i !== -1) dlgStack.splice(i, 1);
      if (!dlgStack.length && dlgBackdrop) dlgBackdrop.classList.remove("open");
    });
  });

  // Menüpunkte mit data-dialog öffnen den passenden <dialog>
  document.querySelectorAll("[data-dialog]").forEach(function (item) {
    item.addEventListener("click", function () {
      var dlg = document.getElementById(item.dataset.dialog);
      if (dlg) openDlg(dlg);
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
        openDlg(createDlg);
        nameInput.focus();
      });
    });
  }

  // Passwort-Formular: kam der Redirect mit markiertem Feld zurück (Server-
  // Validierung), Dialog und Abschnitt wieder öffnen und das Feld fokussieren
  var invalidField = document.querySelector("#dlg-account .field-invalid");
  if (invalidField) {
    var accDlg = document.getElementById("dlg-account");
    if (accDlg) openDlg(accDlg);
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
  document.querySelectorAll(".fname:not(.note-open), .dialog-head h2").forEach(function (el) {
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

  // Fusszeilen-Filter: "Nur eigene Dateien" blendet die mir freigegebenen
  // Zeilen aus; der Zustand ueberlebt im localStorage
  var ownOnly = document.getElementById("own-only");
  if (ownOnly) {
    var OWN_KEY = "relay-own-only";
    var applyOwnFilter = function () {
      document.querySelectorAll("tr.row-foreign").forEach(function (row) {
        row.hidden = ownOnly.checked;
      });
      localStorage.setItem(OWN_KEY, ownOnly.checked ? "1" : "0");
    };
    ownOnly.checked = localStorage.getItem(OWN_KEY) === "1";
    ownOnly.addEventListener("change", applyOwnFilter);
    applyOwnFilter();
  }

  // Notizen: Markdown-Editor (CodeMirror mit Markdown-Highlighting) als
  // grosser modaler Dialog, rechts eine Live-Vorschau (marked -> DOMPurify ->
  // highlight.js fuer Code-Bloecke). "Neue Notiz" oeffnet sofort mit
  // "# Titel"-Vorlage; Klick auf eine Notiz laedt deren Inhalt.
  // Speichern erst bei Aenderung gegenueber dem Oeffnen (eigene Logik statt
  // dialog-submit-Waechter: der Ausgangszustand wechselt mit jedem Oeffnen).
  var noteDlg = document.getElementById("dlg-note");
  if (noteDlg) {
    var noteForm = document.getElementById("note-form");
    var noteText = noteForm.querySelector("textarea");
    var noteSave = document.getElementById("note-save");
    var noteTitleEl = document.getElementById("dlg-note-title");
    var notePreview = document.getElementById("note-preview");
    var noteStatus = document.getElementById("note-status");
    var noteCreateAction = noteForm.action; // .../notes/create
    var noteBaseUrl = noteCreateAction.replace(/\/notes\/create$/, "");
    var noteBaseline = "";
    var noteCM = null;    // CodeMirror-Instanz; ohne Vendor-JS bleibt die Textarea
    var noteTimer = null;

    // ToDo/Personen/Ort — eigenes Formular-Stueck, laeuft aber ueber denselben
    // Speichern-Button wie der Markdown-Inhalt (ein Submit pro Dialog)
    var noteTodo = document.getElementById("note-todo");
    var noteDue = document.getElementById("note-due");
    var noteOrt = document.getElementById("note-ort");
    var noteMetaBaseline = "";
    var noteDetails = document.getElementById("note-details");
    var noteViewSummary = document.getElementById("note-view-summary");
    var noteSummaryHasContent = false;

    // Personen: Chip-Feld mit Autocomplete aus den bekannten Nutzern (data-known),
    // nimmt ebenso Freitext fuer Unbekannte an. peopleChips ist die einzige
    // Quelle der Wahrheit; versteckte people_known/people_extra-Felder werden
    // daraus synchronisiert (normaler Form-POST), ebenso die Lese-Ansicht.
    var notePeopleField = document.getElementById("note-people-field");
    var notePeopleChips = document.getElementById("note-people-chips");
    var notePeopleInput = document.getElementById("note-people-input");
    var notePeopleHidden = document.getElementById("note-people-hidden");
    var peopleDropdown = null;
    var knownUsers = [];
    try { knownUsers = JSON.parse(notePeopleField.dataset.known || "[]"); } catch (e) {}
    var knownByUsername = {};
    knownUsers.forEach(function (u) { knownByUsername[u.username] = u; });
    var peopleChips = []; // {username|null, name, hasAvatar}

    // Avatar (bekannt+Bild) bzw. Initialen-Kreis (bekannt ohne Bild) —
    // Freitext-Personen bekommen kein Rund; size in px
    function personAvatar(entry, size) {
      if (entry.username && entry.hasAvatar) {
        var img = document.createElement("img");
        img.className = "person-av";
        img.src = noteBaseUrl + "/avatar/" + encodeURIComponent(entry.username);
        img.alt = ""; img.width = size; img.height = size;
        return img;
      }
      var fb = document.createElement("span");
      fb.className = "person-av person-av-fallback";
      fb.style.width = fb.style.height = size + "px";
      fb.textContent = (entry.name || "?").trim().charAt(0).toUpperCase();
      return fb;
    }

    function formatDueLabel(iso) {
      var p = (iso || "").split("-");
      return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : "";
    }

    // --- Personen-Chip-Feld ------------------------------------------------
    // versteckte Formularfelder aus dem Chip-Zustand aufbauen (people_known je
    // bekanntem Nutzer, people_extra je Freitext) — type=hidden -> kein Layout
    function syncHiddenPeople() {
      notePeopleHidden.innerHTML = "";
      peopleChips.forEach(function (c) {
        var inp = document.createElement("input");
        inp.type = "hidden";
        inp.name = c.username ? "people_known" : "people_extra";
        inp.value = c.username || c.name;
        notePeopleHidden.appendChild(inp);
      });
    }

    function renderChips() {
      Array.prototype.slice.call(notePeopleChips.querySelectorAll(".chip"))
        .forEach(function (c) { c.remove(); });
      peopleChips.forEach(function (entry, i) {
        var chip = document.createElement("span");
        chip.className = "chip" + (entry.username ? "" : " chip-text");
        if (entry.username) chip.appendChild(personAvatar(entry, 16));
        chip.appendChild(document.createTextNode(entry.name));
        var x = document.createElement("button");
        x.type = "button"; x.className = "chip-x";
        x.setAttribute("aria-label", entry.name + " entfernen");
        x.textContent = "×";
        x.addEventListener("click", function () { removeChipAt(i); notePeopleInput.focus(); });
        chip.appendChild(x);
        notePeopleChips.insertBefore(chip, notePeopleInput);
      });
      syncHiddenPeople();
    }

    function addChip(entry) {
      var dup = peopleChips.some(function (c) {
        return entry.username ? c.username === entry.username
          : (!c.username && c.name.toLowerCase() === entry.name.toLowerCase());
      });
      if (!dup) { peopleChips.push(entry); renderChips(); }
      onNoteChange();
    }
    function removeChipAt(i) { peopleChips.splice(i, 1); renderChips(); onNoteChange(); }

    // aktuell noch nicht als Chip stehenden Text zu einer Person machen —
    // exakter Namenstreffer bei bekannten Nutzern wird zum bekannten Chip
    function commitPeopleInput() {
      var val = notePeopleInput.value.replace(/,+$/, "").trim();
      notePeopleInput.value = "";
      hidePeopleDropdown();
      if (!val) return;
      var match = knownUsers.filter(function (u) {
        return u.display_name.toLowerCase() === val.toLowerCase();
      })[0];
      addChip(match
        ? { username: match.username, name: match.display_name, hasAvatar: match.hasAvatar }
        : { username: null, name: val, hasAvatar: false });
    }

    // Vorschlaege: bekannte Nutzer, die zum Tippen passen und noch nicht drin sind
    function peopleSuggestions() {
      var q = notePeopleInput.value.trim().toLowerCase();
      return knownUsers.filter(function (u) {
        if (peopleChips.some(function (c) { return c.username === u.username; })) return false;
        return !q || u.display_name.toLowerCase().indexOf(q) !== -1;
      });
    }
    function showPeopleDropdown() {
      if (notePeopleInput.disabled) return;
      var items = peopleSuggestions();
      if (!peopleDropdown) {
        peopleDropdown = document.createElement("div");
        peopleDropdown.className = "chips-dropdown";
        notePeopleField.appendChild(peopleDropdown);
      }
      peopleDropdown.innerHTML = "";
      if (!items.length) { hidePeopleDropdown(); return; }
      items.forEach(function (u) {
        var opt = document.createElement("button");
        opt.type = "button"; opt.className = "chips-option";
        opt.appendChild(personAvatar({ username: u.username, name: u.display_name, hasAvatar: u.hasAvatar }, 18));
        opt.appendChild(document.createTextNode(u.display_name));
        // mousedown feuert vor dem blur des Inputs -> Auswahl geht nicht verloren
        opt.addEventListener("mousedown", function (e) {
          e.preventDefault();
          notePeopleInput.value = "";
          addChip({ username: u.username, name: u.display_name, hasAvatar: u.hasAvatar });
          hidePeopleDropdown();
          notePeopleInput.focus();
        });
        peopleDropdown.appendChild(opt);
      });
      peopleDropdown.hidden = false;
    }
    function hidePeopleDropdown() { if (peopleDropdown) peopleDropdown.hidden = true; }

    notePeopleInput.addEventListener("input", showPeopleDropdown);
    notePeopleInput.addEventListener("focus", showPeopleDropdown);
    notePeopleInput.addEventListener("blur", function () {
      // kurze Verzoegerung, damit ein Options-mousedown noch greift
      setTimeout(function () { commitPeopleInput(); }, 130);
    });
    notePeopleInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === ",") {
        if (!notePeopleInput.value.trim()) { if (e.key === ",") e.preventDefault(); return; }
        e.preventDefault();
        var sugg = peopleSuggestions();
        // Tippt der Nutzer einen Teilnamen, nimmt Enter den ersten Vorschlag;
        // ohne passenden Vorschlag entsteht ein Freitext-Chip
        if (sugg.length) {
          notePeopleInput.value = "";
          addChip({ username: sugg[0].username, name: sugg[0].display_name, hasAvatar: sugg[0].hasAvatar });
          hidePeopleDropdown();
        } else {
          commitPeopleInput();
        }
      } else if (e.key === "Backspace" && notePeopleInput.value === "" && peopleChips.length) {
        removeChipAt(peopleChips.length - 1);
      } else if (e.key === "Escape") {
        hidePeopleDropdown();
      }
    });
    // beim Absenden noch nicht bestaetigten Text uebernehmen (Klick auf Speichern
    // blurrt zwar, aber der verzoegerte Commit liefe u.U. erst nach dem Submit)
    noteForm.addEventListener("submit", function () {
      if (notePeopleInput.value.trim()) commitPeopleInput();
    });

    // Kleines Icon (place.svg/users.svg) als Abschnittsmarkierung in der
    // Lese-Zusammenfassung — strukturiert die Zeile, ohne sie zu vergroessern
    function noteSummaryIcon(name, size) {
      var img = document.createElement("img");
      img.className = "note-summary-icon";
      img.src = noteBaseUrl + "/static/img/" + name + ".svg";
      img.alt = ""; img.width = size || 14; img.height = size || 14;
      return img;
    }

    // Meta-Badges (ToDo/Personen/Ort) in `target` einhaengen — nur, was
    // tatsaechlich gesetzt ist: Personen als Avatar+Name (bekannt) bzw. reiner
    // Text (Freitext). Rueckgabe: Anzahl gerenderter Badges (0 = nichts).
    // Gemeinsam genutzt von der Lese-Ansicht im Dialog UND dem Hover-Tooltip;
    // opts.avatar/opts.icon steuern die Groessen (Tooltip nutzt kleinere).
    function appendSummaryBadges(target, meta, opts) {
      opts = opts || {};
      var avSize = opts.avatar || 18, icoSize = opts.icon || 14;
      var known = (meta.people && meta.people.known) || [];
      var extra = (meta.people && meta.people.extra) || [];
      var count = 0;

      if (meta.isTodo) {
        var overdue = !!meta.dueDate && meta.dueDate < new Date().toISOString().slice(0, 10);
        // note-summary-badge (nicht die kompakte .badge-Basis) -> gleiche Hoehe
        // wie die Personen-/Ort-Badges; badge-todo(-over) faerbt es gelb/rot
        var badge = document.createElement("span");
        badge.className = "note-summary-badge badge-todo" + (overdue ? " badge-todo-over" : "");
        badge.textContent = "ToDo" + (meta.dueDate ? " · fällig " + formatDueLabel(meta.dueDate) : "");
        target.appendChild(badge); count++;
      }

      if (known.length || extra.length) {
        var wrap = document.createElement("span");
        wrap.className = "note-people note-summary-badge";
        wrap.appendChild(noteSummaryIcon("users", icoSize));
        known.forEach(function (uname) {
          var u = knownByUsername[uname];
          if (!u) return; // Nutzer inzwischen geloescht -> stillschweigend auslassen
          var p = document.createElement("span");
          p.className = "note-person";
          p.appendChild(personAvatar({ username: u.username, name: u.display_name, hasAvatar: u.hasAvatar }, avSize));
          p.appendChild(document.createTextNode(u.display_name));
          wrap.appendChild(p);
        });
        extra.forEach(function (name) {
          var p = document.createElement("span");
          p.className = "note-person note-person-text";
          p.textContent = name;
          wrap.appendChild(p);
        });
        target.appendChild(wrap); count++;
      }

      if (meta.ort) {
        var ortSpan = document.createElement("span");
        ortSpan.className = "note-ort note-summary-badge";
        ortSpan.appendChild(noteSummaryIcon("place", icoSize));
        ortSpan.appendChild(document.createTextNode(meta.ort));
        target.appendChild(ortSpan); count++;
      }
      return count;
    }

    // Minimalistische Lese-Ansicht (Dialog) — nur sichtbar, wenn etwas da ist
    function renderNoteSummary(meta) {
      noteViewSummary.innerHTML = "";
      noteSummaryHasContent = appendSummaryBadges(noteViewSummary, meta) > 0;
    }

    function updateDueVisibility() {
      // Faelligkeitsdatum ist optional — es gibt ToDos ohne feste Timeline;
      // das Datumsfeld erscheint inline neben dem Schalter, nur wenn ToDo an ist
      var on = noteTodo.checked;
      noteDue.hidden = !on;
      if (!on) noteDue.value = "";
    }

    function metaSnapshot() {
      return JSON.stringify({
        isTodo: noteTodo.checked, dueDate: noteTodo.checked ? noteDue.value : "",
        people: peopleChips.map(function (c) { return c.username || ("~" + c.name); }),
        ort: noteOrt.value,
      });
    }

    if (window.marked) marked.use({ gfm: true, breaks: true });

    function noteVal() { return noteCM ? noteCM.getValue() : noteText.value; }

    // Links in gerendertem Markdown: externe (http/https/mailto) mit
    // target=_blank versehen — Wrapper-Apps (z.B. Voltage) reichen _blank an
    // den System-Browser durch, normale Navigation bliebe in der App haengen.
    // Interne/relative Links und Anker wuerden mitten in der App auf
    // Nirgendwo-Pfade navigieren -> href entfernen, sie werden reiner Text.
    function externalizeLinks(root) {
      root.querySelectorAll("a[href]").forEach(function (a) {
        if (/^(https?:|mailto:)/i.test(a.getAttribute("href"))) {
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        } else {
          a.removeAttribute("href");
        }
      });
    }

    // Vorschau rendern; wirft der Parser, gilt das Markdown als ungueltig
    // und die Statuszeile zeigt den Fehler (Speichern bleibt moeglich)
    function renderNotePreview() {
      if (!window.marked || !window.DOMPurify) return;
      var html;
      try {
        html = marked.parse(noteVal());
        noteStatus.textContent = "";
      } catch (e) {
        noteStatus.textContent = "Markdown-Fehler: " + (e && e.message || e);
        return;
      }
      notePreview.innerHTML = DOMPurify.sanitize(html);
      externalizeLinks(notePreview);
      if (window.hljs) {
        notePreview.querySelectorAll("pre code").forEach(function (el) {
          hljs.highlightElement(el);
        });
      }
    }

    function onNoteChange() {
      var v = noteVal();
      var unchanged = v === noteBaseline && metaSnapshot() === noteMetaBaseline;
      noteSave.disabled = unchanged || v.trim() === "";
      clearTimeout(noteTimer);
      noteTimer = setTimeout(renderNotePreview, 200);
    }

    noteTodo.addEventListener("change", function () { updateDueVisibility(); onNoteChange(); });
    [noteDue, noteOrt].forEach(function (el) { el.addEventListener("input", onNoteChange); });

    function ensureNoteEditor() {
      if (noteCM || !window.CodeMirror) return;
      noteCM = CodeMirror.fromTextArea(noteText, {
        mode: "markdown",
        theme: "github", // eigene Palette in index.css, passend zur Vorschau
        lineWrapping: true,
        extraKeys: {
          "Ctrl-B": function () { mdActions.bold(); },
          "Ctrl-I": function () { mdActions.italic(); },
        },
      });
      noteCM.on("change", onNoteChange);
    }
    noteText.addEventListener("input", onNoteChange); // Fallback ohne CodeMirror

    // Ansicht vs. Bearbeiten: bestehende Notizen oeffnen als gerendertes
    // Panel (note-view); der Stift auf dem Panel wechselt ins Bearbeiten.
    var noteCanEdit = false;
    var noteEditBtn = document.getElementById("note-edit");
    var notePdfBtn = document.getElementById("note-pdf");
    var noteExportUrl = null; // /notes/pdf/... — nur bei gespeicherten Notizen
    function setNoteMode(editMode) {
      noteDlg.classList.toggle("note-view", !editMode);
      // evtl. beim Resizen eingefrorene Position aufheben -> wieder zentriert
      noteDlg.style.left = noteDlg.style.top = noteDlg.style.margin = "";
      if (editMode) {
        // gemerkte Groesse anwenden, aber nie groesser als das Fenster
        var s = (localStorage.getItem("relay-note-size") || "").split("x");
        if (s.length === 2 && +s[0] && +s[1]) {
          noteDlg.style.width = Math.min(+s[0], window.innerWidth - 24) + "px";
          noteDlg.style.height = Math.min(+s[1], window.innerHeight - 24) + "px";
        }
      } else {
        // Lese-Panel behaelt seine kompakte CSS-Groesse
        noteDlg.style.width = noteDlg.style.height = "";
      }
      if (noteEditBtn) noteEditBtn.hidden = editMode || !noteCanEdit;
      // PDF-Export nur im Lese-Modus und nur bei bereits gespeicherten Notizen
      // (auch fuer nur-lesende Freigaben verfuegbar)
      if (notePdfBtn) notePdfBtn.hidden = editMode || !noteExportUrl;
      // Detailfelder nur im Bearbeiten-Modus anfassbar — wie der Editor
      // selbst (das Panel im Lese-Modus zeigt nur an, aendert nichts)
      var metaEditable = editMode && noteCanEdit;
      noteTodo.disabled = !metaEditable;
      [noteDue, noteOrt, notePeopleInput].forEach(function (el) { el.disabled = !metaEditable; });
      if (!metaEditable) hidePeopleDropdown();
      // Formular nur beim Bearbeiten sichtbar, Lese-Zusammenfassung nur im
      // Lese-Modus UND nur, wenn es ueberhaupt etwas zu zeigen gibt
      noteDetails.hidden = !editMode;
      noteViewSummary.hidden = editMode || !noteSummaryHasContent;
      if (editMode && noteCM) {
        noteCM.refresh(); // Spalte war ausgeblendet -> Masse neu messen
        noteCM.focus();
      }
    }

    // Verschieben (am Kopf) und Skalieren (unsichtbare Griffecke unten
    // rechts): beides wandelt die zentrierte Lage (inset:0 + margin:auto)
    // zuerst in feste left/top-Koordinaten um — beim Skalieren wuerde der
    // Dialog sonst symmetrisch wachsen und der Griff der Maus davonlaufen.
    // Kein Sprung: left/top = aktuelle Position; setNoteMode zentriert wieder.
    function pinNote() {
      var r = noteDlg.getBoundingClientRect();
      noteDlg.style.left = r.left + "px";
      noteDlg.style.top = r.top + "px";
      noteDlg.style.margin = "0";
      return r;
    }
    function noteDrag(handle, onMove) {
      handle.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        // Klicks auf Bedienelemente im Kopf (×) nicht kapern
        if (e.target.closest("button,a,input")) return;
        var r = pinNote();
        var sx = e.clientX, sy = e.clientY;
        function move(ev) { onMove(r, ev.clientX - sx, ev.clientY - sy); }
        function stop() {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", stop);
          handle.removeEventListener("pointercancel", stop);
        }
        handle.setPointerCapture(e.pointerId);
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", stop);
        handle.addEventListener("pointercancel", stop);
        e.preventDefault(); // sonst wuerde der Titeltext beim Ziehen markiert
      });
    }
    noteDrag(noteDlg.querySelector(".dialog-head"), function (r, dx, dy) {
      // Kopfzeile bleibt immer erreichbar: nie ganz aus dem Fenster schieben
      noteDlg.style.left = Math.max(80 - r.width,
        Math.min(r.left + dx, window.innerWidth - 80)) + "px";
      noteDlg.style.top = Math.max(8,
        Math.min(r.top + dy, window.innerHeight - 48)) + "px";
    });
    var noteResize = document.getElementById("note-resize");
    if (noteResize) noteDrag(noteResize, function (r, dx, dy) {
      // Untergrenzen zieht das CSS ein (min-width/min-height)
      noteDlg.style.width = (r.width + dx) + "px";
      noteDlg.style.height = (r.height + dy) + "px";
    });
    // bei jeder Groessenaenderung: CodeMirror neu vermessen und die vom
    // Nutzer gewaehlte Groesse merken (Inline-width setzt nur der UA-Resize
    // bzw. setNoteMode aus dem gemerkten Wert — CSS-Groessen nicht speichern)
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (!noteDlg.open || noteDlg.classList.contains("note-view")) return;
        if (noteCM) noteCM.refresh();
        if (noteDlg.style.width) {
          var r = noteDlg.getBoundingClientRect();
          localStorage.setItem("relay-note-size",
            Math.round(r.width) + "x" + Math.round(r.height));
        }
      }).observe(noteDlg);
    }
    if (noteEditBtn) {
      noteEditBtn.addEventListener("click", function () { setNoteMode(true); });
    }
    if (notePdfBtn) {
      // oeffnet das gerenderte PDF im OnlyOffice-Viewer — im SELBEN Tab
      // (wie das normale Datei-Oeffnen), nicht in einem neuen
      notePdfBtn.addEventListener("click", function () {
        if (noteExportUrl) window.location.assign(noteExportUrl);
      });
    }

    function openNote(title, content, action, canEdit, startEdit, meta) {
      meta = meta || { isTodo: false, dueDate: "", people: { known: [], extra: [] }, ort: "" };
      ensureNoteEditor();
      noteCanEdit = canEdit;
      noteTitleEl.textContent = title;
      noteForm.action = action;
      // PDF-Export nur fuer gespeicherte Notizen: die Save-Action traegt owner/rel.
      // Ziel liegt unter /edit/, damit Voltage den OnlyOffice-Kontext erkennt.
      noteExportUrl = action.indexOf("/notes/save/") !== -1
        ? action.replace("/notes/save/", "/edit/notepdf/") : null;
      if (noteCM) {
        noteCM.setValue(content);
        noteCM.setOption("readOnly", canEdit ? false : "nocursor");
      } else {
        noteText.value = content;
        noteText.readOnly = !canEdit;
      }
      noteSave.hidden = !canEdit;
      noteSave.disabled = true;
      noteStatus.textContent = "";
      noteBaseline = content;

      // Formularfelder (Bearbeiten-Modus) befuellen: people speichert
      // Nutzernamen bekannter Nutzer + Freitext getrennt (siehe notemeta.js)
      peopleChips = [];
      (meta.people.known || []).forEach(function (uname) {
        var u = knownByUsername[uname];
        if (u) peopleChips.push({ username: u.username, name: u.display_name, hasAvatar: u.hasAvatar });
      });
      (meta.people.extra || []).forEach(function (name) {
        peopleChips.push({ username: null, name: name, hasAvatar: false });
      });
      notePeopleInput.value = "";
      hidePeopleDropdown();
      renderChips();
      noteTodo.checked = meta.isTodo;
      noteDue.value = meta.dueDate || "";
      updateDueVisibility();
      noteOrt.value = meta.ort || "";
      noteMetaBaseline = metaSnapshot();

      // Lese-Zusammenfassung aus denselben Daten bauen, dann erst den Modus
      // setzen — der blendet Formular/Zusammenfassung passend ein/aus
      renderNoteSummary(meta);
      setNoteMode(!!(startEdit && canEdit));

      openDlg(noteDlg);
      if (noteCM) {
        noteCM.refresh(); // war beim Initialisieren unsichtbar -> Masse neu messen
        if (canEdit) noteCM.focus();
      } else if (canEdit) {
        noteText.focus();
      }
      renderNotePreview();
    }

    // Splitter: Aufteilung Editor/Vorschau per Ziehen aendern (20-80%),
    // gemerkt im localStorage; CodeMirror muss bei Breitenaenderung neu messen
    var noteSplitter = document.getElementById("note-splitter");
    var noteMain = noteForm.querySelector(".note-main");
    var noteEditorPane = noteForm.querySelector(".note-editor-pane");
    var SPLIT_KEY = "relay-note-split";
    var savedSplit = parseFloat(localStorage.getItem(SPLIT_KEY));
    if (savedSplit >= 20 && savedSplit <= 80)
      noteEditorPane.style.flex = "0 0 " + savedSplit + "%";
    if (noteSplitter) {
      noteSplitter.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        noteSplitter.setPointerCapture(e.pointerId);
        noteSplitter.classList.add("dragging");
      });
      noteSplitter.addEventListener("pointermove", function (e) {
        if (!noteSplitter.hasPointerCapture(e.pointerId)) return;
        var rect = noteMain.getBoundingClientRect();
        var pct = Math.min(80, Math.max(20, ((e.clientX - rect.left) / rect.width) * 100));
        noteEditorPane.style.flex = "0 0 " + pct + "%";
        localStorage.setItem(SPLIT_KEY, pct.toFixed(1));
        if (noteCM) noteCM.refresh();
      });
      noteSplitter.addEventListener("pointerup", function (e) {
        noteSplitter.releasePointerCapture(e.pointerId);
        noteSplitter.classList.remove("dragging");
      });
    }

    // Markdown-Toolbar: Toggle-Operationen auf der CodeMirror-Selektion.
    // Alle Aenderungen laufen ueber die CM-API -> change-Event -> Vorschau
    // und Speichern-Zustand aktualisieren sich von selbst.
    function mdWrap(marker) {
      if (!noteCM) return;
      var sel = noteCM.getSelection();
      if (sel.length >= 2 * marker.length && sel.startsWith(marker) && sel.endsWith(marker)) {
        noteCM.replaceSelection(sel.slice(marker.length, sel.length - marker.length), "around");
      } else if (sel) {
        noteCM.replaceSelection(marker + sel + marker, "around");
      } else {
        var cur = noteCM.getCursor();
        noteCM.replaceRange(marker + marker, cur);
        noteCM.setCursor({ line: cur.line, ch: cur.ch + marker.length });
      }
      noteCM.focus();
    }
    function mdEachLine(fn) { // fn(text) -> neuer Text, fuer alle selektierten Zeilen
      if (!noteCM) return;
      var from = noteCM.getCursor("from").line, to = noteCM.getCursor("to").line;
      noteCM.operation(function () {
        for (var l = from, i = 0; l <= to; l++, i++) {
          var t = noteCM.getLine(l);
          noteCM.replaceRange(fn(t, i), { line: l, ch: 0 }, { line: l, ch: t.length });
        }
      });
      noteCM.focus();
    }
    function mdPrefix(prefix, re) {
      mdEachLine(function (t) { return re.test(t) ? t.replace(re, "") : prefix + t; });
    }
    function mdHeading(level) {
      mdEachLine(function (t) {
        var m = t.match(/^(#{1,6})\s+/);
        var stripped = t.replace(/^#{1,6}\s+/, "");
        return m && m[1].length === level ? stripped : "#".repeat(level) + " " + stripped;
      });
    }
    var mdActions = {
      bold: function () { mdWrap("**"); },
      italic: function () { mdWrap("*"); },
      strike: function () { mdWrap("~~"); },
      code: function () { mdWrap("`"); },
      h1: function () { mdHeading(1); },
      h2: function () { mdHeading(2); },
      h3: function () { mdHeading(3); },
      ul: function () { mdPrefix("- ", /^-\s+(?!\[)/); },
      ol: function () { mdEachLine(function (t, i) {
        return /^\d+\.\s+/.test(t) ? t.replace(/^\d+\.\s+/, "") : (i + 1) + ". " + t;
      }); },
      task: function () { mdPrefix("- [ ] ", /^-\s+\[[ xX]\]\s+/); },
      quote: function () { mdPrefix("> ", /^>\s?/); },
      codeblock: function () {
        if (!noteCM) return;
        var sel = noteCM.getSelection();
        if (sel) {
          noteCM.replaceSelection("```\n" + sel + "\n```", "around");
        } else {
          var cur = noteCM.getCursor();
          noteCM.replaceRange("```\n\n```", cur);
          noteCM.setCursor({ line: cur.line + 1, ch: 0 });
        }
        noteCM.focus();
      },
      link: function () {
        if (!noteCM) return;
        noteCM.replaceSelection("[" + (noteCM.getSelection() || "Text") + "](url)");
        var end = noteCM.getCursor();
        noteCM.setSelection({ line: end.line, ch: end.ch - 4 }, { line: end.line, ch: end.ch - 1 });
        noteCM.focus();
      },
      hr: function () {
        if (!noteCM) return;
        var cur = noteCM.getCursor();
        noteCM.replaceRange("\n---\n", { line: cur.line, ch: noteCM.getLine(cur.line).length });
        noteCM.focus();
      },
    };
    document.querySelectorAll("#note-toolbar .note-tb").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var fn = mdActions[btn.dataset.md];
        if (fn && noteCM && !noteCM.getOption("readOnly")) fn();
      });
    });

    var noteNew = document.getElementById("note-new");
    if (noteNew) {
      noteNew.addEventListener("click", function () {
        openNote("Neue Notiz", "# Titel\n\n", noteCreateAction, true, true);
        // "Titel" vorselektieren: lostippen ersetzt das Platzhalterwort
        if (noteCM) noteCM.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 7 });
        else noteText.setSelectionRange(2, 7);
      });
    }
    // Hover ueber einem Notiz-Namen: gerenderte Vorschau als Kaertchen unter
    // dem Namen (gleiche Verzoegerung wie Tooltips, Inhalt wird gecacht;
    // nach dem Speichern laedt die Seite ohnehin neu -> Cache immer frisch)
    var noteTip = document.getElementById("note-tip");
    var noteTipCache = {};
    var noteTipTimer = null;
    function hideNoteTip() {
      clearTimeout(noteTipTimer);
      if (noteTip) noteTip.classList.remove("open");
    }
    window.addEventListener("scroll", hideNoteTip, true);
    document.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("mouseleave", hideNoteTip);
      btn.addEventListener("mouseenter", function () {
        if (!noteTip || !window.marked || !window.DOMPurify) return;
        clearTimeout(noteTipTimer);
        noteTipTimer = setTimeout(function () {
          var rel = btn.dataset.rel.split("/").map(encodeURIComponent).join("/");
          var ownerPart = encodeURIComponent(btn.dataset.owner) + "/" + rel;
          var key = btn.dataset.owner + "/" + btn.dataset.rel;
          // Inhalt UND Metadaten laden (Meta ist optional -> Fehler schluckt der
          // Badge-Teil einfach); zusammen gecacht {text, meta}
          var loaded = noteTipCache[key] !== undefined
            ? Promise.resolve(noteTipCache[key])
            : Promise.all([
                fetch(noteBaseUrl + "/notes/raw/" + ownerPart)
                  .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
                fetch(noteBaseUrl + "/notes/meta/" + ownerPart)
                  .then(function (r) { return r.ok ? r.json() : null; })
                  .catch(function () { return null; }),
              ]).then(function (res) {
                var data = { text: res[0], meta: res[1] };
                noteTipCache[key] = data;
                return data;
              });
          loaded.then(function (data) {
            noteTip.innerHTML = "";
            var body = document.createElement("div");
            body.className = "md-render";
            body.innerHTML = DOMPurify.sanitize(marked.parse(data.text));
            externalizeLinks(body);
            if (window.hljs) {
              body.querySelectorAll("pre code").forEach(function (el) {
                hljs.highlightElement(el);
              });
            }
            noteTip.appendChild(body);
            // Meta-Badges als Fuss unten ins Kaertchen (nur, wenn gesetzt);
            // ~10% kleiner als in der Dialog-Lese-Ansicht
            if (data.meta) {
              var badges = document.createElement("div");
              badges.className = "note-tip-badges";
              if (appendSummaryBadges(badges, data.meta, { avatar: 16, icon: 13 }))
                noteTip.appendChild(badges);
            }
            var r = btn.getBoundingClientRect();
            var left = Math.max(8, Math.min(r.left, window.innerWidth - noteTip.offsetWidth - 8));
            var top = r.bottom + 6;
            if (top + noteTip.offsetHeight > window.innerHeight - 8)
              top = Math.max(8, r.top - noteTip.offsetHeight - 6);
            noteTip.style.left = left + "px";
            noteTip.style.top = top + "px";
            noteTip.classList.add("open");
          }).catch(function () { /* Vorschau ist optional — Fehler still schlucken */ });
        }, 350);
      });
    });

    document.querySelectorAll(".note-open").forEach(function (btn) {
      btn.addEventListener("click", function () {
        hideNoteTip();
        var rel = btn.dataset.rel.split("/").map(encodeURIComponent).join("/");
        var ownerPart = encodeURIComponent(btn.dataset.owner) + "/" + rel;
        Promise.all([
          fetch(noteBaseUrl + "/notes/raw/" + ownerPart)
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); }),
          fetch(noteBaseUrl + "/notes/meta/" + ownerPart)
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
        ])
          .then(function (res) {
            openNote(btn.dataset.label,
              res[0],
              noteBaseUrl + "/notes/save/" + ownerPart,
              btn.dataset.canedit === "1",
              false,
              res[1]);
          })
          .catch(function () {
            showNotice("Fehler", "Die Notiz konnte nicht geladen werden.", { danger: true });
          });
      });
    });

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
            fetch(noteBaseUrl + "/desktop/layout", {
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

    // --- Frei platzierbare Notiz-Icons ("Desktop") ------------------------
    // Die Icons sind zugleich .note-open -> Klick (oeffnen) und Hover
    // (Vorschau) laufen ueber die Handler oben. Hier nur Position + Ziehen.
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

    // Standard-Platzierung ohne gemerkte Position: abwechselnd linker/rechter
    // freier Rand neben der Liste, von oben (unter der Topbar) nach unten
    function layoutDeskDefaults(icons) {
      if (!icons.length) return;
      var page = document.querySelector(".page");
      var pr = page ? page.getBoundingClientRect() : { left: 0, right: window.innerWidth };
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
      fetch(noteBaseUrl + "/notes/desktop", {
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
  }

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
    openDlg(dlg);
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
      openDlg(confirmDlg);
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
