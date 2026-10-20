const words = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ');
export const small = { input: 'i has went home', output: 'I went home.' };
export const multilingual = {
  input: 'hello انا رحت home امبارح مع my friend',
  output: 'Hello انا رحت home امبارح مع my friend.',
};
export const large = { input: words('alpha', 1500), output: words('beta', 1500) };
export const rich = {
  input: Array(150).fill('i has went home yesterday with my friend').join(' '),
  output: Array(150).fill('I went home yesterday with my friend.').join(' '),
};
export const fragmentBytes = 1024;
export const payload = 'x'.repeat(2 * 1024 * 1024 - 7) + 'مرحبا🌍';
export const browserNames = [
  'rewrite-small',
  'rewrite-multilingual',
  'diff-1500-no-overlap',
  'selection-100',
  'idle-off',
  'rich-marker',
  'api-native-checks',
  'connection-owner-close',
  'model-settings-frames',
  'open-close-retention',
];
export const coreNames = [
  'rewrite-1000-manual',
  'rewrite-1000-idle',
  'native-frame-1k',
  'sse-1k',
  'host-ready-before-close',
];
export const sizes = (fixture) => ({
  inputBytes: Buffer.byteLength(fixture.input),
  inputWords: fixture.input.split(/\s+/u).length,
  outputBytes: Buffer.byteLength(fixture.output),
});
