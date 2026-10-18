import { type Settings } from '../core/settings';
import { useSettingsApi } from '../options/useSettings';
import { BoltIcon } from './icons';
import { hideSite, showSite, siteState, type SiteState } from './sites';
import { Switch } from './Switch';
import { Tooltip } from './Tooltip';

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
          <Tooltip
            id="idle-desc"
            text={
              settings.idleFix
                ? 'Fixes a field after a 3 s pause'
                : 'Off. The button and the shortcut still work'
            }
          >
            <b id="idle-title">Fix while I type</b>
          </Tooltip>
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
  const help = siteHelp(host, state);

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
        {help === null ? (
          <b id="site-title">{title}</b>
        ) : (
          <Tooltip id="site-desc" text={help}>
            <b id="site-title">{title}</b>
          </Tooltip>
        )}
        {state?.kind === 'hidden-by' && (
          <span id="site-desc">
            Hidden by {state.rule}.{' '}
            <button type="button" class="link" onClick={onOpenSites}>
              Edit in Sites
            </button>
          </span>
        )}
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

function siteHelp(host: string | null | undefined, state: SiteState | null): string | null {
  if (host === undefined || state?.kind === 'hidden-by') return null;
  if (host === null) return 'LocalPolish does not run on this page';
  if (state === null || state.kind === 'shown') return 'The button and the idle Fix run here';
  return 'Hidden here. The shortcut still works';
}
