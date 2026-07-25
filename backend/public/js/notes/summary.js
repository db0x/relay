// Personen-Avatare, Fälligkeits-Label und die Status/ToDo/Personen/Ort-Badges
// der Notiz-Lese-Ansicht — gemeinsam genutzt vom Personen-Chip-Feld, der
// Dialog-Zusammenfassung UND dem Hover-Tooltip in der Dateiliste.
import { statusBadge } from "./status.js";

// Avatar (bekannt+Bild) bzw. Initialen-Kreis (bekannt ohne Bild) —
// Freitext-Personen bekommen kein Rund; size in px
export function personAvatar(entry, size, baseUrl) {
  if (entry.username && entry.hasAvatar) {
    var img = document.createElement("img");
    img.className = "person-av";
    img.src = baseUrl + "/avatar/" + encodeURIComponent(entry.username);
    img.alt = ""; img.width = size; img.height = size;
    return img;
  }
  var fb = document.createElement("span");
  fb.className = "person-av person-av-fallback";
  fb.style.width = fb.style.height = size + "px";
  fb.textContent = (entry.name || "?").trim().charAt(0).toUpperCase();
  return fb;
}

export function formatDueLabel(iso) {
  var p = (iso || "").split("-");
  return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : "";
}

// Kleines Icon (place.svg/users.svg) als Abschnittsmarkierung in der
// Lese-Zusammenfassung — strukturiert die Zeile, ohne sie zu vergroessern
function noteSummaryIcon(name, size, baseUrl) {
  var img = document.createElement("img");
  img.className = "note-summary-icon";
  img.src = baseUrl + "/static/img/" + name + ".svg";
  img.alt = ""; img.width = size || 14; img.height = size || 14;
  return img;
}

// Meta-Badges (ToDo/Personen/Ort) in `target` einhaengen — nur, was
// tatsaechlich gesetzt ist: Personen als Avatar+Name (bekannt) bzw. reiner
// Text (Freitext). Rueckgabe: Anzahl gerenderter Badges (0 = nichts).
// Gemeinsam genutzt von der Lese-Ansicht im Dialog UND dem Hover-Tooltip;
// opts.avatar/opts.icon steuern die Groessen (Tooltip nutzt kleinere).
export function appendSummaryBadges(target, meta, knownByUsername, baseUrl, opts) {
  opts = opts || {};
  var avSize = opts.avatar || 18, icoSize = opts.icon || 14;
  var known = (meta.people && meta.people.known) || [];
  var extra = (meta.people && meta.people.extra) || [];
  var count = 0;

  // Der Bearbeitungsstand steht IMMER vorn — anders als die uebrigen Badges
  // hat jede Notiz einen (Default "Offen"), er soll jederzeit ablesbar sein.
  target.appendChild(statusBadge(meta.status));
  count++;

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
    wrap.appendChild(noteSummaryIcon("users", icoSize, baseUrl));
    known.forEach(function (uname) {
      var u = knownByUsername[uname];
      if (!u) return; // Nutzer inzwischen geloescht -> stillschweigend auslassen
      var p = document.createElement("span");
      p.className = "note-person";
      p.appendChild(personAvatar({ username: u.username, name: u.display_name, hasAvatar: u.hasAvatar }, avSize, baseUrl));
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
    ortSpan.appendChild(noteSummaryIcon("place", icoSize, baseUrl));
    ortSpan.appendChild(document.createTextNode(meta.ort));
    target.appendChild(ortSpan); count++;
  }
  return count;
}

// Minimalistische Lese-Ansicht (Dialog) — nur sichtbar, wenn etwas da ist.
// Rueckgabe: true, wenn tatsaechlich etwas gerendert wurde.
export function renderNoteSummary(noteViewSummary, meta, knownByUsername, baseUrl) {
  noteViewSummary.innerHTML = "";
  return appendSummaryBadges(noteViewSummary, meta, knownByUsername, baseUrl) > 0;
}
