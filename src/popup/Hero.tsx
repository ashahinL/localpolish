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
  /**
   * False on the Provider tab, which has its own Test connection, bridge status and result.
   * The hero then hides those (keeping its height, so the tabs do not move).
   */
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
        <span class={`dot ${link.tone}`} aria-hidden="true" />
        <span class="grow">
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
      <div class="hero-status">
        {bridgeError ? (
          <BridgeErrorNote message={bridgeError} />
        ) : (
          // A blank line on Provider keeps the height without repeating the Bridge section.
          <span class={`link-label ${link.tone}`}>{full ? link.label : ' '}</span>
        )}
        {full && <TestStatus test={test} />}
      </div>
    </div>
  );
}
