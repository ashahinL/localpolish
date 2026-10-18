interface SetupChrome {
  tabs: {
    getCurrent(): Promise<{ id?: number } | undefined>;
    remove(tabId: number): Promise<void>;
  };
}

function extension(): SetupChrome {
  return (globalThis as unknown as { chrome: SetupChrome }).chrome;
}

export async function closeThisTab(): Promise<void> {
  const tab = await extension().tabs.getCurrent();
  if (tab?.id === undefined) {
    window.close();
    return;
  }
  await extension().tabs.remove(tab.id);
}
