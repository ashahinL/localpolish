export const HOST_NAME = 'com.localpolish.bridge';
export const EXTENSION_ID = 'ealpmjmaclnlpelpcacmbicmdipmbeei';
export const TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 180_000;
export const MAX_NATIVE_FRAME_BYTES = 8 * 1024 * 1024;
export const MAX_CLI_EVENT_BYTES = 8 * 1024 * 1024;
// buildPrompt already wraps raw text as "<text>\n" + text + "\n</text>" (15 bytes).
export const MAX_INPUT_BYTES = 256 * 1024;
// Total raw generated text, before output cleanup, counted in UTF-8 bytes.
export const MAX_OUTPUT_BYTES = 1024 * 1024;
export const OUTPUT_LIMIT_MESSAGE =
  'The generated text is over the 1 MiB output limit. Try again with a shorter text.';
export const MAX_USER_PROMPT_BYTES = MAX_INPUT_BYTES + 15;
export const INPUT_LIMIT_MESSAGE =
  'This text is over the 256 KiB limit, so it was not sent. Shorten it and try again.';
// Each Chromium browser on Windows reads native hosts from its own key.
export const WINDOWS_REGISTRY_KEYS = [
  'Google\\Chrome',
  'BraveSoftware\\Brave-Browser',
  'Microsoft\\Edge',
  'Chromium',
].map((browser) => `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST_NAME}`);
