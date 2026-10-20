import { type Settings } from '../../core/settings';

export interface PromptPair {
  system: string;
  user: string;
}

export type StreamFn = (
  prompt: PromptPair,
  settings: Settings,
  onText: (t: string) => void,
  signal: AbortSignal,
  onModel?: (model: string) => void,
) => Promise<void>;
