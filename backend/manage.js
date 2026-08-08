// Nutzerverwaltung — im laufenden Container ausfuehren:
//   docker compose exec backend node manage.js add thomas "Thomas"
//   docker compose exec backend node manage.js list
//   docker compose exec backend node manage.js passwd thomas
//   docker compose exec backend node manage.js token thomas
//   docker compose exec backend node manage.js del thomas
const readline = require("readline");
const users = require("./users");

const USAGE = `Nutzerverwaltung:
  node manage.js add <name> "<Anzeigename>"
  node manage.js list
  node manage.js passwd <name>
  node manage.js 2fa <name> off      # zweite Stufe abschalten (Notausgang)
  node manage.js token <name>       # erzeugt ein NEUES Token und zeigt es einmalig
  node manage.js admin <name> on|off
  node manage.js lock <name> on|off
  node manage.js del <name>`;

// Passwort ohne Echo einlesen (verstecktes Terminal-Eingabefeld)
function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (ch) => {
      const s = ch.toString("utf8");
      if (s === "\n" || s === "\r" || s === "\r\n" || s === "") return;
      rl.output.write("\x1b[2K\x1b[200D" + prompt + "*".repeat(rl.line.length));
    };
    rl.output.write(prompt);
    process.stdin.on("data", onData);
    rl.question("", (answer) => {
      process.stdin.removeListener("data", onData);
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

async function askPassword() {
  const pw = await askHidden("Passwort: ");
  if (pw !== await askHidden("Passwort (wiederholen): ")) fail("Passwoerter stimmen nicht ueberein.");
  if (pw.length < 6) fail("Mindestens 6 Zeichen.");
  return pw;
}

function fail(msg) { console.error(msg); process.exit(1); }

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "add" && args.length === 2) {
      await users.addUser(args[0], args[1], await askPassword());
      console.log(`Nutzer '${args[0]}' angelegt.`);
    } else if (cmd === "passwd" && args.length === 1) {
      await users.setPassword(args[0], await askPassword());
      console.log("Passwort geaendert.");
    } else if (cmd === "token" && args.length === 1) {
      // Anzeigen geht nicht mehr — in der DB steht nur die Pruefsumme.
      // Der Befehl erzeugt daher ein NEUES Token und gibt es einmalig aus.
      const wer = users.get(args[0]);
      if (!wer) fail("Unbekannter Nutzer.");
      if (wer.is_admin) fail("Verwaltungszugaenge haben kein API-Token.");
      console.log(users.resetToken(args[0]));
      console.error("(neu erzeugt — das vorherige Token gilt nicht mehr)");
    } else if (cmd === "admin" && args.length === 2 && ["on", "off"].includes(args[1])) {
      users.setAdmin(args[0], args[1] === "on");
      console.log(`'${args[0]}' ist jetzt ${args[1] === "on" ? "Admin" : "kein Admin mehr"}.`);
    } else if (cmd === "lock" && args.length === 2 && ["on", "off"].includes(args[1])) {
      users.setLocked(args[0], args[1] === "on");
      console.log(`'${args[0]}' ist jetzt ${args[1] === "on" ? "gesperrt" : "entsperrt"}.`);
    } else if (cmd === "del" && args.length === 1) {
      users.del(args[0]);
      console.log(`Nutzer '${args[0]}' geloescht.`);
    } else if (cmd === "2fa" && args.length === 2 && args[1] === "off") {
      // Notausgang: Handy weg UND Wiederherstellungscodes weg. Wer hier
      // herankommt, hat ohnehin Zugriff auf den Server.
      require("./twofactor").schalteAb(args[0]);
      console.log(`Zweite Stufe fuer '${args[0]}' abgeschaltet — beim naechsten Anmelden neu einrichten.`);
    } else if (cmd === "list") {
      for (const row of users.listUsers())
        console.log(`${row.username}\t${row.display_name}`
          + `${row.is_admin ? "\t[admin]" : ""}${row.locked ? "\t[gesperrt]" : ""}`);
    } else {
      fail(USAGE);
    }
  } catch (e) {
    fail(e.message);
  }
  process.exit(0);
}

main();
