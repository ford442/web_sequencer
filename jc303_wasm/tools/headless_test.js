const puppeteer = require('puppeteer');

(async () => {
  const logs = [];
  const errors = [];
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);

  page.on('console', msg => {
    const text = `[console:${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });
  page.on('pageerror', err => {
    const text = `[pageerror] ${err.toString()}`;
    errors.push(text);
    console.error(text);
  });
  page.on('error', err => {
    const text = `[error] ${err.toString()}`;
    errors.push(text);
    console.error(text);
  });

  const url = process.argv[2] || 'http://localhost:8000/index.html';
  console.log('Opening', url);

  // Inject console.error override early so Error objects print .stack
  await page.evaluateOnNewDocument(() => {
    const orig = console.error.bind(console);
    console.error = function(...args) {
      const mapped = args.map(a => (a && a.stack) ? a.stack : a);
      orig(...mapped);
    };
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.warn('page.goto warning:', e.toString());
  }

  // Click init button
  try {
    await page.waitForSelector('#init-button', { timeout: 15000 });
    console.log('Clicking init button');
    await page.click('#init-button');
  } catch (e) {
    console.error('init button error:', e.toString());
    errors.push('init button error: ' + e.toString());
  }

  // Wait for logs or any errors (give it 10s)
  await new Promise(resolve => setTimeout(resolve, 10000));

  await browser.close();

  if (errors.length > 0) {
    console.error('Errors captured:', errors);
    process.exit(2);
  }

  console.log('Logs captured:', logs.length);
  process.exit(0);
})();
