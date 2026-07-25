// Personen: Chip-Feld mit Autocomplete aus den bekannten Nutzern (data-known),
// nimmt ebenso Freitext fuer Unbekannte an. peopleChips ist die einzige
// Quelle der Wahrheit; versteckte people_known/people_extra-Felder werden
// daraus synchronisiert (normaler Form-POST), ebenso die Lese-Ansicht.
import { personAvatar } from "./summary.js";

// config: { field, chipsEl, input, hiddenEl, form, baseUrl, onChange }
// onChange wird bei jeder Aenderung des Chip-Zustands gerufen (Speichern-Button-Refresh).
export function createPeopleChips(config) {
  var notePeopleField = config.field;
  var notePeopleChips = config.chipsEl;
  var notePeopleInput = config.input;
  var notePeopleHidden = config.hiddenEl;
  var baseUrl = config.baseUrl;
  var onChange = config.onChange;

  var knownUsers = [];
  try { knownUsers = JSON.parse(notePeopleField.dataset.known || "[]"); } catch (e) {}
  var knownByUsername = {};
  knownUsers.forEach(function (u) { knownByUsername[u.username] = u; });
  var peopleChips = []; // {username|null, name, hasAvatar}
  var peopleDropdown = null;

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
      if (entry.username) chip.appendChild(personAvatar(entry, 16, baseUrl));
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
    onChange();
  }
  function removeChipAt(i) { peopleChips.splice(i, 1); renderChips(); onChange(); }

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
      opt.appendChild(personAvatar({ username: u.username, name: u.display_name, hasAvatar: u.hasAvatar }, 18, baseUrl));
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
  if (config.form) {
    config.form.addEventListener("submit", function () {
      if (notePeopleInput.value.trim()) commitPeopleInput();
    });
  }

  return {
    knownByUsername: knownByUsername,
    getChips: function () { return peopleChips; },
    // Chip-Zustand komplett ersetzen (beim Oeffnen einer Notiz aus meta.people)
    setChips: function (newChips) {
      peopleChips = newChips;
      notePeopleInput.value = "";
      hidePeopleDropdown();
      renderChips();
    },
    hideDropdown: hidePeopleDropdown,
  };
}
