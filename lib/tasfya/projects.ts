import type { TasfyaResult } from "./types";

/**
 * Client-side project persistence — no database. Projects are kept in
 * localStorage (so work survives a refresh) and can additionally be exported
 * to / imported from a `.json` file for backup or moving between machines.
 *
 * A project stores the *computed* settlement (TasfyaResult) plus the user's
 * per-item settlement edits — not the raw uploaded HTML — so it restores
 * instantly without re-processing.
 */

export interface TasfyaProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  result: TasfyaResult;
  /** Per-item settlement overrides, keyed by item code (raw strings). */
  edits: Record<string, string>;
}

const STORAGE_KEY = "tasfya:projects:v1";
const SCHEMA_VERSION = 1;
const FILE_TYPE = "tasfya-project";

interface Container {
  version: number;
  projects: TasfyaProject[];
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** TasfyaResult.referenceDate survives JSON as an ISO string; revive it. */
function reviveResult(raw: TasfyaResult): TasfyaResult {
  return { ...raw, referenceDate: new Date(raw.referenceDate) };
}

function reviveProject(raw: TasfyaProject): TasfyaProject {
  return { ...raw, result: reviveResult(raw.result) };
}

/** All saved projects, most-recently-updated first. */
export function loadProjects(): TasfyaProject[] {
  if (!hasStorage()) return [];
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return [];
    const data = JSON.parse(text) as Container;
    const list = Array.isArray(data?.projects) ? data.projects : [];
    return list.map(reviveProject).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function persist(projects: TasfyaProject[]): void {
  if (!hasStorage()) return;
  const container: Container = { version: SCHEMA_VERSION, projects };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(container));
}

/** A sensible default name from the report's supplier / order number. */
export function suggestName(result: TasfyaResult): string {
  const parts = [result.supplierCompany, result.orderNumber && `#${result.orderNumber}`]
    .filter(Boolean)
    .join(" ");
  return parts || "Project";
}

/** Creates a new project from the current report + edits and stores it. */
export function createProject(
  name: string,
  result: TasfyaResult,
  edits: Record<string, string>,
): TasfyaProject {
  const now = Date.now();
  const project: TasfyaProject = {
    id: newId(),
    name: name.trim() || suggestName(result),
    createdAt: now,
    updatedAt: now,
    result,
    edits,
  };
  persist([project, ...loadProjects()]);
  return project;
}

/** Updates an existing project's data (used by auto-save). No-op if missing. */
export function updateProject(
  id: string,
  patch: Partial<Pick<TasfyaProject, "name" | "result" | "edits">>,
): TasfyaProject[] {
  const projects = loadProjects().map((p) =>
    p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
  );
  persist(projects);
  return projects;
}

export function deleteProject(id: string): TasfyaProject[] {
  const projects = loadProjects().filter((p) => p.id !== id);
  persist(projects);
  return projects;
}

/** Triggers a download of the project as a portable `.json` file. */
export function exportProjectFile(project: TasfyaProject): void {
  const payload = { type: FILE_TYPE, version: SCHEMA_VERSION, project };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safe = project.name.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "project";
  a.download = `tasfya-${safe}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parses an exported project file and stores it as a *new* project (fresh id,
 * so importing never overwrites an existing one). Throws on an invalid file.
 */
export function importProjectFile(text: string): TasfyaProject {
  const data = JSON.parse(text) as {
    type?: string;
    project?: TasfyaProject;
  };
  if (data?.type !== FILE_TYPE || !data.project?.result) {
    throw new Error("Not a valid Tasfya project file.");
  }
  const now = Date.now();
  const imported = reviveProject(data.project);
  const project: TasfyaProject = {
    ...imported,
    id: newId(),
    createdAt: imported.createdAt ?? now,
    updatedAt: now,
  };
  persist([project, ...loadProjects()]);
  return project;
}
