// Gemeinsamer Kern der Dokumentsuche.
//
// Zwei Stellen suchen dieselben Dinge und sollen dabei gleich aussehen und
// gleich sortieren: das Suchfeld im Anwendungs-Menue (js/search.js) und die
// @-Verlinkung im Notiz-Editor (js/notes/mention.js). Geteilt wird darum
// beides — der Abruf UND der Aufbau einer Trefferzeile. Was die beiden
// unterscheidet, ist allein, was ein Klick auf einen Treffer ausloest:
// oeffnen bzw. einen Verweis in den Text setzen.

// GET /search liefert je Treffer schon alles Noetige (siehe routes/browse.js).
// Fehler enden bewusst als leere Liste: eine Suche, die nichts findet, ist
// derselbe Zustand wie eine, die nicht antwortet — es gibt nichts zu waehlen.
//
// ohneBibliothek: die @-Verlinkung im Notiz-Editor braucht das. Ihr Verweis
// besteht aus Besitzer + Pfad, und einen Besitzer hat eine Bibliotheksdatei
// nicht — angeboten werden darf dort also nur, was sich auch verlinken laesst.
export function sucheDokumente(baseUrl, q, ohneBibliothek) {
  return fetch(baseUrl + "/search?q=" + encodeURIComponent(q) + (ohneBibliothek ? "&lib=0" : ""),
    { credentials: "same-origin" })
    .then(function (r) { return r.ok ? r.json() : []; });
}

// Inhalt einer Trefferzeile: Typ-Icon, Beschriftung, Herkunftshinweis.
// Das aeussere Element stellt der Aufrufer (Link oder Knopf) — nur so kann
// jede Seite ihre eigenen Oeffnen-Haken daran haengen.
export function fuelleTreffer(el, hit, baseUrl) {
  var icon = document.createElement("img");
  icon.className = "app-hit-icon";
  icon.src = baseUrl + "/static/img/" + hit.icon + ".svg";
  icon.alt = ""; icon.width = 20; icon.height = 20;
  el.appendChild(icon);

  var text = document.createElement("span");
  text.className = "app-hit-label";
  text.textContent = hit.label;
  el.appendChild(text);

  if (hit.hint) {
    var hint = document.createElement("span");
    hint.className = "app-hit-hint";
    hint.textContent = hit.hint;
    el.appendChild(hint);
  }
  return el;
}
