/* global document, window */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve, sep, extname } from 'node:path';

// Usage: node scripts/preview-presskit.mjs <installed-playwright-package.json> <fresh-evidence-dir>
const [packageFile, outputDirectory] = process.argv.slice(2);
assert.ok(
  packageFile && outputDirectory,
  'Supply a Playwright package.json and fresh evidence directory.',
);
const root = await realpath(process.cwd());
const output = resolve(outputDirectory);
await mkdir(output, { recursive: true });
const reportPath = resolve(output, 'preview-proof.json');
await writeFile(
  reportPath,
  JSON.stringify({ status: 'running', startedAt: new Date().toISOString() }),
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const htmlPath = 'docs/assets/presskit-preview.html';
const catalogPath = 'assets/presskit/wardogs-january-2026/catalog.json';
const catalogBytes = await readFile(catalogPath);
const catalog = JSON.parse(catalogBytes);
const allowedPaths = new Set([
  htmlPath,
  ...catalog.assets.map((asset) => asset.path),
  ...['help-cs', 'help-en', 'status-unknown-cs', 'status-stale-en'].map(
    (id) => `docs/assets/examples/${id}.json`,
  ),
]);
const report = {
  schemaVersion: 1,
  kind: 'offline-presskit-catalog-capture',
  status: 'running',
  startedAt: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  catalogSha256: digest(catalogBytes),
  previewSha256: digest(await readFile(htmlPath)),
  harnessSha256: digest(await readFile(new URL(import.meta.url))),
  sourceFiles: [],
  servedFiles: {},
  captures: [],
  fixtureChecks: [],
  pageErrors: [],
  blockedExternalRequests: [],
};
const mime = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
    assert.ok(allowedPaths.has(name));
    assert.ok(mime[extname(name)]);
    const filename = await realpath(resolve(root, name));
    assert.ok(filename.startsWith(root + sep));
    const bytes = await readFile(filename);
    report.servedFiles[name] = { sha256: digest(bytes), bytes: bytes.length };
    response.writeHead(200, { 'Content-Type': mime[extname(name)], 'Cache-Control': 'no-store' });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  for (const asset of catalog.assets) {
    const bytes = await readFile(asset.path);
    assert.equal(digest(bytes), asset.sha256);
    report.sourceFiles.push({ path: asset.path, sha256: asset.sha256, bytes: bytes.length });
  }
  const { chromium } = createRequire(resolve(packageFile))('@playwright/test');
  browser = await chromium.launch({ headless: true });
  report.browser = `Chromium ${browser.version()}`;
  const page = await browser.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    report.blockedExternalRequests.push(route.request().url());
    return route.abort();
  });
  for (const viewport of [
    { width: 1440, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/${htmlPath}`, { waitUntil: 'networkidle' });
    if (await page.locator('#example-select').count()) {
      for (const id of ['help-cs', 'help-en', 'status-unknown-cs', 'status-stale-en']) {
        const fixture = JSON.parse(await readFile(`docs/assets/examples/${id}.json`));
        assert.deepEqual(fixture.response.allowed_mentions, { parse: [] });
        for (const binding of fixture.assetBindings) {
          assert.ok(catalog.assets.some((asset) => asset.path === binding.repositoryPath));
          assert.ok(
            fixture.response.attachments.some(
              (attachment) =>
                attachment.id === binding.attachmentId && attachment.filename === binding.filename,
            ),
          );
        }
        await page.selectOption('#example-select', id);
        await page.waitForFunction((content) => {
          const panel = document.querySelector('#example-panel');
          return !panel.hidden && panel.textContent.includes(content);
        }, fixture.response.content);
        assert.equal(await page.locator('#example-panel').getAttribute('lang'), fixture.locale);
        assert.equal(await page.locator('#example-error').isVisible(), false);
        report.fixtureChecks.push({
          id,
          viewport,
          locale: fixture.locale,
          attachmentBindings: 'passed',
          rendered: true,
        });
      }
      const selected = viewport.width > 1000 ? 'status-unknown-cs' : 'status-stale-en';
      await page.selectOption('#example-select', selected);
      await page.waitForFunction(
        (id) =>
          document.querySelector('#example-source').getAttribute('href').endsWith(`${id}.json`) &&
          !document.querySelector('#example-panel').hidden,
        selected,
      );
    }
    await page.waitForFunction(
      () =>
        document.images.length > 0 &&
        [...document.images].every((img) => img.complete && img.naturalWidth > 0),
    );
    // Decoded off-screen images can still have deferred paint in a full-page capture.
    await page.evaluate(async () => {
      const painted = () =>
        new Promise((done) =>
          window.requestAnimationFrame(() => window.requestAnimationFrame(done)),
        );
      for (const img of document.images) {
        img.loading = 'eager';
        await img.decode();
        img.scrollIntoView({ block: 'center', behavior: 'instant' });
        await painted();
      }
      window.scrollTo({ top: 0, behavior: 'instant' });
      await painted();
    });
    const state = await page.evaluate(() => ({
      images: [...document.images].map((img) => ({
        path: new URL(img.src).pathname.slice(1),
        width: img.naturalWidth,
        height: img.naturalHeight,
        alt: img.alt,
      })),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      text: document.body.innerText,
    }));
    assert.equal(state.horizontalOverflow, false, 'Preview must not overflow its viewport.');
    assert.match(state.text, /not (?:the website|discord)/i);
    for (const asset of catalog.assets)
      assert.ok(
        state.images.some((img) => img.path === asset.path),
        `Missing rendered asset: ${asset.path}`,
      );
    const name = `catalog-${viewport.width}x${viewport.height}.jpg`;
    const bytes = await page.screenshot({
      path: resolve(output, name),
      fullPage: true,
      type: 'jpeg',
      quality: 85,
    });
    report.captures.push({
      filename: name,
      viewport,
      sha256: digest(bytes),
      bytes: bytes.length,
      images: state.images,
      horizontalOverflow: state.horizontalOverflow,
      caption:
        'Actual local asset-catalog screenshot. This is not the website or a live Discord client.',
    });
  }
  assert.equal(report.pageErrors.length, 0);
  assert.equal(report.blockedExternalRequests.length, 0);
  for (const asset of catalog.assets)
    assert.equal(digest(await readFile(asset.path)), asset.sha256);
  for (const [name, file] of Object.entries(report.servedFiles))
    assert.equal(digest(await readFile(name)), file.sha256);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
  report.completedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: report.status,
      captures: report.captures.length,
      error: report.error,
    }),
  );
}
