export const HOST_NAME = 'com.localpolish.bridge';
export const EXTENSION_ID = 'ealpmjmaclnlpelpcacmbicmdipmbeei';
export const TIMEOUT_MS = 60_000;
// Each Chromium browser on Windows reads native hosts from its own key.
export const WINDOWS_REGISTRY_KEYS = [
  'Google\\Chrome',
  'BraveSoftware\\Brave-Browser',
  'Microsoft\\Edge',
  'Chromium',
].map((browser) => `HKCU\\Software\\${browser}\\NativeMessagingHosts\\${HOST_NAME}`);
