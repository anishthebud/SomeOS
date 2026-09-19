"use client";

import {
  Activity,
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Database,
  File,
  FileText,
  Folder,
  FolderOpen,
  House,
  Inbox,
  LoaderCircle,
  Menu,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FinderView } from "./FinderView";

type View = "workspace" | "today" | "files" | "sources" | "wiki" | "tasks" | "calendar" | "activity";
type FsNode = { name: string; path: string; type: "file" | "folder"; size: number; modified: string; children?: FsNode[] };
type Snapshot = {
  tree: FsNode[];
  recent: FsNode[];
  stats: { sources: number; pages: number; tasks: number; bytes: number };
  model: { online: boolean; name: string };
  generatedAt: string;
};
type SomeTask = { id: string; title: string; status: "todo" | "in_progress" | "done"; priority: "high" | "medium" | "low"; project: string; dueDate: string; body: string; tags: string[] };
type CalendarEvent = { id: string; title: string; date: string; endDate?: string; kind?: string; notes?: string };
type SearchHit = { path: string; title: string; excerpt: string; score: number; modified: string };
type FileData = { path: string; content: string; size: number; modified: string };
type Notice = { text: string; tone?: "good" | "bad" };

const NAV: { id: View; label: string; icon: typeof House }[] = [
  { id: "workspace", label: "Workspace", icon: House },
  { id: "today", label: "Today", icon: Clock3 },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "sources", label: "Sources", icon: Inbox },
  { id: "wiki", label: "Wiki", icon: FileText },
  { id: "tasks", label: "Tasks", icon: Check },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "activity", label: "Activity", icon: Activity },
];

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function shortDate(value: string) {
  if (!value) return "No date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function FileTree({ nodes, selected, onSelect }: { nodes: FsNode[]; selected: string; onSelect: (path: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(["sources", "wiki", "sources/inbox", "wiki/pages"]));
  const render = (node: FsNode, depth: number) => {
    const isOpen = open.has(node.path);
    if (node.type === "folder") {
      return (
        <div key={node.path}>
          <button
            className="tree-row"
            style={{ paddingLeft: 10 + depth * 15 }}
            onClick={() => setOpen((current) => { const next = new Set(current); isOpen ? next.delete(node.path) : next.add(node.path); return next; })}
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
            <span>{node.name}</span>
          </button>
          {isOpen && node.children?.map((child) => render(child, depth + 1))}
        </div>
      );
    }
    return (
      <button key={node.path} className={`tree-row tree-file ${selected === node.path ? "is-selected" : ""}`} style={{ paddingLeft: 30 + depth * 15 }} onClick={() => onSelect(node.path)}>
        <File size={15} />
        <span>{node.name}</span>
      </button>
    );
  };
  return <div className="file-tree">{nodes.map((node) => render(node, 0))}</div>;
}

function EmptyState({ icon: Icon, title, children }: { icon: typeof File; title: string; children: React.ReactNode }) {
  return <div className="empty-state"><Icon size={28} /><h3>{title}</h3><p>{children}</p></div>;
}

