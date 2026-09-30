const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173/?e2e=1');
  console.log(await page.title());
  await browser.close();
})();
