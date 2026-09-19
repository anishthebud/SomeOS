"use client";

import {
  ArrowDownAZ,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileJson,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Grid2X2,
  HardDrive,
  Info,
  LayoutList,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type FinderItem = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number;
  modified: string;
  extension: string;
  protected: boolean;
  originalPath?: string;
};
type Notice = { text: string; tone?: "good" | "bad" };
type DialogState = { kind: "new-folder" | "new-file" | "rename" | "move" | "trash" | "delete"; value: string } | null;

const LOCATIONS = [
  { label: "Sources", path: "sources", icon: HardDrive },
  { label: "Inbox", path: "sources/inbox", icon: FolderInput },
  { label: "Uploads", path: "sources/uploads", icon: Upload },
  { label: "Devices", path: "sources/devices", icon: HardDrive },
  { label: "Wiki", path: "wiki", icon: FolderOpen },
  { label: "Pages", path: "wiki/pages", icon: FileText },
  { label: "Tasks", path: "wiki/tasks", icon: Check },
  { label: "Trash", path: "sources/.trash", icon: Trash2 },
];

async function finderRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function fileIcon(item: FinderItem, size = 42) {
  if (item.type === "folder") return <Folder size={size} strokeWidth={1.45} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(item.extension)) return <FileImage size={size} strokeWidth={1.45} />;
  if (["zip", "tar", "gz", "7z"].includes(item.extension)) return <FileArchive size={size} strokeWidth={1.45} />;
  if (["csv", "tsv", "xlsx"].includes(item.extension)) return <FileSpreadsheet size={size} strokeWidth={1.45} />;
  if (["json", "yaml", "yml"].includes(item.extension)) return <FileJson size={size} strokeWidth={1.45} />;
  if (["js", "ts", "tsx", "jsx", "py", "sh", "css", "html"].includes(item.extension)) return <FileCode2 size={size} strokeWidth={1.45} />;
  if (["md", "mdx", "txt", "log"].includes(item.extension)) return <FileText size={size} strokeWidth={1.45} />;
  return <File size={size} strokeWidth={1.45} />;
}

