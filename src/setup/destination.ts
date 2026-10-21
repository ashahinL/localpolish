import { isLoopbackHost } from '../background/providers/openai';
import { type CliProviderId, type Settings } from '../core/settings';

const CLI_DESTINATION: Record<CliProviderId, string> = {
  'antigravity-cli':
    'Your text goes from this computer, through the bridge, to the Antigravity CLI, which sends it to Google. LocalPolish deletes each Antigravity conversation after the answer.',
  'claude-cli':
    'Your text goes from this computer, through the bridge, to the Claude Code CLI, which sends it to Anthropic.',
  'codex-cli':
    'Your text goes from this computer, through the bridge, to the Codex CLI, which sends it to OpenAI.',
  'grok-cli':
    'Your text goes from this computer, through the bridge, to the Grok CLI, which sends it to xAI. Grok keeps history in ~/.grok and can search X.',
};

/** One line on where a Fix sends the user's text for the chosen provider. */
export function destination(settings: Settings): string {
  const { provider } = settings;
  if (provider === 'anthropic-api') return "Your text goes to Anthropic's API.";
  if (provider !== 'openai-compatible') return CLI_DESTINATION[provider];
  const baseUrl = settings.openaiBaseUrl.trim();
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return 'Your text goes to the base URL you set above.';
  }
  return isLoopbackHost(hostname)
    ? `Your text goes to ${baseUrl}, a server on this computer.`
    : `Your text goes to ${baseUrl}, a server outside this computer.`;
}
