// Teilen von Dokumenten: der Kern der Nutzer-Isolation.
//
// Grundregel (access.js): jeder sieht nur die eigenen Dateien und die
// ausdruecklich fuer ihn freigegebenen. Getestet wird beides -- dass eine
// Freigabe wirklich ankommt UND dass ohne Freigabe nichts durchkommt, auch
// nicht ueber eine direkt aufgerufene URL.
const { test, expect } = require("@playwright/test");
const {
  login, loginAsAdmin, logout, createUser, uniqueName, uploadFile, fileRow,
  shareFile, unshareFile, deleteFile, expectFlash, expectStatus, postForm,
  openRowMenu, waitAppReady,
} = require("./helpers/relay");
const { BASE_URL } = require("./test-env");

// Zwei frische Nutzer pro Test: so kann kein Test die Freigaben eines anderen sehen.
async function twoUsers(page) {
  await loginAsAdmin(page);
  const alice = await createUser(page, { display: "Alice " + uniqueName("") });
  const bob = await createUser(page, { display: "Bob " + uniqueName("") });
  await logout(page);
  return { alice, bob };
}

// Eigener Browser-Kontext fuer den zweiten Nutzer (eigene Session/Cookies).
// baseURL wird explizit gesetzt -- manuell erzeugte Kontexte erben die
// `use`-Optionen aus der Konfiguration nicht.
async function openAs(browser, user) {
  const context = await browser.newContext({ baseURL: BASE_URL, locale: "de-DE" });
  const page = await context.newPage();
  await login(page, user.username, user.password);
  return { context, page };
}

