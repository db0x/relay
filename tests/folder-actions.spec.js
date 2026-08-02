// Ordner-Aktionen wirken auf den GERADE angezeigten Ordner.
//
// Regression: Hochladen, "Neuer Ordner" und "Neue Datei" schicken den
// Zielordner als dir-Feld mit. Nach einem AJAX-Ordnerwechsel (folder-nav.js
// tauscht nur #page aus) zeigten diese Felder weiter auf den Ordner vom
// Seitenaufbau — alles landete in der Wurzel statt im geoeffneten
// Unterordner. Hochladen und "Neuer Ordner" sitzen im Fensterkopf (werden
// also mitgetauscht), "Neue Datei" im Anwendungs-Menue am Logo; die Dialoge
// ausserhalb von #page werden per syncDirFields nachgezogen.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, waitAppReady, fileRow, openApp,
} = require("./helpers/relay");

// Legt einen Ordner an und navigiert per AJAX hinein.
async function enterFolder(page, name) {
  await page.locator('[data-dialog="dlg-mkdir"]').click();
  await page.fill("#dlg-mkdir input[name=name]", name);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/mkdir")),
    page.click("#dlg-mkdir .dialog-submit"),
  ]);
  await waitAppReady(page);
  await page.locator(`a.fname[href*="${name}"]`).click();
  await expect(page).toHaveURL(new RegExp(name));
}

test.describe("Ordner-Aktionen im geoeffneten Unterordner", () => {
  let folder;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
    folder = "Ordner" + uniqueName("");
    await enterFolder(page, folder);
  });

  test("die Ordner-Aktionen sitzen im Fensterkopf, nicht in der Topbar", async ({ page }) => {
    await expect(page.locator(".page-head .upload-form")).toBeVisible();
    await expect(page.locator('.page-head [data-dialog="dlg-mkdir"]')).toBeVisible();
    await expect(page.locator(".toolbar .upload-form")).toHaveCount(0);
    await expect(page.locator('.toolbar [data-dialog="dlg-mkdir"]')).toHaveCount(0);
  });

  test("Hochladen legt die Datei im geoeffneten Ordner ab", async ({ page }) => {
    const filename = uniqueName("dok") + ".docx";
    await Promise.all([
      page.waitForNavigation(),
      page.locator(".upload-form input[type=file]").setInputFiles({
        name: filename, mimeType: "application/octet-stream", buffer: Buffer.from("x"),
      }),
    ]);
    await waitAppReady(page);

    // im Unterordner sichtbar …
    await page.goto(`/?p=${encodeURIComponent(folder)}`);
    await waitAppReady(page);
    await expect(fileRow(page, filename)).toBeVisible();
    // … und NICHT in der Wurzel
    await page.goto("/");
    await waitAppReady(page);
    await expect(fileRow(page, filename)).toHaveCount(0);
  });

  test("„Neuer Ordner“ legt den Unterordner im geoeffneten Ordner an", async ({ page }) => {
    const sub = "Unter" + uniqueName("");
    await page.locator('[data-dialog="dlg-mkdir"]').click();
    await page.fill("#dlg-mkdir input[name=name]", sub);
    await Promise.all([page.waitForNavigation(), page.click("#dlg-mkdir .dialog-submit")]);
    await waitAppReady(page);

    await page.goto(`/?p=${encodeURIComponent(folder)}`);
    await waitAppReady(page);
    await expect(fileRow(page, sub)).toBeVisible();
    await page.goto("/");
    await waitAppReady(page);
    await expect(fileRow(page, sub)).toHaveCount(0);
  });

  test("„Neue Datei“ legt das Dokument im geoeffneten Ordner an", async ({ page }) => {
    const name = "Doku" + uniqueName("");
    await openApp(page, '[data-create="docx"]');
    await page.fill("#dlg-create-name", name);
    // Das Anlegen leitet in den OnlyOffice-Editor weiter — der ist hier nicht
    // Teil des Tests; es zaehlt nur, WO die Datei entsteht.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/create")),
      page.click("#dlg-create .dialog-submit"),
    ]);

    await page.goto(`/?p=${encodeURIComponent(folder)}`);
    await waitAppReady(page);
    await expect(fileRow(page, name + ".docx")).toBeVisible();
    await page.goto("/");
    await waitAppReady(page);
    await expect(fileRow(page, name + ".docx")).toHaveCount(0);
  });

  test("die Ordnerauswahl im Dialog steht auf dem geoeffneten Ordner",
    async ({ page }) => {
      await openApp(page, '[data-create="docx"]');
      await expect(page.locator("#dlg-create")).toBeVisible();
      await expect(page.locator("#dlg-create-dir")).toHaveValue(folder);
    });

  test("ueber die Auswahl landet die Datei in einem ANDEREN Ordner",
    async ({ page }) => {
      // Der eigentliche Zweck der Auswahl: anlegen, ohne vorher dorthin zu
      // navigieren. Wir stehen in `folder` und zielen auf die Wurzel.
      const name = "Woanders" + uniqueName("");
      await openApp(page, '[data-create="docx"]');
      await page.fill("#dlg-create-name", name);
      await page.selectOption("#dlg-create-dir", "");
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/create")),
        page.click("#dlg-create .dialog-submit"),
      ]);

      await page.goto("/");
      await waitAppReady(page);
      await expect(fileRow(page, name + ".docx")).toBeVisible();
      await page.goto(`/?p=${encodeURIComponent(folder)}`);
      await waitAppReady(page);
      await expect(fileRow(page, name + ".docx")).toHaveCount(0);
    });

  test("in einem Unterordner steht der Dateiname ohne Pfad in der Liste",
    async ({ page }) => {
      // Regression: die Liste baute ihren Anzeigenamen aus dem RELATIVEN Pfad
      // — in einem Unterordner stand darum "Ordner/Datei.docx" statt
      // "Datei.docx". In der Wurzel fiel das nie auf (dort sind beide gleich).
      const filename = uniqueName("pfad") + ".docx";
      await Promise.all([
        page.waitForNavigation(),
        page.locator(".upload-form input[type=file]").setInputFiles({
          name: filename, mimeType: "application/octet-stream", buffer: Buffer.from("x"),
        }),
      ]);
      await waitAppReady(page);
      await page.goto(`/?p=${encodeURIComponent(folder)}`);
      await waitAppReady(page);
      await expect(page.locator("table.files .fname").first()).toHaveText(filename);
    });
});
