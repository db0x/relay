// Das Netz einer Notiz: dritter Modus der Lese-Ansicht.
//
// Gezeigt wird ein Ego-Netz mit einem Sprung — die Notiz in der Mitte, links
// wer auf sie verweist, rechts worauf sie verweist. Ein Klick macht den
// angeklickten Knoten zur neuen Mitte.
//
// Verweise stehen nur als Text in den Notizen; die Rueckrichtung entsteht
// dadurch, dass der Server alle ERREICHBAREN Notizen durchsieht. Genau daran
// haengt der wichtigste Test hier: was man nicht sehen darf, taucht auch als
// Rueckverweis nicht auf — sonst verriete das Netz Titel fremder Notizen.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName,
  createNote, shareFile, waitAppReady, deleteFile,
} = require("./helpers/relay");

const netz = (page) => page.locator("#note-netz");
const mitte = (page) => page.locator(".netz-mitte .netz-label");
const rein = (page) => page.locator(".netz-rein .netz-label");
const raus = (page) => page.locator(".netz-raus:not(.netz-tot) .netz-label");

// Notiz anlegen, die per @ auf die genannten Titel verweist.
async function notizMitVerweisen(page, titel, ziele = []) {
  await waitAppReady(page);
  await page.click("#app-menu-btn");
  await page.click("#app-panel .note-new");
  await expect(page.locator("#dlg-note")).toBeVisible();
  await page.click(".CodeMirror");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(`# ${titel}\n\nInhalt.`);
  for (const z of ziele) {
    await page.keyboard.type(`\n\nSiehe @${z}`);
    await expect(page.locator(".mention-panel .app-hit").first()).toBeVisible();
    await page.keyboard.press("Enter");
  }
  await Promise.all([page.waitForNavigation(), page.click("#note-save")]);
}

// Notiz oeffnen und in den Netz-Modus schalten.
async function oeffneNetz(page, titel) {
  await page.goto("/?p=Notizen");
  await waitAppReady(page);
  await page.locator("table.files .note-open").filter({ hasText: titel }).first().click();
  await expect(page.locator("#dlg-note")).toBeVisible();
  await page.click("#note-netz-btn");
  await expect(page.locator(".netz-mitte")).toBeVisible();
}

