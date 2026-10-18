interface PopupTab {
  url?: string;
}

interface PopupChrome {
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<PopupTab[]>;
  };
  runtime: {
    openOptionsPage(): Promise<void>;
    getManifest(): { version: string };
  };
}

function extension(): PopupChrome {
  return (globalThis as unknown as { chrome: PopupChrome }).chrome;
}

export async function activeTabUrl(): Promise<string | undefined> {
  const tabs = await extension().tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url;
}

export function openOptionsPage(): void {
  void extension().runtime.openOptionsPage();
}

export function extensionVersion(): string {
  return extension().runtime.getManifest().version;
}
