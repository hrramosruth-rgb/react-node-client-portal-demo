const { chromium } = require("playwright");
const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
process.chdir(root);
(async () => {
  const { createApp } = await import(root + "/server/app.js");
  const dir = fs.mkdtempSync("/private/tmp/portal-account-");
  const server = createApp({ path: path.join(dir, "data.json") }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((resolve) => server.once("listening", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole("button", { name: "Open workspace" }).click();
    await page
      .getByRole("heading", { name: "Your projects, in focus." })
      .waitFor();
    const initial = await page.evaluate(async () => {
      const r = await fetch("/api/projects");
      return r.json();
    });
    const names = initial.projects.map((p) => p.name);
    assert.ok(names.length > 0);
    await page.evaluate(() =>
      fetch("/api/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    await page.getByRole("button", { name: /Refresh/ }).click();
    await page.getByRole("button", { name: "Open workspace" }).waitFor();
    await page.locator("select").selectOption("south@demo.test");
    await page.route("**/api/projects", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Regression simulated refresh failure" }),
      }),
    );
    await page.getByRole("button", { name: "Open workspace" }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Regression simulated refresh failure" })
      .waitFor();
    for (const name of names)
      assert.equal(
        await page.getByText(name, { exact: true }).count(),
        0,
        "Previous client project must never appear after account switch: " +
          name,
      );
    console.log(
      "Account-switch regression PASS: failed new-account refresh never reveals prior workspace data.",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
