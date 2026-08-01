// Eigene Bildlaufleisten (OverlayScrollbars, js/core/scrollbars.js).
//
// Warum das ueberhaupt getestet werden KANN: die nativen Leisten des Systems
// zeichnet ein Headless-Browser gar nicht — genau deshalb liess sich der
// urspruengliche Fehler ("Fenster laeuft ueber, aber keine Leiste") hier nie
// nachstellen. Diese Leisten sind echte Elemente und damit pruefbar.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, uniqueName, uploadFile, waitAppReady,
} = require("./helpers/relay");

const VBAR = "#page .os-scrollbar-vertical";
const HANDLE = `${VBAR} .os-scrollbar-handle`;

// Instanz-Zustand aus der Bibliothek holen (sie liegt global, wie marked)
function osState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const os = window.OverlayScrollbarsGlobal.OverlayScrollbars(el);
    if (!os) return null;
    return { zerstoert: os.state().destroyed, scrollTop: os.elements().viewport.scrollTop };
  }, selector);
}

test.describe("Bildlaufleisten", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await waitAppReady(page);
  });

  // Fenster klein machen und so viele Dateien anlegen, dass die Liste
  // sicher ueberlaeuft — ohne 25 Uploads zu brauchen.
  async function overflowingList(page, count = 6) {
    await page.setViewportSize({ width: 1000, height: 420 });
    for (let i = 0; i < count; i++) {
      await uploadFile(page, `${uniqueName("sb")}.docx`);
      await waitAppReady(page);
    }
    await page.waitForTimeout(300); // Leiste nach dem letzten Neuaufbau setzen
  }

  test("das Dateifenster bekommt eine sichtbare Leiste, wenn es ueberlaeuft",
    async ({ page }) => {
      await overflowingList(page);
      await expect(page.locator(VBAR)).toBeVisible();
      // Der Griff ist kuerzer als die Bahn -> es gibt wirklich etwas zu scrollen
      const mass = await page.evaluate((h) => {
        const handle = document.querySelector(h);
        const track = handle.closest(".os-scrollbar").querySelector(".os-scrollbar-track");
        return {
          griff: handle.getBoundingClientRect().height,
          bahn: track.getBoundingClientRect().height,
          breite: handle.getBoundingClientRect().width,
        };
      }, HANDLE);
      expect(mass.griff).toBeGreaterThan(0);
      expect(mass.griff).toBeLessThan(mass.bahn);
      expect(mass.breite).toBeGreaterThan(3);
    });

  test("sie bleibt sichtbar, auch ohne den Zeiger im Fenster", async ({ page }) => {
    // autoHide:"never" ist der Kern der Sache — eine Leiste, die man erst
    // hervorholen muss, loeste das Ausgangsproblem nur zur Haelfte.
    await overflowingList(page);
    await page.mouse.move(5, 5); // weit weg vom Fenster
    await page.waitForTimeout(900);
    await expect(page.locator(VBAR)).toBeVisible();
    await expect(page.locator(VBAR)).not.toHaveClass(/os-scrollbar-auto-hide-hidden/);
  });

  test("das Notiz-Board bekommt sie automatisch ueber createWindow",
    async ({ page }) => {
      // Kein eigener Aufruf im Board-Code: createWindow versorgt JEDES Fenster.
      if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
      await expect(page.locator("#board")).toBeVisible();
      await expect(page.locator("#board .os-scrollbar-vertical")).toHaveCount(1);
      expect((await osState(page, "#board")).zerstoert).toBe(false);
    });

  test("ein Listentausch laesst keine tote Instanz zurueck", async ({ page }) => {
    // Regression: folder-nav.js ersetzt #page.innerHTML. Ohne das Aufloesen
    // vorher blieb eine Instanz uebrig, die sich fuer lebendig hielt
    // (state().destroyed === false), aber nie wieder etwas zeichnete.
    await overflowingList(page);
    await expect(page.locator(VBAR)).toBeVisible();

    // Sortierwechsel laeuft durch denselben swapFolder wie ein Ordnerwechsel
    await page.locator("table.files th .sort").first().click();
    await page.waitForTimeout(600);

    await expect(page.locator(VBAR)).toBeVisible();
    await expect(page.locator(VBAR)).toHaveCount(1); // keine zweite Leiste
    expect((await osState(page, "#page")).zerstoert).toBe(false);
  });

  test("der Griff scrollt, ohne das Fenster zu verschieben", async ({ page }) => {
    // .os-scrollbar steht in DRAG_SKIP (js/core/window.js) — ohne das wuerde
    // der Zug am Griff das ganze Fenster durch die Gegend schieben.
    await overflowingList(page);
    const links = await page.evaluate(() => document.querySelector("#page").style.left);
    const h = await page.locator(HANDLE).boundingBox();

    await page.mouse.move(h.x + h.width / 2, h.y + 4);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.waitForTimeout(120);
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(h.x + h.width / 2, h.y + 4 + i * 12);
      await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect((await osState(page, "#page")).scrollTop).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.querySelector("#page").style.left)).toBe(links);
  });

  test("auch Menues und Vorschauen haben sie", async ({ page }) => {
    for (const sel of [".notif-panel", ".note-preview"]) {
      expect((await osState(page, sel)), sel).not.toBeNull();
    }
  });

  test("der Notiz-Editor hat eine eigene, sichtbare Leiste", async ({ page }) => {
    // CodeMirror verwaltet sein Innenleben selbst — OverlayScrollbars kann dort
    // nicht hinein. Stattdessen sein eigenes Modell (Addon cm-scrollbars.js,
    // scrollbarStyle:"overlay"); die Optik gleicht index.css an.
    if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
    await page.click("#note-new");
    await expect(page.locator("#dlg-note")).toBeVisible();
    await page.click(".CodeMirror");
    await page.keyboard.press("Control+A");
    // Kurze Zeilen, aber genug davon: der Editorbereich ist nur rund 170px
    // hoch. Lange Zeilen zu tippen kostete nur Zeit (jeder Anschlag geht
    // einzeln durch CodeMirror) und brachte den Test an die 30s-Grenze.
    const zeilen = [];
    for (let i = 1; i <= 20; i++) zeilen.push(`Zeile ${i}`);
    await page.keyboard.type(zeilen.join("\n"));

    // das Addon-Modell ist aktiv (sonst waere es die unsichtbare native)
    await expect(page.locator(".CodeMirror")).toHaveClass(/CodeMirror-overlayscroll/);
    const bar = page.locator(".CodeMirror-overlayscroll-vertical");
    await expect(bar).toBeVisible();

    const mass = await bar.evaluate((el) => {
      const inner = el.firstElementChild;
      return {
        bahn: el.getBoundingClientRect().height,
        griff: inner.getBoundingClientRect().height,
        breite: inner.getBoundingClientRect().width,
      };
    });
    expect(mass.griff).toBeGreaterThan(0);
    expect(mass.griff).toBeLessThan(mass.bahn);
    // dieselbe Griffbreite wie bei den uebrigen Leisten
    expect(Math.round(mass.breite)).toBe(6);

    // und er scrollt: nach unten getippt -> Zug nach OBEN muss zurueckfuehren
    const inner = await page.locator(".CodeMirror-overlayscroll-vertical > div").boundingBox();
    const vorher = await page.evaluate(() => document.querySelector(".CodeMirror-scroll").scrollTop);
    expect(vorher).toBeGreaterThan(0);
    await page.mouse.move(inner.x + inner.width / 2, inner.y + inner.height / 2);
    await page.mouse.down();
    await page.mouse.move(inner.x + inner.width / 2, inner.y + inner.height / 2 - 100, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() =>
      page.evaluate(() => document.querySelector(".CodeMirror-scroll").scrollTop)).toBeLessThan(vorher);
  });

  test("die Notiz-Vorschau setzt ihre Bloecke UNTEREINANDER", async ({ page }) => {
    // Regression: OverlayScrollbars setzt seinen Behaelter auf
    // flex-direction:row. Schrieb note-dialog.js das gerenderte Markdown
    // direkt in diesen Behaelter, wurden Ueberschrift, Absatz und Liste zu
    // Flex-Kindern und standen NEBENEINANDER. Der Inhalt gehoert deshalb in
    // #note-preview-body, eine Ebene tiefer.
    // "Neue Notiz" sitzt im Board-Kopf. Nur oeffnen, wenn zu — der Zustand
    // wird serverseitig gemerkt und ein frueherer Test kann ihn geaendert haben.
    if (await page.locator("#board.page-min").count()) await page.click("#board-toggle");
    await page.click("#note-new");
    await expect(page.locator("#dlg-note")).toBeVisible();
    await page.click(".CodeMirror");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("# Ueberschrift\n\nEin Absatz.\n\n- Punkt eins\n- Punkt zwei");
    // Die Vorschau laeuft mit 200ms Verzoegerung nach -> auf den INHALT warten,
    // nicht nur auf ein <h1> (das gibt es schon in der leeren Vorlage)
    await expect(page.locator("#note-preview-body h1")).toHaveText("Ueberschrift");
    await expect(page.locator("#note-preview-body ul li")).toHaveCount(2);

    const lage = await page.evaluate(() => {
      const body = document.querySelector("#note-preview-body");
      const [h1, p, ul] = ["h1", "p", "ul"].map((s) => body.querySelector(s).getBoundingClientRect());
      return {
        absatzUnterUeberschrift: p.top >= h1.bottom - 1,
        listeUnterAbsatz: ul.top >= p.bottom - 1,
        // alle beginnen am gleichen linken Rand — Spalten taeten das nicht
        gleicheKante: Math.abs(h1.left - p.left) < 2 && Math.abs(p.left - ul.left) < 40,
      };
    });
    expect(lage.absatzUnterUeberschrift).toBe(true);
    expect(lage.listeUnterAbsatz).toBe(true);
    expect(lage.gleicheKante).toBe(true);
  });
});
