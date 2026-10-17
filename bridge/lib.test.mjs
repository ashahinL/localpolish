import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCommand,
  CODEX_DISABLED_FEATURES,
  createDecoder,
  encodeMessage,
  GROK_DENY_RULES,
  GROK_REMOVED_TOOLS,
  parseLine,
  resolveCommand,
} from './lib.mjs';

describe('encodeMessage', () => {
  it('round-trips a message and prefixes the UTF-8 byte length', () => {
    const obj = { type: 'chunk', text: 'مرحبا 👋' };
    const encoded = encodeMessage(obj);
    const json = JSON.stringify(obj);
    expect(encoded.readUInt32LE(0)).toBe(Buffer.byteLength(json, 'utf8'));
    expect(encoded.subarray(4).toString('utf8')).toBe(json);

    const seen = [];
    createDecoder((message) => seen.push(message))(encoded);
    expect(seen).toEqual([obj]);
  });
});

describe('createDecoder', () => {
  it('emits one message when a frame arrives in three chunks', () => {
    const obj = { type: 'chunk', text: 'She' };
    const encoded = encodeMessage(obj);
    const seen = [];
    const decode = createDecoder((message) => seen.push(message));
    decode(encoded.subarray(0, 2));
    decode(encoded.subarray(2, 5));
    expect(seen).toEqual([]);
    decode(encoded.subarray(5));
    expect(seen).toEqual([obj]);
  });

  it('emits two messages when two frames arrive in one chunk', () => {
    const first = { type: 'chunk', text: 'a' };
    const second = { type: 'chunk', text: 'b' };
    const seen = [];
    createDecoder((message) => seen.push(message))(
      Buffer.concat([encodeMessage(first), encodeMessage(second)]),
    );
    expect(seen).toEqual([first, second]);
  });
});

describe('buildCommand', () => {
  const claudeTail = [
    '--system-prompt',
    'S',
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
  ];
  const grokTail = [
    '--system-prompt-override',
    'S',
    '--disallowed-tools',
    GROK_REMOVED_TOOLS.join(','),
    '--deny',
    GROK_DENY_RULES,
    '--no-subagents',
    '--no-plan',
    '--disable-web-search',
    '--output-format',
    'streaming-messages-json',
    '--include-partial-messages',
  ];
  const codexHead = [
    'exec',
    '-',
    '--skip-git-repo-check',
    '--ephemeral',
    '-s',
    'read-only',
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ['-c', `features.${feature}=false`]),
    '-c',
    'web_search=disabled',
  ];
  const codexTail = ['-c', `developer_instructions=${JSON.stringify('S')}`, '--json'];

  it('turns off the tools that can run commands or read files', () => {
    expect(CODEX_DISABLED_FEATURES).toEqual(expect.arrayContaining(['shell_tool', 'unified_exec']));
    expect(GROK_REMOVED_TOOLS).toEqual(
      expect.arrayContaining(['run_terminal_cmd', 'read_file', 'search_tool', 'use_tool']),
    );
    expect(GROK_DENY_RULES.split(',')).toEqual(expect.arrayContaining(['Bash', 'Read', 'MCPTool']));
  });

  it('builds claude args with model and effort', () => {
    expect(buildCommand('claude', { model: 'm1', effort: 'high', system: 'S' })).toEqual({
      cmd: 'claude',
      args: ['-p', '--model', 'm1', '--effort', 'high', ...claudeTail],
    });
  });

  it('omits an empty claude model and effort', () => {
    expect(buildCommand('claude', { model: '', effort: '', system: 'S' }).args).toEqual([
      '-p',
      ...claudeTail,
    ]);
  });

  it('builds grok args with model and effort', () => {
    expect(buildCommand('grok', { model: 'm1', effort: 'low', system: 'S' })).toEqual({
      cmd: 'grok',
      args: ['-p', '-', '-m', 'm1', '--effort', 'low', ...grokTail],
    });
  });

  it('omits an empty grok model and effort', () => {
    expect(buildCommand('grok', { model: '', effort: '', system: 'S' }).args).toEqual([
      '-p',
      '-',
      ...grokTail,
    ]);
  });

  it('builds codex args with model and effort', () => {
    expect(buildCommand('codex', { model: 'm1', effort: 'high', system: 'S' })).toEqual({
      cmd: 'codex',
      args: [...codexHead, '-m', 'm1', '-c', 'model_reasoning_effort=high', ...codexTail],
    });
  });

  it('omits an empty codex model and effort', () => {
    expect(buildCommand('codex', { model: '', effort: '', system: 'S' }).args).toEqual([
      ...codexHead,
      ...codexTail,
    ]);
  });

  it('rejects an unknown cli', () => {
    expect(() => buildCommand('llama', { model: 'm1', effort: '', system: 'S' })).toThrow(/llama/);
  });
});

describe('parseLine', () => {
  const textLine =
    '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"She"}},"session_id":"x"}';
  const thinkingLine =
    '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}}';
  const resultOk =
    '{"type":"result","subtype":"success","is_error":false,"result":"She doesn\'t like it."}';
  const resultError =
    '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Not logged in"}';

  it('reads claude and grok text deltas and ignores the rest', () => {
    for (const cli of ['claude', 'grok']) {
      expect(parseLine(cli, textLine)).toEqual({ text: 'She' });
      expect(parseLine(cli, `  ${textLine}\n`)).toEqual({ text: 'She' });
      expect(parseLine(cli, thinkingLine)).toBeNull();
      expect(parseLine(cli, resultOk)).toBeNull();
      expect(parseLine(cli, resultError)).toEqual({ error: 'Not logged in' });
      expect(parseLine(cli, 'Reading additional input from stdin...')).toBeNull();
    }
  });

  it('reads a codex answer and its failures', () => {
    const answer =
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"She doesn’t like it."}}';
    expect(parseLine('codex', answer)).toEqual({ text: 'She doesn’t like it.' });
    expect(
      parseLine(
        'codex',
        '{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"x"}}',
      ),
    ).toBeNull();
    expect(
      parseLine('codex', '{"type":"turn.failed","error":{"message":"usage limit reached"}}'),
    ).toEqual({ error: 'usage limit reached' });
    expect(parseLine('codex', '{"type":"error","message":"nope"}')).toEqual({ error: 'nope' });
    expect(parseLine('codex', 'Reading additional input from stdin...')).toBeNull();
  });
});

describe('resolveCommand', () => {
  it('runs the script behind an npm .cmd shim with Node', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-shim-'));
    const shim = path.join(dir, 'codex.cmd');
    const npmShim = String.raw`@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
`;
    fs.writeFileSync(shim, npmShim.replace(/\n/g, '\r\n'));
    try {
      expect(resolveCommand(shim, 'node.exe')).toEqual({
        cmd: 'node.exe',
        args: [path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')],
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs any other file as it is', () => {
    expect(resolveCommand('/usr/local/bin/claude')).toEqual({
      cmd: '/usr/local/bin/claude',
      args: [],
    });
  });
});
