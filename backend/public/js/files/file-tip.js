// Kurzinfo zu einer Datei als Hover-Kaertchen.
//
// Haengt an den Verweisen im Notiztext (js/notes/doclinks.js): eine Notiz
// zeigt dort ihre gewohnte Inhaltsvorschau, ein Dokument hat keine — also
// zeigen wir, was man ohne Oeffnen wissen will: Groesse, letzte Aenderung und
// die Freigabe-Lage. Wem die Datei gehoert, sieht die Empfaenger; wem sie
// freigegeben wurde, sieht den Absender (GET /fileinfo entscheidet das, nicht
// diese Datei — die Aufteilung ist eine Frage der Berechtigung).
import { zeigeKarte, versteckeKarte } from "../core/card-tip.js";
import { personAvatar } from "../notes/summary.js";

var VERZOEGERUNG = 350; // wie bei den uebrigen Hover-Kaertchen
var einzige = null;     // eine Karte fuer die ganze Seite

function baueKarte() {
  var el = document.createElement("div");
  el.className = "note-tip doc-tip";
  el.id = "doc-tip";
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  return el;
}

function rechtText(perm) { return perm === "edit" ? "Bearbeiten" : "Nur lesen"; }

function fuelle(karte, info, baseUrl) {
  karte.innerHTML = "";

  var kopf = document.createElement("div");
  kopf.className = "doc-tip-head";
  var icon = document.createElement("img");
  icon.src = baseUrl + "/static/img/" + info.icon + ".svg";
  icon.alt = ""; icon.width = 18; icon.height = 18;
  kopf.appendChild(icon);
  var name = document.createElement("span");
  name.className = "doc-tip-name";
  name.textContent = info.label;
  kopf.appendChild(name);
  karte.appendChild(kopf);

  var zeile = document.createElement("div");
  zeile.className = "doc-tip-meta";
  zeile.textContent = info.size + " · geändert " + info.modified;
  karte.appendChild(zeile);

  // Freigabe-Lage — nur, wenn es eine gibt
  var teil = null;
  if (info.sharedBy) {
    teil = [{ person: info.sharedBy, perm: info.sharedBy.perm }];
  } else if (info.shares && info.shares.length) {
    teil = info.shares.map(function (s) { return { person: s, perm: s.perm }; });
  }
  if (!teil) return;

  var box = document.createElement("div");
  box.className = "doc-tip-shares";
  var titel = document.createElement("div");
  titel.className = "doc-tip-shares-title";
  titel.textContent = info.sharedBy ? "Freigegeben von" : "Geteilt mit";
  box.appendChild(titel);
  teil.forEach(function (t) {
    var row = document.createElement("span");
    row.className = "share-tip-row"; // dieselbe Zeilenoptik wie in der Dateiliste
    row.appendChild(personAvatar(
      { username: t.person.username, name: t.person.name, hasAvatar: t.person.hasAvatar },
      22, baseUrl));
    var n = document.createElement("span");
    n.className = "share-tip-name";
    n.textContent = t.person.name;
    row.appendChild(n);
    var p = document.createElement("span");
    p.className = "share-tip-perm";
    p.textContent = rechtText(t.perm);
    row.appendChild(p);
    box.appendChild(row);
  });
  karte.appendChild(box);
}

// Eine Instanz pro Seite (die Karte ist ein einzelnes Element, das umherwandert).
export function fileTip(baseUrl) {
  if (einzige) return einzige;
  var karte = null;
  var timer = null;
  var cache = {};

  function verstecke() {
    clearTimeout(timer);
    versteckeKarte(karte);
  }

  function zeige(anker, owner, rel) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var pfad = encodeURIComponent(owner) + "/" +
        rel.split("/").map(encodeURIComponent).join("/");
      var key = owner + "/" + rel;
      var geladen = cache[key] !== undefined
        ? Promise.resolve(cache[key])
        : fetch(baseUrl + "/fileinfo/" + pfad, { credentials: "same-origin" })
            .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(function (info) { cache[key] = info; return info; });
      geladen.then(function (info) {
        if (!karte) karte = document.getElementById("doc-tip") || baueKarte();
        fuelle(karte, info, baseUrl);
        zeigeKarte(karte, anker);
      }).catch(function () { /* Kurzinfo ist Beiwerk — Fehler still schlucken */ });
    }, VERZOEGERUNG);
  }

  window.addEventListener("scroll", verstecke, true);
  einzige = { zeige: zeige, verstecke: verstecke };
  return einzige;
}
