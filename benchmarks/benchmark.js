const { chromium } = require('playwright');
const { spawn } = require('child_process');

(async () => {
  // Start local server to serve mlb.html
  const server = spawn('python3', ['-m', 'http.server', '8081']);

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:8081/mlb.html');

  // Wait for initial render
  await page.waitForTimeout(1000);

  // Run benchmark
  const result = await page.evaluate(() => {
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      // simulate switching between 'games' and 'potd'
      const tab = i % 2 === 0 ? 'potd' : 'games';
      switchTab(tab);
    }
    return performance.now() - start;
  });

  console.log(`Benchmark completed in: ${result} ms`);

  await browser.close();
  server.kill();
})();
