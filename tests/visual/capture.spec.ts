import { test, expect } from '@playwright/test';
import { captureEvidence } from './capture.js';

test('does not capture until the page has two rendering opportunities', async ({
  page,
}, testInfo) => {
  await page.setContent('<h1>Synthetic capture readiness fixture</h1>');
  await page.evaluate(() => {
    const callbacks: FrameRequestCallback[] = [];
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => callbacks.push(callback);
    Object.assign(window, {
      pendingFrames: () => callbacks.length,
      releaseFrame: () => callbacks.shift()!(performance.now()),
      restoreFrames: () => (window.requestAnimationFrame = original),
    });
  });
  let settled = false;
  const capture = captureEvidence(page, testInfo.outputPath('readiness.png'));
  // Handle rejection even when an assertion fails and Playwright closes the page.
  void capture.then(
    () => (settled = true),
    () => (settled = true),
  );
  await expect.poll(() => page.evaluate('window.pendingFrames()')).toBe(1);
  expect(settled).toBe(false);
  await page.evaluate('window.releaseFrame()');
  await expect.poll(() => page.evaluate('window.pendingFrames()')).toBe(1);
  expect(settled).toBe(false);
  await page.evaluate('window.releaseFrame(); window.restoreFrames()');
  const png = await capture;
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  expect(png.readUInt32BE(16)).toBe(1440);
  expect(png.readUInt32BE(20)).toBe(1000);
});
