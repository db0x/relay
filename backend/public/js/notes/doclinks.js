// Verweise von einer Notiz auf ein Dokument oder eine andere Notiz.
//
// Gespeichert wird ganz normales Markdown — es entsteht KEINE Sonderauszeichnung
// in der Datei:
//
//     [Urlaubsplanung](relay/thomas/Reisen/2026-Norwegen.docx)
//
// Warum dieses Ziel und keine echte Adresse?
//   - Kein Instanz-Praefix (BASE_PATH) und kein Hostname im Notiztext: dieselbe
//     Notiz funktioniert lokal wie auf dem Server, auch wenn Relay dort unter
//     einem Unterpfad laeuft. Die Datei wandert per Sync zwischen Instanzen.
//   - Es ist eine relative Adresse und ueberlebt darum DOMPurify. Ein eigenes
//     Schema (relay:…) wuerde beim Saeubern verworfen — der Verweis waere weg.
//   - Wer die Datei in einem fremden Markdown-Programm oeffnet, sieht immer
//     noch den Titel als Text; kaputt geht nichts.
//
// Verweise zeigen auf owner + Pfad, nicht auf eine Kennung: wird die Zieldatei
// umbenannt oder verschoben, laeuft der Verweis ins Leere (der Klick meldet das
// dann). Auch der Verweistext ist der Titel VON DAMALS — er wandert nicht mit.
import { bindImageOpen } from "../files/image-view.js";
import { fileTip } from "../files/file-tip.js";

var PREFIX = "relay/";

// Dateiendung -> Typ-Icon; dieselbe Zuordnung wie iconFor() in routes/browse.js
// (dort fuer Dateiliste und Suche, hier fuer den Verweis im Fliesstext).
var BILD_TYPEN = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
function endung(name) { return (name.split(".").pop() || "").toLowerCase(); }
export function istBild(name) { return BILD_TYPEN.indexOf(endung(name)) !== -1; }
function iconFuer(name) {
  var ext = endung(name);
  if (["xlsx", "xls", "ods", "csv"].indexOf(ext) !== -1) return "xlsx";
  if (["pptx", "ppt", "odp"].indexOf(ext) !== -1) return "pptx";
  if (ext === "pdf") return "pdf";
  if (ext === "md") return "note";
  if (istBild(name)) return "image";
  return "docx";
}

// Pfadteile einzeln kodieren: Leerzeichen und Klammern wuerden die
// Markdown-Klammer sonst vorzeitig schliessen.
function encPfad(owner, rel) {
  return encodeURIComponent(owner) + "/" +
    rel.split("/").map(encodeURIComponent).join("/");
}

// Das fertige Markdown fuer einen Verweis. Eckige Klammern im Titel werden
// maskiert — sonst zerfaellt der Verweis beim Rendern.
//
// alsBild=true erzeugt eine EINBETTUNG statt eines Verweises. Der Unterschied
// ist genau ein Ausrufezeichen — Markdown kann das von Haus aus, wir brauchen
// dafuer weder eine eigene Schreibweise noch einen Vermerk in der Datenbank.
// Und weil die Entscheidung sichtbar im Text steht, aendert man sie spaeter
// durch Setzen oder Loeschen dieses einen Zeichens.
export function markdownVerweis(label, owner, rel, alsBild) {
  return (alsBild ? "!" : "")
    + "[" + String(label).replace(/([[\]])/g, "\\$1") + "](" + PREFIX + encPfad(owner, rel) + ")";
}

// Ziel eines href zurueckuebersetzen; null, wenn es keiner unserer Verweise ist.
export function zielVon(href) {
  if (!href || href.indexOf(PREFIX) !== 0) return null;
  var teile = href.slice(PREFIX.length).split("/");
  if (teile.length < 2) return null;
  try { teile = teile.map(decodeURIComponent); } catch (e) { return null; }
  var owner = teile.shift();
  var rel = teile.join("/");
  return owner && rel ? { owner: owner, rel: rel } : null;
}

