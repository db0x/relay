const { chromium } = require("@playwright/test");
const B = "http://localhost:5992";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 900, height: 900 });
  await p.goto(B + "/login");
  await p.fill("input[name=username]", "admin");
  await p.fill("input[name=password]", "start-passwort-lang");
  await Promise.all([p.waitForNavigation(), p.click("button")]);
  await p.waitForTimeout(400);
  console.log("gelandet auf:", p.url());
  await p.screenshot({ path: "/dev/shm/zwei-einrichten.png", fullPage: true });
  await b.close();
})();
