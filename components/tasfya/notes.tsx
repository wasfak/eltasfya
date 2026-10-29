"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, StickyNote, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadNotes, saveNote } from "@/lib/tasfya/notes";

/**
 * Per-code notes UI shared by the tasfya and zaghlol pages. Notes live on this
 * PC (IndexedDB, see lib/tasfya/notes.ts), so both pages see the same notes.
 */
export function useNotes() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Code whose note editor is open (null = closed).
  const [noteCode, setNoteCode] = useState<string | null>(null);

  useEffect(() => {
    loadNotes()
      .then(setNotes)
      .catch(() => setNotes({}));
  }, []);

  /** Persists a note (empty = delete) and updates the in-memory map. */
  async function save(code: string, text: string) {
    await saveNote(code, text);
    setNotes((prev) => {
      const next = { ...prev };
      if (text.trim()) next[code] = text;
      else delete next[code];
      return next;
    });
  }

  return { notes, noteCode, openNote: setNoteCode, save };
}

/** Icon button beside a code: sky outline when empty, filled when a note exists. */
export function NoteButton({
  code,
  note,
  onClick,
}: {
  code: string;
  note: string | undefined;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={note ?? "Add a note"}
      aria-label={`Note for ${code}`}
      className={cn(
        "grid size-8 place-items-center rounded-md hover:bg-sky-100 dark:hover:bg-sky-950/60",
        note
          ? "text-sky-600 dark:text-sky-400"
          : "text-sky-500/70 hover:text-sky-600 dark:text-sky-500/70 dark:hover:text-sky-400",
      )}
    >
      <StickyNote
        className={cn("size-5", note && "fill-sky-200 dark:fill-sky-900")}
      />
    </button>
  );
}

/** The note's text shown under the item name; click to edit. */
export function NoteLine({
  note,
  onClick,
}: {
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      dir="auto"
      onClick={onClick}
      className="mx-auto mt-1.5 line-clamp-3 block max-w-80 whitespace-pre-line rounded-md border border-sky-300 bg-sky-100 px-2.5 py-1 text-sm font-medium text-sky-900 hover:bg-sky-200 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-200 dark:hover:bg-sky-900/60"
    >
      {note}
    </button>
  );
}

/** Modal editor for one code's note. */
export function NoteDialog({
  code,
  name,
  note,
  onSave,
  onClose,
}: {
  code: string;
  name?: string;
  note: string | undefined;
  onSave: (code: string, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape (discarding the unsaved draft).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function commit(text: string) {
    setSaving(true);
    setError(null);
    try {
      await onSave(code, text);
      onClose();
    } catch {
      setError("Couldn't save the note — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-lg font-bold">Note</h2>
            <p className="text-sm text-muted-foreground">
              {code}
              {name ? ` — ${name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 place-items-center rounded-lg hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <textarea
            autoFocus
            dir="auto"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                void commit(draft);
            }}
            rows={6}
            placeholder="Write a note for this code…"
            className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="text-xs text-muted-foreground">
            Saved only on this PC — never uploaded. Shows on this code in every
            mode and project. Ctrl+Enter to save.
          </p>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border p-4">
          {note ? (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => commit("")}
              className="text-red-600 hover:text-red-700 dark:text-red-400"
            >
              Delete note
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => commit(draft)}>
              {saving ? <Loader2 className="animate-spin" /> : <Check />}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
