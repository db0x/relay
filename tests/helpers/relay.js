// Gemeinsame Bausteine der E2E-Suite: Anmelden, Nutzer anlegen, Datei
// hochladen, freigeben. Bewusst ueber die echte Oberflaeche (Klicks statt
// direkter POSTs) -- die Tests sollen den Weg gehen, den auch ein Mensch geht.
// Ausnahme sind die Autorisierungs-Negativtests: die schicken absichtlich
// direkte Requests an der Oberflaeche vorbei (siehe expectStatus unten).
const { expect } = require("@playwright/test");

// Der Bootstrap-Admin, den app.js bei leerer Datenbank anlegt.
const ADMIN = { username: "admin", password: "admin" };

// Eindeutige, fuer Relay gueltige Namen (secureFilename in storage.js erlaubt
// nur A-Za-z0-9._-). Zaehler zusaetzlich zur Zeit, damit auch zwei Aufrufe in
// derselben Millisekunde verschieden bleiben.
let counter = 0;
function uniqueName(prefix) {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

async function login(page, username, password) {
  await page.goto("/login");
  await page.fill("input[name=username]", username);
  await page.fill("input[name=password]", password);
  await Promise.all([page.waitForNavigation(), page.click("form button")]);
}

async function loginAsAdmin(page) {
  await login(page, ADMIN.username, ADMIN.password);
  await expect(page.locator(".uname")).toBeVisible();
}

async function logout(page) {
  await page.goto("/logout");
}

// Topbar-Menue oeffnen und einen Dialog daraus starten (z.B. "dlg-users").
async function openMenuDialog(page, dialogId) {
  await page.click(".menu-btn");
  await page.click(`[data-dialog="${dialogId}"]`);
  await expect(page.locator(`#${dialogId}`)).toBeVisible();
}

// Legt einen Nutzer ueber die Nutzerverwaltung an (nur als Admin moeglich).
// Gibt {username, display, password} zurueck, damit Tests damit weiterarbeiten.
async function createUser(page, { username, display, password = "geheim123", admin = false } = {}) {
  const name = username || uniqueName("u");
  const shown = display || `Test ${name}`;
  await openMenuDialog(page, "dlg-users");
  const form = page.locator("form.user-create");
  await form.locator("input[name=username]").fill(name);
  await form.locator("input[name=display]").fill(shown);
  await form.locator("input[name=password]").fill(password);
  if (admin) await form.locator("input[name=admin]").check();
  await Promise.all([page.waitForNavigation(), form.locator("button").click()]);
  return { username: name, display: shown, password };
}

// Laedt eine Datei hoch. Inhalt ist beliebig -- die Suite prueft unsere
// Datei-/Freigabe-Logik, nicht das Office-Format (das ist OnlyOffice-Sache).
// Der Datei-Input ist versteckt (ein Knopf loest ihn aus); setInputFiles
// kommt damit klar, und das change-Event schickt das Formular selbst ab.
async function uploadFile(page, filename, content = "Relay E2E") {
  await Promise.all([
    page.waitForNavigation(),
    page.locator(".upload-form input[type=file]").setInputFiles({
      name: filename,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(content),
    }),
  ]);
}

// Die Tabellenzeile zu einem Dateinamen (fuer Zeilenmenue, Badges, Sichtbarkeit).
function fileRow(page, filename) {
  return page.locator("table.files tbody tr").filter({ hasText: filename });
}

// Zeilen-Kontextmenue oeffnen und einen Eintrag anklicken.
async function openRowMenu(page, filename) {
  const row = fileRow(page, filename);
  await row.locator(".row-menu-btn").click();
  return row;
}

// Datei fuer einen anderen Nutzer freigeben ("edit" oder "view").
async function shareFile(page, filename, targetUsername, perm = "edit") {
  const row = await openRowMenu(page, filename);
  await row.locator('[data-dialog^="dlg-share-"]').click();
  const dlg = page.locator('dialog[id^="dlg-share-"][open]');
  await expect(dlg).toBeVisible();
  await dlg.locator("select[name=target]").selectOption(targetUsername);
  await dlg.locator("select[name=perm]").selectOption(perm);
  await Promise.all([page.waitForNavigation(), dlg.locator("button.dialog-action").click()]);
}

// Freigabe wieder entziehen. Laeuft ueber die Rueckfrage (form[data-confirm]),
// deshalb muss danach noch der gemeinsame Bestaetigungsdialog quittiert werden.
async function unshareFile(page, filename, targetDisplayName) {
  const row = await openRowMenu(page, filename);
  await row.locator('[data-dialog^="dlg-share-"]').click();
  const dlg = page.locator('dialog[id^="dlg-share-"][open]');
  await expect(dlg).toBeVisible();
  const entry = dlg.locator(".share-list li").filter({ hasText: targetDisplayName });
  await entry.locator("form.unshare-form button").click();
  await confirmDialog(page);
}

// Datei loeschen (Zeilenmenue -> Loeschen -> Rueckfrage bestaetigen).
async function deleteFile(page, filename) {
  const row = await openRowMenu(page, filename);
  await row.locator("form.del-form button").click();
  await confirmDialog(page);
}

// Der gemeinsame Bestaetigungsdialog aller form[data-confirm] (js/core/confirm.js).
async function confirmDialog(page) {
  await expect(page.locator("#dlg-confirm")).toBeVisible();
  await Promise.all([
    page.waitForNavigation(),
    page.click("#dlg-confirm-ok"),
  ]);
}

// Prueft eine Statusmeldung. Der Tray blendet sich nach 2,5s selbst aus und
// bekommt dann `hidden` -- toContainText liest textContent und funktioniert
// deshalb auch danach noch (kein Wettlauf gegen die Animation).
async function expectFlash(page, text) {
  await expect(page.locator(".flash-tray")).toContainText(text);
}

// Direkter Request an der Oberflaeche vorbei, mit der Session des Kontexts.
// Genau so pruefen wir die SERVER-Regel -- nicht nur den ausgeblendeten Knopf.
async function expectStatus(page, method, url, status) {
  const res = method === "post"
    ? await page.request.post(url, { maxRedirects: 0 })
    : await page.request.get(url, { maxRedirects: 0 });
  expect(res.status(), `${method.toUpperCase()} ${url}`).toBe(status);
  return res;
}

// Formular-POST unter Umgehung der Oberflaeche (fuer Autorisierungstests:
// "der Knopf ist ausgeblendet -- lehnt der Server es auch selbst ab?").
//
// maxRedirects:0 ist wichtig: die Routen antworten mit Redirect auf "/", und
// wuerde der Request dem folgen, wuerde er die Statusmeldung schon selbst
// abholen -- ein anschliessendes expectFlash(page, ...) faende dann nichts mehr.
async function postForm(page, url, form) {
  return page.request.post(url, { form, maxRedirects: 0 });
}

module.exports = {
  ADMIN,
  uniqueName,
  login,
  loginAsAdmin,
  logout,
  openMenuDialog,
  createUser,
  uploadFile,
  fileRow,
  openRowMenu,
  shareFile,
  unshareFile,
  deleteFile,
  confirmDialog,
  expectFlash,
  expectStatus,
  postForm,
};
