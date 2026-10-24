import { useEffect, useState } from 'preact/hooks';
import { listDocuments, type SavedDocument } from '../core/documents';
import { type DefaultMode, type Settings } from '../core/settings';
import { shortWhen } from '../core/when';
import { useSettingsApi } from '../options/useSettings';
import { type ChatTarget } from './chrome';
import { useOpenChat } from './useChat';

const RECENT = 3;

const MODES: { value: DefaultMode; label: string; title?: string }[] = [
  { value: 'fix', label: 'Fix' },
  { value: 'rephrase', label: 'Rephrase', title: 'Rephrase (keep tone)' },
  { value: 'shorter', label: 'Shorter' },
];

const MODE_HELP: Record<DefaultMode, string> = {
  fix: 'Corrects spelling and grammar, keeps your words.',
  rephrase: 'Rewrites for clarity and keeps your tone.',
  shorter: 'Trims the text and keeps the meaning.',
};

interface HomeTabProps {
  settings: Settings;
  target: ChatTarget | undefined;
}

export function HomeTab({ settings, target }: HomeTabProps) {
  const { change } = useSettingsApi();

  return (
    <>
      <RecentDocuments target={target} />
      <section class="sec" aria-labelledby="mode-h">
        <h2 id="mode-h">Button and shortcut do</h2>
        <div class="seg" role="radiogroup" aria-labelledby="mode-h">
          {MODES.map((mode) => {
            const on = settings.defaultMode === mode.value;
            return (
              <label key={mode.value} class={on ? 'on' : undefined} title={mode.title}>
                <input
                  type="radio"
                  name="default-mode"
                  value={mode.value}
                  checked={on}
                  onChange={() => change({ defaultMode: mode.value })}
                />
                {mode.label}
              </label>
            );
          })}
        </div>
        <p class="help">{MODE_HELP[settings.defaultMode]}</p>
      </section>
    </>
  );
}

function RecentDocuments({ target }: { target: ChatTarget | undefined }) {
  const [documents, setDocuments] = useState<SavedDocument[] | 'error'>();
  const { opening, error, open } = useOpenChat(target);

  useEffect(() => {
    let alive = true;
    void listDocuments().then(
      (list) => {
        if (alive) setDocuments(list.slice(0, RECENT));
      },
      () => {
        if (alive) setDocuments('error');
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section class="sec" aria-labelledby="recent-h">
      <h2 id="recent-h">Recent documents</h2>
      {documents === 'error' && <p class="help">Could not load documents.</p>}
      {documents?.length === 0 && <p class="help">No documents yet. New document starts one.</p>}
      {Array.isArray(documents) && documents.length > 0 && (
        <ul class="recent" aria-labelledby="recent-h">
          {documents.map(({ id, title, updatedAt }) => (
            <li key={id}>
              <button
                type="button"
                disabled={!target || opening}
                onClick={() => open({ kind: 'document', documentId: id })}
              >
                <span class="t" dir="auto">
                  {title || 'Untitled'}
                </span>
                <span class="when">{shortWhen(updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p class="note note-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
