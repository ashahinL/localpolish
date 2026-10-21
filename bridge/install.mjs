import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXTENSION_ID, HOST_NAME, WINDOWS_REGISTRY_KEYS } from './constants.mjs';
import {
  agyHomeFor,
  agyLoginCommand,
  codexHomeFor,
  codexLoginCommand,
  findOnPath,
  supportDir,
} from './lib.mjs';

const CLI_NAMES = ['claude', 'codex', 'grok', 'agy'];
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

/**
 * @param {{
 *   home: string,
 *   repoDir: string,
 *   nodePath: string,
 *   pathEnv: string,
 *   platform?: NodeJS.Platform,
 * }} opts
 * @returns {{
 *   wrapperPath: string,
 *   manifestPath: string,
 *   found: Record<'claude' | 'codex' | 'grok' | 'agy', string | null>,
 * }}
 */
export function installBridge({ home, repoDir, nodePath, pathEnv, platform = process.platform }) {
  const windows = platform === 'win32';
  /** @type {Record<'claude' | 'codex' | 'grok' | 'agy', string | null>} */
  const found = { claude: null, codex: null, grok: null, agy: null };
  for (const name of CLI_NAMES) {
    found[name] = findOnPath(name, pathEnv, platform);
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
  if (!windows) for (const dir of SYSTEM_PATH) addDir(dir);

  const wrapperDir = supportDir(home, platform);
  fs.mkdirSync(wrapperDir, { recursive: true });
  const hostPath = path.join(repoDir, 'bridge', 'host.mjs');
  const wrapperPath = path.join(
    wrapperDir,
    windows ? 'localpolish-bridge.cmd' : 'localpolish-bridge',
  );
  // Chrome on Windows starts native hosts with the user's PATH, so the wrapper only adds to it.
  // cmd reads the file in the console code page, so it switches to UTF-8 for non-ASCII paths,
  // and a literal % must be doubled or cmd expands it as a variable.
  const cmdText = (/** @type {string} */ value) => value.replaceAll('%', '%%');
  const shellQuote = (/** @type {string} */ value) => "'" + value.replaceAll("'", "'\\''") + "'";
  const wrapper = windows
    ? [
        '@echo off',
        'chcp 65001 >nul',
        `set "PATH=${cmdText(dirs.join(';'))};%PATH%"`,
        `"${cmdText(nodePath)}" "${cmdText(hostPath)}"`,
        '',
      ].join('\r\n')
    : [
        '#!/bin/sh',
        `export PATH=${shellQuote(dirs.join(':'))}`,
        `exec ${shellQuote(nodePath)} ${shellQuote(hostPath)}`,
        '',
      ].join('\n');
  fs.writeFileSync(wrapperPath, wrapper, { mode: 0o755 });
  fs.chmodSync(wrapperPath, 0o755);

  // Windows finds the manifest through a registry key, so it can live next to the wrapper.
  const manifestDir = windows
    ? wrapperDir
    : path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
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
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    console.error('The LocalPolish bridge installer only supports macOS and Windows.');
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
  if (process.platform === 'win32') {
    for (const key of WINDOWS_REGISTRY_KEYS) {
      execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', result.manifestPath, '/f']);
    }
  }
  for (const name of CLI_NAMES) {
    console.log(`${name}: ${result.found[name] ?? 'not found'}`);
  }
  console.log(result.wrapperPath);
  console.log(result.manifestPath);
  if (result.found.agy) {
    console.log(
      `To use Antigravity, log in once for LocalPolish: ${agyLoginCommand(agyHomeFor(os.homedir()))}`,
    );
  }
  const codexHome = codexHomeFor(os.homedir());
  fs.mkdirSync(codexHome, { recursive: true });
  if (result.found.codex && !fs.existsSync(path.join(codexHome, 'auth.json'))) {
    console.log(`To use Codex, log in once for LocalPolish: ${codexLoginCommand(codexHome)}`);
  }
}
