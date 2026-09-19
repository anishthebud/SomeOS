import fs from "node:fs/promises";
import path from "node:path";

import { ensureVault, resolveVaultPath } from "./someos";

export type FinderItem = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number;
  modified: string;
  extension: string;
  protected: boolean;
  originalPath?: string;
};

const TRASH_PATH = "sources/.trash";
const TRASH_META_SUFFIX = ".someos-trash.json";
const SYSTEM_PATHS = new Set(["wiki/log.md", "wiki/calendar/events.json"]);

function validateName(input: string): string {
  const name = input.trim();
  if (!name || name === "." || name === ".." || name.startsWith(".") || /[\\/\0]/.test(name)) {
    throw new Error("Use a visible file name without slashes");
  }
  return name;
}

function isProtected(relative: string): boolean {
  return relative === "sources" || relative === "wiki" || SYSTEM_PATHS.has(relative) || relative.includes("/.someos-");
}

function assertMutable(relative: string) {
  if (isProtected(relative)) throw new Error("This SomeOS system item cannot be changed here");
}

async function exists(relative: string): Promise<boolean> {
  try { await fs.access(resolveVaultPath(relative).full); return true; }
  catch { return false; }
}

async function uniquePath(parent: string, requestedName: string): Promise<string> {
  const ext = path.extname(requestedName);
  const stem = path.basename(requestedName, ext);
  let candidate = `${parent}/${requestedName}`;
  let suffix = 2;
  while (await exists(candidate)) candidate = `${parent}/${stem} ${suffix++}${ext}`;
  return candidate;
}

async function ensureDirectory(relative: string) {
  const stat = await fs.stat(resolveVaultPath(relative).full);
  if (!stat.isDirectory()) throw new Error("Destination is not a folder");
}

export async function listFinderDirectory(relative = "sources") {
  await ensureVault();
  await fs.mkdir(resolveVaultPath(TRASH_PATH).full, { recursive: true });
  const directory = relative || "sources";
  await ensureDirectory(directory);
  const entries = await fs.readdir(resolveVaultPath(directory).full, { withFileTypes: true });
  const items: FinderItem[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name.endsWith(TRASH_META_SUFFIX)) continue;
    if (entry.name.startsWith(".") && directory !== TRASH_PATH) continue;
    const child = `${directory}/${entry.name}`;
    const stat = await fs.stat(resolveVaultPath(child).full);
    let originalPath: string | undefined;
    if (directory === TRASH_PATH) {
      try {
        const metadata = JSON.parse(await fs.readFile(`${resolveVaultPath(child).full}${TRASH_META_SUFFIX}`, "utf8")) as { originalPath?: string };
        originalPath = metadata.originalPath;
      } catch { originalPath = undefined; }
    }
    items.push({
      name: entry.name,
      path: child,
      type: stat.isDirectory() ? "folder" : "file",
      size: stat.size,
      modified: stat.mtime.toISOString(),
      extension: entry.isDirectory() ? "" : path.extname(entry.name).slice(1).toLowerCase(),
      protected: isProtected(child),
      originalPath,
    });
  }
  return { path: directory, items };
}

export async function createFinderFolder(parent: string, name: string) {
  await ensureDirectory(parent);
  const relative = await uniquePath(parent, validateName(name));
  await fs.mkdir(resolveVaultPath(relative).full);
  return { path: relative };
}

export async function createFinderFile(parent: string, name: string) {
  await ensureDirectory(parent);
  const safeName = validateName(name.includes(".") ? name : `${name}.md`);
  const relative = await uniquePath(parent, safeName);
  await fs.writeFile(resolveVaultPath(relative).full, "", "utf8");
  return { path: relative };
}

export async function renameFinderItem(source: string, name: string) {
  assertMutable(source);
  const parent = path.posix.dirname(source);
  const destination = `${parent}/${validateName(name)}`;
  if (destination !== source && await exists(destination)) throw new Error("An item with that name already exists");
  await fs.rename(resolveVaultPath(source).full, resolveVaultPath(destination).full);
  return { path: destination };
}

export async function moveFinderItem(source: string, destinationFolder: string) {
  assertMutable(source);
  await ensureDirectory(destinationFolder);
  if (destinationFolder === source || destinationFolder.startsWith(`${source}/`)) throw new Error("A folder cannot be moved inside itself");
  const destination = await uniquePath(destinationFolder, path.posix.basename(source));
  await fs.rename(resolveVaultPath(source).full, resolveVaultPath(destination).full);
  return { path: destination };
}

export async function duplicateFinderItem(source: string) {
  assertMutable(source);
  const parent = path.posix.dirname(source);
  const ext = path.posix.extname(source);
  const stem = path.posix.basename(source, ext);
  const destination = await uniquePath(parent, `${stem} copy${ext}`);
  await fs.cp(resolveVaultPath(source).full, resolveVaultPath(destination).full, { recursive: true, errorOnExist: true });
  return { path: destination };
}

export async function trashFinderItem(source: string) {
  assertMutable(source);
  if (source.startsWith(`${TRASH_PATH}/`)) throw new Error("Item is already in Trash");
  await fs.mkdir(resolveVaultPath(TRASH_PATH).full, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = await uniquePath(TRASH_PATH, `${stamp}--${path.posix.basename(source)}`);
  await fs.rename(resolveVaultPath(source).full, resolveVaultPath(destination).full);
  await fs.writeFile(`${resolveVaultPath(destination).full}${TRASH_META_SUFFIX}`, `${JSON.stringify({ originalPath: source, trashedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return { path: destination };
}

export async function restoreFinderItem(source: string) {
  if (!source.startsWith(`${TRASH_PATH}/`)) throw new Error("Item is not in Trash");
  const metadataPath = `${resolveVaultPath(source).full}${TRASH_META_SUFFIX}`;
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as { originalPath?: string };
  if (!metadata.originalPath) throw new Error("Original location is unavailable");
  const parent = path.posix.dirname(metadata.originalPath);
  await fs.mkdir(resolveVaultPath(parent).full, { recursive: true });
  const destination = await uniquePath(parent, path.posix.basename(metadata.originalPath));
  await fs.rename(resolveVaultPath(source).full, resolveVaultPath(destination).full);
  await fs.unlink(metadataPath);
  return { path: destination };
}

export async function deleteFinderItemPermanently(source: string) {
  if (!source.startsWith(`${TRASH_PATH}/`)) throw new Error("Permanent deletion is limited to items already in Trash");
  const resolved = resolveVaultPath(source);
  await fs.rm(resolved.full, { recursive: true });
  await fs.rm(`${resolved.full}${TRASH_META_SUFFIX}`, { force: true });
  return { deleted: source };
}

export async function saveFinderUpload(parent: string, file: File) {
  await ensureDirectory(parent);
  if (file.size > 50 * 1024 * 1024) throw new Error("Uploads are limited to 50 MB");
  const relative = await uniquePath(parent, validateName(file.name || "Untitled"));
  await fs.writeFile(resolveVaultPath(relative).full, Buffer.from(await file.arrayBuffer()));
  return { path: relative, size: file.size };
}
