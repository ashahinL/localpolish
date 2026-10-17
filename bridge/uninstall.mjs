import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOST_NAME, WINDOWS_REGISTRY_KEYS } from './constants.mjs';
import { supportDir } from './lib.mjs';

/**
 * @param {{ home: string, platform?: NodeJS.Platform }} opts
 */
export function uninstallBridge({ home, platform = process.platform }) {
  if (platform !== 'win32') {
    const manifestPath = path.join(
      home,
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
    fs.rmSync(manifestPath, { force: true });
  }
  fs.rmSync(supportDir(home, platform), { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  uninstallBridge({ home: os.homedir() });
  if (process.platform === 'win32') {
    for (const key of WINDOWS_REGISTRY_KEYS) {
      spawnSync('reg', ['delete', key, '/f'], { stdio: 'ignore' });
    }
  }
}
