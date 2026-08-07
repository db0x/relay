// Zeitbasierte Einmalkennwoerter (RFC 6238) — die zweite Stufe bei der
// Anmeldung von Admins.
//
// Bewusst ohne Paket: Der Kern ist HMAC-SHA1 ueber einen 30-Sekunden-Zaehler
// plus die "dynamic truncation" aus RFC 4226. Das sind rund 30 Zeilen, die
// sich gegen die Testvektoren des Standards pruefen lassen (tests/totp.test.js)
// — weniger Aufwand als die Pflege einer Abhaengigkeit, und nachvollziehbar.
//
// Das Geheimnis wird VERSCHLUESSELT abgelegt (verschluessele/entschluessele
// hier unten). Grund: Das Backup spiegelt users.db aufs NAS, die .env aber
// nicht. Wer nur an das Backup kaeme, haette sonst alle zweiten Faktoren im
// Klartext, waehrend die Passwoerter durch bcrypt geschuetzt blieben.
const crypto = require("crypto");

const SCHRITT = 30;          // Sekunden je Zeitfenster
const STELLEN = 6;
// Wieviele Fenster Gangabweichung werden akzeptiert? 1 = +/-30s. Ohne
// Toleranz scheitern Anmeldungen an einer ungenau gehenden Handy-Uhr.
const TOLERANZ = 1;

// --- Base32 (RFC 4648, ohne Fuellzeichen — so erwarten es die Apps) ------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Kodieren(buf) {
  let bits = 0, wert = 0, out = "";
  for (const b of buf) {
    wert = (wert << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(wert << (5 - bits)) & 31];
  return out;
}

function base32Dekodieren(s) {
  let bits = 0, wert = 0;
  const out = [];
  for (const z of String(s).toUpperCase().replace(/[\s=]/g, "")) {
    const i = B32.indexOf(z);
    if (i < 0) throw new Error("kein gueltiges Base32");
    wert = (wert << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// --- Der eigentliche Algorithmus ----------------------------------------
// Zaehler als 8 Byte, big endian; HMAC-SHA1; dann die "dynamic truncation":
// die letzten 4 Bit des Hash zeigen auf die 4 Bytes, aus denen die Zahl kommt.
function codeFuerSchritt(geheimnis, schritt, stellen = STELLEN) {
  const zaehler = Buffer.alloc(8);
  zaehler.writeUInt32BE(Math.floor(schritt / 0x100000000), 0);
  zaehler.writeUInt32BE(schritt >>> 0, 4);
  const hash = crypto.createHmac("sha1", base32Dekodieren(geheimnis)).update(zaehler).digest();
  const off = hash[hash.length - 1] & 0x0f;
  const zahl = ((hash[off] & 0x7f) << 24) | (hash[off + 1] << 16)
    | (hash[off + 2] << 8) | hash[off + 3];
  return String(zahl % 10 ** stellen).padStart(stellen, "0");
}

function schrittFuer(zeitMs = Date.now()) {
  return Math.floor(zeitMs / 1000 / SCHRITT);
}

// Neues Geheimnis: 20 Byte Zufall — dieselbe Laenge, die der Standard fuer
// SHA1 empfiehlt, und die Apps kommen damit sicher zurecht.
function neuesGeheimnis() {
  return base32Kodieren(crypto.randomBytes(20));
}

// Prueft einen eingegebenen Code. Rueckgabe: der benutzte Zeitschritt (fuer
// die Wiederverwendungs-Sperre) oder null.
// letzterSchritt verhindert, dass derselbe Code im selben Fenster ein zweites
// Mal gilt — sonst liesse sich ein abgefangener Code nochmal einsetzen.
function pruefe(geheimnis, eingabe, letzterSchritt = 0, zeitMs = Date.now()) {
  const code = String(eingabe || "").replace(/\D/g, "");
  if (code.length !== STELLEN) return null;
  const jetzt = schrittFuer(zeitMs);
  for (let d = -TOLERANZ; d <= TOLERANZ; d++) {
    const s = jetzt + d;
    if (s <= letzterSchritt) continue; // schon benutzt
    const erwartet = codeFuerSchritt(geheimnis, s);
    // zeitkonstanter Vergleich; beide sind gleich lang (STELLEN Ziffern)
    if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(erwartet))) return s;
  }
  return null;
}

// Adresse fuer den QR-Code. Der Aussteller taucht in der App als Ueberschrift
// auf; label enthaelt ihn nochmal, so machen es alle gaengigen Apps.
function otpauthUrl(geheimnis, nutzer, aussteller) {
  const label = encodeURIComponent(`${aussteller}:${nutzer}`);
  const q = new URLSearchParams({
    secret: geheimnis, issuer: aussteller, algorithm: "SHA1",
    digits: String(STELLEN), period: String(SCHRITT),
  });
  return `otpauth://totp/${label}?${q}`;
}

// Geheimnis in Vierergruppen — fuer die Handeingabe, wenn die Kamera streikt
function lesbar(geheimnis) {
  return geheimnis.replace(/(.{4})/g, "$1 ").trim();
}

// --- Verschluesselung fuer die Ablage in der Datenbank -------------------
// AES-256-GCM. Format: "v1.<iv>.<tag>.<ciphertext>", alles base64url.
function schluessel() {
  const roh = process.env.TOTP_KEY || "";
  if (roh) return crypto.createHash("sha256").update(roh).digest();
  // Kein eigener Schluessel gesetzt: aus dem Sitzungsgeheimnis ableiten.
  // ACHTUNG: Wer SESSION_SECRET wechselt, macht damit alle eingerichteten
  // zweiten Faktoren ungueltig. Wer beides entkoppeln will, setzt TOTP_KEY.
  return crypto.hkdfSync("sha256", Buffer.from(process.env.SESSION_SECRET || ""),
    Buffer.alloc(0), Buffer.from("relay-totp"), 32);
}

function verschluessele(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", Buffer.from(schluessel()), iv);
  const daten = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"),
    daten.toString("base64url")].join(".");
}

function entschluessele(gespeichert) {
  const [v, iv, tag, daten] = String(gespeichert || "").split(".");
  if (v !== "v1" || !iv || !tag || !daten) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(schluessel()),
      Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(daten, "base64url")), d.final()]).toString("utf8");
  } catch (e) {
    return null; // falscher Schluessel oder veraendert
  }
}

module.exports = {
  SCHRITT, STELLEN, TOLERANZ,
  neuesGeheimnis, pruefe, codeFuerSchritt, schrittFuer, otpauthUrl, lesbar,
  base32Kodieren, base32Dekodieren, verschluessele, entschluessele,
};
