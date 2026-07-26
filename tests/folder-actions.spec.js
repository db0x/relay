// Ordner-Aktionen wirken auf den GERADE angezeigten Ordner.
//
// Regression: Hochladen, "Neuer Ordner" und "Neue Datei" schicken den
// Zielordner als verstecktes dir-Feld mit. Nach einem AJAX-Ordnerwechsel
// (folder-nav.js tauscht nur #page aus) zeigten diese Felder weiter auf den
// Ordner vom Seitenaufbau — alles landete in der Wurzel statt im geoeffneten
// Unterordner. Die Knoepfe sitzen jetzt im Fensterkopf (werden also
// mitgetauscht), die Dialoge ausserhalb werden per syncDirFields nachgezogen.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, waitAppReady, fileRow,
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
    await page.locator('[data-create="docx"]').click();
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
});
