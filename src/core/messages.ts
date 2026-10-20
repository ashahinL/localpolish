import { type Mode, type Settings, type Tone } from './settings';

export const HOST_NAME = 'com.localpolish.bridge';
export const REWRITE_PORT = 'rewrite';
/** Error code for a missing bridge, so idle Fix can stay quiet before setup. */
export const BRIDGE_MISSING = 'bridge-missing';

export interface RewriteRequest {
  mode: Mode;
  tone: Tone;
  text: string;
  trigger?: 'idle';
}

export type RewriteEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string; code?: typeof BRIDGE_MISSING };

export type BridgeStatus =
  | {
      ok: true;
      clis: Record<'claude' | 'codex' | 'grok', { version: string } | null>;
    }
  | { ok: false; message: string };

export type TestResult = { ok: true; sample: string; ms: number } | { ok: false; message: string };

export type PageSettings = Pick<Settings, 'blocklist' | 'idleFix' | 'defaultMode'>;

export type RuntimeMessage =
  | { type: 'test-connection' }
  | { type: 'bridge-status'; force?: boolean }
  | { type: 'open-popup' }
  | { type: 'page-settings' }
  | { type: 'page-settings-changed' };
