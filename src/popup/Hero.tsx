import { type Settings } from '../core/settings';
import { isCli } from '../options/ProviderSection';
import { BridgeErrorNote } from './BridgeErrorNote';
import { ChatIcon, DocumentIcon } from './icons';
import { connection, providerSummary } from './summary';
import { TestStatus } from './TestConnection';
import { type BridgeState } from './useBridge';
import { type TargetState, useOpenChat } from './useChat';
import { type TestState } from './useTest';

interface HeroProps {
  settings: Settings;
  bridge: BridgeState;
  test: TestState;
  chat: TargetState;
  /** False on the Provider tab, which shows its own bridge status and test result. */
  full: boolean;
  onOpenProvider(): void;
}

export function Hero({ settings, bridge, test, chat, full, onOpenProvider }: HeroProps) {
  const { opening, error, open } = useOpenChat(chat.target);
  const summary = providerSummary(settings);
  const link = connection(settings, bridge.status);
  const status = bridge.status;
  // The note already says what the label would; on Provider the Bridge section shows it.
  const bridgeError =
    full && isCli(settings.provider) && status?.ok === false ? status.message : undefined;
  const disabled = !chat.target || opening;
  const message = chat.error || error;

  return (
    <div class={full ? 'hero' : 'hero quiet'}>
      <div class="starts">
        <button type="button" class="new-chat" disabled={disabled} onClick={() => open()}>
          <ChatIcon />
          New chat
        </button>
        <button
          type="button"
          class="new-chat alt"
          disabled={disabled}
          onClick={() => open({ kind: 'document' })}
        >
          <DocumentIcon />
          New document
        </button>
      </div>
      {message && (
        <p class="note note-error" role="alert">
          {message}
        </p>
      )}
      <div class="using">
        <span class={`dot ${link.tone}`} role="img" aria-label={link.label} title={link.label} />
        <span class="grow" title={`${summary.title} ${summary.detail}`}>
          <b>{summary.title}</b> <span class="muted">{summary.detail}</span>
        </span>
        <button type="button" class="text-btn" onClick={onOpenProvider}>
          Change
        </button>
        <button
          type="button"
          class="text-btn"
          aria-label="Test connection"
          disabled={test.running}
          onClick={test.run}
        >
          Test
        </button>
      </div>
      {full && (
        <div class="hero-status">
          {bridgeError ? (
            <BridgeErrorNote message={bridgeError} />
          ) : (
            link.tone !== 'ok' && <span class={`link-label ${link.tone}`}>{link.label}</span>
          )}
          <TestStatus test={test} />
        </div>
      )}
    </div>
  );
}
