// Nutzerverwaltung (nur Admins): anlegen, Rechte, sperren, loeschen.
//
// Besonders wichtig sind die Schutzregeln aus routes/admin.js, die verhindern,
// dass man sich selbst aussperrt oder einen Admin versehentlich wegputzt.
// Die Oberflaeche blendet die entsprechenden Knoepfe aus -- getestet wird
// zusaetzlich, dass der SERVER es ebenfalls ablehnt (postForm).
const { test, expect } = require("@playwright/test");
const {
  ADMIN, login, loginAsAdmin, logout, createUser, uniqueName,
  openMenuDialog, expectFlash, postForm,
} = require("./helpers/relay");

// Zeile der Nutzertabelle zu einem Nutzernamen.
// Bewusst ueber den EXAKTEN Nutzernamen (die .muted-Spalte) statt hasText:
// "admin" steckt sonst auch im Badge "Admin" jeder anderen Zeile.
function userRow(page, username) {
  return page.locator("#dlg-users .users-table tbody tr")
    .filter({ has: page.locator(".user-names .muted", { hasText: new RegExp(`^${username}$`) }) });
}

test.describe("Nutzer anlegen", () => {
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test("neuer Nutzer erscheint in der Tabelle und kann sich anmelden", async ({ page }) => {
    const user = await createUser(page);
    await expectFlash(page, "angelegt");

    await openMenuDialog(page, "dlg-users");
    await expect(userRow(page, user.username)).toContainText(user.display);

    await logout(page);
    await login(page, user.username, user.password);
    await expect(page.locator("table.files")).toBeVisible();
  });

  test("Nutzer mit Admin-Haken bekommt die Verwaltung zu sehen", async ({ page }) => {
    const user = await createUser(page, { admin: true });
    await logout(page);
    await login(page, user.username, user.password);
    await page.click("#main-menu-btn");
    await expect(page.locator('[data-dialog="dlg-users"]')).toBeVisible();
  });

  test("doppelter Nutzername wird abgelehnt", async ({ page }) => {
    const user = await createUser(page);
    await createUser(page, { username: user.username });
    await expectFlash(page, "existiert schon");
  });

  test("ungueltiger Nutzername wird abgelehnt", async ({ page }) => {
    // Der Name wird zum Ordnernamen unter documents/ -> gleiche Regeln wie
    // Dateinamen. "../" darf niemals durchkommen.
    await postForm(page, "/users/create", {
      username: "../boeser_name", display: "Boese", password: "geheim123",
    });
    await page.goto("/");
    await expectFlash(page, "Ungültiger Nutzername");
  });

  test("zu kurzes Startpasswort wird auch serverseitig abgelehnt", async ({ page }) => {
    const name = uniqueName("kurz");
    await postForm(page, "/users/create", {
      username: name, display: "Kurz", password: "1234",
    });
    await page.goto("/");
    await expectFlash(page, "mindestens 8 Zeichen");

    // wirklich nicht angelegt
    await logout(page);
    await login(page, name, "1234");
    await expect(page.locator(".err")).toBeVisible();
  });
});

test.describe("Admin-Rechte", () => {
  test("Rechte geben und wieder entziehen", async ({ page }) => {
    await loginAsAdmin(page);
    const user = await createUser(page);

    await openMenuDialog(page, "dlg-users");
    await Promise.all([
      page.waitForNavigation(),
      userRow(page, user.username).locator('form[action*="/users/admin"] button').click(),
    ]);
    await expectFlash(page, "ist jetzt Admin");
    await openMenuDialog(page, "dlg-users");
    await expect(userRow(page, user.username)).toContainText("Admin");

    // Entziehen laeuft ueber die Rueckfrage
    await userRow(page, user.username).locator('form[action*="/users/admin"] button').click();
    await expect(page.locator("#dlg-confirm")).toBeVisible();
    await Promise.all([page.waitForNavigation(), page.click("#dlg-confirm-ok")]);
    await expectFlash(page, "ist kein Admin mehr");
  });

  test("die eigenen Admin-Rechte kann man sich nicht entziehen", async ({ page }) => {
    await loginAsAdmin(page);
    // In der Oberflaeche gibt es den Knopf fuer die eigene Zeile gar nicht …
    await openMenuDialog(page, "dlg-users");
    await expect(userRow(page, ADMIN.username).locator("form")).toHaveCount(0);

    // … und der Server lehnt es ebenfalls ab.
    await postForm(page, "/users/admin", { target: ADMIN.username, value: "0" });
    await page.goto("/");
    await expectFlash(page, "kann man sich nicht selbst entziehen");
    await page.click("#main-menu-btn");
    await expect(page.locator('[data-dialog="dlg-users"]')).toBeVisible();
  });

  test("ein Nicht-Admin kommt weder an das Menue noch an die Route", async ({ page }) => {
    await loginAsAdmin(page);
    const user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);

    await page.click("#main-menu-btn");
    await expect(page.locator('[data-dialog="dlg-users"]')).toHaveCount(0);

    const name = uniqueName("geschmuggelt");
    const res = await postForm(page, "/users/create", {
      username: name, display: "Geschmuggelt", password: "geheim123",
    });
    expect(res.status()).toBe(302); // Redirect statt Anlegen
    await page.goto("/");
    await expectFlash(page, "Admin-Rechte");

    // der Nutzer darf wirklich nicht existieren
    await logout(page);
    await login(page, name, "geheim123");
    await expect(page.locator(".err")).toBeVisible();
  });
});

