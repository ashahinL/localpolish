import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';

export const EXTENSION_ID = 'ealpmjmaclnlpelpcacmbicmdipmbeei';

export function extensionWorker(context: BrowserContext): Worker | undefined {
  return context.serviceWorkers().find((worker) => worker.url().includes(EXTENSION_ID));
}

export function assertBrowserLaunchAllowed(): void {
  if (process.platform === 'darwin' && process.env.CODEX_SANDBOX === 'seatbelt') {
    throw new Error(
      'Chrome extension tests cannot run in the macOS Codex sandbox. Run browser checks through the unrestricted reviewer.',
    );
  }
}

// --single-process prevents extension service workers from starting.
export async function launchExtension(dist: string): Promise<{
  context: BrowserContext;
  close(): Promise<void>;
}> {
  assertBrowserLaunchAllowed();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-extension-'));
  try {
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    return {
      context,
      async close() {
        try {
          await context.close();
        } finally {
          fs.rmSync(profile, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    fs.rmSync(profile, { recursive: true, force: true });
    throw error;
  }
}
