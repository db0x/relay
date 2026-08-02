// Suche mit Autovervollstaendigung im Anwendungs-Menue.
//
// Gesucht wird in den ANZEIGENAMEN aller Dokumente, die der Anfragende sehen
// darf: eigene (ueber alle Ordner hinweg) plus die ihm freigegebenen. Der
// wichtigste Test hier ist der letzte in der ersten Gruppe — die Suche darf
// kein Fenster zu fremden Dateien aufstossen.
const { test, expect } = require("@playwright/test");
const {
  loginAsAdmin, login, logout, createUser, uniqueName, uploadFile, createNote,
  shareFile, waitAppReady, expectFlash,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

const FELD = "#app-search";
const LISTE = "#app-search-results";
const TREFFER = `${LISTE} .app-hit`;

// Menue oeffnen und suchen. Gewartet wird nicht auf eine feste Zeit, sondern
// bis die Trefferliste FERTIG aufgefahren ist: waehrend der Hoehen-Animation
// baut OverlayScrollbars den Behaelter noch um, und Tastendruecke in diesem
// Moment sind ein Wettlauf (genau daran ist der Enter-Test einmal gescheitert).
async function suche(page, q) {
  if (await page.locator("#app-panel").isHidden()) await page.click("#app-menu-btn");
  await page.fill(FELD, q);
  await page.waitForResponse((r) => r.url().includes("/search?q="));
  await page.waitForFunction(() => {
    const out = document.querySelector("#app-search-out");
    if (!out || !out.style.height) return false;
    // gerenderte Hoehe hat den Zielwert erreicht -> Uebergang durch
    return Math.abs(out.getBoundingClientRect().height - parseFloat(out.style.height)) < 1;
  });
  // Danach raeumt OverlayScrollbars im Behaelter noch auf (Groessen-Beobachter,
  // Leisten-Klassen). Zwei Frames abwarten, bis das durch ist — sonst treffen
  // Tastendruecke die Oberflaeche mitten im Umbau.
  await page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r))));
}

const labels = (page) =>
  page.locator(`${TREFFER} .app-hit-label`).allTextContents();

test.describe("Suche", () => {
  let user, doc, note;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
    doc = "Reisekosten" + uniqueName("");
    await uploadFile(page, doc + ".docx");
    await waitAppReady(page);
  });

  test("das Feld sitzt oben im Menue, mit Lupe, und bekommt den Fokus",
    async ({ page }) => {
      await page.click("#app-menu-btn");
      await expect(page.locator(FELD)).toBeVisible();
      // Lupe im Feld — echte Datei, kein toter Symlink
      const icon = page.locator(".app-search-icon");
      await expect(icon).toHaveAttribute("src", /search\.svg/);
      expect(await icon.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
      // steht VOR der ersten Kategorie
      const reihenfolge = await page.evaluate(() => {
        const kinder = [...document.querySelector("#app-panel").children];
        return kinder.findIndex((e) => e.classList.contains("app-search"))
          < kinder.findIndex((e) => e.classList.contains("app-group"));
      });
      expect(reihenfolge).toBe(true);
      await expect(page.locator(FELD)).toBeFocused();
    });

  test("sie findet eigene Dokumente ueber einen Teil des Titels", async ({ page }) => {
    await suche(page, "reisekost");
    expect(await labels(page)).toContain(doc + ".docx");
  });

  test("Umlaute sind egal", async ({ page }) => {
    // Der Anzeigename einer Notiz darf Umlaute tragen (er steht in note_meta,
    // nicht im Dateinamen) — "grosse" muss "Große" finden.
    note = "Große Überraschung " + uniqueName("");
    await createNote(page, note);
    await waitAppReady(page);
    await suche(page, "grosse uberraschung");
    expect(await labels(page)).toContain(note);
  });

  test("freigegebene Dokumente stehen mit dem Besitzer dabei",
    async ({ page, browser }) => {
      const geteilt = "Gemeinsam" + uniqueName("") + ".docx";
      const ctx = await browser.newContext({ baseURL: BASE_URL });
      const owner = await ctx.newPage();
      await loginAsAdmin(owner);
      await uploadFile(owner, geteilt);
      await waitAppReady(owner);
      await owner.reload();
      await waitAppReady(owner);
      await shareFile(owner, geteilt, user.username, "view");
      await expectFlash(owner, "freigegeben");
      await ctx.close();

      await page.reload();
      await waitAppReady(page);
      await suche(page, "gemeinsam");
      expect(await labels(page)).toContain(geteilt);
      // Hinweis rechts nennt den Besitzer (bei eigenen steht dort der Ordner)
      await expect(page.locator(`${TREFFER} .app-hit-hint`).first()).toHaveText("Admin");
    });

  test("fremde Dateien OHNE Freigabe taucht sie nicht auf", async ({ page, browser }) => {
    // Der eigentliche Sicherheitsfall: die Suche darf nur zeigen, was
    // ohnehin sichtbar waere.
    const geheim = "Streng" + uniqueName("") + ".docx";
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const owner = await ctx.newPage();
    await loginAsAdmin(owner);
    await uploadFile(owner, geheim);
    await ctx.close();

    await suche(page, "streng");
    expect(await labels(page)).toEqual([]);
    // auch direkt am Endpunkt vorbei nicht
    const res = await page.request.get(`/search?q=${encodeURIComponent("streng")}`);
    expect(await res.json()).toEqual([]);
  });

  test("ohne Anmeldung antwortet der Endpunkt nicht", async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: BASE_URL });
    const anon = await ctx.newPage();
    const res = await anon.request.get("/search?q=a", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toContain("/login");
    await ctx.close();
  });
});