export function SomeOSApp() {
  const [view, setView] = useState<View>("workspace");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tasks, setTasks] = useState<SomeTask[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [file, setFile] = useState<FileData | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const showNotice = useCallback((text: string, tone?: Notice["tone"]) => {
    setNotice({ text, tone });
    window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    try {
      const [nextSnapshot, taskData, eventData] = await Promise.all([
        request<Snapshot>("/api/someos/snapshot"),
        request<{ tasks: SomeTask[] }>("/api/someos/tasks"),
        request<{ events: CalendarEvent[] }>("/api/someos/calendar"),
      ]);
      setSnapshot(nextSnapshot); setTasks(taskData.tasks); setEvents(eventData.events);
    } catch (error) { showNotice((error as Error).message, "bad"); }
    finally { setBusy(""); }
  }, [showNotice]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    try {
      const savedLeft = localStorage.getItem("someos:left-pane");
      const savedRight = localStorage.getItem("someos:right-pane");
      if (savedLeft !== null) setSidebarOpen(savedLeft === "open");
      if (savedRight !== null) setAssistantOpen(savedRight === "open");
    } catch { /* Storage can be unavailable in privacy mode. */ }
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setSearchOpen(true); window.setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (event.key === "Escape") { setSearchOpen(false); setMobileNav(false); }
    };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, []);

  const selectFile = useCallback(async (path: string) => {
    setSelectedPath(path); setBusy("file");
    try { const next = await request<FileData>(`/api/someos/file?path=${encodeURIComponent(path)}`); setFile(next); setDraft(next.content); setEditing(false); }
    catch (error) { showNotice((error as Error).message, "bad"); }
    finally { setBusy(""); }
  }, [showNotice]);

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!query.trim()) return setHits([]);
    setBusy("search"); setSearchOpen(true);
    try { setHits((await request<{ hits: SearchHit[] }>(`/api/someos/search?q=${encodeURIComponent(query)}`)).hits); }
    catch (error) { showNotice((error as Error).message, "bad"); }
    finally { setBusy(""); }
  };

  const openPath = (path: string) => {
    setView(path.startsWith("sources/") ? "sources" : "wiki"); setSearchOpen(false); void selectFile(path);
  };

  const sourceTree = useMemo(() => snapshot?.tree.filter((node) => node.path === "sources") || [], [snapshot]);
  const wikiTree = useMemo(() => snapshot?.tree.filter((node) => node.path === "wiki") || [], [snapshot]);
  const folderPaths = useMemo(() => {
    const visit = (nodes: FsNode[]): string[] => nodes.flatMap((node) => node.type === "folder" ? [node.path, ...visit(node.children || [])] : []);
    return snapshot ? visit(snapshot.tree) : ["sources", "wiki"];
  }, [snapshot]);
  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = tasks.filter((task) => task.status !== "done" && (!task.dueDate || task.dueDate <= today));
  const todayEvents = events.filter((event) => event.date.slice(0, 10) === today);

  const changeView = (next: View) => { setView(next); setMobileNav(false); if (next === "activity") void selectFile("wiki/log.md"); };
  const toggleSidebar = () => setSidebarOpen((open) => { const next = !open; try { localStorage.setItem("someos:left-pane", next ? "open" : "closed"); } catch {} return next; });
  const toggleAssistant = () => setAssistantOpen((open) => { const next = !open; try { localStorage.setItem("someos:right-pane", next ? "open" : "closed"); } catch {} return next; });

  return (
    <div className={`someos-shell ${sidebarOpen ? "with-sidebar" : ""} ${assistantOpen ? "with-assistant" : ""}`}>
      <aside id="someos-navigation" className={`os-sidebar ${sidebarOpen ? "" : "desktop-hidden"} ${mobileNav ? "is-open" : ""}`}>
        <div className="brand-row"><div className="brand-glyph"><Server size={19} /></div><div><strong>SomeOS</strong><span>Private knowledge system</span></div><button className="icon-button desktop-only" onClick={toggleSidebar} aria-label="Close left pane" title="Close left pane"><PanelLeftClose size={18} /></button><button className="icon-button mobile-only" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={20} /></button></div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">System</p>
          {NAV.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "is-active" : ""}`} onClick={() => changeView(id)}><Icon size={18} /><span>{label}</span>{id === "tasks" && tasks.filter((task) => task.status !== "done").length > 0 && <b>{tasks.filter((task) => task.status !== "done").length}</b>}</button>)}
        </nav>
        <div className="sidebar-files"><p className="nav-label">Files</p>{snapshot ? <FileTree nodes={snapshot.tree} selected={selectedPath} onSelect={openPath} /> : <div className="sidebar-loading"><LoaderCircle className="spin" size={16} /> Loading vault</div>}</div>
        <div className="system-status"><div><span className={`status-dot ${snapshot?.model.online ? "online" : ""}`} /><strong>{snapshot?.model.online ? "Gemma online" : "Gemma offline"}</strong></div><span>{snapshot?.model.name || "Checking model"}</span></div>
      </aside>

      {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}

      <section className="os-main">
        <header className="topbar">
          <button className="icon-button mobile-only" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <button className={`icon-button desktop-only ${sidebarOpen ? "is-active" : ""}`} onClick={toggleSidebar} aria-label={sidebarOpen ? "Close left pane" : "Open left pane"} aria-controls="someos-navigation" aria-pressed={sidebarOpen} title={sidebarOpen ? "Close left pane" : "Open left pane"}>{sidebarOpen ? <PanelLeftClose size={19} /> : <PanelLeftOpen size={19} />}</button>
          <form className="global-search" onSubmit={runSearch}><Search size={17} /><input ref={searchRef} value={query} onFocus={() => setSearchOpen(true)} onChange={(event) => setQuery(event.target.value)} placeholder="Search your private filesystem" aria-label="Search files" /><kbd>⌘ K</kbd></form>
          <button className="icon-button" onClick={() => void refresh()} title="Refresh filesystem" aria-label="Refresh filesystem"><RefreshCw className={busy === "refresh" ? "spin" : ""} size={18} /></button>
          <button className={`icon-button ${assistantOpen ? "is-active" : ""}`} onClick={toggleAssistant} title={assistantOpen ? "Close assistant pane" : "Open assistant pane"} aria-label={assistantOpen ? "Close assistant pane" : "Open assistant pane"} aria-controls="someos-assistant" aria-pressed={assistantOpen}>{assistantOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button>
        </header>

        {searchOpen && <div className="search-popover"><div className="search-popover-head"><span>{query ? `Results for “${query}”` : "Search SomeOS"}</span><button className="icon-button" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={17} /></button></div>{busy === "search" ? <div className="search-empty"><LoaderCircle className="spin" size={18} /> Searching files</div> : hits.length ? hits.map((hit) => <button className="search-hit" key={hit.path} onClick={() => openPath(hit.path)}><FileText size={18} /><span><strong>{hit.title}</strong><small>{hit.path}</small><p>{hit.excerpt}</p></span></button>) : <div className="search-empty">{query ? "No matching files." : "Type a query and press Enter."}</div>}</div>}

        <main className="content-area">
          {view === "workspace" && <Workspace snapshot={snapshot} onOpen={openPath} onCaptureDone={() => void refresh()} showNotice={showNotice} setBusy={setBusy} busy={busy} />}
          {view === "today" && <TodayView tasks={todayTasks} events={todayEvents} onTask={async (task) => { await request("/api/someos/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, patch: { status: task.status === "done" ? "todo" : "done" } }) }); void refresh(); }} onCaptureDone={() => void refresh()} showNotice={showNotice} />}
          {view === "files" && <FinderView folderPaths={folderPaths} openFile={openPath} onChanged={() => void refresh()} showNotice={showNotice} />}
          {(view === "sources" || view === "wiki") && <Explorer title={view === "sources" ? "Sources" : "Wiki"} subtitle={view === "sources" ? "Raw inputs from you and connected devices." : "Durable knowledge generated from your sources."} nodes={view === "sources" ? sourceTree : wikiTree} selectedPath={selectedPath} selectFile={selectFile} file={file} draft={draft} setDraft={setDraft} editing={editing} setEditing={setEditing} busy={busy} save={async () => { if (!file) return; setBusy("save"); try { const saved = await request<FileData>("/api/someos/file", { method: "PUT", body: JSON.stringify({ path: file.path, content: draft }) }); setFile(saved); setEditing(false); showNotice("File saved", "good"); void refresh(); } catch (error) { showNotice((error as Error).message, "bad"); } finally { setBusy(""); } }} ingest={view === "sources" ? async () => { setBusy("ingest"); try { const result = await request<{ processed: unknown[]; errors: unknown[]; remaining: number }>("/api/someos/ingest", { method: "POST", body: JSON.stringify({ limit: 8 }) }); showNotice(`Ingested ${result.processed.length} source${result.processed.length === 1 ? "" : "s"}${result.errors.length ? `; ${result.errors.length} failed` : ""}`, result.errors.length ? "bad" : "good"); void refresh(); } catch (error) { showNotice((error as Error).message, "bad"); } finally { setBusy(""); } } : undefined} />}
          {view === "tasks" && <TasksView tasks={tasks} refresh={refresh} showNotice={showNotice} />}
          {view === "calendar" && <CalendarView events={events} refresh={refresh} showNotice={showNotice} />}
          {view === "activity" && <Explorer title="Activity" subtitle="A local audit trail of source ingestion and generated knowledge." nodes={[]} selectedPath={selectedPath} selectFile={selectFile} file={file} draft={draft} setDraft={setDraft} editing={editing} setEditing={setEditing} busy={busy} save={async () => {}} />}
        </main>
      </section>

      {assistantOpen && <button className="assistant-scrim" aria-label="Close assistant" onClick={toggleAssistant} />}
      {assistantOpen && <Assistant onOpen={openPath} showNotice={showNotice} onClose={toggleAssistant} />}
      {notice && <div className={`toast ${notice.tone || ""}`} role="status">{notice.tone === "good" ? <Check size={17} /> : notice.tone === "bad" ? <Circle size={17} /> : null}{notice.text}</div>}
    </div>
  );
}

function SectionHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle: string; actions?: React.ReactNode }) {
  return <div className="section-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{subtitle}</p></div>{actions && <div className="header-actions">{actions}</div>}</div>;
}

function CaptureForm({ compact = false, onDone, showNotice }: { compact?: boolean; onDone: () => void; showNotice: (text: string, tone?: Notice["tone"]) => void }) {
  const [title, setTitle] = useState(""); const [content, setContent] = useState(""); const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!content.trim()) return; setSaving(true); try { const result = await request<{ path: string }>("/api/someos/capture", { method: "POST", body: JSON.stringify({ title, content }) }); setTitle(""); setContent(""); showNotice(`Captured to ${result.path}`, "good"); onDone(); } catch (error) { showNotice((error as Error).message, "bad"); } finally { setSaving(false); } };
  return <form className={`capture-box ${compact ? "compact" : ""}`} onSubmit={submit}><div className="capture-title"><Plus size={17} /><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Capture title (optional)" aria-label="Capture title" /></div><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="Drop a thought, decision, link, meeting note, or device observation…" aria-label="Capture content" rows={compact ? 3 : 5} /><div className="capture-footer"><span>Saved locally to sources/inbox</span><button className="button primary" disabled={!content.trim() || saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Inbox size={16} />}Capture</button></div></form>;
}

function Workspace({ snapshot, onOpen, onCaptureDone, showNotice }: { snapshot: Snapshot | null; onOpen: (path: string) => void; onCaptureDone: () => void; showNotice: (text: string, tone?: Notice["tone"]) => void; setBusy: (value: string) => void; busy: string }) {
  const hour = new Date().getHours(); const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const stats = [{ label: "Sources", value: snapshot?.stats.sources ?? "—", icon: Database }, { label: "Wiki pages", value: snapshot?.stats.pages ?? "—", icon: FileText }, { label: "Task files", value: snapshot?.stats.tasks ?? "—", icon: Check }, { label: "Vault size", value: snapshot ? formatBytes(snapshot.stats.bytes) : "—", icon: Server }];
  return <div className="page"><SectionHeader eyebrow="Local workspace" title={`${greeting}.`} subtitle="Your files, generated knowledge, and private model in one place." /><div className="stat-grid">{stats.map(({ label, value, icon: Icon }) => <div className="stat-card" key={label}><div><span>{label}</span><strong>{value}</strong></div><Icon size={20} /></div>)}</div><div className="workspace-grid"><section className="panel capture-panel"><div className="panel-heading"><div><h2>Quick capture</h2><p>Write once. Let SomeOS organize it later.</p></div></div><CaptureForm onDone={onCaptureDone} showNotice={showNotice} /></section><section className="panel recent-panel"><div className="panel-heading"><div><h2>Recently changed</h2><p>Latest activity across the filesystem.</p></div></div><div className="recent-list">{snapshot?.recent.length ? snapshot.recent.slice(0, 7).map((item) => <button key={item.path} onClick={() => onOpen(item.path)}><FileText size={17} /><span><strong>{item.name}</strong><small>{item.path}</small></span><time>{shortDate(item.modified)}</time></button>) : <EmptyState icon={FileText} title="No files yet">Capture your first source to begin.</EmptyState>}</div></section></div></div>;
}

function TodayView({ tasks, events, onTask, onCaptureDone, showNotice }: { tasks: SomeTask[]; events: CalendarEvent[]; onTask: (task: SomeTask) => void; onCaptureDone: () => void; showNotice: (text: string, tone?: Notice["tone"]) => void }) {
  const date = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  return <div className="page"><SectionHeader eyebrow="Daily command center" title={date} subtitle="What needs your attention, without the noise." /><div className="today-grid"><section className="panel"><div className="panel-heading"><div><h2>Focus</h2><p>{tasks.length} actionable task{tasks.length === 1 ? "" : "s"}</p></div></div><div className="task-list">{tasks.length ? tasks.map((task) => <button className="task-row" key={task.id} onClick={() => onTask(task)}><span className="task-check"><Check size={14} /></span><span><strong>{task.title}</strong><small>{task.project}{task.dueDate ? ` · due ${shortDate(task.dueDate)}` : ""}</small></span><i className={`priority ${task.priority}`}>{task.priority}</i></button>) : <EmptyState icon={Check} title="All clear">No overdue or undated tasks.</EmptyState>}</div></section><section className="panel"><div className="panel-heading"><div><h2>Schedule</h2><p>Events on your local calendar</p></div></div>{events.length ? <div className="event-list">{events.map((event) => <div key={event.id}><span>{new Date(event.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><strong>{event.title}</strong></div>)}</div> : <EmptyState icon={CalendarDays} title="Open calendar">Nothing scheduled today.</EmptyState>}</section></div><section className="panel today-capture"><div className="panel-heading"><div><h2>Today’s notes</h2><p>Capture what happened while it is fresh.</p></div></div><CaptureForm compact onDone={onCaptureDone} showNotice={showNotice} /></section></div>;
}

function Explorer({ title, subtitle, nodes, selectedPath, selectFile, file, draft, setDraft, editing, setEditing, busy, save, ingest }: { title: string; subtitle: string; nodes: FsNode[]; selectedPath: string; selectFile: (path: string) => void; file: FileData | null; draft: string; setDraft: (value: string) => void; editing: boolean; setEditing: (value: boolean) => void; busy: string; save: () => void; ingest?: () => void }) {
  return <div className="page explorer-page"><SectionHeader title={title} subtitle={subtitle} actions={ingest && <button className="button primary" onClick={ingest} disabled={busy === "ingest"}>{busy === "ingest" ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}Ingest new sources</button>} /><div className="explorer"><aside className="explorer-tree">{nodes.length ? <FileTree nodes={nodes} selected={selectedPath} onSelect={selectFile} /> : title !== "Activity" ? null : <p className="tree-hint">Activity is stored at wiki/log.md</p>}</aside><section className="file-pane">{busy === "file" ? <div className="file-loading"><LoaderCircle className="spin" size={22} /> Opening file</div> : file ? <><div className="file-toolbar"><div><strong>{file.path.split("/").at(-1)}</strong><span>{file.path} · {formatBytes(file.size)} · {shortDate(file.modified)}</span></div><div>{editing ? <><button className="button ghost" onClick={() => { setDraft(file.content); setEditing(false); }}>Cancel</button><button className="button primary" onClick={save} disabled={busy === "save"}>{busy === "save" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}Save</button></> : title !== "Activity" && <button className="button ghost" onClick={() => setEditing(true)}>Edit file</button>}</div></div>{editing ? <textarea className="file-editor" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck="true" /> : <article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown></article>}</> : <EmptyState icon={FolderOpen} title="Choose a file">Select a text file from the filesystem to preview it.</EmptyState>}</section></div></div>;
}

function TasksView({ tasks, refresh, showNotice }: { tasks: SomeTask[]; refresh: () => Promise<void>; showNotice: (text: string, tone?: Notice["tone"]) => void }) {
  const [title, setTitle] = useState("");
  const add = async (event: FormEvent) => { event.preventDefault(); if (!title.trim()) return; try { await request("/api/someos/tasks", { method: "POST", body: JSON.stringify({ title }) }); setTitle(""); await refresh(); } catch (error) { showNotice((error as Error).message, "bad"); } };
  const update = async (task: SomeTask, status: SomeTask["status"]) => { try { await request("/api/someos/tasks", { method: "PATCH", body: JSON.stringify({ id: task.id, patch: { status } }) }); await refresh(); } catch (error) { showNotice((error as Error).message, "bad"); } };
  const columns: { id: SomeTask["status"]; label: string }[] = [{ id: "todo", label: "To do" }, { id: "in_progress", label: "In progress" }, { id: "done", label: "Done" }];
  return <div className="page"><SectionHeader title="Tasks" subtitle="Plain Markdown files, organized into a focused workflow." actions={<form className="quick-add" onSubmit={add}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Add a task" aria-label="Task title" /><button className="button primary" disabled={!title.trim()}><Plus size={16} />Add</button></form>} /><div className="task-board">{columns.map((column) => <section className="task-column" key={column.id}><div className="column-title"><span>{column.label}</span><b>{tasks.filter((task) => task.status === column.id).length}</b></div>{tasks.filter((task) => task.status === column.id).map((task) => <article className="task-card" key={task.id}><div><span className={`priority-dot ${task.priority}`} /><small>{task.project}</small></div><h3>{task.title}</h3>{task.body && <p>{task.body}</p>}<footer><span>{task.dueDate ? shortDate(task.dueDate) : "No due date"}</span><select aria-label={`Status for ${task.title}`} value={task.status} onChange={(event) => void update(task, event.target.value as SomeTask["status"])}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></footer></article>)}</section>)}</div></div>;
}

function CalendarView({ events, refresh, showNotice }: { events: CalendarEvent[]; refresh: () => Promise<void>; showNotice: (text: string, tone?: Notice["tone"]) => void }) {
  const [title, setTitle] = useState(""); const [date, setDate] = useState("");
  const add = async (event: FormEvent) => { event.preventDefault(); try { await request("/api/someos/calendar", { method: "POST", body: JSON.stringify({ title, date }) }); setTitle(""); setDate(""); await refresh(); } catch (error) { showNotice((error as Error).message, "bad"); } };
  const grouped = events.reduce<Record<string, CalendarEvent[]>>((result, item) => { const day = item.date.slice(0, 10); (result[day] ||= []).push(item); return result; }, {});
  return <div className="page"><SectionHeader title="Calendar" subtitle="A portable schedule stored in wiki/calendar/events.json." actions={<form className="event-add" onSubmit={add}><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event name" aria-label="Event name" /><input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Event date and time" /><button className="button primary" disabled={!title || !date}><Plus size={16} />Add</button></form>} /><div className="calendar-list">{Object.entries(grouped).length ? Object.entries(grouped).map(([day, items]) => <section key={day}><div className="calendar-day"><strong>{new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: "short" })}</strong><span>{new Date(`${day}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}</span></div><div>{items.map((event) => <article className="calendar-event" key={event.id}><time>{new Date(event.date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time><span><strong>{event.title}</strong><small>{event.kind || "Local event"}</small></span></article>)}</div></section>) : <EmptyState icon={CalendarDays} title="Nothing scheduled">Add your first local event above.</EmptyState>}</div></div>;
}

