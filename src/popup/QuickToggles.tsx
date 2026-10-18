import { type ComponentChildren } from 'preact';
import { type Settings } from '../core/settings';
import { useSettingsApi } from '../options/useSettings';
import { BoltIcon } from './icons';
import { hideSite, showSite, siteState, type SiteState } from './sites';
import { Switch } from './Switch';

interface QuickTogglesProps {
  settings: Settings;
  host: string | null | undefined;
  onOpenSites(): void;
}

export function QuickToggles({ settings, host, onOpenSites }: QuickTogglesProps) {
  const { change } = useSettingsApi();
  return (
    <section class="quick" aria-label="Quick switches">
      <div class="qrow">
        <span class="qicon" aria-hidden="true">
          <BoltIcon />
        </span>
        <div class="qtxt">
          <b id="idle-title">Fix while I type</b>
          <span id="idle-desc">
            {settings.idleFix
              ? 'Fixes a field after a 3 s pause'
              : 'Off. The button and the shortcut still work'}
          </span>
        </div>
        <Switch
          checked={settings.idleFix}
          labelId="idle-title"
          descId="idle-desc"
          onToggle={() => change({ idleFix: !settings.idleFix })}
        />
      </div>
      <SiteRow settings={settings} host={host} onOpenSites={onOpenSites} />
    </section>
  );
}

function siteLetter(host: string): string {
  const bare = host.toLowerCase().startsWith('www.') ? host.slice(4) : host;
  return bare.charAt(0).toUpperCase();
}

function SiteRow({ settings, host, onOpenSites }: QuickTogglesProps) {
  const { change } = useSettingsApi();
  const state = typeof host === 'string' ? siteState(host, settings.blocklist) : null;
  const title = host === undefined ? 'This site' : host === null ? 'This page' : `Show on ${host}`;

  const toggle = () => {
    if (typeof host !== 'string' || state === null || state.kind === 'hidden-by') return;
    const blocklist =
      state.kind === 'hidden'
        ? showSite(host, settings.blocklist)
        : hideSite(host, settings.blocklist);
    change({ blocklist });
  };

  return (
    <div class={state?.kind === 'hidden' ? 'qrow hidden-here' : 'qrow'}>
      <span class="qicon site" aria-hidden="true">
        {typeof host === 'string' ? siteLetter(host) : ''}
      </span>
      <div class="qtxt">
        <b id="site-title">{title}</b>
        <SiteDescription host={host} state={state} onOpenSites={onOpenSites} />
      </div>
      <Switch
        checked={state?.kind === 'shown'}
        labelId="site-title"
        descId={host === undefined ? undefined : 'site-desc'}
        disabled={state === null || state.kind === 'hidden-by'}
        onToggle={toggle}
      />
    </div>
  );
}

function SiteDescription({
  host,
  state,
  onOpenSites,
}: {
  host: string | null | undefined;
  state: SiteState | null;
  onOpenSites(): void;
}): ComponentChildren {
  if (host === undefined) return null;
  if (host === null) {
    return <span id="site-desc">LocalPolish does not run on this page</span>;
  }
  if (state === null || state.kind === 'shown') {
    return <span id="site-desc">The button and the idle Fix run here</span>;
  }
  if (state.kind === 'hidden') {
    return <span id="site-desc">Hidden here. The shortcut still works</span>;
  }
  return (
    <span id="site-desc">
      Hidden by {state.rule}.{' '}
      <button type="button" class="link" onClick={onOpenSites}>
        Edit in Sites
      </button>
    </span>
  );
}