test.describe("Freigaben", () => {
  let alice, bob, filename;

  test.beforeEach(async ({ page }) => {
    ({ alice, bob } = await twoUsers(page));
    filename = uniqueName("dok") + ".docx";
    await login(page, alice.username, alice.password);
    await uploadFile(page, filename);
  });

  test("hochgeladene Datei erscheint in der eigenen Liste", async ({ page }) => {
    await expect(fileRow(page, filename)).toBeVisible();
    // eigene Datei -> keine Fremd-Kennzeichnung
    await expect(fileRow(page, filename)).not.toHaveClass(/row-foreign/);
  });

  test("Freigabe zum Bearbeiten kommt beim Empfaenger an", async ({ page, browser }) => {
    await shareFile(page, filename, bob.username, "edit");
    await expectFlash(page, "freigegeben");
    // beim Besitzer als "geteilt" markiert
    await expect(fileRow(page, filename)).toContainText("geteilt");

    const { context, page: bobPage } = await openAs(browser, bob);
    const row = fileRow(bobPage, filename);
    await expect(row).toBeVisible();
    await expect(row).toContainText(alice.display);   // "von Alice …"
    await expect(row).not.toContainText("nur lesen"); // volles Bearbeiten-Recht
    await context.close();
  });

  test("Empfaenger darf herunterladen", async ({ page, browser }) => {
    await shareFile(page, filename, bob.username, "edit");
    const { context, page: bobPage } = await openAs(browser, bob);
    await expectStatus(bobPage, "get",
      `/download/${alice.username}/${encodeURIComponent(filename)}`, 200);
    await context.close();
  });

  test("Nur-lesen-Freigabe wird als solche angezeigt", async ({ page, browser }) => {
    await shareFile(page, filename, bob.username, "view");
    const { context, page: bobPage } = await openAs(browser, bob);
    await expect(fileRow(bobPage, filename)).toContainText("nur lesen");
    // lesen ja, aber es bleibt Alices Datei
    await expectStatus(bobPage, "get",
      `/download/${alice.username}/${encodeURIComponent(filename)}`, 200);
    await context.close();
  });

  test("Empfaenger darf die fremde Datei NICHT loeschen", async ({ page, browser }) => {
    await shareFile(page, filename, bob.username, "edit");
    const { context, page: bobPage } = await openAs(browser, bob);

    // In der Oberflaeche gibt es den Loeschen-Eintrag fuer fremde Dateien nicht …
    await fileRow(bobPage, filename).locator(".row-menu-btn").click();
    await expect(fileRow(bobPage, filename).locator("form.del-form")).toHaveCount(0);

    // … und der Server lehnt den direkten Versuch ebenfalls ab.
    await postForm(bobPage, `/delete/${alice.username}/${encodeURIComponent(filename)}`, {});
    await bobPage.goto("/");
    await expectFlash(bobPage, "Nur der Besitzer");

    // Datei ist noch da -- beim Besitzer wie beim Empfaenger
    await expect(fileRow(bobPage, filename)).toBeVisible();
    await page.reload();
    await expect(fileRow(page, filename)).toBeVisible();
    await context.close();
  });

  test("Freigabe entziehen nimmt den Zugriff sofort weg", async ({ page, browser }) => {
    await shareFile(page, filename, bob.username, "edit");
    const { context, page: bobPage } = await openAs(browser, bob);
    await expect(fileRow(bobPage, filename)).toBeVisible();

    await unshareFile(page, filename, bob.display);
    await expectFlash(page, "entzogen");

    await bobPage.reload();
    await expect(fileRow(bobPage, filename)).toHaveCount(0);
    await expectStatus(bobPage, "get",
      `/download/${alice.username}/${encodeURIComponent(filename)}`, 404);
    await context.close();
  });

  test("ohne Freigabe ist die fremde Datei unsichtbar und nicht abrufbar", async ({ browser }) => {
    // Kein shareFile() -- Bob hat mit dieser Datei nichts zu tun.
    const { context, page: bobPage } = await openAs(browser, bob);
    await expect(fileRow(bobPage, filename)).toHaveCount(0);
    // 404 statt 403: verraet nicht einmal, dass es die Datei gibt
    await expectStatus(bobPage, "get",
      `/download/${alice.username}/${encodeURIComponent(filename)}`, 404);
    await context.close();
  });

  test("ohne Anmeldung kommt niemand an die Datei", async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const anon = await context.newPage();
    const res = await anon.request.get(
      `/download/${alice.username}/${encodeURIComponent(filename)}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toContain("/login");
    await context.close();
  });

  test("Filter „Nur eigene Dateien“ blendet Freigegebenes aus", async ({ page, browser }) => {
    await shareFile(page, filename, bob.username, "edit");
    const { context, page: bobPage } = await openAs(browser, bob);

    // Geklickt wird das Label: die echte Checkbox liegt hinter dem
    // Custom-Switch (.switch-ui), genau wie ein Mensch es antippen wuerde.
    const filterSwitch = bobPage.locator(".list-footer .switch-label");
    await expect(fileRow(bobPage, filename)).toBeVisible();

    await filterSwitch.click();
    await expect(bobPage.locator("#own-only")).toBeChecked();
    await expect(fileRow(bobPage, filename)).toBeHidden();

    await filterSwitch.click();
    await expect(bobPage.locator("#own-only")).not.toBeChecked();
    await expect(fileRow(bobPage, filename)).toBeVisible();
    await context.close();
  });

  test("loescht der Besitzer die Datei, verschwindet auch die Freigabe", async ({ page, browser }) => {
    await shareFile(page, filename, bob.username, "edit");
    const { context, page: bobPage } = await openAs(browser, bob);
    await expect(fileRow(bobPage, filename)).toBeVisible();

    await deleteFile(page, filename);
    await expectFlash(page, "gelöscht");

    await bobPage.reload();
    await expect(fileRow(bobPage, filename)).toHaveCount(0);
    await expectStatus(bobPage, "get",
      `/download/${alice.username}/${encodeURIComponent(filename)}`, 404);
    await context.close();
  });

  test("Freigabe an sich selbst oder an Unbekannte wird abgelehnt", async ({ page }) => {
    await postForm(page, `/share/${encodeURIComponent(filename)}`,
      { target: alice.username, perm: "edit" });
    await page.goto("/");
    await expectFlash(page, "Unbekannter Nutzer");

    await postForm(page, `/share/${encodeURIComponent(filename)}`,
      { target: "gibtesnicht", perm: "edit" });
    await page.goto("/");
    await expectFlash(page, "Unbekannter Nutzer");
  });

  test("fremde Datei kann man nicht im eigenen Namen freigeben", async ({ page, browser }) => {
    const { context, page: bobPage } = await openAs(browser, bob);
    // Bob versucht, Alices Datei weiterzureichen -- accessFor() gibt ihm
    // fuer den eigenen Namensraum nichts, also "Datei nicht gefunden".
    await postForm(bobPage, `/share/${encodeURIComponent(filename)}`,
      { target: bob.username, perm: "edit" });
    await bobPage.goto("/");
    await expectFlash(bobPage, "nicht gefunden");
    await context.close();
  });
});

test.describe("Verwaltungszugänge sind keine Empfänger", () => {
  // Admins arbeiten ausschliesslich administrativ (Entscheidung 2026-08-07).
  // Sie sollen deshalb gar nicht erst auffindbar sein — weder in der
  // Freigabe-Auswahl noch bei den Personen einer Notiz.
  test("ein Admin steht nicht in der Freigabe-Auswahl", async ({ page }) => {
    await loginAsAdmin(page);
    const admin = await createUser(page, { admin: true });
    const normal = await createUser(page);
    await logout(page);

    await login(page, normal.username, normal.password);
    const datei = uniqueName("gemeinsam") + ".txt";
    await uploadFile(page, datei);
    const zeile = await openRowMenu(page, datei);
    await zeile.locator('[data-dialog^="dlg-share-"]').click();
    const auswahl = page.locator('dialog[id^="dlg-share-"][open] select[name=target]');
    await expect(auswahl.locator(`option[value="${admin.username}"]`)).toHaveCount(0);
    // die Auswahl ist nicht etwa leer — normale Nutzer stehen weiter drin
    await expect(auswahl.locator("option")).not.toHaveCount(0);
  });

  test("auch am Dialog vorbei nimmt der Server es nicht an", async ({ page }) => {
    await loginAsAdmin(page);
    const admin = await createUser(page, { admin: true });
    const normal = await createUser(page);
    await logout(page);

    await login(page, normal.username, normal.password);
    const datei = uniqueName("direkt") + ".txt";
    await uploadFile(page, datei);
    await postForm(page, `${BASE_URL}/share/${datei}`, { target: admin.username, perm: "edit" });
    await page.goto("/");
    await expectFlash(page, "Verwaltungszugänge können keine Freigaben empfangen");
  });

  test("ein Admin taucht nicht bei den Personen einer Notiz auf", async ({ page }) => {
    await loginAsAdmin(page);
    const admin = await createUser(page, { admin: true });
    const normal = await createUser(page);
    await logout(page);

    await login(page, normal.username, normal.password);
    await waitAppReady(page);
    // Die Vorschlagsliste steht als Datenliste im Markup (browse.js: knownUsers)
    const seite = await page.content();
    expect(seite, "Anzeigename des Admins darf nirgends stehen").not.toContain(admin.display);
    expect(seite).toContain(normal.display);
  });
});
