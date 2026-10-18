import { type Settings } from '../core/settings';
import { AnthropicDetails, CliDetails, isCli, OpenAiDetails } from '../options/ProviderSection';
import { BridgeCard } from './BridgeCard';
import { ProviderPicker } from './ProviderPicker';
import { providerSummary } from './summary';
import { TestConnection } from './TestConnection';
import { type BridgeState } from './useBridge';
import { type TestState } from './useTest';

interface ProviderTabProps {
  settings: Settings;
  bridge: BridgeState;
  test: TestState;
}

export function ProviderDetails({ settings }: { settings: Settings }) {
  const { provider } = settings;
  const { title } = providerSummary(settings);
  return (
    <section class="card stack" id="details" aria-labelledby="pd-h">
      <div class="ctitle">
        <h2 id="pd-h">{title} settings</h2>
      </div>
      <div class="details" key={provider}>
        {isCli(provider) && <CliDetails provider={provider} settings={settings} />}
        {provider === 'openai-compatible' && <OpenAiDetails settings={settings} />}
        {provider === 'anthropic-api' && <AnthropicDetails settings={settings} />}
      </div>
    </section>
  );
}

export function ProviderTab({ settings, bridge, test }: ProviderTabProps) {
  const { provider } = settings;
  const { title } = providerSummary(settings);

  return (
    <>
      <ProviderPicker settings={settings} />
      <ProviderDetails settings={settings} />
      {isCli(provider) && <BridgeCard bridge={bridge} />}
      <section class="card stack" aria-labelledby="tc-h">
        <div class="ctitle">
          <h2 id="tc-h">Test connection</h2>
        </div>
        <p class="help">Runs a tiny Fix with {title}.</p>
        <TestConnection test={test} wide />
      </section>
    </>
  );
}
