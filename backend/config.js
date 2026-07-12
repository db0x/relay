// Konfiguration: Umgebungsvariablen (docker-compose reicht die .env durch)
// und feste Konstanten, die mehrere Module brauchen.

// Pfad-Praefix, wenn Relay hinter einem Reverse Proxy unter einem Unterpfad
// laeuft (z.B. BASE_PATH=/relay fuer http://moria/relay). Leer = an der Wurzel.
// Normalisiert: fuehrender Slash ja, abschliessender nein.
let base = process.env.BASE_PATH || "";
if (base && !base.startsWith("/")) base = "/" + base;
base = base.replace(/\/+$/, "");

module.exports = {
  BASE: base,
  DOCS: "/data/documents",                        // Wurzel der Nutzer-Dateien
  // browserseitig (api.js, Editor, Cache): explizit gesetzt (z.B. http://moria/ds
  // hinter nginx) oder aus SERVER_HOST:DS_PORT gebaut
  PUBLIC_DS: process.env.PUBLIC_DS_URL
    || `http://${process.env.SERVER_HOST}:${process.env.DS_PORT || 5000}`,
  HOST_INTERNAL: process.env.HOST_INTERNAL,       // DocumentServer -> uns
  DS_INTERNAL: process.env.DS_INTERNAL,           // uns -> DocumentServer (Cache)
  JWT_SECRET: process.env.JWT_SECRET,             // OnlyOffice-Config/Callback signieren
  FILE_SECRET: process.env.FILE_SECRET,           // signierte /files-Links
  SESSION_SECRET: process.env.SESSION_SECRET,     // signiert Login-Session-Cookies
  APP_NAME: process.env.INSTANCE_NAME || "Relay", // Anzeigename der Instanz in der UI

  // Dateiendung -> OnlyOffice-Dokumenttyp
  DOCTYPE: {
    docx: "word", doc: "word", odt: "word", rtf: "word", txt: "word",
    xlsx: "cell", xls: "cell", ods: "cell", csv: "cell",
    pptx: "slide", ppt: "slide", odp: "slide",
  },

  // leere Vorlagen (im Image mitgeliefert) fuer "Neue Datei"
  BLANKS: {
    docx: "/app/blank/blank.docx",
    xlsx: "/app/blank/blank.xlsx",
    pptx: "/app/blank/blank.pptx",
  },
};
