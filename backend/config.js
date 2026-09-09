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

// oeffentliche DocumentServer-URL (Browser/Editor/Cache-Links); hinter nginx
// mit Pfad-Praefix (z.B. http://moria/ds)
const publicDs = process.env.PUBLIC_DS_URL
  || `http://${process.env.SERVER_HOST}:${process.env.DS_PORT || 5000}`;
// Pfad-Praefix des DS (z.B. "/ds") — intern serviert der DS OHNE diesen Praefix
let dsPrefix = "";
try { dsPrefix = new URL(publicDs).pathname.replace(/\/+$/, ""); } catch (e) { /* leer */ }

// Eine DS-Cache-/Callback-URL (oeffentlich) in die intern erreichbare URL
// umschreiben: Host durch DS_INTERNAL ersetzen UND den oeffentlichen
// Pfad-Praefix entfernen. WICHTIG fuer den Speicher-Callback: bliebe der
// Praefix drin (z.B. /ds/cache/...), liefe der interne Abruf ins 404 — und die
// Express-Fehlerseite ("Cannot GET ...") landete frueher als Dateiinhalt
// (Datenverlust). Der Aufrufer MUSS zusaetzlich den HTTP-Status pruefen.
function dsFetchUrl(dsUrl) {
  const u = new URL(dsUrl);
  let p = u.pathname;
  if (dsPrefix && (p === dsPrefix || p.startsWith(dsPrefix + "/"))) {
    p = p.slice(dsPrefix.length) || "/";
  }
  return process.env.DS_INTERNAL + p + (u.search || "");
}

// Steht ein Reverse Proxy davor? Dann darf Express X-Forwarded-Proto/-For
// glauben — und nur dann. Ohne Proxy waeren diese Kopfzeilen frei erfunden:
// jeder Absender koennte sich eine beliebige IP andichten (und damit die
// Anmeldebremse umgehen) oder eine sichere Verbindung vortaeuschen.
// Wert: Anzahl der vertrauenswuerdigen Zwischenstationen (hinter einem nginx
// auf demselben Rechner also 1), leer/0 = keiner.
const trustProxy = Math.max(0, parseInt(process.env.TRUST_PROXY, 10) || 0);

// Admin-Zugaenge nur aus dem Heimnetz? Standard AUS — wer das einschaltet,
// ohne die Zonen im nginx zu setzen, sperrt seine Admins aus der Oberflaeche
// aus (Notausgang bleibt manage.js auf dem Server). Also: erst nginx, dann
// diesen Schalter. Wie die Zone bestimmt wird, steht in zone.js.
const adminLanOnly = /^(1|true|yes|on)$/i.test(process.env.ADMIN_LAN_ONLY || "");

// Zweite Stufe fuer Admins ERZWINGEN? Standard aus. Aus heisst nicht "geht
// nicht": Einrichten kann jeder Admin jederzeit, und wer eingerichtet hat,
// muss den Code auch immer eingeben. Der Schalter entscheidet nur, ob ein
// Admin OHNE zweite Stufe noch hereinkommt.
const admin2fa = /^(1|true|yes|on)$/i.test(process.env.ADMIN_2FA || "");

module.exports = {
  BASE: base,
  TRUST_PROXY: trustProxy,
  ADMIN_LAN_ONLY: adminLanOnly,
  ADMIN_2FA: admin2fa,
  DOCS: "/data/documents",                        // Wurzel der Nutzer-Dateien
  // Wurzel der geteilten Bibliothek. Der Host-Pfad steht in der .env
  // (SHARED_LIB) und wird von docker-compose NUR LESEND (:ro) hierher
  // eingehaengt — die Bibliothek gehoert nicht Relay, sie wird nur gezeigt.
  LIB_DIR: "/data/library",
  // derselbe Host-Pfad im Klartext, ausschliesslich fuer den Hinweis im
  // Admin-Dialog ("ist ueberhaupt eine Bibliothek konfiguriert?").
  SHARED_LIB: process.env.SHARED_LIB || "",
  STATE_DIR: process.env.STATE_DIR || "/data/state", // Nutzerdatenbank + Avatare
  BACKUP_DIR: "/data/backup",                     // Ziel fuer "Backup ausfuehren" (rsync)
  PUBLIC_DS: publicDs,
  dsFetchUrl,
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

  // Bilddateien: Endung -> MIME-Typ. Bewusst eine WHITELIST mit festen Typen —
  // ausgeliefert wird nur mit genau diesem Content-Type plus nosniff, damit
  // eine als .png getarnte HTML-Datei nicht doch als Seite ausgefuehrt wird.
  // SVG fehlt absichtlich: es ist XML und kann Skripte enthalten, die im
  // Browser unter UNSERER Herkunft liefen (siehe routes/images.js).
  IMAGE_TYPES: {
    png: "image/png",
    jpg: "image/jpeg", jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  },

  // Videodateien: Endung -> MIME-Typ. Wie IMAGE_TYPES eine WHITELIST — der
  // Content-Type kommt NIE aus der Datei selbst, und zusammen mit nosniff kann
  // eine als .mp4 getarnte HTML-Datei nicht als Seite ausgefuehrt werden.
  // Abgespielt wird mit dem eingebauten <video> des Browsers, ganz ohne
  // Bibliothek; mkv/avi sind mit aufgefuehrt, weil sie in Filmsammlungen die
  // Regel sind — ob der Browser sie kann, haengt am Codec (der Dialog faengt
  // den Fehlschlag ab und bietet stattdessen das Herunterladen an).
  VIDEO_TYPES: {
    mp4: "video/mp4", m4v: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
  },

  // leere Vorlagen (im Image mitgeliefert) fuer "Neue Datei"
  BLANKS: {
    docx: "/app/blank/blank.docx",
    xlsx: "/app/blank/blank.xlsx",
    pptx: "/app/blank/blank.pptx",
  },
};
