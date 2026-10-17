import { describe, expect, it } from 'vitest';
import { buildCommand, createDecoder, encodeMessage, parseLine } from './lib.mjs';

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
  it('builds claude args and omits an empty model', () => {
    expect(buildCommand('claude', 'm1', 'S')).toEqual({
      cmd: 'claude',
      args: [
        '-p',
        '--model',
        'm1',
        '--effort',
        'low',
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
      ],
    });
    expect(buildCommand('claude', '', 'S').args).toEqual([
      '-p',
      '--effort',
      'low',
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
    ]);
  });

  it('builds grok args and omits an empty model', () => {
    expect(buildCommand('grok', 'm1', 'S')).toEqual({
      cmd: 'grok',
      args: [
        '-p',
        '-',
        '-m',
        'm1',
        '--system-prompt-override',
        'S',
        '--tools',
        '',
        '--disable-web-search',
        '--output-format',
        'streaming-messages-json',
        '--include-partial-messages',
      ],
    });
    expect(buildCommand('grok', '', 'S').args).toEqual([
      '-p',
      '-',
      '--system-prompt-override',
      'S',
      '--tools',
      '',
      '--disable-web-search',
      '--output-format',
      'streaming-messages-json',
      '--include-partial-messages',
    ]);
  });

  it('builds codex args and omits an empty model', () => {
    const instructions = `developer_instructions=${JSON.stringify('S')}`;
    expect(buildCommand('codex', 'm1', 'S')).toEqual({
      cmd: 'codex',
      args: [
        'exec',
        '-',
        '--skip-git-repo-check',
        '--ephemeral',
        '-s',
        'read-only',
        '-m',
        'm1',
        '-c',
        'model_reasoning_effort=low',
        '-c',
        instructions,
        '--json',
      ],
    });
    expect(buildCommand('codex', '', 'S').args).toEqual([
      'exec',
      '-',
      '--skip-git-repo-check',
      '--ephemeral',
      '-s',
      'read-only',
      '-c',
      'model_reasoning_effort=low',
      '-c',
      instructions,
      '--json',
    ]);
  });

  it('rejects an unknown cli', () => {
    expect(() => buildCommand('llama', 'm1', 'S')).toThrow(/llama/);
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
