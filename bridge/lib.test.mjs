import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAX_NATIVE_FRAME_BYTES } from './constants.mjs';
import {
  agyHomeFor,
  clearAgyRun,
  agyLoginCommand,
  buildCommand,
  CODEX_DISABLED_FEATURES,
  codexRewriteCatalog,
  createDecoder,
  encodeMessage,
  GROK_DENY_RULES,
  GROK_REMOVED_TOOLS,
  parseLine,
  resolveCommand,
  splitText,
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
  it.each([
    { name: 'one-byte fragments', size: 1 },
    { name: 'split header', size: 3 },
    { name: 'header boundary', size: 4 },
    { name: 'split payload and UTF-8', size: 7 },
    { name: 'coalesced frames', size: 1000 },
  ])('decodes $name', ({ size }) => {
    const messages = [{ text: 'مرحبا 😀' }, { text: 'second' }, { end: true }];
    const frame = Buffer.concat(messages.map(encodeMessage));
    const seen = [];
    const decode = createDecoder((message) => seen.push(message));
    for (let at = 0; at < frame.length; at += size) decode(frame.subarray(at, at + size));
    expect(seen).toEqual(messages);
  });

  it('resets before calling the message callback', () => {
    const seen = [];
    const decode = createDecoder((message) => {
      seen.push(message);
      if (seen.length === 1) decode(encodeMessage({ text: 'nested' }));
    });
    decode(encodeMessage({ text: 'first' }));
    expect(seen).toEqual([{ text: 'first' }, { text: 'nested' }]);
  });

  it('accepts exactly 8 MiB of JSON excluding the header', () => {
    const message = { text: 'x'.repeat(MAX_NATIVE_FRAME_BYTES - 11) };
    const frame = encodeMessage(message);
    expect(frame.length).toBe(MAX_NATIVE_FRAME_BYTES + 4);
    const seen = [];
    const decode = createDecoder((message) => seen.push(message));
    for (let at = 0; at < frame.length; at += 1024) decode(frame.subarray(at, at + 1024));
    expect(seen).toEqual([message]);
  });

  it('rejects an oversized header before allocating or receiving its payload', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_NATIVE_FRAME_BYTES + 1);
    const seen = [];
    const decode = createDecoder((message) => seen.push(message));
    decode(header.subarray(0, 3));
    const alloc = vi.spyOn(Buffer, 'alloc');
    try {
      expect(() => decode(header.subarray(3))).toThrow(
        'Native JSON payload exceeds the 8 MiB limit.',
      );
      expect(alloc).not.toHaveBeenCalled();
      expect(seen).toEqual([]);
    } finally {
      alloc.mockRestore();
    }
  });

  it.each(['', '{bad'])('throws for malformed JSON %j without a callback', (json) => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(Buffer.byteLength(json));
    const frame = Buffer.concat([header, Buffer.from(json)]);
    const seen = [];
    expect(() => createDecoder((message) => seen.push(message))(frame)).toThrow(SyntaxError);
    expect(seen).toEqual([]);
  });

  it('copies fragmented 1, 2 and 4 MiB frames with linear byte work', () => {
    const work = [];
    for (const mib of [1, 2, 4]) {
      const message = { text: 'x'.repeat(mib * 1024 * 1024 - 11) };
      const frame = encodeMessage(message);
      const seen = [];
      const decode = createDecoder((message) => seen.push(message));
      let copyBytes = 0;
      let concatBytes = 0;
      const copy = Buffer.prototype.copy;
      const concat = Buffer.concat;
      Buffer.prototype.copy = function (...args) {
        const bytes = Reflect.apply(copy, this, args);
        copyBytes += bytes;
        return bytes;
      };
      Buffer.concat = function (...args) {
        const result = Reflect.apply(concat, Buffer, args);
        concatBytes += result.length;
        return result;
      };
      try {
        for (let at = 0; at < frame.length; at += 1024) decode(frame.subarray(at, at + 1024));
      } finally {
        Buffer.prototype.copy = copy;
        Buffer.concat = concat;
      }
      expect(seen).toEqual([message]);
      expect(copyBytes).toBe(frame.length);
      expect(concatBytes).toBe(0);
      work.push(copyBytes + concatBytes);
    }
    expect(work).toEqual([1048580, 2097156, 4194308]);
    expect(work[1]).toBeLessThanOrEqual(work[0] * 2);
    expect(work[2]).toBeLessThanOrEqual(work[1] * 2);
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
    ...[
      'skills.include_instructions=false',
      'agents.enabled=false',
      'include_permissions_instructions=false',
      'include_apps_instructions=false',
      'include_collaboration_mode_instructions=false',
      'include_environment_context=false',
      'tools.update_plan.enabled=false',
      'tools.experimental_request_user_input.enabled=false',
    ].flatMap((setting) => ['-c', setting]),
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

  it('passes a codex instructions file before --json', () => {
    const args = buildCommand('codex', {
      model: '',
      effort: '',
      system: 'S',
      instructionsFile: '/tmp/x/instructions.md',
    }).args;
    expect(args.slice(-3)).toEqual([
      '-c',
      'model_instructions_file="/tmp/x/instructions.md"',
      '--json',
    ]);
    expect(args.join(' ')).not.toContain('developer_instructions');
  });

  it('rejects an unknown cli', () => {
    expect(() => buildCommand('llama', { model: 'm1', effort: '', system: 'S' })).toThrow(/llama/);
  });
});

