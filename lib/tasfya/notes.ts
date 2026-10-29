import { idbStore, requestPersistentStorage } from "@/lib/hayaa/idb";

/**
 * Per-item-code notes, kept only on this PC in IndexedDB — nothing is ever
 * sent to the server. Notes are global (not per project), so a note written on
 * a code shows up in every tasfya mode and every project that has that code.
 */

interface NoteRecord {
  code: string;
  text: string;
  updatedAt: number;
}

const tx = idbStore("tasfya-notes", "notes", "code");

/** All saved notes, keyed by item code. */
export async function loadNotes(): Promise<Record<string, string>> {
  const all = (await tx<NoteRecord[]>("readonly", (s) => s.getAll())) ?? [];
  return Object.fromEntries(all.map((n) => [n.code, n.text]));
}

/** Saves a code's note; an empty (whitespace-only) note deletes it. */
export async function saveNote(code: string, text: string): Promise<void> {
  if (!text.trim()) {
    await tx("readwrite", (s) => s.delete(code));
    return;
  }
  const record: NoteRecord = { code, text, updatedAt: Date.now() };
  await tx("readwrite", (s) => s.put(record));
  void requestPersistentStorage();
}
