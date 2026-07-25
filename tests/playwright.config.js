// Playwright-Konfiguration der Relay-E2E-Suite.
//
// Getestet wird ausschliesslich die Schicht, die WIR um OnlyOffice herum
// gebaut haben: Anmelden, Nutzerverwaltung, Freigaben. Der Editor selbst
// (OnlyOffice-DocumentServer) ist bewusst nicht Teil der Tests -- deshalb
// braucht die Suite auch nur den Backend-Container.
const { defineConfig, devices } = require("@playwright/test");

const { BASE_URL, CHROMIUM } = require("./test-env");

module.exports = defineConfig({
  testDir: ".",
  globalSetup: require.resolve("./global-setup.js"),
  globalTeardown: require.resolve("./global-teardown.js"),

  // Alle Tests teilen sich eine Datenbank im Wegwerf-Container -> seriell.
  // Zusaetzlich benennt jeder Test seine Nutzer/Dateien eindeutig (uniqueName
  // in helpers/relay.js), damit sie sich auch sonst nicht ins Gehege kommen.
  workers: 1,
  fullyParallel: false,

  // In der CI kein stiller Rerun bei rot: ein Test, der nur manchmal gruen ist,
  // soll auffallen. Lokal ebenfalls 0 -- die Suite ist schnell genug.
  retries: 0,
  timeout: 30000,
  expect: { timeout: 7000 },
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],

  use: {
    baseURL: BASE_URL,
    locale: "de-DE",
    // Spur/Screenshot nur bei Fehlern -- macht CI-Fehler nachvollziehbar,
    // ohne jeden gruenen Lauf mit Artefakten zuzumuellen.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // RELAY_TEST_CHROMIUM erlaubt ein vorhandenes System-Chromium
        // (spart lokal den Browser-Download); ohne die Variable nimmt
        // Playwright seinen eigenen -- so laeuft es in der CI.
        launchOptions: CHROMIUM ? { executablePath: CHROMIUM } : {},
      },
    },
  ],
});
