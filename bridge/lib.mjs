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
 * Splits text into pieces of at most `size` UTF-16 units, without cutting a surrogate pair.
 * @param {string} text
 * @param {number} size
 * @returns {string[]}
 */
export function splitText(text, size) {
  const pieces = [];
  let start = 0;
  while (text.length - start > size) {
    let end = start + size;
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    pieces.push(text.slice(start, end));
    start = end;
  }
  pieces.push(text.slice(start));
  return pieces;
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

// `grok --tools ""` keeps every tool, so each one is removed by name, and the deny rules
// block whole tool types in case a later Grok adds a tool under a new name.
export const GROK_REMOVED_TOOLS = [
  'run_terminal_cmd',
  'read_file',
  'search_replace',
  'list_dir',
  'grep',
  'write',
  'todo_write',
  'task',
  'kill_task',
  'get_task_output',
  'wait_tasks',
  'scheduler_create',
  'scheduler_delete',
  'scheduler_list',
  'monitor',
  'search_tool',
  'use_tool',
  'update_goal',
  'web_search',
  'web_fetch',
  'image_gen',
  'image_edit',
  'image_to_video',
  'reference_to_video',
  'send_feedback',
  'lsp',
  'workflow',
  'Agent',
];
export const GROK_DENY_RULES = 'Bash,Read,Edit,Write,Grep,WebFetch,MCPTool';

// `codex -s read-only` still lets Codex read files and run commands. Unknown keys are ignored,
// so older Codex versions still start.
export const CODEX_DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'plugins',
  'browser_use',
  'computer_use',
  'in_app_browser',
  'goals',
  'view_image',
];

const CODEX_REWRITE_CONFIG = [
  'skills.include_instructions=false',
  'agents.enabled=false',
  'include_permissions_instructions=false',
  'include_apps_instructions=false',
  'include_collaboration_mode_instructions=false',
  'include_environment_context=false',
  'tools.update_plan.enabled=false',
  'tools.experimental_request_user_input.enabled=false',
];
const CODEX_CATALOG_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Returns null for an unreadable, invalid, stale, or missing model cache so Codex can refresh it.
 * @param {string} codexHome
 * @param {string} model
 * @returns {{ models: Record<string, unknown>[] } | null}
 */
export function codexRewriteCatalog(codexHome, model) {
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(path.join(codexHome, 'models_cache.json'), 'utf8'));
  } catch {
    return null;
  }
  const fetchedAt = Date.parse(cache?.fetched_at);
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > CODEX_CATALOG_MAX_AGE_MS) return null;
  const selected = Array.isArray(cache?.models)
    ? cache.models.find((entry) => entry?.slug === model)
    : null;
  if (!selected) return null;
  return {
    models: [
      {
        ...selected,
        tool_mode: null,
        apply_patch_tool_type: null,
        experimental_supported_tools: [],
      },
    ],
  };
}

// Grok loads Claude, Codex and Cursor rules (such as ~/.claude/CLAUDE.md) into its prompt by default.
/** @type {Record<string, string>} */
export const GROK_IMPORTS_OFF = {};
for (const source of ['CLAUDE', 'CODEX', 'CURSOR']) {
  for (const kind of ['AGENTS', 'HOOKS', 'MCPS', 'RULES', 'SKILLS', 'SESSIONS']) {
    GROK_IMPORTS_OFF[`GROK_${source}_${kind}_ENABLED`] = '0';
  }
}

/**
 * `instructionsFile` replaces Codex's built-in prompt, which is about 3,500 tokens.
 * @param {string} cli
 * @param {{ model: string, effort: string, system: string, instructionsFile?: string, modelCatalogFile?: string }} opts
 * @returns {{ cmd: string, args: string[] }}
 */
