import { type Mode, type Tone } from './settings';

export const HOST_NAME = 'com.localpolish.bridge';
export const REWRITE_PORT = 'rewrite';

export interface RewriteRequest {
  mode: Mode;
  tone: Tone;
  text: string;
}

export type RewriteEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export type BridgeStatus =
  | {
      ok: true;
      clis: Record<'claude' | 'codex' | 'grok', { version: string } | null>;
    }
  | { ok: false; message: string };

export type TestResult = { ok: true; sample: string; ms: number } | { ok: false; message: string };

export type RuntimeMessage =
  { type: 'test-connection' } | { type: 'bridge-status' } | { type: 'open-popup' };
