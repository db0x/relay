// Bremse gegen das Durchprobieren von Passwoertern.
//
// Zwei Zaehler, weil beide fuer sich Luecken haetten:
//   - je KONTO: schuetzt einen bestimmten Zugang, egal von wie vielen Adressen
//     aus probiert wird (Botnetz).
//   - je ADRESSE: schuetzt gegen das Abklappern vieler Konten von einer Stelle
//     aus (Zugangsdaten aus Leaks).
// Gezaehlt werden nur FEHLVERSUCHE; ein erfolgreicher Login raeumt den
// Kontozaehler ab. Wer sein Passwort kennt, merkt von alledem nichts.
//
// Bewusst im Arbeitsspeicher: das Fenster ist kurz, und ein Neustart ist kein
// Angriffswerkzeug (er kostet den Angreifer mehr, als er ihm bringt). Faellt
// der Sitzungsspeicher spaeter in die Datenbank, kann das hier mitwandern.
//
// Die Bremse ersetzt kein fail2ban davor: was der nginx schon abweist, kostet
// Relay nicht einmal einen bcrypt-Durchlauf.

const FENSTER_MS = 15 * 60 * 1000; // Beobachtungszeitraum
const MAX_KONTO = 10;              // Fehlversuche je Zugang im Fenster
const MAX_ADRESSE = 30;            // Fehlversuche je Absender-Adresse im Fenster

const konten = new Map();   // username -> number[] (Zeitpunkte)
const adressen = new Map(); // ip -> number[]

function frisch(map, key) {
  const jetzt = Date.now();
  const liste = (map.get(key) || []).filter((t) => jetzt - t < FENSTER_MS);
  if (liste.length) map.set(key, liste); else map.delete(key);
  return liste;
}

// Aufraeumen: ohne das wuechse die Map mit jedem je probierten Namen.
// Laeuft bei jeder Pruefung, aber hoechstens jede Minute.
let letztesAufraeumen = 0;
function aufraeumen() {
  const jetzt = Date.now();
  if (jetzt - letztesAufraeumen < 60000) return;
  letztesAufraeumen = jetzt;
  for (const map of [konten, adressen]) {
    for (const key of [...map.keys()]) frisch(map, key);
  }
}

// Darf dieser Versuch ueberhaupt geprueft werden? Rueckgabe: null = ja,
// sonst { sekunden } bis zum naechsten erlaubten Versuch.
function pruefe(username, ip) {
  aufraeumen();
  const kandidaten = [
    [frisch(konten, username || ""), MAX_KONTO],
    [frisch(adressen, ip || ""), MAX_ADRESSE],
  ];
  let sperreBis = 0;
  for (const [liste, max] of kandidaten) {
    if (liste.length >= max) sperreBis = Math.max(sperreBis, liste[0] + FENSTER_MS);
  }
  if (!sperreBis) return null;
  return { sekunden: Math.max(1, Math.ceil((sperreBis - Date.now()) / 1000)) };
}

function fehlversuch(username, ip) {
  const jetzt = Date.now();
  for (const [map, key] of [[konten, username || ""], [adressen, ip || ""]]) {
    const liste = frisch(map, key);
    liste.push(jetzt);
    map.set(key, liste);
  }
}

function erfolg(username) {
  konten.delete(username || "");
}

// nur fuer Tests/Diagnose
function _zustand() {
  return { konten: konten.size, adressen: adressen.size };
}

module.exports = { pruefe, fehlversuch, erfolg, _zustand, FENSTER_MS, MAX_KONTO, MAX_ADRESSE };
