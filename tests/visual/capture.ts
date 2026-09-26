import type { Page } from '@playwright/test';

export async function captureEvidence(page: Page, path: string): Promise<Buffer> {
  await page.bringToFront();
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (
      document.visibilityState !== 'visible' ||
      document.documentElement.clientWidth <= 0 ||
      document.documentElement.clientHeight <= 0
    ) {
      throw new Error('Evidence capture requires a visible page with positive layout dimensions.');
    }
    // DOM assertions can pass before a new Chromium surface is ready. Allow two
    // rendering opportunities; this is not a guarantee of compositor presentation.
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Evidence capture did not receive two animation frames.')),
        5_000,
      );
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.clearTimeout(timeout);
          resolve();
        });
      });
    });
  });
  // Keep capture failures fatal: no reloads, screenshot retries or partial proof.
  return page.screenshot({ path, fullPage: true, animations: 'disabled' });
}