test.describe("Notiz-Netz", () => {
  let ich;   // der Nutzer, unter dem der jeweilige Test arbeitet

  test.beforeEach(async ({ page }) => {
    // eigener Nutzer je Test: die Rueckverweis-Suche geht ueber ALLE eigenen
    // Notizen, Reste aus anderen Tests wuerden sich sonst einmischen
    await loginAsAdmin(page);
    ich = await createUser(page);
    await logout(page);
    await login(page, ich.username, ich.password);
  });

  test("es zeigt aus- und eingehende Verweise, beidseitige nur einmal",
    async ({ page }) => {
      const zeit = uniqueName("");
      await notizMitVerweisen(page, "Packliste" + zeit);
      await notizMitVerweisen(page, "Fotos" + zeit);
      await notizMitVerweisen(page, "Plan" + zeit, ["Packliste" + zeit, "Fotos" + zeit]);
      await notizMitVerweisen(page, "Urlaub" + zeit, ["Plan" + zeit]);
      // Fotos verweist zurueck -> beidseitig
      await page.goto("/?p=Notizen");
      await waitAppReady(page);
      await page.locator("table.files .note-open").filter({ hasText: "Fotos" + zeit }).click();
      await page.click("#note-edit");
      await page.click(".CodeMirror");
      await page.keyboard.press("Control+End");
      await page.keyboard.type("\n\nGehört zu @Plan" + zeit);
      await expect(page.locator(".mention-panel .app-hit").first()).toBeVisible();
      await page.keyboard.press("Enter");
      await Promise.all([page.waitForNavigation(), page.click("#note-save")]);

      await oeffneNetz(page, "Plan" + zeit);
      await expect(mitte(page)).toHaveText("Plan" + zeit);
      await expect(rein(page)).toHaveText(["Urlaub" + zeit]);
      await expect(raus(page)).toHaveText(["Packliste" + zeit, "Fotos" + zeit]);
      // beidseitig steht auf der Ausgangsseite — und nur dort
      await expect(page.locator(".netz-beide")).toHaveCount(1);
      await expect(page.locator(".netz-beide .netz-label")).toHaveText("Fotos" + zeit);
      // eine Kante je Nachbar
      await expect(page.locator(".netz-kante")).toHaveCount(3);
    });

  test("ein Klick auf einen Knoten macht ihn zur neuen Mitte", async ({ page }) => {
    const zeit = uniqueName("");
    await notizMitVerweisen(page, "Ziel" + zeit);
    await notizMitVerweisen(page, "Start" + zeit, ["Ziel" + zeit]);

    await oeffneNetz(page, "Start" + zeit);
    await expect(mitte(page)).toHaveText("Start" + zeit);
    await page.locator(".netz-raus").filter({ hasText: "Ziel" + zeit }).click();

    // Die Notiz wird wirklich geoeffnet — Titel zieht mit — und das Netz
    // bleibt an, jetzt um die neue Mitte.
    await expect(page.locator("#dlg-note-title")).toHaveText("Ziel" + zeit);
    await expect(mitte(page)).toHaveText("Ziel" + zeit);
    await expect(rein(page)).toHaveText(["Start" + zeit]);
    await expect(netz(page)).toBeVisible();
  });

  test("der Knopf zeigt, dass der Netz-Modus laeuft", async ({ page }) => {
    // Drei Ansichten derselben Notiz — man muss sehen, in welcher man steckt.
    // Geprueft wird der Hintergrund, nicht nur aria-pressed: das Attribut kann
    // stimmen, waehrend optisch nichts passiert.
    await createNote(page, "Zustand " + uniqueName("n"));
    await page.goto("/?p=Notizen");
    await waitAppReady(page);
    await page.locator("table.files .note-open").first().click();
    const knopf = page.locator("#note-netz-btn");
    await expect(knopf).toBeVisible();
    await expect(knopf).toHaveAttribute("aria-pressed", "false");
    const aus = await knopf.evaluate((e) => getComputedStyle(e).backgroundColor);

    // Der Knopf faehrt seine Farbe weich um (transition) — darum auf den
    // Endzustand warten statt einen Wert mitten im Uebergang zu lesen.
    const grund = () => knopf.evaluate((e) => getComputedStyle(e).backgroundColor);
    await knopf.click();
    await page.mouse.move(5, 5); // Hover-Wirkung aus dem Weg
    await expect(knopf).toHaveAttribute("aria-pressed", "true");
    await expect.poll(grund, { timeout: 2000 }).not.toBe(aus);

    // und zurueck. Auch hier den Zeiger wegnehmen: nach einem Klick steht er
    // auf dem Knopf, und dessen Hover-Farbe waere sonst das Messergebnis.
    await knopf.click();
    await page.mouse.move(5, 5);
    await expect(knopf).toHaveAttribute("aria-pressed", "false");
    await expect.poll(grund, { timeout: 2000 }).toBe(aus);
  });

  test("ohne Verweise sagt es das, statt leer zu bleiben", async ({ page }) => {
    await createNote(page, "Allein " + uniqueName("n"));
    await oeffneNetz(page, "Allein");
    await expect(page.locator("#netz-leer")).toBeVisible();
    await expect(page.locator("#netz-leer")).toContainText("keiner anderen verbunden");
    await expect(page.locator(".netz-rein, .netz-raus")).toHaveCount(0);
  });

  test("ein Verweis auf eine geloeschte Notiz bleibt als totes Ziel stehen",
    async ({ page }) => {
      const zeit = uniqueName("");
      await notizMitVerweisen(page, "Weg" + zeit);
      await notizMitVerweisen(page, "Bleibt" + zeit, ["Weg" + zeit]);

      // Ziel loeschen — der Verweis im Text bleibt zurueck
      await page.goto("/?p=Notizen");
      await waitAppReady(page);
      await Promise.all([
        page.waitForNavigation(),
        deleteFile(page, "Weg" + zeit),   // laeuft ueber die Rueckfrage
      ]);

      await oeffneNetz(page, "Bleibt" + zeit);
      await expect(page.locator(".netz-tot")).toHaveCount(1);
      await expect(page.locator(".netz-tot .netz-label")).toHaveText("Weg" + zeit);
      // tote Ziele sind keine Knoepfe — dort gibt es nichts zu oeffnen
      expect(await page.locator(".netz-tot").evaluate((e) => e.tagName)).toBe("SPAN");
    });

  test("ein Rueckverweis aus einer NICHT freigegebenen Notiz taucht nicht auf",
    async ({ page, browser }) => {
      // Der eigentliche Sicherheitsfall: sonst verriete das Netz Titel und
      // Existenz fremder Notizen, die mir niemand freigegeben hat.
      const zeit = uniqueName("");
      await notizMitVerweisen(page, "Zielnotiz" + zeit);
      // …und an eine zweite Person freigeben, damit die ueberhaupt verweisen kann
      const zweite = await (async () => {
        const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
        const p = await ctx.newPage();
        await loginAsAdmin(p);
        const u = await createUser(p);
        await ctx.close();
        return u;
      })();
      await page.goto("/?p=Notizen");
      await waitAppReady(page);
      await shareFile(page, "Zielnotiz" + zeit, zweite.username, "view");

      // Die zweite Person verweist darauf — ohne ihre Notiz zurueckzugeben
      const ctx2 = await browser.newContext({ baseURL: new URL(page.url()).origin });
      const p2 = await ctx2.newPage();
      await login(p2, zweite.username, zweite.password);
      await notizMitVerweisen(p2, "Heimlich" + zeit, ["Zielnotiz" + zeit]);

      // Aus meiner Sicht ist dieser Rueckverweis unsichtbar
      await oeffneNetz(page, "Zielnotiz" + zeit);
      await expect(page.locator(".netz-rein")).toHaveCount(0);
      await expect(netz(page)).not.toContainText("Heimlich");

      // Gegenprobe, damit der Test nicht aus dem falschen Grund gruen ist:
      // sobald sie ihre Notiz freigibt, steht sie im Netz.
      await p2.goto("/?p=Notizen");
      await waitAppReady(p2);
      await shareFile(p2, "Heimlich" + zeit, ich.username, "view");
      await oeffneNetz(page, "Zielnotiz" + zeit);
      await expect(rein(page)).toHaveText(["Heimlich" + zeit]);
      await ctx2.close();
    });
});
