import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";

import { VAULT_ROOT } from "./vaultroot";

export type FsNode = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number;
  modified: string;
  children?: FsNode[];
};

export type SearchHit = {
  path: string;
  title: string;
  excerpt: string;
  score: number;
  modified: string;
};

export type SomeTask = {
  id: string;
  title: string;
  status: "todo" | "in_progress" | "done";
  priority: "high" | "medium" | "low";
  project: string;
  dueDate: string;
  body: string;
  tags: string[];
};

export type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  endDate?: string;
  kind?: string;
  notes?: string;
};

const TEXT_EXTENSIONS = new Set([".md", ".mdx", ".txt", ".json", ".csv", ".log", ".yaml", ".yml"]);
const ROOT_FOLDERS = ["sources", "wiki"];
const MODEL_URL = `${process.env.LLM_BASE_URL || "http://127.0.0.1:8000/v1"}/chat/completions`;
const MODEL_NAME = process.env.LLM_MODEL || "gemma-4-12b-it";

function normalizeRelative(input: string): string {
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === ".") return "";
  if (normalized.split("/").some((part) => part === ".." || !part)) throw new Error("Invalid path");
  if (!ROOT_FOLDERS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
    throw new Error("Path must be inside sources/ or wiki/");
  }
  return normalized;
}

export function resolveVaultPath(input: string): { relative: string; full: string } {
  const relative = normalizeRelative(input);
  const full = path.resolve(VAULT_ROOT, relative);
  const root = path.resolve(VAULT_ROOT);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) throw new Error("Invalid path");
  return { relative, full };
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "untitled";
}

export async function ensureVault(): Promise<void> {
  const dirs = [
    "sources/inbox",
    "sources/daily",
    "sources/notes",
    "sources/devices",
    "sources/uploads",
    "wiki/pages",
    "wiki/tasks",
    "wiki/calendar",
  ];
  await Promise.all(dirs.map((dir) => fs.mkdir(path.join(VAULT_ROOT, dir), { recursive: true })));
  const events = path.join(VAULT_ROOT, "wiki/calendar/events.json");
  const log = path.join(VAULT_ROOT, "wiki/log.md");
  await Promise.all([
    fs.access(events).catch(() => fs.writeFile(events, "[]\n", "utf8")),
    fs.access(log).catch(() => fs.writeFile(log, "# SomeOS activity\n\n", "utf8")),
  ]);
}

async function toNode(relative: string): Promise<FsNode> {
  const { full } = resolveVaultPath(relative);
  const stat = await fs.stat(full);
  const name = path.basename(full);
  if (stat.isDirectory()) {
    const names = await fs.readdir(full);
    const children = (
      await Promise.all(
        names
          .filter((entry) => !entry.startsWith("."))
          .map((entry) => toNode(`${relative}/${entry}`)),
      )
    ).sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { name, path: relative, type: "folder", size: children.reduce((sum, child) => sum + child.size, 0), modified: stat.mtime.toISOString(), children };
  }
  return { name, path: relative, type: "file", size: stat.size, modified: stat.mtime.toISOString() };
}

function flatten(nodes: FsNode[]): FsNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);
}

export async function getSnapshot() {
  await ensureVault();
  const tree = await Promise.all(ROOT_FOLDERS.map((root) => toNode(root)));
  const all = flatten(tree);
  const files = all.filter((node) => node.type === "file");
  const sourceFiles = files.filter((node) => node.path.startsWith("sources/"));
  const wikiFiles = files.filter((node) => node.path.startsWith("wiki/pages/"));
  const taskFiles = files.filter((node) => node.path.startsWith("wiki/tasks/"));
  const recent = [...files].sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 12);
  let modelOnline = false;
  try {
    const response = await fetch(`${process.env.LLM_BASE_URL || "http://127.0.0.1:8000/v1"}/models`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    modelOnline = response.ok;
  } catch {
    modelOnline = false;
  }
  return {
    tree,
    recent,
    stats: {
      sources: sourceFiles.length,
      pages: wikiFiles.length,
      tasks: taskFiles.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
    },
    model: { online: modelOnline, name: MODEL_NAME },
    generatedAt: new Date().toISOString(),
  };
}

