import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { assertBrowserLaunchAllowed } from './extension-runtime';

export async function launchVisibilityBrowser(extensionDir?: string): Promise<{
  context: BrowserContext;
  close(): Promise<void>;
}> {
  assertBrowserLaunchAllowed();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'localpolish-visibility-'));
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let closed: Promise<void> = Promise.resolve();
  let exited = false;
  let failure: Error | undefined;
  const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const stop = async () => {
    if (browser?.isConnected()) {
      try {
        const session = await browser.newBrowserCDPSession();
        await session.send('Browser.close');
      } catch {
        // Closing Chrome also closes the protocol connection.
      }
    }
    if (!exited && child?.pid) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          closed,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 2000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (!exited) {
        if (process.platform === 'win32') {
          await new Promise<void>((resolve, reject) => {
            const killer = spawn('taskkill', ['/pid', String(child!.pid), '/t', '/f']);
            killer.once('error', reject);
            killer.once('close', () => resolve());
          });
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
          }
        }
        await closed;
      }
    }
    await browser?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  };
  try {
    child = spawn(
      chromium.executablePath(),
      [
        `--user-data-dir=${profile}`,
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--headless=new',
        '--no-sandbox',
        ...(extensionDir
          ? [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
          : []),
        'about:blank',
      ],
      { stdio: 'ignore', detached: process.platform !== 'win32' },
    );
    closed = new Promise<void>((resolve) => {
      child!.once('error', (err) => {
        failure = err;
      });
      child!.once('close', () => {
        exited = true;
        resolve();
      });
    });
    const endpointFile = path.join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + 15_000;
    while (!fs.existsSync(endpointFile)) {
      if (failure) throw failure;
      if (exited || Date.now() >= deadline) throw new Error('Visibility browser did not start.');
      await pause(50);
    }
    const [port] = fs.readFileSync(endpointFile, 'utf8').split('\n');
    // The default Playwright connection enables focus emulation and keeps background tabs visible.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Visibility browser has no default context.');
    return { context, close: stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
