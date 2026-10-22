import { readChatTarget } from './pending';

interface InsertChrome {
  windows: { getCurrent(): Promise<{ id?: number }> };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

export async function insertAnswer(sequence: string | undefined, text: string): Promise<void> {
  if (!sequence || !(await readChatTarget(sequence)))
    throw new Error(
      'This chat has no live text field. Open chat from the page again, or use Copy.',
    );
  const ext = (globalThis as unknown as { chrome: InsertChrome }).chrome;
  const { id } = await ext.windows.getCurrent();
  const result = await ext.runtime.sendMessage({
    type: 'chat-insert',
    sequence,
    windowId: id,
    text,
  });
  if (typeof result !== 'object' || result === null || (result as { ok?: unknown }).ok !== true)
    throw new Error(
      (result as { message?: string } | undefined)?.message ??
        'Could not insert. Use Copy instead.',
    );
}
