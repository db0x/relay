// Konfiguration: Umgebungsvariablen (docker-compose reicht die .env durch)
// und feste Konstanten, die mehrere Module brauchen.

// Pfad-Praefix, wenn Relay hinter einem Reverse Proxy unter einem Unterpfad
// laeuft (z.B. BASE_PATH=/relay fuer http://moria/relay). Leer = an der Wurzel.
// Normalisiert: fuehrender Slash ja, abschliessender nein.
let base = process.env.BASE_PATH || "";
if (base && !base.startsWith("/")) base = "/" + base;
base = base.replace(/\/+$/, "");

// harte Datei-Obergrenze (MB): gilt fuer die Datei-API und wird beim
// DS-Start als maxDownloadBytes gesetzt; MAX_UPLOAD_MB wird daran gekappt
const maxFileMb = Math.max(1, parseInt(process.env.MAX_FILE_MB, 10) || 512);

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
  // harte Obergrenze fuer Dateien insgesamt (Datei-API-Upload; der
  // DocumentServer bekommt denselben Wert als maxDownloadBytes — relay-entry.sh)
  MAX_FILE_MB: maxFileMb,
  // maximale Groesse fuer Browser-Uploads in MB (Client prueft VOR dem Upload,
  // der Server setzt es durch); nie groesser als die harte Obergrenze
  MAX_UPLOAD_MB: Math.min(Math.max(1, parseInt(process.env.MAX_UPLOAD_MB, 10) || 128), maxFileMb),
  VERSION: require("./package.json").version,     // Relay-Version, in der UI sichtbar
  // Editor-Theme, das jeder Editor-Start bekommt (uiTheme in der Config;
  // edit.js setzt zusaetzlich die im Browser gespeicherte Wahl hart darauf).
  // "theme-white" = "Modern Hell" in der Editor-Oberflaeche.
  EDITOR_THEME: process.env.EDITOR_THEME || "theme-white",

  // Dateiendung -> OnlyOffice-Dokumenttyp
  DOCTYPE: {
    docx: "word", doc: "word", odt: "word", rtf: "word", txt: "word",
    xlsx: "cell", xls: "cell", ods: "cell", csv: "cell",
    pptx: "slide", ppt: "slide", odp: "slide",
    pdf: "pdf", // Ansicht im OnlyOffice-PDF-Viewer; Upload ja, Erstellen nein
  },

  // leere Vorlagen (im Image mitgeliefert) fuer "Neue Datei"
  BLANKS: {
    docx: "/app/blank/blank.docx",
    xlsx: "/app/blank/blank.xlsx",
    pptx: "/app/blank/blank.pptx",
  },
};