test.describe("Sperren", () => {
  test("gesperrter Nutzer kommt nicht mehr hinein, entsperrt wieder", async ({ page }) => {
    await loginAsAdmin(page);
    const user = await createUser(page);

    await openMenuDialog(page, "dlg-users");
    await userRow(page, user.username).locator('form[action*="/users/lock"] button').click();
    await expect(page.locator("#dlg-confirm")).toBeVisible();
    await Promise.all([page.waitForNavigation(), page.click("#dlg-confirm-ok")]);
    await expectFlash(page, "ist gesperrt");

    await logout(page);
    await login(page, user.username, user.password);
    await expect(page.locator(".err")).toContainText("Zugang ist gesperrt");

    // wieder entsperren (kein data-confirm beim Entsperren)
    await loginAsAdmin(page);
    await openMenuDialog(page, "dlg-users");
    await Promise.all([
      page.waitForNavigation(),
      userRow(page, user.username).locator('form[action*="/users/lock"] button').click(),
    ]);
    await expectFlash(page, "wieder entsperrt");

    await logout(page);
    await login(page, user.username, user.password);
    await expect(page.locator("table.files")).toBeVisible();
  });

  test("Admins koennen nicht gesperrt werden, man selbst auch nicht", async ({ page }) => {
    await loginAsAdmin(page);
    const other = await createUser(page, { admin: true });

    await postForm(page, "/users/lock", { target: other.username, value: "1" });
    await page.goto("/");
    await expectFlash(page, "erst die Admin-Rechte entziehen");

    await postForm(page, "/users/lock", { target: ADMIN.username, value: "1" });
    await page.goto("/");
    await expectFlash(page, "nicht selbst sperren");

    // beide kommen weiterhin hinein
    await logout(page);
    await login(page, other.username, other.password);
    await expect(page.locator("table.files")).toBeVisible();
  });
});

test.describe("Loeschen", () => {
  test("normaler Nutzer wird mitsamt Zugang entfernt", async ({ page }) => {
    await loginAsAdmin(page);
    const user = await createUser(page);

    await openMenuDialog(page, "dlg-users");
    await userRow(page, user.username).locator('form[action*="/users/delete"] button').click();
    await expect(page.locator("#dlg-confirm")).toBeVisible();
    await Promise.all([page.waitForNavigation(), page.click("#dlg-confirm-ok")]);
    await expectFlash(page, "gelöscht");

    await openMenuDialog(page, "dlg-users");
    await expect(userRow(page, user.username)).toHaveCount(0);

    await logout(page);
    await login(page, user.username, user.password);
    await expect(page.locator(".err")).toBeVisible();
  });

  test("Admins und man selbst sind vor dem Loeschen geschuetzt", async ({ page }) => {
    await loginAsAdmin(page);
    const other = await createUser(page, { admin: true });

    await postForm(page, "/users/delete", { target: other.username });
    await page.goto("/");
    await expectFlash(page, "erst die Admin-Rechte entziehen");

    await postForm(page, "/users/delete", { target: ADMIN.username });
    await page.goto("/");
    await expectFlash(page, "nicht selbst löschen");

    // beide gibt es noch
    await logout(page);
    await login(page, other.username, other.password);
    await expect(page.locator("table.files")).toBeVisible();
  });
});

test.describe("Passwort eines Nutzers setzen", () => {
  // Nur mit der zweiten Stufe des Admins — die hat er in DIESEM Container
  // nicht (ADMIN_2FA laeuft im eigenen Container, siehe security.spec.js).
  // Geprueft wird hier also die Absage, und dass sie wirklich nichts aendert.
  test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

  test("der Knopf steht bei normalen Nutzern, nicht bei Admins", async ({ page }) => {
    const u = await createUser(page);
    const a = await createUser(page, { admin: true });
    await openMenuDialog(page, "dlg-users");
    await expect(userRow(page, u.username)
      .locator('button[data-dialog^="dlg-pw-"]')).toHaveCount(1);
    await expect(userRow(page, a.username)
      .locator('button[data-dialog^="dlg-pw-"]')).toHaveCount(0);
    // und beim Admin selbst auch nicht
    await expect(userRow(page, ADMIN.username)
      .locator('button[data-dialog^="dlg-pw-"]')).toHaveCount(0);
  });

  test("ohne zweite Stufe lehnt der Server ab — und aendert nichts",
    async ({ page, browser }) => {
      const u = await createUser(page);
      await postForm(page, "/users/password", {
        target: u.username, pw1: "ganz-neues-passwort", pw2: "ganz-neues-passwort",
        code: "123456",
      });
      await page.goto("/");
      await expectFlash(page, "zweite Stufe");

      // Das alte Passwort gilt weiter, das versuchte neue nicht.
      const ctx = await browser.newContext();
      const p = await ctx.newPage();
      await login(p, u.username, u.password);
      await expect(p.locator(".uname")).toBeVisible();
      await ctx.close();
    });

  test("ein normaler Nutzer kommt an die Route gar nicht heran", async ({ page, browser }) => {
    const opfer = await createUser(page);
    const taeter = await createUser(page);
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, taeter.username, taeter.password);
    await postForm(p, "/users/password", {
      target: opfer.username, pw1: "fremdes-passwort", pw2: "fremdes-passwort", code: "123456",
    });
    // Zugang des Opfers unveraendert
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    await login(p2, opfer.username, opfer.password);
    await expect(p2.locator(".uname")).toBeVisible();
    await ctx.close(); await ctx2.close();
  });
});