export async function readVaultText(relative: string) {
  const resolved = resolveVaultPath(relative);
  const stat = await fs.stat(resolved.full);
  if (!stat.isFile()) throw new Error("Not a file");
  if (!TEXT_EXTENSIONS.has(path.extname(resolved.full).toLowerCase())) throw new Error("Preview is available for text files only");
  const content = await fs.readFile(resolved.full, "utf8");
  return { path: resolved.relative, content, size: stat.size, modified: stat.mtime.toISOString() };
}

export async function writeVaultText(relative: string, content: string) {
  const resolved = resolveVaultPath(relative);
  if (!TEXT_EXTENSIONS.has(path.extname(resolved.full).toLowerCase())) throw new Error("Only text files can be edited");
  await fs.mkdir(path.dirname(resolved.full), { recursive: true });
  const temp = `${resolved.full}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temp, content, "utf8");
  await fs.rename(temp, resolved.full);
  return readVaultText(resolved.relative);
}

async function collectTextFiles(relativeRoot: string): Promise<string[]> {
  const { full } = resolveVaultPath(relativeRoot);
  const out: string[] = [];
  async function visit(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const child = path.join(dir, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) await visit(child, childRel);
      else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(childRel);
    }
  }
  await visit(full, relativeRoot);
  return out;
}

function excerptFor(content: string, terms: string[]): string {
  const flat = content.replace(/^---[\s\S]*?---/m, "").replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const first = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 90);
  const excerpt = flat.slice(start, start + 260);
  return `${start > 0 ? "…" : ""}${excerpt}${start + 260 < flat.length ? "…" : ""}`;
}

export async function searchFilesystem(query: string, limit = 20): Promise<SearchHit[]> {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const files = [...(await collectTextFiles("sources")), ...(await collectTextFiles("wiki"))];
  const hits: SearchHit[] = [];
  for (const relative of files) {
    if (relative.endsWith(".someos-index.json")) continue;
    const { full } = resolveVaultPath(relative);
    const stat = await fs.stat(full);
    if (stat.size > 1_000_000) continue;
    const content = await fs.readFile(full, "utf8");
    const lower = content.toLowerCase();
    const pathLower = relative.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (pathLower.includes(term)) score += 8;
      const matches = lower.split(term).length - 1;
      score += Math.min(matches, 8);
    }
    if (!score) continue;
    const parsed = matter(content);
    hits.push({
      path: relative,
      title: String(parsed.data.title || path.basename(relative, path.extname(relative))),
      excerpt: excerptFor(parsed.content || content, terms),
      score,
      modified: stat.mtime.toISOString(),
    });
  }
  return hits.sort((a, b) => b.score - a.score || b.modified.localeCompare(a.modified)).slice(0, limit);
}

async function callGemma(messages: { role: "system" | "user"; content: string }[], maxTokens = 1000): Promise<string> {
  const response = await fetch(MODEL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL_NAME, messages, temperature: 0.15, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`Local model returned ${response.status}: ${await response.text()}`);
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const output = json.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("Local model returned an empty response");
  return output;
}

export async function answerFromFilesystem(question: string) {
  const hits = await searchFilesystem(question, 6);
  const context = hits
    .map((hit, index) => `FILE ${index + 1}\nPATH: ${hit.path}\nCONTENT: ${hit.excerpt}`)
    .join("\n\n");
  const answer = await callGemma(
    [
      {
        role: "system",
        content:
          "You are SomeOS, a private home knowledge assistant. Answer only from the supplied local filesystem context. Cite every supported claim inline using the exact filesystem path in brackets, for example [sources/inbox/note.md]. Never cite labels like SOURCE 1 or FILE 1. If context is insufficient, say what source is missing. Be concise and practical.",
      },
      { role: "user", content: `QUESTION:\n${question}\n\nLOCAL CONTEXT:\n${context || "No matching local files."}` },
    ],
    900,
  );
  return { answer, citations: hits.map((hit) => ({ path: hit.path, title: hit.title })) };
}

type IngestState = Record<string, { hash: string; page: string; ingestedAt: string }>;

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return JSON");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

export async function ingestSources(limit = 8) {
  await ensureVault();
  const statePath = path.join(VAULT_ROOT, "wiki/.someos-index.json");
  let state: IngestState = {};
  try {
    state = JSON.parse(await fs.readFile(statePath, "utf8")) as IngestState;
  } catch {
    state = {};
  }

  const sourceFiles = await collectTextFiles("sources");
  const changed: { relative: string; content: string; hash: string }[] = [];
  for (const relative of sourceFiles) {
    const { full } = resolveVaultPath(relative);
    const stat = await fs.stat(full);
    if (stat.size > 1_000_000) continue;
    const content = await fs.readFile(full, "utf8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    if (state[relative]?.hash !== hash) changed.push({ relative, content, hash });
  }

  const processed: { source: string; page: string; tasks: number }[] = [];
  const errors: { source: string; error: string }[] = [];
  for (const item of changed.slice(0, Math.max(1, Math.min(limit, 20)))) {
    try {
      const raw = await callGemma(
        [
          {
            role: "system",
            content:
              "Compile a private source file into one durable wiki page. Return ONLY valid JSON with keys: title (string), summary (one sentence), tags (array of 2-6 lowercase strings), body (markdown with useful headings, facts, dates, people, decisions, and open questions), tasks (array of objects with title, priority high|medium|low, due_date YYYY-MM-DD or empty). Never invent facts. Preserve important numbers and dates.",
          },
          { role: "user", content: `SOURCE PATH: ${item.relative}\n\nSOURCE CONTENT:\n${item.content.slice(0, 90_000)}` },
        ],
        1700,
      );
      const parsed = extractJson(raw);
      const title = String(parsed.title || path.basename(item.relative, path.extname(item.relative)));
      const summary = String(parsed.summary || "Generated from a local source.");
      const tags = Array.isArray(parsed.tags) ? parsed.tags.map(String).map(slugify).filter(Boolean).slice(0, 8) : [];
      const priorPage = state[item.relative]?.page;
      const page = priorPage || `wiki/pages/${slugify(title)}-${item.hash.slice(0, 6)}.md`;
      const body = String(parsed.body || summary).trim();
      const wikiContent = matter.stringify(`${body}\n\n## Source\n\n- [[${item.relative}]]\n`, {
        title,
        summary,
        tags,
        sources: [item.relative],
        updated: new Date().toISOString(),
        generated_by: MODEL_NAME,
      });
      await writeVaultText(page, wikiContent);

      let taskCount = 0;
      const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
      for (const candidate of tasks.slice(0, 8)) {
        if (!candidate || typeof candidate !== "object") continue;
        const task = candidate as Record<string, unknown>;
        const taskTitle = String(task.title || "").trim();
        if (!taskTitle) continue;
        await createTask({
          title: taskTitle,
          priority: (["high", "medium", "low"].includes(String(task.priority)) ? String(task.priority) : "medium") as SomeTask["priority"],
          dueDate: String(task.due_date || ""),
          project: title,
          body: `Generated from [[${item.relative}]].`,
          tags: ["generated"],
        });
        taskCount += 1;
      }

      state[item.relative] = { hash: item.hash, page, ingestedAt: new Date().toISOString() };
      processed.push({ source: item.relative, page, tasks: taskCount });
    } catch (error) {
      errors.push({ source: item.relative, error: error instanceof Error ? error.message : "Unknown ingest error" });
    }
  }

  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  if (processed.length) {
    const lines = processed.map((entry) => `- ${new Date().toISOString()} — ${entry.source} → ${entry.page}`);
    await fs.appendFile(path.join(VAULT_ROOT, "wiki/log.md"), `${lines.join("\n")}\n`, "utf8");
  }
  return { processed, errors, remaining: Math.max(0, changed.length - processed.length - errors.length) };
}