describe('codexRewriteCatalog', () => {
  it.each([
    undefined,
    '{bad',
    'null',
    '{"models":{}}',
    '{"models":[{"slug":"m1"}]}',
    '{"fetched_at":"2020-01-01","models":[{"slug":"m1"}]}',
    JSON.stringify({ fetched_at: new Date().toISOString(), models: [{ slug: 'other' }] }),
  ])('allows a rewrite without the optional catalog when the cache is %s', (contents) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-catalog-'));
    try {
      if (contents !== undefined) fs.writeFileSync(path.join(home, 'models_cache.json'), contents);
      expect(codexRewriteCatalog(home, 'm1')).toBeNull();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
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
      expect(parseLine(cli, resultOk)).toEqual({ end: true });
      const stop = (reason) =>
        `{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"${reason}"}}}`;
      expect(parseLine(cli, stop('end_turn'))).toEqual({ end: true });
      expect(parseLine(cli, stop('max_tokens'))).toEqual({
        error: 'The answer was cut off. Try a shorter text.',
      });
      expect(parseLine(cli, stop('tool_use'))).toBeNull();
      expect(parseLine(cli, '{"type":"stream_event","event":{"type":"message_stop"}}')).toBeNull();
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
    expect(parseLine('codex', '{"type":"turn.completed","usage":{}}')).toEqual({ end: true });
    expect(parseLine('codex', 'Reading additional input from stdin...')).toBeNull();
  });

  it('reads a grok init model and ignores a malformed or non-grok one', () => {
    const init = (model) =>
      JSON.stringify({ type: 'system', subtype: 'init', model, session_id: 'abc' });
    expect(parseLine('grok', init('grok-4.7'))).toEqual({ model: 'grok-4.7' });
    expect(parseLine('grok', `  ${init('  grok-4.7  ')}\n`)).toEqual({ model: 'grok-4.7' });
    expect(parseLine('grok', init('a'.repeat(200)))).toEqual({ model: 'a'.repeat(200) });
    expect(parseLine('grok', init(''))).toBeNull();
    expect(parseLine('grok', init('   '))).toBeNull();
    expect(parseLine('grok', init('a'.repeat(201)))).toBeNull();
    expect(parseLine('grok', init(1))).toBeNull();
    expect(parseLine('grok', init(null))).toBeNull();
    expect(parseLine('grok', JSON.stringify({ type: 'system', subtype: 'init' }))).toBeNull();
    expect(
      parseLine(
        'grok',
        JSON.stringify({ type: 'system', subtype: 'compact_boundary', model: 'grok-4.7' }),
      ),
    ).toBeNull();
    expect(parseLine('claude', init('grok-4.7'))).toBeNull();
    expect(parseLine('codex', init('grok-4.7'))).toBeNull();
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

describe('splitText', () => {
  it('keeps short text whole', () => {
    expect(splitText('abc', 5)).toEqual(['abc']);
  });

  it('splits long text without cutting a surrogate pair', () => {
    expect(splitText('abcdef', 4)).toEqual(['abcd', 'ef']);
    expect(splitText('ab😀cd', 3)).toEqual(['ab', '😀c', 'd']);
  });
});

describe('Antigravity', () => {
  it.each([
    ['', '', []],
    ['gemini-3.8-flash-low', '', ['--model', 'gemini-3.8-flash-low']],
    ['', 'high', ['--effort', 'high']],
    ['m1', 'low', ['--model', 'm1', '--effort', 'low']],
  ])('builds a command with model %s and effort %s', (model, effort, extra) => {
    expect(buildCommand('agy', { model, effort, system: 'private system' })).toEqual({
      cmd: 'agy',
      args: [
        '--agent',
        'localpolish',
        '--output-format',
        'stream-json',
        '--input-format',
        'stream-json',
        '-p=',
        ...extra,
      ],
    });
  });

  it.each([
    [
      { event: 'init', conversation_id: 'id', init: { model: '  m1  ' } },
      { model: 'm1', conversation: 'id' },
    ],
    [{ event: 'init', init: { model: '' } }, null],
    [{ event: 'init', init: { model: 7 } }, null],
    [{ event: 'init', init: { model: 'x'.repeat(201) } }, null],
    [
      { event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Hello.' } },
      { text: 'Hello.' },
    ],
    [
      {
        event: 'step_update',
        step_update: { step_type: 'agent_response', state: 'DONE', text_delta: '\n' },
      },
      { text: '\n' },
    ],
    [{ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: '' } }, null],
    [{ event: 'step_update', step_update: { step_type: 'tool', text_delta: 'ignored' } }, null],
    [{ event: 'result', result: { status: 'SUCCESS' } }, { end: true }],
    [
      { event: 'result', result: { status: 'ERROR', error: 'fake failure' } },
      { error: 'fake failure' },
    ],
    [
      { event: 'result', result: { status: 'CANCELLED' } },
      { error: 'Antigravity stopped (CANCELLED).' },
    ],
    [{ event: 'unknown' }, null],
  ])('parses %j', (event, expected) => {
    expect(parseLine('agy', JSON.stringify(event))).toEqual(expected);
  });

  it.each(['darwin', 'win32'])('uses a private home and login on %s', (platform) => {
    const home = agyHomeFor('/fake/home', platform);
    expect(home).toBe(
      platform === 'win32'
        ? path.join('/fake/home', 'AppData', 'Local', 'LocalPolish', 'agy-home')
        : path.join('/fake/home', 'Library', 'Application Support', 'LocalPolish', 'agy-home'),
    );
    expect(agyLoginCommand(home, platform)).toBe(
      platform === 'win32'
        ? `$env:HOME="${home}"; $env:USERPROFILE="${home}"; mkdir -Force $env:HOME | Out-Null; agy`
        : `mkdir -p "${home}" && HOME="${home}" agy`,
    );
  });
});

const sqlite = process.getBuiltinModule?.('node:sqlite');

describe('clearAgyRun', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  const other = '66666666-7777-8888-9999-000000000000';

  function savedDir() {
    const saved = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-agy-saved-'));
    fs.mkdirSync(path.join(saved, 'conversations'));
    fs.mkdirSync(path.join(saved, 'brain', id), { recursive: true });
    fs.writeFileSync(path.join(saved, 'conversations', `${id}.db`), 'fake draft');
    fs.writeFileSync(path.join(saved, 'brain', id, 'draft'), 'fake draft');
    return saved;
  }

  it('removes the run and keeps the newest five logs', () => {
    const saved = savedDir();
    fs.mkdirSync(path.join(saved, 'log'));
    const logs = Array.from({ length: 7 }, (_, i) => `cli-20261022_0${i}0000.log`);
    for (const name of logs) fs.writeFileSync(path.join(saved, 'log', name), '');
    clearAgyRun(saved, id);
    expect(fs.existsSync(path.join(saved, 'conversations', `${id}.db`))).toBe(false);
    expect(fs.existsSync(path.join(saved, 'brain', id))).toBe(false);
    expect(fs.readdirSync(path.join(saved, 'log')).sort()).toEqual(logs.slice(2));
  });

  it.skipIf(!sqlite)("deletes only this run's summary row", () => {
    const saved = savedDir();
    const file = path.join(saved, 'conversation_summaries.db');
    const db = new sqlite.DatabaseSync(file);
    db.exec('CREATE TABLE conversation_summaries (conversation_id text, title text)');
    const insert = db.prepare('INSERT INTO conversation_summaries VALUES (?, ?)');
    insert.run(id, 'Grammar fix');
    insert.run(other, 'Kept');
    db.close();
    clearAgyRun(saved, id);
    const check = new sqlite.DatabaseSync(file);
    expect(check.prepare('SELECT conversation_id FROM conversation_summaries').all()).toEqual([
      { conversation_id: other },
    ]);
    check.close();
  });

  it('ignores a summaries file without the table', () => {
    const saved = savedDir();
    fs.writeFileSync(path.join(saved, 'conversation_summaries.db'), '');
    expect(() => clearAgyRun(saved, id)).not.toThrow();
    expect(fs.existsSync(path.join(saved, 'conversations', `${id}.db`))).toBe(false);
  });
});
