// Dokumente oeffnen, ohne Relay zu verlassen.
//
// Vorher war ein Klick auf einen Dateinamen eine Vollbild-Navigation: Desktop,
// Notiz-Icons, offene Fenster und (seit es ihn gibt) der Chat-Ereignisstrom
// waren weg. Jetzt laeuft die Editor-Seite /edit/... in einem iframe in einem
// FENSTER des Desktops — verschiebbar, minimierbar, in der Groesse zu ziehen
// (js/files/editor-view.js + core/window.js).
//
// WICHTIG fuer diese Suite: OnlyOffice selbst ist hier NICHT erreichbar — der
// Wegwerf-Container laeuft ohne DocumentServer. Die Tests pruefen deshalb
// genau das, was UNS gehoert: dass das Fenster aufgeht, die Seite bleibt, der
// iframe auf die richtige Adresse zeigt, das Schliessen speichern laesst und
// die Berechtigung stimmt. Ob der Editor darin hochkommt, ist Sache des
// DocumentServers und wird von Hand im echten Stack geprueft.
const { test, expect } = require("@playwright/test");
const {
  ADMIN, login, loginAsAdmin, createUser, uniqueName, waitAppReady, uploadFile, fileRow,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

// Eine Datei anlegen und im Fenster oeffnen. Rueckgabe: ihr Name.
async function oeffneDokument(page) {
  const name = `${uniqueName("dok")}.docx`;
  await uploadFile(page, name);
  await waitAppReady(page);
  await fileRow(page, name).locator("a.fname").click();
  await expect(page.locator("#editor-win")).toBeVisible();
  return name;
}

// Die Voltage-Bruecke nachstellen, BEVOR ein Skript der Seite laeuft — genau so
// steht sie in der echten App bereit (additionalArguments erreichen den Preload
// vor dem ersten Skript). `antwort` ist, was die Runtime melden wuerde.
async function stelleVoltageNach(page, antwort) {
  await page.addInitScript((ok) => {
    window.__voltageAufrufe = [];
    window.voltage = {
      runtime: "relay",
      openDocumentWindow: function (url) {
        window.__voltageAufrufe.push(url);
        return Promise.resolve(ok);
      },
    };
  }, antwort);
}

test.describe("PDFs in der Voltage-Runtime", () => {
  // In der App gibt es einen echten Fenstermanager. Ein PDF gehoert dann in ein
  // echtes Fenster (eine zweite Instanz des AppImage), nicht in das gezeichnete
  // Pseudo-Fenster des Relay-Desktops. Im Browser aendert sich nichts.
  test("ein PDF geht an die Runtime statt ins Desktop-Fenster", async ({ page }) => {
    await stelleVoltageNach(page, true);
    await loginAsAdmin(page);
    const name = `${uniqueName("schau")}.pdf`;
    await uploadFile(page, name);
    await waitAppReady(page);

    await fileRow(page, name).locator("a.fname").click();

    // Die Runtime hat die Adresse bekommen ...
    await expect.poll(() => page.evaluate(() => window.__voltageAufrufe)).toEqual([
      `${BASE_URL}/edit/${ADMIN.username}/${name}`,
    ]);
    // ... und das gezeichnete Fenster ist NICHT aufgegangen
    await expect(page.locator("#editor-win")).toBeHidden();
    await expect(page.locator("#editor-toggle")).toBeHidden();
    expect(page.url()).not.toContain("/edit/");
  });

  test("auch ein bearbeitbares Dokument wird der Runtime angeboten", async ({ page }) => {
    // Nicht nur PDFs: welche Dateiarten ein eigenes Fenster bekommen, steht in
    // der Runtime (dort ist je Art eine Anwendung hinterlegt), nicht hier. Relay
    // bietet alles an, was der DocumentServer oeffnet, und richtet sich nach der
    // Antwort. Es bleibt dabei bei EINEM offenen Dokument — entweder dort oder
    // hier, nie beides.
    await stelleVoltageNach(page, true);
    await loginAsAdmin(page);
    const name = `${uniqueName("brief")}.docx`;
    await uploadFile(page, name);
    await waitAppReady(page);

    await fileRow(page, name).locator("a.fname").click();

    await expect.poll(() => page.evaluate(() => window.__voltageAufrufe)).toEqual([
      `${BASE_URL}/edit/${ADMIN.username}/${name}`,
    ]);
    await expect(page.locator("#editor-win")).toBeHidden();
  });

  test("ohne Zuordnung fuer diese Dateiart bleibt es im Desktop-Fenster",
    async ({ page }) => {
      // Der Normalfall einer unkonfigurierten App: die Runtime kennt fuer diese
      // Art keine Anwendung und antwortet "nein". Dann verhaelt sich relay wie
      // im Browser — Dokumente herausreichen ist eine bewusste Einstellung.
      await stelleVoltageNach(page, false);
      await loginAsAdmin(page);
      const name = `${uniqueName("tabelle")}.xlsx`;
      await uploadFile(page, name);
      await waitAppReady(page);

      await fileRow(page, name).locator("a.fname").click();

      await expect(page.locator("#editor-win")).toBeVisible();
      expect((await page.evaluate(() => window.__voltageAufrufe)).length).toBe(1);
    });

  test("meldet die Runtime, dass sie nichts starten konnte, oeffnet es doch im Desktop",
    async ({ page }) => {
      // Entwicklungsstart ohne AppImage: openDocumentWindow antwortet false. Ein
      // Klick darf dann nicht ins Leere laufen.
      await stelleVoltageNach(page, false);
      await loginAsAdmin(page);
      const name = `${uniqueName("fallback")}.pdf`;
      await uploadFile(page, name);
      await waitAppReady(page);

      await fileRow(page, name).locator("a.fname").click();

      await expect(page.locator("#editor-win")).toBeVisible();
      expect((await page.evaluate(() => window.__voltageAufrufe)).length).toBe(1);
    });

  test("ohne Runtime bleibt alles beim Alten", async ({ page }) => {
    // Derselbe Klick im normalen Browser: kein window.voltage, gezeichnetes
    // Fenster wie immer.
    await loginAsAdmin(page);
    const name = `${uniqueName("browser")}.pdf`;
    await uploadFile(page, name);
    await waitAppReady(page);

    expect(await page.evaluate(() => typeof window.voltage)).toBe("undefined");
    await fileRow(page, name).locator("a.fname").click();
    await expect(page.locator("#editor-win")).toBeVisible();
  });
});

test.describe("Editor-Fenster", () => {
  test("ein Klick auf das Dokument oeffnet das Fenster statt die Seite zu wechseln",
    async ({ page }) => {
      await loginAsAdmin(page);
      const name = `${uniqueName("win")}.docx`;
      await uploadFile(page, name);
      await waitAppReady(page);

      // Ohne Dokument ist das Fenster eingeklappt und sein Umschalter weg —
      // es gaebe nichts zurueckzuholen.
      await expect(page.locator("#editor-win")).toBeHidden();
      await expect(page.locator("#editor-toggle")).toBeHidden();

      const vorher = page.url();
      await fileRow(page, name).locator("a.fname").click();

      await expect(page.locator("#editor-win")).toBeVisible();
      // Der eigentliche Punkt: die Anwendung steht noch
      expect(page.url()).toBe(vorher);
      await expect(page.locator("table.files")).toBeVisible();
      await expect(page.locator("#editor-win-title")).toHaveText(name);
      // Jetzt gibt es etwas zurueckzuholen
      await expect(page.locator("#editor-toggle")).toBeVisible();
      // Der iframe zeigt auf die unveraenderte Editor-Seite
      await expect(page.locator("#editor-win-frame"))
        .toHaveAttribute("src", new RegExp(`/edit/${ADMIN.username}/${name}$`));
      // ... und der Notausgang "eigener Tab" auf dieselbe Adresse
      await expect(page.locator("#editor-win-newtab"))
        .toHaveAttribute("href", new RegExp(`/edit/${ADMIN.username}/${name}$`));
    });

  test("der Umschalter traegt Symbol und Namen des Dokuments", async ({ page }) => {
    // Er steht fuer DAS DOKUMENT, nicht fuer die Anwendung — ein PDF soll wie
    // ein PDF aussehen. Dieselbe Zuordnung wie in der Dateiliste, ueber die
    // Route /fileicon/<endung> (mimeicons.js). Sobald es mehrere Dokumente
    // gibt, ist genau das der Unterschied zwischen den Eintraegen.
    await loginAsAdmin(page);
    const name = `${uniqueName("sym")}.pptx`;
    await uploadFile(page, name);
    await waitAppReady(page);

    const symbol = page.locator("#editor-toggle img");
    // vorher: das neutrale Anwendungssymbol
    await expect(symbol).toHaveAttribute("src", /onlyoffice\.svg$/);

    await fileRow(page, name).locator("a.fname").click();
    await expect(page.locator("#editor-win")).toBeVisible();
    await expect(symbol).toHaveAttribute("src", /\/fileicon\/pptx$/);
    await expect(page.locator("#editor-toggle")).toHaveAttribute("data-tip", name);
    // ... und es laedt auch wirklich (die Icons haben keine viewBox, werden
    // aber trotzdem korrekt auf 26px skaliert — hier abgesichert)
    expect(await symbol.evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);

    // nach dem Schliessen zurueck auf neutral, damit beim naechsten Oeffnen
    // nicht kurz das Symbol des VORIGEN Dokuments steht
    await page.click("#editor-win-close");
    await expect(page.locator("#editor-win")).toBeHidden();
    await expect(symbol).toHaveAttribute("src", /onlyoffice\.svg$/);
  });

  test("Schliessen laesst speichern und kappt die Editor-Sitzung", async ({ page }) => {
    // Reisst man den iframe einfach heraus, endet die Sitzung zum
    // DocumentServer abrupt und die letzten Aenderungen koennen verloren
    // gehen. Darum vorher forcesave — hier wird geprueft, DASS es passiert.
    await loginAsAdmin(page);
    await oeffneDokument(page);

    const gerufen = [];
    page.on("request", (r) => {
      if (r.url().includes("/forcesave/")) gerufen.push(r.method());
    });
    await page.click("#editor-win-close");

    await expect(page.locator("#editor-win")).toBeHidden();
    expect(gerufen).toContain("POST");
    // about:blank statt der Editor-Adresse: sonst liefe die Sitzung weiter
    await expect(page.locator("#editor-win-frame")).toHaveAttribute("src", "about:blank");
    // und der Umschalter verschwindet wieder
    await expect(page.locator("#editor-toggle")).toBeHidden();
  });

  test("Minimieren laesst das Dokument OFFEN und der Umschalter holt es zurueck",
    async ({ page }) => {
      // Der Unterschied zum Schliessen: die Sitzung zum DocumentServer laeuft
      // weiter, der iframe behaelt seine Adresse. Nur so ist Minimieren
      // billig genug, um es beilaeufig zu benutzen.
      await loginAsAdmin(page);
      const name = await oeffneDokument(page);

      const gerufen = [];
      page.on("request", (r) => { if (r.url().includes("/forcesave/")) gerufen.push(r.method()); });
      await page.click("#editor-win-minimize");

      await expect(page.locator("#editor-win")).toBeHidden();
      expect(gerufen).toEqual([]);            // NICHT gespeichert — nichts endet
      await expect(page.locator("#editor-toggle")).toBeVisible();
      await expect(page.locator("#editor-win-frame"))
        .toHaveAttribute("src", new RegExp(`/edit/${ADMIN.username}/${name}$`));

      await page.click("#editor-toggle");
      await expect(page.locator("#editor-win")).toBeVisible();
    });

  test("auf Fenstergroesse und zurueck", async ({ page }) => {
    await loginAsAdmin(page);
    await oeffneDokument(page);
    const vorher = await page.locator("#editor-win").boundingBox();

    await page.click("#editor-win-max");
    await expect(page.locator("#editor-win")).toHaveClass(/win-max/);
    await expect(page.locator("#editor-win-max")).toHaveAttribute("aria-pressed", "true");
    const gross = await page.locator("#editor-win").boundingBox();
    expect(gross.width).toBeGreaterThan(vorher.width);
    expect(Math.round(gross.x)).toBe(0);

    // Zurueck auf GENAU die Groesse von vorher — der maximierte Zustand ist
    // eine Ansicht, keine Groesse, und darf die gemerkte nicht ueberschreiben.
    await page.click("#editor-win-max");
    await expect(page.locator("#editor-win")).not.toHaveClass(/win-max/);
    const wieder = await page.locator("#editor-win").boundingBox();
    expect(Math.abs(wieder.width - vorher.width)).toBeLessThan(3);
    expect(Math.abs(wieder.x - vorher.x)).toBeLessThan(3);

    // Maximiert geschlossen -> die Klasse darf nicht haengenbleiben, sonst
    // kaeme das naechste Dokument bildschirmfuellend zurueck
    await page.click("#editor-win-max");
    await page.click("#editor-win-close");
    await expect(page.locator("#editor-win")).not.toHaveClass(/win-max/);
  });

  test("ein neu angelegtes Dokument geht ebenfalls im Fenster auf", async ({ page }) => {
    // /create leitete frueher direkt auf die Editor-Vollseite um — genau der
    // Sprung aus der Anwendung, den wir loswerden wollten. Jetzt kommt die
    // Marke ?open= zurueck, die editor-view.js auswertet und wieder wegraeumt.
    await loginAsAdmin(page);
    await waitAppReady(page);
    const name = uniqueName("neu");
    await page.click("#app-menu-btn");
    await page.click('#app-panel [data-create="docx"]');
    await expect(page.locator("#dlg-create")).toBeVisible();
    await page.fill("#dlg-create input[name=name]", name);
    await Promise.all([page.waitForNavigation(), page.click("#dlg-create .dialog-submit")]);
    await waitAppReady(page);

    await expect(page.locator("#editor-win")).toBeVisible();
    await expect(page.locator("#editor-win-frame"))
      .toHaveAttribute("src", new RegExp(`/edit/${ADMIN.username}/${name}\\.docx$`));
    // Die Marke darf nicht in der Adresse haengenbleiben, sonst ginge der
    // Editor bei jedem Zurueck erneut auf
    expect(page.url()).not.toContain("open=");
  });

  test("?neu= oeffnet den Anlegen-Dialog und legt ganzseitig los", async ({ page }) => {
    // Der Einstieg fuer eine Voltage-App, die genau einen Dateityp betreut und
    // OHNE Datei gestartet wurde: dort ist "neue Datei dieser Art" die einzige
    // sinnvolle Absicht. Sie landet danach NICHT in der Dateiliste mit einem
    // gezeichneten Fenster darin — das waere wieder der zweite Desktop —,
    // sondern ganzseitig im Editor.
    await loginAsAdmin(page);
    await page.goto("/?neu=xlsx");
    await waitAppReady(page);

    await expect(page.locator("#dlg-create")).toBeVisible();
    await expect(page.locator("#dlg-create-ext")).toHaveValue("xlsx");
    await expect(page.locator("#dlg-create-title")).toHaveText("Neue Tabelle");
    // Die Marke ist aus der Adresse genommen — ein Neuladen darf den Dialog
    // nicht erneut aufreissen.
    expect(page.url()).not.toContain("neu=");

    const name = uniqueName("frisch");
    await page.fill("#dlg-create input[name=name]", name);
    await Promise.all([page.waitForNavigation(), page.click("#dlg-create .dialog-submit")]);
    expect(page.url()).toMatch(new RegExp(`/edit/${ADMIN.username}/${name}\\.xlsx$`));
  });

  test("eine frisch angelegte Datei geht an dieselbe Stelle wie eine angeklickte",
    async ({ page }) => {
      // Nach dem Anlegen kommt ?open= zurueck. Das lief frueher an der Runtime
      // vorbei direkt ins gezeichnete Fenster — die neue Datei landete also
      // woanders als dieselbe Datei einen Klick spaeter. Eine Schleife kann
      // daraus nicht werden: ?open= entsteht nur im Redirect von /create, und
      // die Anwendung, die daraufhin startet, bekommt /edit/... ohne die Marke.
      await stelleVoltageNach(page, true);
      await loginAsAdmin(page);
      await waitAppReady(page);

      const name = uniqueName("frischdoc");
      await page.click("#app-menu-btn");
      await page.click('#app-panel [data-create="docx"]');
      await page.fill("#dlg-create input[name=name]", name);
      await Promise.all([page.waitForNavigation(), page.click("#dlg-create .dialog-submit")]);
      await waitAppReady(page);

      // ABSOLUT, nicht nur "enthaelt /edit/...": die Runtime prueft die Adresse gegen
      // die Basis ihrer App und weist einen blossen Pfad ab. Genau daran scheiterte
      // die frisch angelegte Datei, waehrend ein Klick funktionierte — der eine
      // Aufrufer liefert a.href, der andere baute aus BASE_URL, und das ist ein Pfad.
      await expect.poll(() => page.evaluate(() => window.__voltageAufrufe)).toEqual([
        `${BASE_URL}/edit/${ADMIN.username}/${name}.docx`,
      ]);
      await expect(page.locator("#editor-win")).toBeHidden();
      expect(page.url()).not.toContain("open=");
    });

  test("ohne ?neu= bleibt es beim bisherigen Weg in die Liste", async ({ page }) => {
    // Im Browser aendert sich nichts: der Knopf in der Titelleiste legt an und
    // oeffnet im gezeichneten Fenster, wie bisher.
    await loginAsAdmin(page);
    await waitAppReady(page);
    const name = uniqueName("normal");
    await page.click("#app-menu-btn");
    await page.click('#app-panel [data-create="docx"]');
    await expect(page.locator("#dlg-create-ganzseitig")).toHaveValue("");
    await page.fill("#dlg-create input[name=name]", name);
    await Promise.all([page.waitForNavigation(), page.click("#dlg-create .dialog-submit")]);
    expect(page.url()).not.toContain("/edit/");
  });

  test("ein unbekanntes ?neu= tut gar nichts", async ({ page }) => {
    // Relay kann nur anlegen, wofuer es eine Vorlage hat (backend/blank/).
    // Ein PDF gehoert nicht dazu — der Dialog bleibt zu statt leer aufzugehen.
    await loginAsAdmin(page);
    await page.goto("/?neu=pdf");
    await waitAppReady(page);
    await expect(page.locator("#dlg-create")).toBeHidden();
  });

  test("ein Deep-Link ueberlebt die Anmeldung", async ({ page, browser }) => {
    // Beim ERSTEN Start steht die Anmeldung noch aus. Ging die Query dabei
    // verloren, landete man auf der Dateiliste statt im Anlegen-Dialog.
    const ctx = await browser.newContext();
    const frisch = await ctx.newPage();
    await frisch.goto("/?neu=docx");
    expect(frisch.url()).toContain("/login");
    expect(decodeURIComponent(frisch.url())).toContain("neu=docx");
    await ctx.close();
  });

  test("forcesave gilt nur fuer wen, der die Datei bearbeiten darf", async ({ page, browser }) => {
    // Ohne Pruefung koennte jeder Angemeldete das Speichern fremder Sitzungen
    // ausloesen. Die Route sagt nur, WER anfragt — ob der auch an DIESE Datei
    // darf, muss sie selbst nachsehen.
    await loginAsAdmin(page);
    const fremd = await createUser(page, { display: "Ohne Zugriff" });
    const name = `${uniqueName("geheim")}.docx`;
    await uploadFile(page, name);

    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await login(p, fremd.username, fremd.password);
    const status = await p.evaluate(async (u) => {
      const csrf = document.querySelector('meta[name="csrf-token"]').content;
      const r = await fetch(`/forcesave/${u.owner}/${u.name}`, {
        method: "POST", headers: { "X-CSRF-Token": csrf }, credentials: "same-origin",
      });
      return r.status;
    }, { owner: ADMIN.username, name });
    expect(status).toBe(403);
    await ctx.close();
  });

  test("Strg+Klick bleibt der Weg in einen eigenen Tab", async ({ page, context }) => {
    // Der Klick-Handler faengt NUR den einfachen Linksklick ab — wer bewusst
    // einen neuen Tab will, soll ihn bekommen.
    await loginAsAdmin(page);
    const name = `${uniqueName("tab")}.docx`;
    await uploadFile(page, name);
    await waitAppReady(page);

    // Beobachter GANZ am Ende der Kette: der Handler von relay haengt am
    // document, ein Lauscher am window laeuft danach und sieht deshalb, ob
    // jemand den Klick an sich genommen hat (preventDefault).
    await page.evaluate(() => {
      window.__strgKlick = null;
      window.addEventListener("click", (e) => {
        const a = e.target.closest && e.target.closest("a.fname");
        if (a) window.__strgKlick = { verhindert: e.defaultPrevented, ziel: a.href };
      });
    });

    await fileRow(page, name).locator("a.fname").click({ modifiers: ["ControlOrMeta"] });

    // Geprueft wird zuerst, was UNS gehoert: der Klick ist ungehindert beim
    // Browser angekommen, und zwar mit der Editor-Adresse als Ziel.
    const klick = await page.evaluate(() => window.__strgKlick);
    expect(klick, "der Klick hat den Beobachter erreicht").not.toBeNull();
    expect(klick.verhindert, "relay darf den Strg-Klick nicht abfangen").toBe(false);
    expect(klick.ziel).toContain(`/edit/${ADMIN.username}/${name}`);
    // ... und das gezeichnete Fenster ist NICHT aufgegangen
    await expect(page.locator("#editor-win")).toBeHidden();

    // Der Browser hat daraus einen eigenen Tab gemacht. Dessen ADRESSE wird
    // bewusst nicht abgewartet: auf dem CI-Runner bleibt dieser
    // Hintergrund-Tab auf "about:blank" stehen und navigiert auch nach 15 s
    // nicht, waehrend er das hier — selbst auf einem einzelnen Kern — immer
    // binnen Sekunden tut. Was der Browser mit einem freigegebenen Klick
    // anstellt, ist seine Sache; unsere ist die Zusage darueber.
    await expect.poll(() => context.pages().length, { timeout: 10000 }).toBe(2);
    for (const p of context.pages()) if (p !== page) await p.close();
  });

  test("Relay laesst sich nur von Relay selbst einbetten", async ({ page }) => {
    // Die Voraussetzung fuer das ganze Fenster: frame-ancestors 'self'.
    // 'none' verbot auch das Einbetten durch uns selbst, '*' waere eine
    // offene Tuer fuer Clickjacking.
    await loginAsAdmin(page);
    const h = (await page.request.get(`${BASE_URL}/`)).headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  });
});
