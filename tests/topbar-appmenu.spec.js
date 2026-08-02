// Anwendungs-Menue am Logo in der Titelleiste.
//
// Frueher fuehrten Logo UND Name zur Startseite. Jetzt teilt sich das auf:
// der Name laedt weiter neu, das Logo oeffnet ein Menue mit den Anwendungen
// und ihren Aktionen (48px-Icons mit Tooltip, bewusst ohne "+"-Overlay).
// Die Eintraege tragen dieselben Haken wie die Knoepfe in den Fenster-
// Titelleisten (data-create bzw. .note-new) und laufen ueber deren Handler.
const { test, expect } = require("@playwright/test");
const { loginAsAdmin, waitAppReady } = require("./helpers/relay");

const BTN = "#app-menu-btn";
const PANEL = "#app-panel";

test.describe("Anwendungs-Menue", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitAppReady(page);
  });

  test("der Name bleibt der Link zur Startseite, das Logo wird zum Knopf",
    async ({ page }) => {
      await expect(page.locator("a.brand")).toHaveAttribute("href", /\/$/);
      // das Logo steckt NICHT mehr im Link, sondern im Menue-Knopf
      await expect(page.locator("a.brand img")).toHaveCount(0);
      await expect(page.locator(`${BTN} img`)).toHaveCount(1);
    });

  test("es zeigt die Anwendungen mit ihren Aktionen", async ({ page }) => {
    await expect(page.locator(PANEL)).toBeHidden();
    await page.click(BTN);
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(page.locator(BTN)).toHaveAttribute("aria-expanded", "true");

    await expect(page.locator(`${PANEL} .app-group-title`))
      .toHaveText(["OnlyOffice", "Notizen"]);
    await expect(page.locator(`${PANEL} .app-btn`)).toHaveCount(4);
    // jeder Eintrag hat einen Tooltip …
    for (const [sel, tip] of [
      ['[data-create="docx"]', "Neues Textdokument"],
      ['[data-create="xlsx"]', "Neue Tabelle"],
      ['[data-create="pptx"]', "Neue Präsentation"],
      [".note-new", "Neue Notiz"],
    ]) {
      await expect(page.locator(`${PANEL} ${sel}`)).toHaveAttribute("data-tip", tip);
    }
    // … und ein 48px-Icon
    const groesse = await page.locator(`${PANEL} .app-btn img`).first()
      .evaluate((el) => el.getBoundingClientRect());
    expect(Math.round(groesse.width)).toBe(48);
    expect(Math.round(groesse.height)).toBe(48);
  });

  test("die Kategorien tragen ihr Anwendungs-Icon", async ({ page }) => {
    await page.click(BTN);
    const icons = await page.locator(`${PANEL} .app-group-title img`)
      .evaluateAll((els) => els.map((e) => e.getAttribute("src").split("/").pop().split("?")[0]));
    expect(icons).toEqual(["onlyoffice.svg", "relay.svg"]);
  });

  test("jedes Icon hat eine Unterschrift, keine davon abgeschnitten",
    async ({ page }) => {
      await page.click(BTN);
      await expect(page.locator(`${PANEL} .app-label`))
        .toHaveText(["Textdokument", "Tabelle", "Präsentation", "Notiz"]);
      // Die Kacheln haben feste Breite — bei zu schmalem Panel liefe die
      // laengste Unterschrift in die Ellipse (oder das Panel ueber den Rand).
      const beschnitten = await page.locator(`${PANEL} .app-label`)
        .evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1)
          .map((e) => e.textContent));
      expect(beschnitten).toEqual([]);
    });

  test("alle Kacheln liegen INNERHALB des Panels", async ({ page }) => {
    // Regression: .menu-panel steht in index.css weiter unten und hatte
    // min-width/right der .app-panel-Regel zurueckerobert — die dritte Kachel
    // ragte dadurch aus dem Panel heraus.
    await page.click(BTN);
    const raus = await page.evaluate(() => {
      const p = document.querySelector("#app-panel").getBoundingClientRect();
      return [...document.querySelectorAll("#app-panel .app-btn")]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.left < p.left - 1 || r.right > p.right + 1;
        })
        .map((b) => b.dataset.tip);
    });
    expect(raus).toEqual([]);
  });

  test("die Icons tragen KEIN Plus-Overlay", async ({ page }) => {
    // Das "+" der Titelleisten-Icons kommt aus .create-zoom::after als
    // add.svg-Hintergrund — im Menue darf davon nichts zu sehen sein.
    await page.click(BTN);
    const mitPlus = await page.evaluate(() =>
      [...document.querySelectorAll("#app-panel .app-btn")].some((b) =>
        [b, ...b.querySelectorAll("*")].some((el) =>
          getComputedStyle(el, "::after").backgroundImage.includes("add.svg"))));
    expect(mitPlus).toBe(false);
    await expect(page.locator(`${PANEL} .create-zoom`)).toHaveCount(0);
  });

  test("es schliesst wie die uebrigen Menues", async ({ page }) => {
    await page.click(BTN);
    await expect(page.locator(PANEL)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(PANEL)).toBeHidden();

    await page.click(BTN);
    await expect(page.locator(PANEL)).toBeVisible();
    await page.mouse.click(640, 640); // irgendwo daneben
    await expect(page.locator(PANEL)).toBeHidden();
  });

  test("„Neue Tabelle“ oeffnet den Anlegen-Dialog und schliesst das Menue",
    async ({ page }) => {
      await page.click(BTN);
      await page.click(`${PANEL} [data-create="xlsx"]`);
      await expect(page.locator("#dlg-create")).toBeVisible();
      await expect(page.locator("#dlg-create-title")).toHaveText("Neue Tabelle");
      await expect(page.locator("#dlg-create-ext")).toHaveValue("xlsx");
      await expect(page.locator(PANEL)).toBeHidden();
    });

  test("„Neue Notiz“ oeffnet den Notiz-Dialog und schliesst das Menue",
    async ({ page }) => {
      await page.click(BTN);
      await page.click(`${PANEL} .note-new`);
      await expect(page.locator("#dlg-note")).toBeVisible();
      await expect(page.locator("#dlg-note-title")).toHaveText("Neue Notiz");
      await expect(page.locator(PANEL)).toBeHidden();
    });

});
