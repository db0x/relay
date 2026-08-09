// Groesse und Lage des Notiz-Dialogs.
//
// Beides gilt in BEIDEN Modi: der Editor und die Lese-Ansicht lassen sich an
// der Griffecke unten rechts skalieren und am Kopf verschieben. Die Groesse
// wird gemerkt — je Modus getrennt, weil die Lese-Ansicht schmaler ist.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, createUser, login, logout, uniqueName, createNote, waitAppReady,
} = require("./helpers/relay");

const dlg = (page) => page.locator("#dlg-note");

async function masse(page) {
  const b = await dlg(page).boundingBox();
  return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) };
}

// An der Griffecke ziehen. Gegriffen wird die MITTE des Griffs, nicht die
// aeusserste Ecke: der Dialog hat border-radius:14px, und die Ecke ausserhalb
// der Rundung nimmt keine Klicks an.
async function zieheEcke(page, dx, dy) {
  const g = await page.locator("#note-resize").boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2 + dx, g.y + g.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
}

async function ziehteKopf(page, dx, dy) {
  const k = await page.locator("#dlg-note .dialog-head").boundingBox();
  // nicht am rechten Rand anfassen — dort sitzt das Schliessen-Kreuz
  await page.mouse.move(k.x + 120, k.y + k.height / 2);
  await page.mouse.down();
  await page.mouse.move(k.x + 120 + dx, k.y + k.height / 2 + dy, { steps: 10 });
  await page.mouse.up();
}

test.describe("Notiz-Dialog: Groesse und Lage", () => {
  let titel;

  async function oeffneLesen(page) {
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await page.locator("table.files .note-open").filter({ hasText: titel }).click();
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page)).toHaveClass(/note-view/);
    await page.waitForTimeout(250); // Oeffnen-Animation abwarten
  }

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    const u = await createUser(page);
    await logout(page);
    await login(page, u.username, u.password);
    titel = "Lesenotiz " + uniqueName("n");
    await createNote(page, titel);
  });

  test("die Lese-Ansicht laesst sich skalieren und merkt sich das",
    async ({ page }) => {
      await oeffneLesen(page);
      const vorher = await masse(page);

      await zieheEcke(page, 200, 120);
      const nachher = await masse(page);
      expect(nachher.w).toBeGreaterThan(vorher.w + 150);
      expect(nachher.h).toBeGreaterThan(vorher.h + 90);

      // schliessen und wieder oeffnen: dieselbe Groesse
      await page.click("#dlg-note .dialog-x");
      await oeffneLesen(page);
      const wieder = await masse(page);
      expect(wieder.w).toBe(nachher.w);
      expect(wieder.h).toBe(nachher.h);
    });

  test("die Lese-Ansicht laesst sich am Kopf verschieben", async ({ page }) => {
    await oeffneLesen(page);
    const vorher = await masse(page);
    await ziehteKopf(page, -180, 90);
    const nachher = await masse(page);
    expect(nachher.x).toBe(vorher.x - 180);
    expect(nachher.y).toBe(vorher.y + 90);
    // verschieben aendert die Groesse nicht
    expect(nachher.w).toBe(vorher.w);
  });

  test("die gemerkte Groesse schrumpft nicht bei jedem Oeffnen",
    async ({ page }) => {
      // Der Dialog faehrt mit transform:scale(.97) auf. Wird die Groesse
      // waehrend dieser Animation ueber getBoundingClientRect gemessen, wandern
      // 3% Verlust in den Speicher — und der Dialog wird bei jedem Oeffnen
      // kleiner. Darum merkt note-dialog.js die LAYOUT-Masse (offsetWidth).
      await oeffneLesen(page);
      await zieheEcke(page, 200, 120);
      const soll = await masse(page);

      for (let i = 0; i < 3; i++) {
        await page.click("#dlg-note .dialog-x");
        await oeffneLesen(page);
        const ist = await masse(page);
        expect(ist.w, `Breite nach ${i + 1} Zyklen`).toBe(soll.w);
        expect(ist.h, `Hoehe nach ${i + 1} Zyklen`).toBe(soll.h);
      }
    });

  test("Lesen und Bearbeiten merken sich verschiedene Groessen",
    async ({ page }) => {
      await oeffneLesen(page);
      await zieheEcke(page, 180, 60);
      const lesen = await masse(page);

      await page.click("#note-edit");
      await expect(dlg(page)).not.toHaveClass(/note-view/);
      await page.waitForTimeout(250);
      await zieheEcke(page, -60, 140);
      const bearbeiten = await masse(page);
      expect(bearbeiten.w).not.toBe(lesen.w);

      // zurueck in die Lese-Ansicht: wieder deren eigene Groesse
      await page.click("#dlg-note .dialog-x");
      await oeffneLesen(page);
      expect((await masse(page)).w).toBe(lesen.w);
    });
});