export function buildCommand(cli, { model, effort, system, instructionsFile, modelCatalogFile }) {
  if (cli === 'claude') {
    const args = ['-p'];
    if (model) args.push('--model', model);
    if (effort) args.push('--effort', effort);
    args.push(
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
    if (effort) args.push('--effort', effort);
    args.push(
      '--system-prompt-override',
      system,
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
    );
    return { cmd: 'grok', args };
  }
  if (cli === 'codex') {
    const args = ['exec', '-', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only'];
    for (const feature of CODEX_DISABLED_FEATURES) args.push('-c', `features.${feature}=false`);
    for (const setting of CODEX_REWRITE_CONFIG) args.push('-c', setting);
    args.push('-c', 'web_search=disabled');
    if (modelCatalogFile) args.push('-c', `model_catalog_json=${JSON.stringify(modelCatalogFile)}`);
    if (model) args.push('-m', model);
    if (effort) args.push('-c', `model_reasoning_effort=${effort}`);
    if (instructionsFile) {
      args.push('-c', `model_instructions_file=${JSON.stringify(instructionsFile)}`);
    } else {
      args.push('-c', `developer_instructions=${JSON.stringify(system)}`);
    }
    args.push('--json');
    return { cmd: 'codex', args };
  }
  throw new Error(`Unknown CLI: ${cli}`);
}

/**
 * @param {string} cli
 * @param {string} line
 * @returns {{ text: string } | { error: string } | { end: true } | null}
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
    // The answer is complete here. The CLI can run for seconds more before it exits.
    if (msg.type === 'stream_event' && event && event.type === 'message_delta' && delta) {
      if (delta.stop_reason === 'end_turn' || delta.stop_reason === 'stop_sequence') {
        return { end: true };
      }
      if (delta.stop_reason === 'max_tokens') {
        return { error: 'The answer was cut off. Try a shorter text.' };
      }
    }
    if (msg.type === 'result') return { end: true };
    return null;
  }

  if (cli === 'codex') {
    if (msg.type === 'item.completed' && msg.item && msg.item.type === 'agent_message') {
      return { text: msg.item.text };
    }
    if (msg.type === 'turn.completed') return { end: true };
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

const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'];

/**
 * @param {string} name
 * @param {string | undefined} pathEnv
 * @param {NodeJS.Platform} [platform]
 * @returns {string | null}
 */
export function findOnPath(name, pathEnv, platform = process.platform) {
  if (!name || !pathEnv) return null;
  const windows = platform === 'win32';
  const names = windows ? WINDOWS_EXTENSIONS.map((ext) => name + ext) : [name];
  for (const dir of pathEnv.split(windows ? ';' : ':')) {
    if (!dir) continue;
    for (const file of names) {
      const candidate = path.join(dir, file);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Missing or not executable.
      }
    }
  }
  return null;
}

/**
 * Node cannot spawn a .cmd file without a shell, and a shell would mangle the system prompt.
 * npm installs a CLI on Windows as a .cmd shim around a script, so run that script with Node.
 * @param {string} bin
 * @param {string} [nodePath]
 * @returns {{ cmd: string, args: string[] }}
 */
export function resolveCommand(bin, nodePath = process.execPath) {
  if (!/\.(cmd|bat)$/i.test(bin)) return { cmd: bin, args: [] };
  const match = fs.readFileSync(bin, 'utf8').match(/"%~?dp0%?\\([^"]+\.[cm]?js)"/i);
  if (!match) throw new Error(`Cannot run ${bin}. Install the CLI with npm, or as an .exe.`);
  return { cmd: nodePath, args: [path.join(path.dirname(bin), ...match[1].split('\\'))] };
}

/**
 * The folder for the wrapper, the Windows host manifest and the Codex home.
 * @param {string} home
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function supportDir(home, platform = process.platform) {
  return platform === 'win32'
    ? path.join(home, 'AppData', 'Local', 'LocalPolish')
    : path.join(home, 'Library', 'Application Support', 'LocalPolish');
}

/**
 * Codex always loads `$CODEX_HOME/AGENTS.md`, so LocalPolish gives it a home with only a login.
 * @param {string} home
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function codexHomeFor(home, platform = process.platform) {
  return path.join(supportDir(home, platform), 'codex-home');
}

/**
 * @param {string} codexHome
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function codexLoginCommand(codexHome, platform = process.platform) {
  return platform === 'win32'
    ? `$env:CODEX_HOME="${codexHome}"; mkdir -Force $env:CODEX_HOME | Out-Null; codex login`
    : `mkdir -p "${codexHome}" && CODEX_HOME="${codexHome}" codex login`;
}
