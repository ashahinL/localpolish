import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {unknown} obj
 * @returns {Buffer}
 */
export function encodeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * @param {(message: unknown) => void} onMessage
 * @returns {(chunk: Buffer) => void}
 */
export function createDecoder(onMessage) {
  /** @type {Buffer} */
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0);
      const frameEnd = 4 + length;
      if (pending.length < frameEnd) return;
      const json = pending.subarray(4, frameEnd).toString('utf8');
      pending = pending.subarray(frameEnd);
      onMessage(JSON.parse(json));
    }
  };
}

/**
 * @param {string} cli
 * @param {string} model
 * @param {string} system
 * @returns {{ cmd: string, args: string[] }}
 */
export function buildCommand(cli, model, system) {
  if (cli === 'claude') {
    const args = ['-p'];
    if (model) args.push('--model', model);
    args.push(
      '--effort',
      'low',
      '--system-prompt',
      system,
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
    );
    return { cmd: 'claude', args };
  }
  if (cli === 'grok') {
    const args = ['-p', '-'];
    if (model) args.push('-m', model);
    args.push(
      '--system-prompt-override',
      system,
      '--tools',
      '',
      '--disable-web-search',
      '--output-format',
      'streaming-messages-json',
      '--include-partial-messages',
    );
    return { cmd: 'grok', args };
  }
  if (cli === 'codex') {
    const args = ['exec', '-', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only'];
    if (model) args.push('-m', model);
    args.push(
      '-c',
      'model_reasoning_effort=low',
      '-c',
      `developer_instructions=${JSON.stringify(system)}`,
      '--json',
    );
    return { cmd: 'codex', args };
  }
  throw new Error(`Unknown CLI: ${cli}`);
}

/**
 * @param {string} cli
 * @param {string} line
 * @returns {{ text: string } | { error: string } | null}
 */
export function parseLine(cli, line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;

  if (cli === 'claude' || cli === 'grok') {
    const event = msg.event;
    const delta = event && event.delta;
    if (
      msg.type === 'stream_event' &&
      event &&
      event.type === 'content_block_delta' &&
      delta &&
      delta.type === 'text_delta'
    ) {
      return { text: delta.text };
    }
    if (msg.type === 'result' && msg.is_error === true) {
      return { error: String(msg.result) };
    }
    return null;
  }

  if (cli === 'codex') {
    if (msg.type === 'item.completed' && msg.item && msg.item.type === 'agent_message') {
      return { text: msg.item.text };
    }
    if (msg.type === 'turn.failed') {
      return { error: msg.error.message };
    }
    if (msg.type === 'error') {
      return { error: msg.message };
    }
    return null;
  }

  return null;
}

/**
 * @param {string} name
 * @param {string | undefined} pathEnv
 * @returns {string | null}
 */
export function findOnPath(name, pathEnv) {
  if (!name || !pathEnv) return null;
  for (const dir of pathEnv.split(':')) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Missing or not executable.
    }
  }
  return null;
}
