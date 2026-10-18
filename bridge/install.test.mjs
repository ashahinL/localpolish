import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EXTENSION_ID, HOST_NAME } from './constants.mjs';
import { installBridge } from './install.mjs';
import { uninstallBridge } from './uninstall.mjs';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dirs = [];

afterEach(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe.runIf(process.platform === 'darwin')('installBridge on macOS', () => {
  it('writes an executable wrapper and a Chrome manifest, then uninstall removes both', () => {
    const home = tempDir('lp-home-');
    const bin = tempDir('lp-bin-');
    for (const name of ['claude', 'grok']) {
      const file = path.join(bin, name);
      fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(file, 0o755);
    }

    const nodePath = process.execPath;
    const result = installBridge({
      home,
      repoDir: '/repo',
      nodePath,
      pathEnv: `${bin}:/usr/bin:/bin`,
    });

    expect(result.found).toEqual({
      claude: path.join(bin, 'claude'),
      codex: null,
      grok: path.join(bin, 'grok'),
    });

    const dirsOnPath = [
      path.dirname(nodePath),
      bin,
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ].filter((dir, index, all) => all.indexOf(dir) === index);
    const wrapper = [
      '#!/bin/sh',
      `export PATH='${dirsOnPath.join(':')}'`,
      `exec '${nodePath}' '/repo/bridge/host.mjs'`,
      '',
    ].join('\n');
    expect(fs.readFileSync(result.wrapperPath, 'utf8')).toBe(wrapper);
    expect(fs.statSync(result.wrapperPath).mode & 0o777).toBe(0o755);

    const manifest = {
      name: HOST_NAME,
      description: 'LocalPolish bridge to local AI CLIs',
      path: result.wrapperPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    };
    const manifestRaw = fs.readFileSync(result.manifestPath, 'utf8');
    expect(manifestRaw).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(JSON.parse(manifestRaw)).toEqual(manifest);

    uninstallBridge({ home });
    expect(fs.existsSync(result.wrapperPath)).toBe(false);
    expect(fs.existsSync(result.manifestPath)).toBe(false);
    expect(fs.existsSync(path.join(home, 'Library', 'Application Support', 'LocalPolish'))).toBe(
      false,
    );
  });

  it('runs the host from a path with shell characters without expanding them', () => {
    const dir = tempDir('lp-wrapper-');
    const repo = path.join(dir, 'repo $(touch expanded) \'q\' "d" `b` é');
    const bridge = path.join(repo, 'bridge');
    const okFile = path.join(dir, 'ok');
    fs.mkdirSync(bridge, { recursive: true });
    fs.writeFileSync(
      path.join(bridge, 'host.mjs'),
      `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(okFile)}, 'ok');\n`,
    );
    const { wrapperPath } = installBridge({
      home: dir,
      repoDir: repo,
      nodePath: process.execPath,
      pathEnv: '',
    });
    const result = spawnSync(wrapperPath, [], { cwd: dir, encoding: 'utf8' });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(fs.readFileSync(okFile, 'utf8')).toBe('ok');
    expect(
      fs.readdirSync(dir, { recursive: true }).some((file) => path.basename(file) === 'expanded'),
    ).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'expanded'))).toBe(false);
  });

  it('installs and uninstalls when the scripts are executed directly', () => {
    const home = tempDir('lp-home-');
    const env = { ...process.env, HOME: home };
    const install = spawnSync(process.execPath, ['bridge/install.mjs'], {
      cwd: repoDir,
      env,
      encoding: 'utf8',
    });
    expect({ status: install.status, stderr: install.stderr }).toMatchObject({ status: 0 });
    const wrapper = path.join(home, 'Library/Application Support/LocalPolish/localpolish-bridge');
    const manifest = path.join(
      home,
      'Library/Application Support/Google/Chrome/NativeMessagingHosts',
      `${HOST_NAME}.json`,
    );
    expect(install.stdout).toContain('claude:');
    expect(install.stdout).toContain('codex:');
    expect(install.stdout).toContain('grok:');
    expect(install.stdout).toContain(wrapper);
    expect(install.stdout).toContain(manifest);
    expect(fs.existsSync(wrapper)).toBe(true);
    expect(fs.existsSync(manifest)).toBe(true);

    const uninstall = spawnSync(process.execPath, ['bridge/uninstall.mjs'], {
      cwd: repoDir,
      env,
      encoding: 'utf8',
    });
    expect(uninstall.status).toBe(0);
    expect(fs.existsSync(wrapper)).toBe(false);
    expect(fs.existsSync(manifest)).toBe(false);
  });
});

describe.runIf(process.platform === 'win32')('installBridge on Windows', () => {
  it('writes a .cmd wrapper and a manifest next to it, then uninstall removes both', () => {
    const home = tempDir('lp-home-');
    const bin = tempDir('lp-bin-');
    for (const name of ['claude.exe', 'codex', 'codex.cmd', 'grok']) {
      fs.writeFileSync(path.join(bin, name), '');
    }

    const result = installBridge({
      home,
      repoDir: 'C:\\repo%USERNAME%',
      nodePath: 'C:\\node\\node.exe',
      pathEnv: `${bin};C:\\Windows`,
      platform: 'win32',
    });

    expect(result.found).toEqual({
      claude: path.join(bin, 'claude.exe'),
      codex: path.join(bin, 'codex.cmd'),
      grok: null,
    });
    const dir = path.join(home, 'AppData', 'Local', 'LocalPolish');
    expect(result.wrapperPath).toBe(path.join(dir, 'localpolish-bridge.cmd'));
    expect(fs.readFileSync(result.wrapperPath, 'utf8')).toBe(
      [
        '@echo off',
        'chcp 65001 >nul',
        `set "PATH=C:\\node;${bin};%PATH%"`,
        '"C:\\node\\node.exe" "C:\\repo%%USERNAME%%\\bridge\\host.mjs"',
        '',
      ].join('\r\n'),
    );
    expect(result.manifestPath).toBe(path.join(dir, `${HOST_NAME}.json`));
    expect(JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'))).toEqual({
      name: HOST_NAME,
      description: 'LocalPolish bridge to local AI CLIs',
      path: result.wrapperPath,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    });

    uninstallBridge({ home, platform: 'win32' });
    expect(fs.existsSync(dir)).toBe(false);
  });
});
