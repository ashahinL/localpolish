# T26b. Document storage

LocalPolish is a Chrome MV3 extension (WXT, TypeScript, Preact, Vitest). Release 1.5.0 adds "documents": drafts the owner writes in the side panel. This task adds only their storage module and one manifest permission. No UI.

Follow the `implement-plan` skill in its light form: build, test, keep the plan file current, report. Skip the guard skills (clean-code-guard, test-guard, docs-guard) and the final review pass. **Do not commit.** The orchestrator reviews and commits.

## Decisions (settled, do not change)

- A document is `{ id, title, body, createdAt, updatedAt }`, all strings except the two timestamps (ms since epoch).
- Kept until the owner deletes it. **No count limit and no age limit** (unlike chats, which keep 50 for 30 days).
- One record may be at most 128 KiB, measured exactly like chats: `new TextEncoder().encode(JSON.stringify(record)).byteLength`.
- Stored in `chrome.storage.local` under the key `documents`, as an array.
- Saving with an `id` that is not stored (for example, deleted in another window while this one autosaves) **creates** it with that id and `createdAt = now`. It never throws for that case, so a draft is never lost.
- The storage layer does not reject empty documents. The UI decides what to save.

## Steps

1. **New `src/core/storageLock.ts`.** Move the lock out of `src/core/chatHistory.ts` (`historyQueue` and `withHistoryLock`, lines 34–46) into one exported function:

   ```ts
   export function createStorageLock(name: string): <T>(work: () => Promise<T>) => Promise<T>;
   ```

   Same behavior as today: use `navigator.locks.request(name, work)` when `globalThis.navigator?.locks` exists, otherwise a per-lock promise queue that keeps going after a failure. In `chatHistory.ts` replace the two with `const withHistoryLock = createStorageLock('localpolish-chat-history');`. Nothing else in `chatHistory.ts` changes. `src/core/chatHistory.test.ts` must pass **unchanged**.

2. **New `src/core/documents.ts`**, written in the same style as `src/core/chatHistory.ts` (its `isRecord`, `isTimestamp`, `storageLocal`, `recordBytes`, `checkedChat`, `readChats` pattern). Export exactly:

   ```ts
   export interface SavedDocument { id: string; title: string; body: string; createdAt: number; updatedAt: number; }
   export interface SaveDocumentInput { id?: string; title: string; body: string; }
   export function listDocuments(): Promise<SavedDocument[]>;
   export function loadDocument(id: string): Promise<SavedDocument | undefined>;
   export function saveDocument(input: SaveDocumentInput): Promise<SavedDocument>;
   export function deleteDocument(id: string): Promise<void>;
   ```

   - Lock: `createStorageLock('localpolish-documents')`, used by `saveDocument` and `deleteDocument`.
   - Reading: ignore anything that is not an array. Drop invalid entries (wrong types, empty id, `createdAt > updatedAt`, over 128 KiB). Drop unknown fields. For duplicate ids keep the one with the newest `updatedAt`. Sort by `updatedAt` newest first, ties by `id` ascending (same comparator as `readChats`).
   - `saveDocument`: `id = input.id ?? crypto.randomUUID()`; `createdAt` from the stored record with that id, else `now`; `updatedAt = now` (`Date.now()`). If the record is over 128 KiB, throw `new Error('This document is over the 128 KiB save limit. Split it into two documents.')` and store nothing. Write the full sorted list back. Return a `structuredClone` of the saved record.
   - `deleteDocument`: remove that id and write the list back. Deleting a missing id is not an error.
   - `listDocuments` and `loadDocument` return independent copies.

3. **Add the permission.** In `wxt.config.ts` line 20, change the list to `['storage', 'unlimitedStorage', 'nativeMessaging', 'contextMenus']`.

4. **New `src/core/documents.test.ts`.** Copy the setup from `src/core/chatHistory.test.ts` lines 1–61 (fake timers with `NOW = 1_800_000_000_000`, the `stored` Map, the `get`/`set`/`remove` fakes, `crypto.randomUUID` and `navigator` stubs, `chrome.storage.local` stub). Use the key `documents`. Tests, each with literal expected values:
   - saves a new document and lists it; a second save one ms later lists newest first; equal `updatedAt` sorts by id.
   - updating keeps `createdAt` and changes `updatedAt`, `title` and `body`.
   - saving with an unknown id creates it with that id and `createdAt === updatedAt === now`.
   - a document older than 30 days and a 60th document are both still listed (no expiry, no cap). Create 60 documents and expect 60.
   - a record over 128 KiB throws the exact message above and leaves storage unchanged; a record exactly at the limit saves.
   - `deleteDocument` removes one; deleting a missing id resolves and leaves the rest.
   - bad stored data: a non-array value lists `[]`; invalid entries are dropped; unknown fields are dropped; the newest duplicate wins.
   - returned objects are independent (mutating a result does not change the next `listDocuments()`).
   - every write uses the browser lock named `localpolish-documents` (copy the test at `chatHistory.test.ts` lines 317–328).
   - a failed `set` rejects with that error and the next save still works (copy `chatHistory.test.ts` lines 330–339, for `get` and `set`).

## Gates

While working: `npx vitest run src/core/documents.test.ts src/core/chatHistory.test.ts`.
Once at the end: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npx prettier --check .`. No browser tests are needed for this task.

## Plan file

In `docs/plans/redesign-1.5.md`, tick `- [ ] **T26b.` to `- [x]` and change the `Status:` line to `Status: T26a and T26b done. Next: T26c.`

## Out of scope

No UI, no changes to `src/chat/**`, no changes to chat history behavior, no README or privacy docs (T26i does those).

## Report

- Files changed and what each change is.
- Gate results with the exact commands and pass/fail counts.
- Any decision you had to make that this brief did not settle.
- Did any of the work you did deserve to become a reusable skill (for this project or any project)? Name it, say what it would cover and why it would recur, or say none.
