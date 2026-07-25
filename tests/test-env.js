// Gemeinsame Umgebung von Setup, Teardown und Playwright-Konfiguration.
//
// RELAY_TEST_BASE_URL: gegen eine bereits laufende Instanz testen (Debugging) --
//   dann startet die Suite selbst keinen Container.
// RELAY_TEST_PORT:     Host-Port des Wegwerf-Containers (Default 5998; bewusst
//   neben 5001 der Dev-Instanz, damit beide parallel laufen koennen).
// RELAY_TEST_CHROMIUM: Pfad zu einem vorhandenen Chromium. Ohne diese Variable
//   nimmt Playwright seinen eigenen Browser (so laeuft es in der CI).
const PORT = process.env.RELAY_TEST_PORT || "5998";
const EXTERNAL = !!process.env.RELAY_TEST_BASE_URL;

module.exports = {
  CONTAINER: "relay-e2e",
  IMAGE: "relay-e2e",
  PORT,
  EXTERNAL,
  BASE_URL: process.env.RELAY_TEST_BASE_URL || `http://localhost:${PORT}`,
  CHROMIUM: process.env.RELAY_TEST_CHROMIUM || undefined,
};
