import { type ModelMessage } from '../../core/messages';
import { type Settings } from '../../core/settings';

export interface StreamOptions {
  timeoutMs?: number;
}

export type StreamFn = (
  messages: readonly ModelMessage[],
  settings: Settings,
  onText: (text: string) => void,
  signal: AbortSignal,
  onModel?: (model: string) => void,
  options?: StreamOptions,
) => Promise<void>;
