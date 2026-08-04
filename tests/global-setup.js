// Startet einen Wegwerf-Backend-Container fuer die Testsuite.
//
// Bewusst OHNE Volumes: die SQLite liegt nur im Container-Dateisystem, jeder
// Lauf startet also mit leerer Datenbank -- und users.js legt dann den
// Bootstrap-Admin an, ueber den die Tests ihre eigenen Nutzer erzeugen. Sein
// Passwort kommt hier per ADMIN_PASSWORD (sonst waere es zufaellig, siehe
// unten). Nach dem Lauf ist alles wieder weg (global-teardown.js).
//
// Getestet wird exakt das Image, das auch deployt wird (backend/Dockerfile);
// der DocumentServer wird NICHT gebraucht, weil die Suite nur die von uns
// gebauten Bereiche abdeckt (Anmelden, Nutzerverwaltung, Freigaben).
const { execFileSync } = require("child_process");
const path = require("path");

const { CONTAINER, IMAGE, PORT, BASE_URL, EXTERNAL } = require("./test-env");

const REPO_ROOT = path.join(__dirname, "..");

function docker(args, opts = {}) {
  return execFileSync("docker", args, { stdio: "pipe", encoding: "utf8", ...opts });
}

// Wartet, bis die Login-Seite antwortet. Der erste Start dauert etwas laenger,
// weil app.js die Datenbank anlegt und den Bootstrap-Admin schreibt (bcrypt).
async function waitForApp(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/login`);
      if (res.ok) return;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Backend unter ${BASE_URL} nicht erreichbar: ${lastErr}`);
}

module.exports = async () => {
  if (EXTERNAL) {
    // RELAY_TEST_BASE_URL gesetzt -> gegen eine bereits laufende Instanz testen
    // (z.B. zum Debuggen). Dann kuemmert sich die Suite nicht um Docker.
    console.log(`[e2e] nutze laufende Instanz unter ${BASE_URL}`);
    await waitForApp();
    return;
  }

  console.log("[e2e] baue Backend-Image …");
  docker(["build", "-t", IMAGE, path.join(REPO_ROOT, "backend")], { stdio: "inherit" });

  // Reste eines abgebrochenen Laufs wegraeumen (rm -f meckert nicht, wenn nichts da ist)
  try { docker(["rm", "-f", CONTAINER]); } catch (e) { /* war nicht da */ }

  console.log(`[e2e] starte Container ${CONTAINER} auf Port ${PORT} …`);
  docker([
    "run", "-d", "--name", CONTAINER,
    "-p", `${PORT}:5000`,
    // Dummy-Secrets: die Suite testet weder JWT-Signaturen noch signierte
    // Datei-Links -- beides gehoert zur OnlyOffice-Anbindung.
    "-e", "SERVER_HOST=localhost",
    "-e", "JWT_SECRET=e2e-dummy-secret-e2e-dummy-secret",
    "-e", "FILE_SECRET=e2e-dummy-secret-e2e-dummy-secret",
    "-e", "SESSION_SECRET=e2e-dummy-secret-e2e-dummy-secret",
    "-e", `HOST_INTERNAL=${BASE_URL}`,
    "-e", "DS_INTERNAL=http://documentserver",
    // Der Bootstrap-Admin bekommt sonst ein ZUFALLSPASSWORT (steht im Log) und
    // muss es beim ersten Anmelden aendern -- richtig so fuer echte
    // Installationen, aber die Suite braucht einen festen Zugang.
    "-e", "ADMIN_PASSWORD=admin",
    // Wie in einer echten Installation hinter nginx: nur damit gelten
    // X-Forwarded-Proto (Secure-Marke am Cookie) und X-Forwarded-For
    // (Absender-Adresse fuer die Anmeldebremse) -- security.spec.js prueft beides.
    "-e", "TRUST_PROXY=1",
    IMAGE,
  ]);

  try {
    await waitForApp();
  } catch (e) {
    // Ohne Container-Log ist ein Startfehler in CI kaum zu deuten
    let log = "";
    try { log = docker(["logs", CONTAINER]); } catch (_) { /* egal */ }
    throw new Error(`${e.message}\n--- docker logs ${CONTAINER} ---\n${log}`);
  }
  console.log(`[e2e] Backend bereit unter ${BASE_URL}`);
};
