// Anmelden: der Zugang zu allem anderen. Deckt Login, Session, Logout,
// Passwortwechsel und die Sperre ab -- inklusive der Faelle, die NICHT
// funktionieren duerfen (falsches Passwort, ohne Login, Open Redirect).
const { test, expect } = require("@playwright/test");
const {
  ADMIN, login, loginAsAdmin, logout, createUser, expectFlash, openMenuDialog,
} = require("./helpers/relay");

test.describe("Anmelden", () => {
  test("ohne Login fuehrt jede geschuetzte Seite zur Anmeldung", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator("input[name=username]")).toBeVisible();
  });

  test("falsches Passwort meldet einen Fehler und laesst niemanden hinein", async ({ page }) => {
    await login(page, ADMIN.username, "falschesPasswort");
    await expect(page.locator(".err")).toContainText("Name oder Passwort falsch");
    // weiterhin ausgesperrt
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("unbekannter Nutzer bekommt dieselbe Meldung wie ein falsches Passwort", async ({ page }) => {
    // Gleiche Formulierung fuer beide Faelle: Fremde sollen nicht herausfinden,
    // welche Zugaenge ueberhaupt existieren.
    await login(page, "gibtesnicht", "irgendwas");
    await expect(page.locator(".err")).toContainText("Name oder Passwort falsch");
  });

  test("korrekter Login zeigt die Dateiliste", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("table.files")).toBeVisible();
    await expect(page.locator(".uname")).toBeVisible();
  });

  test("Bootstrap-Admin wird ans Standard-Passwort erinnert", async ({ page }) => {
    await loginAsAdmin(page);
    await expectFlash(page, "Standard-Passwort");
  });

  test("next-Parameter fuehrt nach dem Login auf das gewuenschte Ziel", async ({ page }) => {
    await page.goto("/?p=");
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.fill("input[name=username]", ADMIN.username);
    await page.fill("input[name=password]", ADMIN.password);
    await Promise.all([page.waitForNavigation(), page.click("form button")]);
    await expect(page.locator("table.files")).toBeVisible();
  });

  test("Open-Redirect: next auf eine fremde Domain wird ignoriert", async ({ page }) => {
    // routes/auth.js laesst nur interne Pfade zu -- "//host" waere ein
    // protokollrelativer Sprung nach draussen.
    await page.goto("/login?next=" + encodeURIComponent("//example.com/"));
    await page.fill("input[name=username]", ADMIN.username);
    await page.fill("input[name=password]", ADMIN.password);
    await Promise.all([page.waitForNavigation(), page.click("form button")]);
    await expect(page).toHaveURL(/localhost/);
    await expect(page.locator("table.files")).toBeVisible();
  });

  test("Logout beendet die Sitzung", async ({ page }) => {
    await loginAsAdmin(page);
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Passwort aendern", () => {
  // Eigener Nutzer statt des Bootstrap-Admins: dessen admin/admin muss fuer
  // die uebrigen Tests gueltig bleiben.
  let user;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page, { password: "startpasswort" });
    await logout(page);
  });

  async function openPasswordForm(page) {
    await openMenuDialog(page, "dlg-account");
    // Der Abschnitt ist eingeklappt (details/summary)
    await page.locator("#dlg-account details", { hasText: "Passwort ändern" }).first()
      .locator("summary").click();
  }

  test("falsches altes Passwort wird abgelehnt", async ({ page }) => {
    await login(page, user.username, user.password);
    await openPasswordForm(page);
    await page.fill("#pw-form input[name=old]", "stimmtnicht");
    await page.fill("#pw-form input[name=new1]", "neuespasswort");
    await page.fill("#pw-form input[name=new2]", "neuespasswort");
    await Promise.all([page.waitForNavigation(), page.click("#pw-form button")]);
    await expectFlash(page, "aktuelle Passwort ist falsch");
    // altes Passwort gilt weiterhin
    await logout(page);
    await login(page, user.username, user.password);
    await expect(page.locator("table.files")).toBeVisible();
  });

  test("zu kurzes neues Passwort wird abgelehnt", async ({ page }) => {
    await login(page, user.username, user.password);
    await openPasswordForm(page);
    await page.fill("#pw-form input[name=old]", user.password);
    // minlength im Formular umgehen: der Server muss das ebenfalls pruefen
    await page.locator("#pw-form").evaluate((f) => {
      f.querySelectorAll("input[type=password]").forEach((i) => i.removeAttribute("minlength"));
    });
    await page.fill("#pw-form input[name=new1]", "kurz");
    await page.fill("#pw-form input[name=new2]", "kurz");
    await Promise.all([page.waitForNavigation(), page.click("#pw-form button")]);
    await expectFlash(page, "mindestens 8 Zeichen");
  });

  test("erfolgreicher Wechsel: neues Passwort gilt, altes nicht mehr", async ({ page }) => {
    const neu = "ganzneuespasswort";
    await login(page, user.username, user.password);
    await openPasswordForm(page);
    await page.fill("#pw-form input[name=old]", user.password);
    await page.fill("#pw-form input[name=new1]", neu);
    await page.fill("#pw-form input[name=new2]", neu);
    await Promise.all([page.waitForNavigation(), page.click("#pw-form button")]);
    await expectFlash(page, "Passwort geändert");

    await logout(page);
    await login(page, user.username, user.password);
    await expect(page.locator(".err")).toContainText("Name oder Passwort falsch");

    await login(page, user.username, neu);
    await expect(page.locator("table.files")).toBeVisible();
  });
});
