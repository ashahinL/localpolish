const MODIFIERS: Record<string, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'> = {
  Ctrl: 'ctrlKey',
  Command: 'metaKey',
  '⌘': 'metaKey',
  MacCtrl: 'ctrlKey',
  '⌃': 'ctrlKey',
  Alt: 'altKey',
  '⌥': 'altKey',
  Shift: 'shiftKey',
  '⇧': 'shiftKey',
};

type Chord = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export function matchesShortcut(
  shortcut: string,
  event: {
    key: string;
    code?: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  },
): boolean {
  const chord = parseShortcut(shortcut);
  if (!chord) return false;
  return (
    event.ctrlKey === chord.ctrlKey &&
    event.metaKey === chord.metaKey &&
    event.altKey === chord.altKey &&
    event.shiftKey === chord.shiftKey &&
    (event.key.toLowerCase() === chord.key.toLowerCase() || event.code === physicalCode(chord.key))
  );
}

// On macOS, Option changes event.key (Option+Shift+L types Ò), so letters and digits also match by key position.
function physicalCode(key: string): string | undefined {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return undefined;
}

// Named shortcuts are Ctrl+Shift+K. macOS symbols have no separator: ⇧⌘K.
function parseShortcut(shortcut: string): Chord | null {
  if (shortcut === '') return null;
  const chord: Chord = {
    key: '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
  };
  if (shortcut.includes('+')) {
    const parts = shortcut.split('+');
    const key = parts.pop();
    if (!key) return null;
    chord.key = key;
    for (const part of parts) {
      const flag = MODIFIERS[part];
      if (!flag) return null;
      chord[flag] = true;
    }
    return chord;
  }
  const chars = [...shortcut];
  let keyStart = 0;
  for (const char of chars) {
    const flag = MODIFIERS[char];
    if (!flag) break;
    chord[flag] = true;
    keyStart += 1;
  }
  chord.key = chars.slice(keyStart).join('');
  if (chord.key === '') return null;
  return chord;
}