export async function captureSource(input: { title?: string; content: string; deviceId?: string; kind?: string }) {
  await ensureVault();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const title = input.title?.trim() || `Capture ${now.toLocaleString()}`;
  const device = input.deviceId ? slugify(input.deviceId) : "inbox";
  const folder = input.deviceId ? `sources/devices/${device}` : input.kind === "daily" ? "sources/daily" : "sources/inbox";
  const filename = input.kind === "daily" ? `${now.toISOString().slice(0, 10)}.md` : `${stamp}-${slugify(title)}.md`;
  const relative = `${folder}/${filename}`;
  const content = matter.stringify(`${input.content.trim()}\n`, {
    title,
    captured_at: now.toISOString(),
    source: input.deviceId ? "iot" : "web",
    ...(input.deviceId ? { device_id: input.deviceId } : {}),
  });
  await writeVaultText(relative, content);
  return { path: relative };
}

export async function listTasks(): Promise<SomeTask[]> {
  await ensureVault();
  const files = await collectTextFiles("wiki/tasks");
  const tasks: SomeTask[] = [];
  for (const relative of files.filter((file) => file.endsWith(".md"))) {
    const raw = await fs.readFile(resolveVaultPath(relative).full, "utf8");
    const parsed = matter(raw);
    tasks.push({
      id: path.basename(relative, ".md"),
      title: String(parsed.data.title || path.basename(relative, ".md")),
      status: (["todo", "in_progress", "done"].includes(parsed.data.status) ? parsed.data.status : "todo") as SomeTask["status"],
      priority: (["high", "medium", "low"].includes(parsed.data.priority) ? parsed.data.priority : "medium") as SomeTask["priority"],
      project: String(parsed.data.project || "General"),
      dueDate: String(parsed.data.due_date || ""),
      body: parsed.content.trim(),
      tags: Array.isArray(parsed.data.tags) ? parsed.data.tags.map(String) : [],
    });
  }
  return tasks.sort((a, b) => a.status.localeCompare(b.status) || a.dueDate.localeCompare(b.dueDate));
}

