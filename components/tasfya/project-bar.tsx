"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  FolderOpen,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createProject,
  deleteProject,
  exportProjectFile,
  importProjectFile,
  loadProjects,
  suggestName,
  updateProject,
  type TasfyaProject,
} from "@/lib/tasfya/projects";
import type { TasfyaResult } from "@/lib/tasfya/types";

interface ProjectBarProps {
  result: TasfyaResult | null;
  edits: Record<string, string>;
  currentId: string | null;
  onCurrentIdChange: (id: string | null) => void;
  /** Load a project's data into the page. */
  onApply: (result: TasfyaResult, edits: Record<string, string>) => void;
  /** Clear the page for a fresh upload. */
  onNew: () => void;
}

export function ProjectBar({
  result,
  edits,
  currentId,
  onCurrentIdChange,
  onApply,
  onNew,
}: ProjectBarProps) {
  const [projects, setProjects] = useState<TasfyaProject[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Load the saved list once on mount (client-only).
  useEffect(() => {
    setProjects(loadProjects());
  }, []);

  const current = projects.find((p) => p.id === currentId) ?? null;

  // Auto-save: whenever the current project's data changes, debounce-write it.
  useEffect(() => {
    if (!currentId || !result) return;
    const handle = setTimeout(() => {
      setProjects(updateProject(currentId, { result, edits }));
      setSavedFlash(true);
      const t = setTimeout(() => setSavedFlash(false), 1200);
      return () => clearTimeout(t);
    }, 600);
    return () => clearTimeout(handle);
  }, [currentId, result, edits]);

  const handleSaveNew = () => {
    if (!result) return;
    const name = window.prompt("Project name", suggestName(result));
    if (name === null) return; // cancelled
    const project = createProject(name, result, edits);
    setProjects(loadProjects());
    onCurrentIdChange(project.id);
  };

  const handleSelect = (id: string) => {
    if (!id) {
      onNew();
      onCurrentIdChange(null);
      return;
    }
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    onCurrentIdChange(project.id);
    onApply(project.result, project.edits);
  };

  const handleDelete = () => {
    if (!current) return;
    if (!window.confirm(`Delete project “${current.name}”?`)) return;
    setProjects(deleteProject(current.id));
    onCurrentIdChange(null);
    onNew();
  };

  const commitRename = () => {
    if (current && draftName.trim()) {
      setProjects(updateProject(current.id, { name: draftName.trim() }));
    }
    setRenaming(false);
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const project = importProjectFile(text);
      setProjects(loadProjects());
      onCurrentIdChange(project.id);
      onApply(project.result, project.edits);
    } catch {
      window.alert("Could not import this file — it is not a valid Tasfya project.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/30 p-2">
      <FolderOpen className="ml-1 size-4 shrink-0 text-muted-foreground" />

      {/* Project picker */}
      <select
        value={currentId ?? ""}
        onChange={(e) => handleSelect(e.target.value)}
        className="h-9 max-w-56 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="Select project"
      >
        <option value="">— New / unsaved —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <Button variant="outline" size="sm" onClick={() => handleSelect("")}>
        <Plus /> New
      </Button>

      {/* Save: create when unsaved, otherwise show the auto-save state */}
      {currentId ? (
        savedFlash ? (
          <span className="inline-flex items-center gap-1 px-2 text-sm text-emerald-600 dark:text-emerald-400">
            <Check className="size-4" /> Saved
          </span>
        ) : (
          <span className="px-2 text-sm text-muted-foreground">Auto-saved</span>
        )
      ) : (
        <Button size="sm" onClick={handleSaveNew} disabled={!result}>
          <Save /> Save project
        </Button>
      )}

      {current && (
        <>
          {renaming ? (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenaming(false);
                }}
                className="h-9 w-40 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <Button variant="ghost" size="sm" onClick={commitRename}>
                <Check />
              </Button>
            </span>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraftName(current.name);
                setRenaming(true);
              }}
              title="Rename"
            >
              <Pencil />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportProjectFile(current)}
            title="Export to file"
          >
            <Download />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDelete}
            title="Delete project"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </Button>
        </>
      )}

      <span className="mx-1 h-5 w-px bg-border" />

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImport(file);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <Upload /> Import
      </Button>

      <span className="ml-auto px-1 text-xs text-muted-foreground">
        {projects.length} saved
      </span>
    </div>
  );
}