export function FinderView({
  folderPaths,
  openFile,
  onChanged,
  showNotice,
}: {
  folderPaths: string[];
  openFile: (path: string) => void;
  onChanged: () => void;
  showNotice: (text: string, tone?: Notice["tone"]) => void;
}) {
  const [currentPath, setCurrentPath] = useState("sources");
  const [history, setHistory] = useState(["sources"]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [items, setItems] = useState<FinderItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"icons" | "list">("icons");
  const [sortBy, setSortBy] = useState<"name" | "modified" | "size">("name");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [inspector, setInspector] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionAnchor = useRef<string | null>(null);

  const load = useCallback(async (relative = currentPath) => {
    setLoading(true);
    try {
      const data = await finderRequest<{ path: string; items: FinderItem[] }>(`/api/someos/files?path=${encodeURIComponent(relative)}`);
      setItems(data.items); setSelected(new Set()); selectionAnchor.current = null;
    } catch (error) { showNotice((error as Error).message, "bad"); }
    finally { setLoading(false); }
  }, [currentPath, showNotice]);

  useEffect(() => { void load(currentPath); }, [currentPath, load]);
  useEffect(() => { if (dialog) window.setTimeout(() => inputRef.current?.focus(), 0); }, [dialog]);

  const visibleItems = useMemo(() => {
    const filtered = items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
    return filtered.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      if (sortBy === "modified") return b.modified.localeCompare(a.modified);
      if (sortBy === "size") return b.size - a.size;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
  }, [items, query, sortBy]);
  const selectedItems = visibleItems.filter((item) => selected.has(item.path));
  const primary = selectedItems[0];
  const inTrash = currentPath === "sources/.trash";

  const navigate = (relative: string, record = true) => {
    if (relative === currentPath) return;
    setCurrentPath(relative); setQuery(""); setContextMenu(null);
    if (record) {
      const next = [...history.slice(0, historyIndex + 1), relative];
      setHistory(next); setHistoryIndex(next.length - 1);
    }
  };

  const goHistory = (delta: number) => {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    setHistoryIndex(next); setCurrentPath(history[next]); setQuery("");
  };

  const selectItem = (item: FinderItem, event: MouseEvent) => {
    if (event.shiftKey && selectionAnchor.current) {
      const start = visibleItems.findIndex((entry) => entry.path === selectionAnchor.current);
      const end = visibleItems.findIndex((entry) => entry.path === item.path);
      if (start >= 0 && end >= 0) setSelected(new Set(visibleItems.slice(Math.min(start, end), Math.max(start, end) + 1).map((entry) => entry.path)));
    } else if (event.metaKey || event.ctrlKey) {
      setSelected((current) => { const next = new Set(current); next.has(item.path) ? next.delete(item.path) : next.add(item.path); return next; });
      selectionAnchor.current = item.path;
    } else { setSelected(new Set([item.path])); selectionAnchor.current = item.path; }
  };

  const openItem = (item: FinderItem) => item.type === "folder" ? navigate(item.path) : openFile(item.path);

  const postAction = async (action: string, body: Record<string, unknown>) => {
    const result = await finderRequest<{ path?: string }>("/api/someos/files", { method: "POST", body: JSON.stringify({ action, ...body }) });
    await load(); onChanged(); return result;
  };

  const actionMany = async (action: "duplicate" | "trash" | "restore" | "delete") => {
    if (!selectedItems.length) return;
    setLoading(true);
    try {
      for (const item of selectedItems) await postAction(action, { source: item.path });
      showNotice(action === "trash" ? `Moved ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"} to Trash` : action === "restore" ? `Restored ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}` : action === "delete" ? `Permanently deleted ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}` : `Duplicated ${selectedItems.length} item${selectedItems.length === 1 ? "" : "s"}`, "good");
    } catch (error) { showNotice((error as Error).message, "bad"); }
    finally { setLoading(false); setDialog(null); setContextMenu(null); }
  };

  const submitDialog = async (event: FormEvent) => {
    event.preventDefault(); if (!dialog) return;
    try {
      if (dialog.kind === "new-folder") await postAction("new-folder", { parent: currentPath, name: dialog.value });
      if (dialog.kind === "new-file") await postAction("new-file", { parent: currentPath, name: dialog.value });
      if (dialog.kind === "rename" && primary) await postAction("rename", { source: primary.path, name: dialog.value });
      if (dialog.kind === "move" && selectedItems.length) for (const item of selectedItems) await postAction("move", { source: item.path, destination: dialog.value });
      showNotice(dialog.kind === "move" ? "Items moved" : dialog.kind === "rename" ? "Item renamed" : "Item created", "good");
      setDialog(null);
    } catch (error) { showNotice((error as Error).message, "bad"); }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files.length || inTrash) return;
    setUploading(true);
    try {
      const form = new FormData(); form.set("parent", currentPath); Array.from(files).forEach((file) => form.append("files", file));
      const response = await fetch("/api/someos/files/upload", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Upload failed");
      showNotice(`Uploaded ${data.uploaded.length} file${data.uploaded.length === 1 ? "" : "s"}`, "good"); await load(); onChanged();
    } catch (error) { showNotice((error as Error).message, "bad"); }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches("input, textarea, select") || dialog) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") { event.preventDefault(); setSelected(new Set(visibleItems.map((item) => item.path))); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && selectedItems.length) { event.preventDefault(); void actionMany("duplicate"); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "n" && !inTrash) { event.preventDefault(); setDialog({ kind: "new-folder", value: "Untitled Folder" }); }
      if ((event.metaKey || event.ctrlKey) && event.key === "Backspace" && selectedItems.length && !inTrash) { event.preventDefault(); setDialog({ kind: "trash", value: "" }); }
      if (event.key === "Enter" && primary && !inTrash) { event.preventDefault(); setDialog({ kind: "rename", value: primary.name }); }
      if (event.key === " " && primary) { event.preventDefault(); openItem(primary); }
      if (event.key === "Escape") { setSelected(new Set()); setContextMenu(null); }
    };
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  }, [dialog, inTrash, primary, selectedItems, visibleItems]);

  const showContext = (event: MouseEvent, item: FinderItem) => {
    event.preventDefault(); if (!selected.has(item.path)) setSelected(new Set([item.path]));
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 300) });
  };

  const parts = currentPath.split("/");
  return (
    <div className="finder-window" onClick={() => setContextMenu(null)}>
      <header className="finder-toolbar">
        <div className="finder-history">
          <button onClick={() => goHistory(-1)} disabled={historyIndex === 0} aria-label="Back" title="Back"><ArrowLeft size={18} /></button>
          <button onClick={() => goHistory(1)} disabled={historyIndex === history.length - 1} aria-label="Forward" title="Forward"><ArrowRight size={18} /></button>
        </div>
        <div className="finder-title"><strong>{inTrash ? "Trash" : parts.at(-1)}</strong><span>{visibleItems.length} item{visibleItems.length === 1 ? "" : "s"}</span></div>
        <div className="finder-tools">
          <button onClick={() => setDialog({ kind: "new-folder", value: "Untitled Folder" })} disabled={inTrash} aria-label="New folder" title="New Folder (⌘⇧N)"><FolderPlus size={18} /></button>
          <button onClick={() => setDialog({ kind: "new-file", value: "Untitled.md" })} disabled={inTrash} aria-label="New text file" title="New Text File"><FilePlus2 size={18} /></button>
          <button onClick={() => fileInputRef.current?.click()} disabled={inTrash || uploading} aria-label="Upload files" title="Upload Files">{uploading ? <LoaderCircle className="spin" size={18} /> : <Upload size={18} />}</button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => event.target.files && void uploadFiles(event.target.files)} />
          <span className="finder-divider" />
          <div className="finder-segment" aria-label="View mode"><button className={viewMode === "icons" ? "is-active" : ""} onClick={() => setViewMode("icons")} aria-label="Icon view" aria-pressed={viewMode === "icons"}><Grid2X2 size={17} /></button><button className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")} aria-label="List view" aria-pressed={viewMode === "list"}><LayoutList size={18} /></button></div>
          <label className="finder-sort" title="Sort items"><ArrowDownAZ size={17} /><select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)} aria-label="Sort items"><option value="name">Name</option><option value="modified">Date Modified</option><option value="size">Size</option></select></label>
          <button className={inspector ? "is-active" : ""} onClick={() => setInspector((value) => !value)} aria-label="Toggle inspector" aria-pressed={inspector} title="Get Info"><Info size={18} /></button>
          <button onClick={() => void load()} aria-label="Refresh folder" title="Refresh"><RefreshCw className={loading ? "spin" : ""} size={17} /></button>
        </div>
      </header>

      <div className="finder-breadcrumbs" aria-label="Current folder">{parts.map((part, index) => { const relative = parts.slice(0, index + 1).join("/"); return <span key={relative}><button onClick={() => navigate(relative)}>{relative === "sources/.trash" ? "Trash" : part}</button>{index < parts.length - 1 && <ChevronRight size={13} />}</span>; })}<label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder" aria-label="Search this folder" /></label></div>

      <div className={`finder-body ${inspector ? "has-inspector" : ""}`}>
        <aside className="finder-sidebar"><p>Favorites</p>{LOCATIONS.map(({ label, path: relative, icon: Icon }) => <button key={relative} className={currentPath === relative ? "is-active" : ""} onClick={() => navigate(relative)}><Icon size={16} /><span>{label}</span></button>)}</aside>
        <main
          className={`finder-content ${viewMode}`}
          tabIndex={0}
          aria-label={`${parts.at(-1)} files`}
          onClick={(event) => { if (event.target === event.currentTarget) setSelected(new Set()); }}
          onDragOver={(event) => { if (!inTrash) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
          onDrop={(event) => { if (!inTrash) { event.preventDefault(); void uploadFiles(event.dataTransfer.files); } }}
        >
          {loading ? <div className="finder-state"><LoaderCircle className="spin" size={24} /><span>Loading {parts.at(-1)}…</span></div> : !visibleItems.length ? <div className="finder-state"><FolderOpen size={38} /><strong>{query ? "No matches" : inTrash ? "Trash is empty" : "This folder is empty"}</strong><span>{query ? "Try a different search." : inTrash ? "Items moved to Trash appear here." : "Drop files here or create a folder."}</span></div> : viewMode === "icons" ? visibleItems.map((item) => <button key={item.path} className={`finder-icon ${selected.has(item.path) ? "is-selected" : ""}`} onClick={(event) => { event.stopPropagation(); selectItem(item, event); }} onDoubleClick={() => openItem(item)} onContextMenu={(event) => showContext(event, item)} title={item.name}>{fileIcon(item)}<span>{item.name}</span></button>) : <table className="finder-list"><thead><tr><th>Name</th><th>Date Modified</th><th>Size</th><th>Kind</th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.path} className={selected.has(item.path) ? "is-selected" : ""} onClick={(event) => { event.stopPropagation(); selectItem(item, event); }} onDoubleClick={() => openItem(item)} onContextMenu={(event) => showContext(event, item)}><td>{fileIcon(item, 20)}<span>{item.name}</span></td><td>{new Date(item.modified).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</td><td>{item.type === "folder" ? "—" : formatBytes(item.size)}</td><td>{item.type === "folder" ? "Folder" : item.extension ? `${item.extension.toUpperCase()} document` : "Document"}</td></tr>)}</tbody></table>}
        </main>
        {inspector && <aside className="finder-inspector">{primary ? <><div className="inspector-preview">{fileIcon(primary, 58)}</div><h3>{primary.name}</h3><p>{primary.type === "folder" ? "Folder" : primary.extension ? `${primary.extension.toUpperCase()} document` : "Document"}</p><dl><dt>Size</dt><dd>{primary.type === "folder" ? "—" : formatBytes(primary.size)}</dd><dt>Modified</dt><dd>{new Date(primary.modified).toLocaleString()}</dd><dt>Where</dt><dd>{primary.path}</dd>{primary.originalPath && <><dt>Original</dt><dd>{primary.originalPath}</dd></>}</dl></> : <div className="inspector-empty"><Info size={28} /><span>Select an item to see its information.</span></div>}</aside>}
      </div>
      <footer className="finder-status"><span>{selected.size ? `${selected.size} of ${visibleItems.length} selected` : `${visibleItems.length} item${visibleItems.length === 1 ? "" : "s"}`}</span><span>{currentPath}</span></footer>

      {contextMenu && primary && <div className="finder-context" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}><button onClick={() => openItem(primary)}><FolderOpen size={15} />Open</button>{primary.type === "file" && <a href={`/api/someos/files/download?path=${encodeURIComponent(primary.path)}`} download><Download size={15} />Download</a>}<hr />{inTrash ? <><button onClick={() => void actionMany("restore")}><RotateCcw size={15} />Put Back</button><button className="danger" onClick={() => setDialog({ kind: "delete", value: "" })}><Trash2 size={15} />Delete Immediately…</button></> : <><button onClick={() => setDialog({ kind: "rename", value: primary.name })}><Pencil size={15} />Rename</button><button onClick={() => void actionMany("duplicate")}><Copy size={15} />Duplicate</button><button onClick={() => setDialog({ kind: "move", value: currentPath })}><FolderInput size={15} />Move to…</button><hr /><button className="danger" onClick={() => setDialog({ kind: "trash", value: "" })}><Trash2 size={15} />Move to Trash</button></>}</div>}

      {dialog && <div className="finder-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}><form className="finder-modal" onSubmit={dialog.kind === "trash" || dialog.kind === "delete" ? (event) => { event.preventDefault(); void actionMany(dialog.kind === "delete" ? "delete" : "trash"); } : submitDialog} role="dialog" aria-modal="true" aria-labelledby="finder-dialog-title"><div className="finder-modal-head"><h2 id="finder-dialog-title">{dialog.kind === "new-folder" ? "New Folder" : dialog.kind === "new-file" ? "New Text File" : dialog.kind === "rename" ? "Rename Item" : dialog.kind === "move" ? "Move Items" : dialog.kind === "delete" ? "Delete Immediately?" : "Move to Trash?"}</h2><button type="button" onClick={() => setDialog(null)} aria-label="Close"><X size={18} /></button></div>{dialog.kind === "trash" || dialog.kind === "delete" ? <p>{dialog.kind === "delete" ? `This will permanently delete the selected item${selectedItems.length === 1 ? "" : "s"}. This action cannot be undone.` : `The selected item${selectedItems.length === 1 ? "" : "s"} can be restored later from Trash.`}</p> : dialog.kind === "move" ? <label>Destination<select autoFocus value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })}>{folderPaths.filter((folder) => folder !== "sources/.trash" && !selected.has(folder)).map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select></label> : <label>Name<input ref={inputRef} value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} onFocus={(event) => { const dot = event.currentTarget.value.lastIndexOf("."); event.currentTarget.setSelectionRange(0, dot > 0 ? dot : event.currentTarget.value.length); }} /></label>}<div className="finder-modal-actions"><button type="button" className="button ghost" onClick={() => setDialog(null)}>Cancel</button><button className={`button ${dialog.kind === "trash" || dialog.kind === "delete" ? "danger" : "primary"}`} disabled={dialog.kind !== "trash" && dialog.kind !== "delete" && !dialog.value.trim()}>{dialog.kind === "delete" ? "Delete" : dialog.kind === "trash" ? "Move to Trash" : dialog.kind === "move" ? "Move" : "Save"}</button></div></form></div>}
    </div>
  );
}
