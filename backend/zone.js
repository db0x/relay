// Kommt diese Anfrage aus dem Heimnetz oder aus dem Internet?
//
// Gebraucht wird das fuer eine einzige Regel: Admin-Zugaenge sprechen nur aus
// dem LAN mit Relay (ADMIN_LAN_ONLY). Verwaltungsrechte sind damit aus dem
// Internet nicht angreifbar — nicht schwerer angreifbar, sondern gar nicht.
//
// Die Zone wird NICHT ueber IP-Bereiche bestimmt, wenn ein Reverse Proxy davor
// steht. Zwei Gruende, beide praktisch:
//   - IPv6: das Praefix vom Provider ist oeffentlich und wechselt. Das eigene
//     Handy im eigenen WLAN saehe damit aus wie das Internet.
//   - Hairpin-NAT: ruft man von zuhause die oeffentliche Domain auf, schreiben
//     manche Router die Absenderadresse um — man saesse im Wohnzimmer und
//     zaehlte als Fremder.
// Stattdessen entscheidet die EINGANGSTUER: der nginx setzt je Server-Block
// `X-Relay-Zone: lan` bzw. `wan`. Der oeffentliche Block MUSS `wan` aktiv
// setzen (nicht weglassen), sonst koennte ein Aufrufer die Kopfzeile selbst
// mitschicken.
//
// Ohne Proxy (TRUST_PROXY=0) gibt es keine Kopfzeile, der man trauen koennte —
// dann zaehlt die Adresse der Gegenstelle, und die ist am Socket abgelesen und
// damit nicht faelschbar. Erlaubt sind die ueblichen privaten Bereiche.
const { TRUST_PROXY, ADMIN_LAN_ONLY } = require("./config");

// RFC1918 + Loopback + Link-Local (169.254/16 fuer Netze ohne DHCP)
const V4_NETZE = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["169.254.0.0", 16],
  ["127.0.0.0", 8],
];

function v4AlsZahl(ip) {
  const teile = ip.split(".");
  if (teile.length !== 4) return null;
  let n = 0;
  for (const t of teile) {
    const z = Number(t);
    if (!Number.isInteger(z) || z < 0 || z > 255) return null;
    n = n * 256 + z;
  }
  return n;
}

function istPrivatV4(ip) {
  const n = v4AlsZahl(ip);
  if (n === null) return false;
  return V4_NETZE.some(([netz, bits]) => {
    const maske = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (n & maske) >>> 0 === (v4AlsZahl(netz) & maske) >>> 0;
  });
}

// true fuer Adressen, die nur im eigenen Netz vorkommen koennen
function istPrivateAdresse(ip) {
  if (!ip) return false;
  let s = String(ip);
  // IPv4-mapped IPv6 ("::ffff:192.168.1.5") — so liefert Node es oft
  if (s.toLowerCase().startsWith("::ffff:")) s = s.slice(7);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return istPrivatV4(s);
  s = s.toLowerCase();
  if (s === "::1") return true;              // Loopback
  if (/^f[cd]/.test(s)) return true;         // fc00::/7  Unique Local
  if (/^fe[89ab]/.test(s)) return true;      // fe80::/10 Link Local
  return false;
}

// "lan" | "wan"
function zoneVon(req) {
  if (TRUST_PROXY > 0) {
    // Fehlt die Kopfzeile, gilt bewusst "wan": eine Regel, die bei
    // unvollstaendiger Konfiguration stillschweigend durchlaesst, ist keine.
    return String(req.get("X-Relay-Zone") || "").trim().toLowerCase() === "lan"
      ? "lan" : "wan";
  }
  return istPrivateAdresse(req.ip) ? "lan" : "wan";
}

function istLan(req) {
  return zoneVon(req) === "lan";
}

// Darf dieser Nutzer von hier aus arbeiten? Betrifft ausschliesslich Admins —
// alle anderen sind von der Zone unberuehrt und kommen von ueberall herein.
// Wird an VIER Stellen geprueft, nicht an einer: beim Anmelden, bei jeder
// weiteren Anfrage (sonst arbeitet eine im LAN begonnene Sitzung unterwegs
// weiter), in der Datei-API und in den Admin-Routen selbst.
function darfVonHier(req, row) {
  if (!ADMIN_LAN_ONLY) return true;
  if (!row || !row.is_admin) return true;
  return istLan(req);
}

module.exports = { zoneVon, istLan, istPrivateAdresse, darfVonHier };