function Assistant({ onOpen, showNotice, onClose }: { onOpen: (path: string) => void; showNotice: (text: string, tone?: Notice["tone"]) => void; onClose: () => void }) {
  const [question, setQuestion] = useState(""); const [asking, setAsking] = useState(false); const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string; citations?: { path: string; title: string }[] }[]>([{ role: "assistant", content: "Ask about anything in your sources or wiki. I’ll answer with local citations." }]);
  const ask = async (event: FormEvent) => { event.preventDefault(); const next = question.trim(); if (!next || asking) return; setQuestion(""); setMessages((current) => [...current, { role: "user", content: next }]); setAsking(true); try { const result = await request<{ answer: string; citations: { path: string; title: string }[] }>("/api/someos/ask", { method: "POST", body: JSON.stringify({ question: next }) }); setMessages((current) => [...current, { role: "assistant", content: result.answer, citations: result.citations }]); } catch (error) { showNotice((error as Error).message, "bad"); } finally { setAsking(false); } };
  return <aside id="someos-assistant" className="assistant-pane"><div className="assistant-head"><div className="assistant-icon"><Bot size={19} /></div><div><strong>SomeOS Assistant</strong><span><i /> Local Gemma</span></div><button className="icon-button assistant-close" onClick={onClose} aria-label="Close assistant pane" title="Close assistant pane"><PanelRightClose size={18} /></button></div><div className="assistant-messages">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}>{message.role === "assistant" && <MessageSquareText size={16} />}<div><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>{message.citations?.length ? <div className="citations">{message.citations.map((citation) => <button key={citation.path} onClick={() => onOpen(citation.path)}>{citation.path}</button>)}</div> : null}</div></div>)}{asking && <div className="message assistant"><LoaderCircle className="spin" size={16} /><div><p>Reading your filesystem…</p></div></div>}</div><form className="assistant-input" onSubmit={ask}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Ask your private knowledge…" aria-label="Ask SomeOS" rows={3} /><button disabled={!question.trim() || asking} aria-label="Send question"><Send size={17} /></button><span>Answers stay on this machine</span></form></aside>;
}