// Verweise in gerendertem Markdown herrichten: Typ-Icon davor, Optik als
// Kachel im Fliesstext — und je nach Ziel der passende Oeffnen-Weg.
//
// config: { baseUrl, openNote, noteTip, hideNoteTip } — alles ausser baseUrl
// fehlt dort, wo ohnehin niemand hinfahren kann (die Hover-Vorschau selbst
// verschwindet beim Ansteuern). Dann bleiben die Verweise reine Anzeige.
//   openNote(owner, rel, label)  oeffnet eine verlinkte Notiz im Dialog
//   noteTip(anker, owner, rel)   zeigt die gewohnte Notiz-Vorschau
export function bindDocLinks(root, config) {
  var baseUrl = config.baseUrl;
  var openNote = config.openNote;
  var noteTip = config.noteTip;
  var datei = openNote ? fileTip(baseUrl) : null;

  // Beim Neuaufbau der Vorschau (jeder Tastendruck im Editor) verschwinden die
  // alten Verweise, OHNE dass ein mouseleave feuert — ein offenes Kaertchen
  // bliebe sonst stehen und zeigte auf ein Element, das es nicht mehr gibt.
  if (datei) datei.verstecke();
  if (config.hideNoteTip) config.hideNoteTip();

  var hatBild = false;

  Array.prototype.forEach.call(root.querySelectorAll("a[href]"), function (a) {
    var ziel = zielVon(a.getAttribute("href"));
    if (!ziel) return;
    var name = ziel.rel.split("/").pop();
    var label = a.textContent;
    var pfad = encPfad(ziel.owner, ziel.rel);

    // .doc-link ist zugleich die Markierung fuer externalizeLinks: dieser
    // Verweis ist bereits versorgt und darf seinen href behalten.
    a.classList.add("doc-link");
    var icon = document.createElement("img");
    icon.className = "doc-link-icon";
    icon.src = baseUrl + "/static/img/" + iconFuer(name) + ".svg";
    icon.alt = ""; icon.width = 14; icon.height = 14;
    a.insertBefore(icon, a.firstChild);

    if (/\.md$/i.test(name)) {
      // Notizen haben keine eigene Adresse — sie leben im Dialog. Also kein
      // href, sondern derselbe Weg, den auch Liste und Desktop-Icons gehen.
      a.removeAttribute("href");
      if (!openNote) return;
      a.setAttribute("role", "link");
      a.tabIndex = 0;
      // Vorschau beim Hinfahren: dieselbe Karte wie an Listenzeilen und
      // Desktop-Icons — der Verweis verhaelt sich wie die Notiz selbst.
      if (noteTip) {
        a.addEventListener("mouseenter", function () { noteTip(a, ziel.owner, ziel.rel); });
        a.addEventListener("mouseleave", function () { config.hideNoteTip(); });
      }
      a.addEventListener("click", function () { openNote(ziel.owner, ziel.rel, label); });
      a.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openNote(ziel.owner, ziel.rel, label);
        }
      });
    } else if (istBild(name)) {
      // Bilder oeffnen ihren Vorschau-Dialog — mit denselben Haken wie in der
      // Dateiliste, gebunden vom vorhandenen Handler (siehe files/image-view.js)
      a.removeAttribute("href");
      if (!openNote) return;
      a.classList.add("image-open");
      a.dataset.src = baseUrl + "/image/" + pfad;
      a.dataset.download = baseUrl + "/download/" + pfad;
      a.dataset.label = label;
      hatBild = true;
    } else {
      // Alles andere ist eine echte Seite (OnlyOffice) — ein normaler Link,
      // damit Mittelklick und "in neuem Tab" wie ueberall funktionieren.
      a.href = baseUrl + "/edit/" + pfad;
    }

    // Dokumente und Bilder haben keine Inhaltsvorschau — sie zeigen beim
    // Hinfahren ihre Kurzinfo (Groesse, Aenderung, Freigabe-Lage).
    if (datei) {
      a.addEventListener("mouseenter", function () { datei.zeige(a, ziel.owner, ziel.rel); });
      a.addEventListener("mouseleave", function () { datei.verstecke(); });
    }
  });

  // Eingebettete Bilder: ![Titel](relay/…). Markdown unterscheidet Verweis und
  // Einbettung selbst — mit dem Ausrufezeichen. Hier bekommt die Quelle ihre
  // echte Adresse; ausgeliefert wird ueber /image, das an Anmeldung und
  // Freigabe haengt (routes/images.js). Ein eingebettetes Bild zeigt also
  // nichts, was der Betrachter nicht ohnehin sehen darf.
  Array.prototype.forEach.call(root.querySelectorAll("img[src]"), function (img) {
    var ziel = zielVon(img.getAttribute("src"));
    if (!ziel) return;
    var name = ziel.rel.split("/").pop();
    if (!istBild(name)) {
      // Ein Ausrufezeichen vor einer Nicht-Bilddatei ist ein Vertipper. Statt
      // eines kaputten Bildsymbols (und einer 404-Anfrage) bleibt der Titel
      // stehen — die Quelle kommt weg, der alt-Text wird sichtbar.
      img.removeAttribute("src");
      return;
    }
    var pfad = encPfad(ziel.owner, ziel.rel);
    img.src = baseUrl + "/image/" + pfad;
    img.classList.add("doc-img");
    if (!openNote) return;
    // Klick vergroessert — derselbe Vorschau-Dialog wie in der Dateiliste
    img.classList.add("image-open");
    img.dataset.src = baseUrl + "/image/" + pfad;
    img.dataset.download = baseUrl + "/download/" + pfad;
    img.dataset.label = img.alt || name;
    hatBild = true;
  });

  if (hatBild) bindImageOpen(root);
}
