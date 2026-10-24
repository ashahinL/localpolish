export interface PopupTab {
  id?: number;
  windowId?: number;
  url?: string;
}

interface PopupChrome {
  sidePanel: { open(target: { windowId: number }): Promise<void> };
  tabs: {
    query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<PopupTab[]>;
  };
  runtime: {
    openOptionsPage(): Promise<void>;
    sendMessage(message: unknown): Promise<unknown>;
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

export interface ChatTarget {
  tabId: number;
  windowId: number;
}

export interface DocumentEntry {
  kind: 'document';
  documentId?: string;
}

export async function chatTarget(): Promise<ChatTarget> {
  const tab = (await extension().tabs.query({ active: true, currentWindow: true }))[0];
  if (tab?.id === undefined || tab.windowId === undefined)
    throw new Error('Could not find the active tab.');
  return { tabId: tab.id, windowId: tab.windowId };
}

export async function openPlainChat(target: ChatTarget, entry?: DocumentEntry): Promise<void> {
  // This first call must stay before every await to retain the popup click gesture.
  await extension().sidePanel.open({ windowId: target.windowId });
  const reply = await extension().runtime.sendMessage({
    type: 'chat-open-plain',
    ...target,
    ...entry,
  });
  if (!(reply as { ok?: boolean } | undefined)?.ok) {
    throw new Error(
      (reply as { message?: string } | undefined)?.message ?? 'Could not start chat.',
    );
  }
  window.close();
}
