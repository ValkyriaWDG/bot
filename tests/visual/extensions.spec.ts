import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { ExtensionsReport } from '../../scripts/extensions-lab.js';

test('shows recorded production output, keyboard selection and safe failure evidence', async ({
  page,
}) => {
  const report: ExtensionsReport = JSON.parse(
    await readFile('.local/lab/extensions-report.json', 'utf8'),
  );
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4178/')) external.push(request.url());
  });
  await page.goto('/extensions#signup-join-cs');
  await expect(page.locator('#scenario-status')).toContainText('PASSED');
  const scenario = report.scenarios.find((s) => s.id === 'signup-join-cs')!;
  await expect(page.locator('#messages')).toContainText(scenario.responses.at(-1)!.content);
  await page.getByLabel('Recorded scenario').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scenario-title')).toHaveText(report.scenarios[1]!.title);
  expect(external).toEqual([]);
  const selected = report.scenarios[0]!;
  selected.checks[0]!.passed = false;
  selected.responses = [
    {
      content: '<img src=x onerror=alert(1)> @everyone',
      components: [],
      allowedMentions: { parse: [] },
    },
  ];
  await page.route('**/extensions-report.json', (route) => route.fulfill({ json: report }));
  await page.goto(`/extensions#${selected.id}`);
  await page.reload();
  await expect(page.locator('#run-status')).toContainText('FAILURES');
  await expect(page.locator('#scenario-status')).toContainText('FAILED');
  await expect(page.locator('#messages')).toContainText('<img src=x');
  await expect(page.locator('#messages img')).toHaveCount(0);
});

test('captures Czech and English publication/signup states at desktop and mobile sizes', async ({
  page,
  browser,
}, testInfo) => {
  const bytes = await readFile('.local/lab/extensions-report.json');
  const report: ExtensionsReport = JSON.parse(bytes.toString('utf8'));
  expect(report.summary.failed).toBe(0);
  const specs = [
    { id: 'fixture-cs', file: '01-match-cs.png', width: 1440, height: 1000 },
    { id: 'result-en', file: '02-result-en.png', width: 1440, height: 1000 },
    { id: 'status-stale-cs', file: '03-stale-status-cs.png', width: 1440, height: 1000 },
    { id: 'signup-unknown-en', file: '04-signup-unknown-en.png', width: 390, height: 844 },
    { id: 'signup-join-cs', file: '05-signup-joined-cs.png', width: 390, height: 844 },
  ];
  const captures = [];
  await mkdir('.local/lab/extensions-screenshots', { recursive: true });
  for (const spec of specs) {
    const scenario = report.scenarios.find((s) => s.id === spec.id)!;
    expect(scenario).toBeDefined();
    await page.setViewportSize({ width: spec.width, height: spec.height });
    await page.goto(`/extensions#${spec.id}`);
    await expect(page.locator('#scenario-title')).toHaveText(scenario.title);
    await expect(page.locator('#scenario-status')).toContainText('PASSED');
    await expect(page.locator('.simulation-banner')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const path = `.local/lab/extensions-screenshots/${spec.file}`;
    const png = await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    await testInfo.attach(spec.file, { path, contentType: 'image/png' });
    captures.push({
      file: spec.file,
      scenarioId: spec.id,
      viewport: { width: spec.width, height: spec.height },
      caption: `Synthetic Discord lab — local viewer, not Discord. ${scenario.title}; actual recorded production output.`,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
  }
  await writeFile(
    '.local/lab/extensions-captures.json',
    JSON.stringify(
      {
        evidenceKind: report.evidenceKind,
        capturedAt: new Date().toISOString(),
        sourceRevision: report.revision.sha,
        sourceDirty: report.revision.dirty,
        viewerRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        viewerDirty:
          execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
        reportSha256: createHash('sha256').update(bytes).digest('hex'),
        browser: `Chromium ${browser.version()}`,
        platform: process.platform,
        captures,
      },
      null,
      2,
    ) + '\n',
  );
});
