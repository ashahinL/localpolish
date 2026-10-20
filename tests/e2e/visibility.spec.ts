import { expect, test } from '@playwright/test';
import { launchVisibilityBrowser } from './visibility-runtime';

test('real tab switches hide and restore the document and its editor frame', async () => {
  const browser = await launchVisibilityBrowser();
  try {
    const page = await browser.context.newPage();
    await page.setContent('<textarea></textarea><iframe srcdoc="<textarea></textarea>"></iframe>');
    await expect(page.locator('iframe')).toHaveCount(1);
    const cover = await browser.context.newPage();
    await cover.setContent('Other tab');
    const read = () =>
      Promise.all(
        page.frames().map((frame) =>
          frame.evaluate(() => ({
            hidden: document.hidden,
            state: document.visibilityState,
          })),
        ),
      );
    const visible = [
      { hidden: false, state: 'visible' },
      { hidden: false, state: 'visible' },
    ];
    const hidden = [
      { hidden: true, state: 'hidden' },
      { hidden: true, state: 'hidden' },
    ];
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.bringToFront();
      await expect.poll(read).toEqual(visible);
      await cover.bringToFront();
      await expect.poll(read).toEqual(hidden);
      await page.bringToFront();
      await expect.poll(read).toEqual(visible);
    }
  } finally {
    await browser.close();
  }
});