test.describe("Suche — Bedienung", () => {
  let user, note;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    await waitAppReady(page);
    note = "Suchnotiz " + uniqueName("");
    await createNote(page, note);
    await waitAppReady(page);
  });

  test("eine gefundene Notiz oeffnet im Notiz-Dialog, nicht im Editor",
    async ({ page }) => {
      // Die Treffer tragen dieselben Haken wie die Zeilen der Dateiliste —
      // eine Notiz ist ein .note-open-Knopf und laeuft ueber deren Handler.
      await suche(page, "suchnotiz");
      const treffer = page.locator(TREFFER).first();
      await expect(treffer).toHaveClass(/note-open/);
      await treffer.click();
      await expect(page.locator("#dlg-note")).toBeVisible();
      await expect(page.locator("#dlg-note-title")).toHaveText(note);
      // das Menue darf nicht ueber dem Dialog stehenbleiben
      await expect(page.locator("#app-panel")).toBeHidden();
      expect(page.url()).not.toContain("/edit/");
    });

  test("Pfeiltaste und Enter oeffnen den gewaehlten Treffer", async ({ page }) => {
    await suche(page, "suchnotiz");
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".app-hit-active")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.locator("#dlg-note")).toBeVisible();
  });

  test("ohne Treffer erscheint ein Hinweis statt einer leeren Liste",
    async ({ page }) => {
      await suche(page, "gibtesnichtxyz");
      await expect(page.locator(LISTE)).toBeHidden();
      await expect(page.locator("#app-search-empty")).toBeVisible();
    });

  test("Escape raeumt erst die Suche, dann das Menue", async ({ page }) => {
    await suche(page, "suchnotiz");
    await expect(page.locator(TREFFER).first()).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(LISTE)).toBeHidden();
    await expect(page.locator(FELD)).toHaveValue("");
    await expect(page.locator("#app-panel")).toBeVisible(); // Menue bleibt

    await page.keyboard.press("Escape");
    await expect(page.locator("#app-panel")).toBeHidden();
  });

  test("die Panelbreite bleibt beim Suchen unveraendert", async ({ page }) => {
    // Feste Breite mit Absicht: das Menue soll beim Tippen nicht mitzappeln.
    const breite = () => page.locator("#app-panel")
      .evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await page.click("#app-menu-btn");
    const leer = await breite();
    await suche(page, "suchnotiz");
    expect(await breite()).toBe(leer);
    await suche(page, "gibtesnichtxyz");
    expect(await breite()).toBe(leer);
  });

  test("die Hoehe der Trefferliste faehrt weich auf und zu", async ({ page }) => {
    const out = page.locator("#app-search-out");
    await page.click("#app-menu-btn");
    // Uebergang ist gesetzt …
    expect(await out.evaluate((el) => getComputedStyle(el).transitionProperty))
      .toContain("height");
    await expect(out).toHaveCSS("height", "0px");

    // … und js/search.js setzt einen echten Pixel-Zielwert (nicht auto —
    // sonst liefe der Uebergang bei wechselnder Trefferzahl nicht)
    await suche(page, "suchnotiz");
    const auf = await out.evaluate((el) => el.style.height);
    expect(auf).toMatch(/^\d+(\.\d+)?px$/);
    expect(parseFloat(auf)).toBeGreaterThan(0);

    await page.fill(FELD, "");
    await expect.poll(() => out.evaluate((el) => el.style.height)).toBe("0px");
  });

  test("erneutes Oeffnen startet mit leerem Feld", async ({ page }) => {
    await suche(page, "suchnotiz");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.click("#app-menu-btn");
    await expect(page.locator(FELD)).toHaveValue("");
    await expect(page.locator(LISTE)).toBeHidden();
  });
});

