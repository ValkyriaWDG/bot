import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { LabReport } from '../lab/report.js';
import { captureEvidence } from './capture.js';

const reportPath = process.env.LAB_REPORT_FILE || '.local/lab/report.json';

test('renders actual scenario results, filters and navigates with keyboard without external requests', async ({
  page,
}) => {
  const external: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4178/')) external.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const report: LabReport = JSON.parse(await readFile(reportPath, 'utf8'));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Bot Lab/ })).toBeVisible();
  await expect(page.locator('#total')).toHaveText(String(report.summary.total));
  await expect(page.locator('#failed')).toHaveText('0');
  await expect(page.locator('.simulation-banner')).toContainText('SIMULATED DISCORD');
  await page.getByRole('searchbox').fill('help-en');
  const help = report.scenarios.find((scenario) => scenario.id === 'help-en');
  expect(help).toBeDefined();
  const channel = page.locator('[data-scenario="help-en"]');
  await channel.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#scenario-title')).toHaveText(help!.title);
  const botMessage = help!.messages.find((message) => message.speaker === 'bot')!;
  await expect(page.locator('.message.bot .message-content').first()).toHaveText(
    botMessage.content,
  );
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('treats member content as text and derives failure badges from failed assertions', async ({
  page,
}) => {
  const report: LabReport = JSON.parse(await readFile(reportPath, 'utf8'));
  const scenario = report.scenarios[0]!;
  scenario.messages.push({
    speaker: 'member',
    displayName: 'Synthetic input',
    content: '<img src=x onerror="window.labInjected=true"> @everyone',
  });
  scenario.checks[0]!.passed = false;
  await page.route('**/report.json', (route) => route.fulfill({ json: report }));
  await page.goto('/');
  await expect(page.locator('#run-status')).toContainText('FAILURES');
  await expect(page.locator('#scenario-status')).toContainText('FAILED');
  await expect(page.locator('#messages')).toContainText('<img src=x onerror=');
  await expect(page.locator('#messages img')).toHaveCount(0);
  expect(await page.evaluate(() => 'labInjected' in window)).toBe(false);
});

test('captures captioned desktop and mobile scenario evidence from the generated report', async ({
  page,
  browser,
}, testInfo) => {
  const bytes = await readFile(reportPath);
  const report: LabReport = JSON.parse(bytes.toString('utf8'));
  expect(report.summary.failed).toBe(0);
  const specs = [
    { id: 'status', name: '01-overview', width: 1440, height: 1000 },
    { id: 'restart-confirm', name: '02-confirmed-restart', width: 1440, height: 1100 },
    { id: 'role-revoked', name: '03-role-revoked', width: 1440, height: 1100 },
    { id: 'unknown-outcome', name: '04-unknown-outcome', width: 1440, height: 1100 },
    { id: 'role-sync', name: '05-role-sync', width: 1440, height: 1100 },
    { id: 'help-en', name: '06-english-mobile', width: 390, height: 844 },
  ];
  const captures = [];
  await mkdir('.local/lab/screenshots', { recursive: true });
  for (const spec of specs) {
    const scenario = report.scenarios.find((item) => item.id === spec.id);
    expect(scenario, `Required screenshot scenario ${spec.id}`).toBeDefined();
    await page.setViewportSize({ width: spec.width, height: spec.height });
    await page.goto(`/#${spec.id}`);
    await expect(page.locator('#scenario-title')).toHaveText(scenario!.title);
    await expect(page.locator('#scenario-status')).toContainText('PASSED');
    await expect(page.locator('.simulation-banner')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const path = `.local/lab/screenshots/${spec.name}.png`;
    const screenshot = await captureEvidence(page, path);
    await testInfo.attach(spec.name, { path, contentType: 'image/png' });
    captures.push({
      file: `${spec.name}.png`,
      scenarioId: spec.id,
      title: scenario!.title,
      caption: `Synthetic Discord lab — local viewer, not Discord. ${scenario!.description}`,
      viewport: { width: spec.width, height: spec.height },
      sha256: createHash('sha256').update(screenshot).digest('hex'),
    });
  }
  const manifest = {
    evidenceKind: 'simulated-discord',
    capturedAt: new Date().toISOString(),
    captureMethod: 'Playwright page.screenshot with fullPage=true and animations=disabled',
    sourceRevision: report.sourceRevision,
    sourceDirty: report.sourceDirty,
    viewerRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    viewerDirty:
      execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    reportSha256: createHash('sha256').update(bytes).digest('hex'),
    browser: `Chromium ${browser.version()}`,
    platform: process.platform,
    captures,
  };
  await writeFile('.local/lab/captures.json', `${JSON.stringify(manifest, null, 2)}\n`);
});
