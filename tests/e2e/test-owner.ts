import { type Page } from '@playwright/test';

interface TestFixture {
  __testPorts: Array<{ disconnected: boolean; disconnects: number; reply(result: unknown): void }>;
  __holdSaves: boolean;
  __saveHeld: Array<() => void>;
}

export function testPorts(
  page: Page,
): Promise<Array<{ disconnected: boolean; disconnects: number }>> {
  return page.evaluate(() =>
    (window as unknown as TestFixture).__testPorts.map(({ disconnected, disconnects }) => ({
      disconnected,
      disconnects,
    })),
  );
}

export async function replyToTest(page: Page, index: number, sample: string): Promise<void> {
  await page.evaluate(
    async ({ index, sample }) => {
      (window as unknown as TestFixture).__testPorts[index]!.reply({ ok: true, sample, ms: 100 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    { index, sample },
  );
}

export function holdSaves(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as TestFixture).__holdSaves = true;
  });
}

export function heldSaves(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as TestFixture).__saveHeld.length);
}

export function releaseSaves(page: Page): Promise<void> {
  return page.evaluate(() => {
    const fixture = window as unknown as TestFixture;
    fixture.__holdSaves = false;
    fixture.__saveHeld.splice(0).forEach((save) => save());
  });
}
