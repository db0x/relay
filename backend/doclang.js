// Dokumentsprache fuer neue Dateien: waehlbare Sprachen und das Umschreiben
// der Blanko-Kopie auf die gewaehlte Sprache.
//
// Die Liste entspricht den Rechtschreib-Woerterbuechern des DocumentServers
// (dictionaries/ im DS 9.4, BCP47-Schreibweise) — nur diese Sprachen kann der
// Editor auch tatsaechlich pruefen. Zuweisen liesse sich im Editor jede
// Sprache, aber ohne Woerterbuch waere die Auswahl hier Etikettenschwindel.
const DEFAULT = "de-DE";

const CODES = [
  "ar-SA", "az-Latn-AZ", "bg-BG", "ca-ES", "ca-ES-valencia", "cs-CZ", "da-DK",
  "de-AT", "de-CH", "de-DE", "el-GR", "en-AU", "en-CA", "en-GB", "en-US",
  "en-ZA", "es-ES", "eu-ES", "fr-FR", "gl-ES", "hr-HR", "hu-HU", "id-ID",
  "it-IT", "kk-KZ", "ko-KR", "lb-LU", "lt-LT", "lv-LV", "mn-MN", "nb-NO",
  "nl-NL", "nn-NO", "oc-FR", "pl-PL", "pt-BR", "pt-PT", "ro-RO", "ru-RU",
  "sk-SK", "sl-SI", "sr-Cyrl-RS", "sr-Latn-RS", "sv-SE", "tr-TR", "uk-UA",
  "uz-Cyrl-UZ", "uz-Latn-UZ", "vi-VN",
];

// deutsche Anzeigenamen ueber Intl. languageDisplay "standard" erzwingt
// durchgaengig "Sprache (Region)" — also "Deutsch (Schweiz)" statt
// "Schweizer Hochdeutsch" — damit Varianten einer Sprache beieinander
// einsortiert werden. Sonderfaelle, die Intl nicht sauber unterscheidet:
const OVERRIDES = {
  "ca-ES-valencia": "Katalanisch (Valencia)",
  "nb-NO": "Norwegisch (Bokmål, Norwegen)",   // statt "(Bokmål) (Norwegen)"
  "nn-NO": "Norwegisch (Nynorsk, Norwegen)",
};
const names = new Intl.DisplayNames(["de"], { type: "language", languageDisplay: "standard" });

// Flaggen-Emoji aus dem Regions-Subtag (de-CH -> CH -> 🇨🇭):
// Regionsbuchstaben auf die Unicode Regional Indicator Symbols abbilden
function flag(code) {
  const region = code.split("-").find((p) => /^[A-Z]{2}$/.test(p));
  if (!region) return "";
  return String.fromCodePoint(...[...region].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// Endonym: der Sprachname in der Sprache selbst ("Русский", "français").
// Basis ist der Code ohne Region/Variante (sr-Cyrl-RS -> sr-Cyrl), damit
// Schrift-Varianten unterscheidbar bleiben. Angehaengt wird es nur, wenn es
// sich vom deutschen Sprachnamen unterscheidet (bei "Deutsch" waere es doppelt).
const namesLangOnly = new Intl.DisplayNames(["de"], { type: "language" });
function endonym(code) {
  const base = code.split("-")
    .filter((p) => !/^[A-Z]{2}$/.test(p) && p !== "valencia").join("-");
  try {
    const own = new Intl.DisplayNames([base], { type: "language" }).of(base);
    return own.toLowerCase() === namesLangOnly.of(base).toLowerCase() ? "" : own;
  } catch (e) {
    return "";
  }
}

const LANGS = CODES
  .map((code) => ({ code, name: OVERRIDES[code] || names.of(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, "de"))
  .map(({ code, name }) => {
    const own = endonym(code);
    return { code, label: `${flag(code)} ${name}${own ? ` · ${own}` : ""}` };
  });

function isValid(code) {
  return CODES.includes(code);
}

// frisch kopierte Blanko-Datei auf die gewaehlte Sprache umschreiben.
// Die Vorlagen sind de-DE (siehe blank/) — dieser String wird ersetzt.
// xlsx kennt keine Dokumentsprache, dort gibt es nichts zu patchen.
function apply(path, ext, lang) {
  if (!isValid(lang) || lang === DEFAULT) return;
  const parts = {
    docx: ["word/styles.xml", "word/stylesWithEffects.xml", "word/settings.xml"],
    pptx: null, // alle XML-Teile (Master + Layouts tragen lang-Attribute)
  };
  if (!(ext in parts)) return;
  // lazy: nur der Patch-Pfad braucht adm-zip, die Sprachliste nicht
  const AdmZip = require("adm-zip");
  const zip = new AdmZip(path);
  for (const entry of zip.getEntries()) {
    if (parts[ext] ? !parts[ext].includes(entry.entryName) : !entry.entryName.endsWith(".xml")) continue;
    const xml = zip.readAsText(entry);
    const patched = ext === "docx"
      ? xml.replaceAll('w:val="de-DE"', `w:val="${lang}"`)
           .replaceAll('w:eastAsia="de-DE"', `w:eastAsia="${lang}"`)
      : xml.replaceAll('lang="de-DE"', `lang="${lang}"`);
    if (patched !== xml) zip.updateFile(entry, Buffer.from(patched, "utf-8"));
  }
  zip.writeZip(path);
}

module.exports = { LANGS, DEFAULT, isValid, apply };
