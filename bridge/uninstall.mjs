import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOST_NAME } from './constants.mjs';

/**
 * @param {{ home: string }} opts
 */
export function uninstallBridge({ home }) {
  const manifestPath = path.join(
    home,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts',
    `${HOST_NAME}.json`,
  );
  const supportDir = path.join(home, 'Library', 'Application Support', 'LocalPolish');
  fs.rmSync(manifestPath, { force: true });
  fs.rmSync(supportDir, { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  uninstallBridge({ home: os.homedir() });
}