export async function createTask(input: Partial<SomeTask> & { title: string }) {
  await ensureVault();
  const id = `${slugify(input.title)}-${crypto.randomBytes(3).toString("hex")}`;
  const task: SomeTask = {
    id,
    title: input.title.trim(),
    status: input.status || "todo",
    priority: input.priority || "medium",
    project: input.project || "General",
    dueDate: input.dueDate || "",
    body: input.body || "",
    tags: input.tags || [],
  };
  const content = matter.stringify(`${task.body.trim()}\n`, {
    title: task.title,
    status: task.status,
    priority: task.priority,
    project: task.project,
    due_date: task.dueDate,
    tags: task.tags,
    created: new Date().toISOString(),
  });
  await writeVaultText(`wiki/tasks/${id}.md`, content);
  return task;
}

export async function updateTask(id: string, patch: Partial<SomeTask>) {
  const relative = `wiki/tasks/${slugify(id)}.md`;
  const raw = await fs.readFile(resolveVaultPath(relative).full, "utf8");
  const parsed = matter(raw);
  const current: SomeTask = {
    id: slugify(id),
    title: String(parsed.data.title || id),
    status: parsed.data.status || "todo",
    priority: parsed.data.priority || "medium",
    project: parsed.data.project || "General",
    dueDate: parsed.data.due_date || "",
    body: parsed.content.trim(),
    tags: parsed.data.tags || [],
  };
  const next = { ...current, ...patch, id: current.id };
  const content = matter.stringify(`${next.body.trim()}\n`, {
    ...parsed.data,
    title: next.title,
    status: next.status,
    priority: next.priority,
    project: next.project,
    due_date: next.dueDate,
    tags: next.tags,
    updated: new Date().toISOString(),
  });
  await writeVaultText(relative, content);
  return next;
}

export async function listCalendarEvents(): Promise<CalendarEvent[]> {
  await ensureVault();
  const raw = await fs.readFile(path.join(VAULT_ROOT, "wiki/calendar/events.json"), "utf8");
  const events = JSON.parse(raw) as CalendarEvent[];
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

export async function createCalendarEvent(input: Omit<CalendarEvent, "id">) {
  const events = await listCalendarEvents();
  const event: CalendarEvent = { ...input, id: `${slugify(input.title)}-${crypto.randomBytes(3).toString("hex")}` };
  events.push(event);
  await fs.writeFile(path.join(VAULT_ROOT, "wiki/calendar/events.json"), `${JSON.stringify(events, null, 2)}\n`, "utf8");
  return event;
}