test.describe("Suche — lange Trefferliste", () => {
  let user, stamm;

  test.beforeEach(async ({ page }) => {
    test.slow(); // mehrere Uploads
    await loginAsAdmin(page);
    user = await createUser(page);
    await logout(page);
    await login(page, user.username, user.password);
    // kleines Fenster: .app-search-scroll ist auf 46vh gedeckelt, so laeuft
    // die Liste schon mit wenigen Treffern ueber
    await page.setViewportSize({ width: 1200, height: 420 });
    await waitAppReady(page);
    stamm = "Reise" + uniqueName("");
    for (let i = 1; i <= 6; i++) {
      await uploadFile(page, `${stamm}-${i}.docx`);
      await waitAppReady(page);
    }
  });

  test("die Bildlaufleiste verdeckt keine Treffer", async ({ page }) => {
    await suche(page, stamm.toLowerCase());
    const bar = page.locator(".app-search-scroll .os-scrollbar-vertical");
    await expect(bar).toBeVisible();
    await expect(bar).not.toHaveClass(/os-scrollbar-unusable/);
    // kein Treffer ragt unter den Griff
    const drunter = await page.evaluate(() => {
      const b = document.querySelector(".app-search-scroll .os-scrollbar-vertical")
        .getBoundingClientRect();
      return [...document.querySelectorAll("#app-search-results .app-hit")]
        .filter((h) => h.getBoundingClientRect().right > b.left + 1).length;
    });
    expect(drunter).toBe(0);
  });

  test("im Menue scrollen schliesst es NICHT", async ({ page }) => {
    // Regression: core/dialogs.js schloss bei JEDEM Scrollen alle Menues
    // (damit sich die fixen Zeilenmenues nicht von ihrer Zeile loesen) — damit
    // war die Trefferliste praktisch nicht bedienbar.
    await suche(page, stamm.toLowerCase());
    const box = await page.locator(".app-search-scroll").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 200);

    await expect(page.locator("#app-panel")).toBeVisible();
    await expect.poll(() => page.evaluate(() => {
      const os = window.OverlayScrollbarsGlobal
        .OverlayScrollbars(document.querySelector(".app-search-scroll"));
      return os ? Math.round(os.elements().viewport.scrollTop) : 0;
    })).toBeGreaterThan(0);
  });

  test("das Zeilenmenue schliesst beim Scrollen weiterhin", async ({ page }) => {
    // Gegenprobe zur Ausnahme oben: ausserhalb eines Menues gilt die alte
    // Regel unveraendert, sonst haengte ein fixes Zeilenmenue in der Luft.
    const row = page.locator("table.files tbody tr").first();
    await row.locator(".row-menu-btn").click();
    await expect(page.locator(".row-menu-panel:not([hidden])")).toHaveCount(1);

    const f = await page.locator("#page").boundingBox();
    await page.mouse.move(f.x + f.width / 2, f.y + f.height - 40);
    await page.mouse.wheel(0, 250);
    await expect(page.locator(".row-menu-panel:not([hidden])")).toHaveCount(0);
  });
});
