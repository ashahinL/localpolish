import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXTENSION_ID, HOST_NAME } from './constants.mjs';
import { findOnPath } from './lib.mjs';

const CLI_NAMES = ['claude', 'codex', 'grok'];
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

/**
 * @param {{ home: string, repoDir: string, nodePath: string, pathEnv: string }} opts
 * @returns {{
 *   wrapperPath: string,
 *   manifestPath: string,
 *   found: Record<'claude' | 'codex' | 'grok', string | null>,
 * }}
 */
export function installBridge({ home, repoDir, nodePath, pathEnv }) {
  /** @type {Record<'claude' | 'codex' | 'grok', string | null>} */
  const found = { claude: null, codex: null, grok: null };
  for (const name of CLI_NAMES) {
    found[name] = findOnPath(name, pathEnv);
  }

  /** @type {string[]} */
  const dirs = [];
  const addDir = (dir) => {
    if (dir && !dirs.includes(dir)) dirs.push(dir);
  };
  addDir(path.dirname(nodePath));
  for (const name of CLI_NAMES) {
    const bin = found[name];
    if (bin) addDir(path.dirname(bin));
  }
  for (const dir of SYSTEM_PATH) addDir(dir);

  const wrapperDir = path.join(home, 'Library', 'Application Support', 'LocalPolish');
  fs.mkdirSync(wrapperDir, { recursive: true });
  const wrapperPath = path.join(wrapperDir, 'localpolish-bridge');
  const wrapper = [
    '#!/bin/sh',
    `export PATH="${dirs.join(':')}"`,
    `exec "${nodePath}" "${path.join(repoDir, 'bridge', 'host.mjs')}"`,
    '',
  ].join('\n');
  fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
  fs.chmodSync(wrapperPath, 0o755);

  const manifestDir = path.join(
    home,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts',
  );
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `${HOST_NAME}.json`);
  const manifest = {
    name: HOST_NAME,
    description: 'LocalPolish bridge to local AI CLIs',
    path: wrapperPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { wrapperPath, manifestPath, found };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.platform !== 'darwin') {
    console.error('The LocalPolish bridge installer only supports macOS.');
    process.exit(1);
  }
  const repoDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const pathEnv = process.env.PATH ?? '';
  // process.execPath is the versioned Homebrew Cellar path, which breaks after `brew upgrade node`.
  const result = installBridge({
    home: os.homedir(),
    repoDir,
    nodePath: findOnPath('node', pathEnv) ?? process.execPath,
    pathEnv,
  });
  for (const name of CLI_NAMES) {
    console.log(`${name}: ${result.found[name] ?? 'not found'}`);
  }
  console.log(result.wrapperPath);
  console.log(result.manifestPath);
}
