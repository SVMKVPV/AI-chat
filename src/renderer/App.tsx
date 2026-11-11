import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Box,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FolderOpen,
  GitFork,
  HardDrive,
  Info,
  Library,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Terminal,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  InstallPlan,
  LocalChatMessage,
  LocalModelEvent,
  LocalModelInstallPlan,
  LocalModelPhase,
  LocalModelStatus,
  PresetId,
  ProjectEvent,
  ProjectRecord,
  ProjectStatus,
  RunRequest,
  SystemHealth,
  ToolStatus,
} from "../shared/types";

type AppView = "library" | "local-ai" | "settings";
type ProjectTab = "overview" | "run" | "environment" | "logs";
type Notice = { kind: "success" | "error" | "info"; message: string };
type LogFilter = "all" | ProjectEvent["level"];

const DARK_BERT_URL = "https://github.com/shmishtopher/dark-bert";

const STATUS_LABELS: Record<ProjectStatus, string> = {
  installing: "Installing",
  ready: "Ready",
  running: "Running",
  stopping: "Stopping",
  failed: "Needs attention",
  "needs-setup": "Setup required",
};

const STATUS_HELP: Record<ProjectStatus, string> = {
  installing: "OpenForge is preparing the local environment.",
  ready: "The project is installed and available to run.",
  running: "A local process is currently active.",
  stopping: "OpenForge is closing the active process.",
  failed: "The last operation did not finish successfully.",
  "needs-setup": "OpenForge could not detect a supported project layout.",
};

const LOCAL_PHASE_LABELS: Record<LocalModelPhase, string> = {
  "not-installed": "Runtime required",
  "installing-runner": "Installing runtime",
  ready: "Ready to start",
  starting: "Starting",
  downloading: "Downloading model",
  running: "Local model online",
  stopping: "Stopping",
  error: "Needs attention",
};

const LOCAL_BUSY_PHASES: LocalModelPhase[] = [
  "installing-runner",
  "starting",
  "downloading",
  "stopping",
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function projectInitials(project: ProjectRecord): string {
  return project.name
    .split(/[-_.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "AI";
}

function linesToArguments(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function quoteArgument(value: string): string {
  return /^[A-Za-z0-9_./:\\=@+-]+$/.test(value) ? value : JSON.stringify(value);
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={`status-badge status-${status}`} title={STATUS_HELP[status]}>
      <span className="status-dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

function IconButton({
  label,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export default function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [events, setEvents] = useState<Record<string, ProjectEvent[]>>({});
  const [localStatus, setLocalStatus] = useState<LocalModelStatus | null>(null);
  const [localEvents, setLocalEvents] = useState<LocalModelEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<AppView>("library");
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [installOpen, setInstallOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [operation, setOperation] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedId) ?? null,
    [projects, selectedId],
  );

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      `${project.owner}/${project.name} ${project.runtime} ${STATUS_LABELS[project.status]}`
        .toLowerCase()
        .includes(query),
    );
  }, [projects, search]);

  const refreshProjects = useCallback(async () => {
    const projectList = await window.openforge.listProjects();
    setProjects(projectList);
    setSelectedId((current) =>
      current && projectList.some((project) => project.id === current)
        ? current
        : (projectList[0]?.id ?? null),
    );
  }, []);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [projectList, systemHealth, modelStatus] = await Promise.all([
        window.openforge.listProjects(),
        window.openforge.getSystemHealth(),
        window.openforge.getLocalModelStatus(),
      ]);
      setProjects(projectList);
      setHealth(systemHealth);
      setLocalStatus(modelStatus);
      setSelectedId((current) =>
        current && projectList.some((project) => project.id === current)
          ? current
          : (projectList[0]?.id ?? null),
      );
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  const closeInstall = useCallback(() => setInstallOpen(false), []);
  const closeRemove = useCallback(() => setRemoveOpen(false), []);

  useEffect(() => {
    void loadWorkspace();
    const unsubscribeProjects = window.openforge.onProjectEvent((event) => {
      setEvents((current) => ({
        ...current,
        [event.projectId]: [...(current[event.projectId] ?? []), event].slice(-2_000),
      }));
      if (event.status) {
        setProjects((current) =>
          current.map((project) =>
            project.id === event.projectId
              ? {
                  ...project,
                  status: event.status!,
                  updatedAt: event.timestamp,
                  lastError: event.status === "failed" ? event.message : project.lastError,
                }
              : project,
          ),
        );
        setAnnouncement(`${event.projectId}: ${event.message}`);
        if (["ready", "failed", "needs-setup"].includes(event.status)) {
          void refreshProjects().catch(() => {
            // The status event still keeps the visible project state useful if a refresh fails.
          });
        }
      }
    });
    const unsubscribeLocalModel = window.openforge.onLocalModelEvent((event) => {
      setLocalEvents((current) => [...current, event].slice(-500));
      setLocalStatus((current) =>
        current
          ? {
              ...current,
              phase: event.phase ?? current.phase,
              lastError:
                event.level === "error"
                  ? event.message
                  : event.phase === "running" || event.phase === "ready"
                    ? undefined
                    : current.lastError,
            }
          : current,
      );
      setAnnouncement(`Local AI: ${event.message}`);
    });
    return () => {
      unsubscribeProjects();
      unsubscribeLocalModel();
    };
  }, [loadWorkspace, refreshProjects]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), notice.kind === "error" ? 7_000 : 4_000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const selectProject = (projectId: string) => {
    setSelectedId(projectId);
    setView("library");
    setTab("overview");
  };

  const handleInstalled = (project: ProjectRecord) => {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
    setSelectedId(project.id);
    setView("library");
    setTab("overview");
    setNotice({ kind: "success", message: `${project.name} is installed and ready.` });
  };

  const runProject = async (request: RunRequest) => {
    const project = projects.find((item) => item.id === request.projectId);
    if (!project) return;
    setOperation(`run:${project.id}`);
    try {
      await window.openforge.runProject(request);
      setNotice({ kind: "success", message: `${project.name} started.` });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setOperation(null);
    }
  };

  const stopProject = async (project: ProjectRecord) => {
    setOperation(`stop:${project.id}`);
    try {
      await window.openforge.stopProject(project.id);
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setOperation(null);
    }
  };

  const updateProject = async (project: ProjectRecord) => {
    setOperation(`update:${project.id}`);
    try {
      const updated = await window.openforge.updateProject(project.id);
      setProjects((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setNotice({
        kind: "success",
        message:
          project.presetId === "dark-bert"
            ? "DarkBERT remains pinned to its reviewed revision."
            : `${project.name} source is up to date. Reinstall if its dependency manifest changed.`,
      });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setOperation(null);
    }
  };

  const removeProject = async () => {
    if (!selectedProject) return;
    const removing = selectedProject;
    setOperation(`remove:${removing.id}`);
    try {
      await window.openforge.removeProject(removing.id);
      const remaining = projects.filter((project) => project.id !== removing.id);
      setProjects(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setRemoveOpen(false);
      setNotice({ kind: "success", message: `${removing.name} was removed from this computer.` });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setOperation(null);
    }
  };

  const refreshHealth = async () => {
    setOperation("health");
    try {
      setHealth(await window.openforge.getSystemHealth());
      setNotice({ kind: "success", message: "System checks refreshed." });
    } catch (error) {
      setNotice({ kind: "error", message: errorMessage(error) });
    } finally {
      setOperation(null);
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="rail" aria-label="Primary navigation">
        <button className="brand-mark" aria-label="OpenForge AI home" onClick={() => setView("library")}>
          <Zap size={19} strokeWidth={2.25} aria-hidden="true" />
        </button>
        <nav className="rail-nav">
          <button
            className={`rail-button ${view === "library" ? "active" : ""}`}
            aria-label="Project library"
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => setView("library")}
          >
            <Library size={19} aria-hidden="true" />
            <span>Library</span>
          </button>
          <button
            className={`rail-button ${view === "local-ai" ? "active" : ""}`}
            aria-label="Local AI chat"
            aria-current={view === "local-ai" ? "page" : undefined}
            onClick={() => setView("local-ai")}
          >
            <Bot size={19} aria-hidden="true" />
            <span>Local AI</span>
          </button>
          <button
            className={`rail-button ${view === "settings" ? "active" : ""}`}
            aria-label="Settings and system health"
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            <Settings size={19} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </nav>
        <div className="rail-footer" title="Runs locally">
          <span className="local-indicator" aria-hidden="true" />
          <span>Local</span>
        </div>
      </aside>

      <aside className="project-sidebar" aria-label="OpenForge workspace">
        <div className="sidebar-heading">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>OpenForge AI</h1>
          </div>
          <IconButton label="Install a project" onClick={() => setInstallOpen(true)}>
            <Plus size={18} aria-hidden="true" />
          </IconButton>
        </div>

        <button
          className={`local-model-shortcut ${view === "local-ai" ? "active" : ""}`}
          onClick={() => setView("local-ai")}
          aria-current={view === "local-ai" ? "true" : undefined}
        >
          <span className="local-model-shortcut-icon" aria-hidden="true"><Bot size={18} /></span>
          <span className="local-model-shortcut-copy">
            <strong>Local AI chat</strong>
            <small>Dolphin X1 Trinity Nano</small>
          </span>
          <span
            className={`local-model-phase phase-${localStatus?.phase ?? "loading"}`}
            title={localStatus ? LOCAL_PHASE_LABELS[localStatus.phase] : "Checking local runtime"}
          />
        </button>

        <div className="search-field">
          <Search size={15} aria-hidden="true" />
          <label className="sr-only" htmlFor="project-search">Search projects</label>
          <input
            id="project-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch("")}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="sidebar-label">
          <span>Installed</span>
          <span>{projects.length}</span>
        </div>

        <div className="project-list">
          {loading ? (
            <div className="sidebar-loading" aria-label="Loading projects">
              {[0, 1, 2].map((item) => (
                <div className="project-skeleton" key={item} />
              ))}
            </div>
          ) : filteredProjects.length ? (
            filteredProjects.map((project) => (
              <button
                className={`project-row ${selectedId === project.id && view === "library" ? "active" : ""}`}
                key={project.id}
                onClick={() => selectProject(project.id)}
                aria-current={selectedId === project.id && view === "library" ? "true" : undefined}
              >
                <span className="project-avatar" aria-hidden="true">
                  {projectInitials(project)}
                </span>
                <span className="project-row-copy">
                  <strong>{project.name}</strong>
                  <small>{project.owner}</small>
                </span>
                <span className={`row-status status-${project.status}`} title={STATUS_LABELS[project.status]}>
                  <span className="status-dot" />
                </span>
              </button>
            ))
          ) : (
            <div className="sidebar-empty">
              <Box size={22} aria-hidden="true" />
              <p>{search ? "No matching projects" : "No projects installed"}</p>
              {!search && <button onClick={() => setInstallOpen(true)}>Install one</button>}
            </div>
          )}
        </div>

        <button className="install-sidebar-button" onClick={() => setInstallOpen(true)}>
          <Download size={16} aria-hidden="true" />
          Install from GitHub
        </button>
      </aside>

      <main id="main-content" className="workspace" tabIndex={-1}>
        {view === "local-ai" ? (
          <LocalAIWorkspace
            status={localStatus}
            events={localEvents}
            onStatus={setLocalStatus}
            onNotice={setNotice}
          />
        ) : view === "settings" ? (
          <SettingsView health={health} refreshing={operation === "health"} onRefresh={refreshHealth} />
        ) : selectedProject ? (
          <ProjectWorkspace
            project={selectedProject}
            tab={tab}
            setTab={setTab}
            events={events[selectedProject.id] ?? []}
            operation={operation}
            onRun={runProject}
            onStop={() => void stopProject(selectedProject)}
            onUpdate={() => void updateProject(selectedProject)}
            onRemove={() => setRemoveOpen(true)}
            onNotice={setNotice}
          />
        ) : (
          <WelcomeView onInstall={() => setInstallOpen(true)} health={health} />
        )}
      </main>

      <div className="activity-bar" aria-label="Application status">
        <span>
          <span className="local-indicator" aria-hidden="true" />
          Local execution
        </span>
        <span>
          <ShieldCheck size={13} aria-hidden="true" />
          {view === "local-ai" ? "Loopback-only model service" : "Secrets filtered from child processes"}
        </span>
        {view === "local-ai" && localStatus && (
          <span className="activity-model-status">
            <span className={`local-model-phase phase-${localStatus.phase}`} aria-hidden="true" />
            {LOCAL_PHASE_LABELS[localStatus.phase]}
          </span>
        )}
        <span className="activity-version">v{health?.appVersion ?? "—"}</span>
      </div>

      <InstallDialog
        open={installOpen}
        events={events}
        onClose={closeInstall}
        onInstalled={handleInstalled}
        onInstallFailed={() => void refreshProjects()}
      />

      <ConfirmDialog
        open={removeOpen}
        title={`Remove ${selectedProject?.name ?? "project"}?`}
        description="This permanently deletes the managed project folder and its local environment. Repository files on GitHub are not affected."
        confirmLabel="Remove project"
        busy={operation?.startsWith("remove:") ?? false}
        onCancel={closeRemove}
        onConfirm={() => void removeProject()}
      />

      {notice && (
        <div className={`toast toast-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.kind === "success" ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : notice.kind === "error" ? (
            <AlertTriangle size={18} aria-hidden="true" />
          ) : (
            <Info size={18} aria-hidden="true" />
          )}
          <span>{notice.message}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice(null)}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

function LocalStatusBadge({ status }: { status: LocalModelStatus | null }) {
  if (!status) {
    return (
      <span className="local-status-badge phase-loading">
        <Loader2 className="spin" size={12} aria-hidden="true" />
        Checking runtime
      </span>
    );
  }

  const busy = LOCAL_BUSY_PHASES.includes(status.phase);
  return (
    <span className={`local-status-badge phase-${status.phase}`}>
      {busy ? (
        <Loader2 className="spin" size={12} aria-hidden="true" />
      ) : (
        <span className="local-model-phase" aria-hidden="true" />
      )}
      {LOCAL_PHASE_LABELS[status.phase]}
    </span>
  );
}

function LocalAIWorkspace({
  status,
  events,
  onStatus,
  onNotice,
}: {
  status: LocalModelStatus | null;
  events: LocalModelEvent[];
  onStatus: (status: LocalModelStatus) => void;
  onNotice: (notice: Notice) => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewPurpose, setReviewPurpose] = useState<"review" | "start">("review");
  const [modelTrustConfirmed, setModelTrustConfirmed] = useState(false);
  const [action, setAction] = useState<"start" | "stop" | null>(null);
  const [actionError, setActionError] = useState("");
  const [messages, setMessages] = useState<LocalChatMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState("");
  const [logStart, setLogStart] = useState(0);
  const messageViewport = useRef<HTMLDivElement>(null);
  const promptField = useRef<HTMLTextAreaElement>(null);

  const visibleEvents = events.slice(logStart);
  const isRunning = status?.phase === "running";
  const isStarting = status?.phase === "starting" || status?.phase === "downloading";
  const runtimeReady = status?.runner.available ?? false;

  useEffect(() => {
    if (!messageViewport.current) return;
    messageViewport.current.scrollTop = messageViewport.current.scrollHeight;
  }, [messages, chatBusy]);

  useEffect(() => {
    if (isRunning) promptField.current?.focus();
  }, [isRunning]);

  const openReview = (purpose: "review" | "start") => {
    setReviewPurpose(purpose);
    setReviewOpen(true);
  };

  const startModel = async (trustConfirmed = modelTrustConfirmed) => {
    if (!trustConfirmed) {
      openReview("start");
      return;
    }
    setAction("start");
    setActionError("");
    try {
      const nextStatus = await window.openforge.startLocalModel(trustConfirmed);
      onStatus(nextStatus);
      onNotice({
        kind: "info",
        message:
          nextStatus.phase === "downloading"
            ? "The model download has started. Keep OpenForge open."
            : "The local model is starting.",
      });
    } catch (error) {
      const message = errorMessage(error);
      setActionError(message);
      onNotice({ kind: "error", message });
    } finally {
      setAction(null);
    }
  };

  const stopModel = async () => {
    setAction("stop");
    setActionError("");
    try {
      const nextStatus = await window.openforge.stopLocalModel();
      onStatus(nextStatus);
      onNotice({ kind: "success", message: "The local model has stopped." });
    } catch (error) {
      const message = errorMessage(error);
      setActionError(message);
      onNotice({ kind: "error", message });
    } finally {
      setAction(null);
    }
  };

  const sendMessage = async () => {
    const content = prompt.trim();
    if (!content || chatBusy || !isRunning) return;

    const userMessage: LocalChatMessage = { role: "user", content };
    const requestMessages = [...messages, userMessage].slice(-24);
    setMessages(requestMessages);
    setPrompt("");
    setChatBusy(true);
    setChatError("");
    try {
      const response = await window.openforge.sendLocalChat({
        messages: requestMessages,
        temperature: 0.7,
        maxTokens: 1_024,
      });
      setMessages((current) => [...current, response.message]);
    } catch (error) {
      setChatError(errorMessage(error));
    } finally {
      setChatBusy(false);
      promptField.current?.focus();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setChatError("");
    promptField.current?.focus();
  };

  return (
    <div className="local-ai-workspace">
      <header className="local-ai-header">
        <div className="local-ai-title">
          <span className="local-ai-mark" aria-hidden="true"><Bot size={22} /></span>
          <div>
            <div className="local-ai-title-line">
              <h2>{status?.name ?? "Dolphin X1 Trinity Nano"}</h2>
              <LocalStatusBadge status={status} />
            </div>
            <p>Local, owner-controlled, minimally filtered AI powered by llama.cpp.</p>
          </div>
        </div>
        <div className="local-ai-actions">
          <button className="button secondary" onClick={() => openReview("review")}>
            <ShieldCheck size={15} aria-hidden="true" />
            Review setup
          </button>
          {!status || !runtimeReady ? (
            <button className="button primary" onClick={() => openReview("review")} disabled={!status}>
              <Download size={15} aria-hidden="true" />
              Install runtime
            </button>
          ) : isRunning || isStarting ? (
            <button
              className="button secondary"
              onClick={() => void stopModel()}
              disabled={action !== null || status.phase === "stopping"}
            >
              {action === "stop" || status.phase === "stopping" ? <Loader2 className="spin" size={15} /> : <Square size={14} />}
              {status.phase === "stopping" ? "Stopping" : isStarting ? "Cancel start" : "Stop model"}
            </button>
          ) : (
            <button
              className="button primary"
              onClick={() => void startModel()}
              disabled={action !== null || LOCAL_BUSY_PHASES.includes(status.phase)}
            >
              {action === "start" ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
              {action === "start" ? "Starting" : "Start local model"}
            </button>
          )}
        </div>
      </header>

      <div className="local-ai-meta" aria-label="Local model details">
        <span><strong>{status?.downloadSize ?? "3.64 GB"}</strong> download on first start</span>
        <span><strong>{status?.quantization ?? "MXFP4_MOE"}</strong> quantization</span>
        <span><strong>llama.cpp</strong> local runtime</span>
        <span><strong>127.0.0.1</strong> loopback only</span>
      </div>

      {(actionError || status?.lastError) && (
        <div className="local-ai-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span><strong>Local model needs attention</strong>{actionError || status?.lastError}</span>
        </div>
      )}

      <div className="local-ai-layout">
        <section className="chat-panel" aria-labelledby="local-chat-title">
          <header className="chat-panel-header">
            <div>
              <p className="eyebrow">Private session</p>
              <h3 id="local-chat-title">Local chat</h3>
            </div>
            <div className="chat-header-actions">
              <span className={`chat-connection ${isRunning ? "online" : "offline"}`}>
                <span aria-hidden="true" />
                {isRunning ? "Model online" : isStarting ? "Preparing model" : "Model offline"}
              </span>
              <IconButton label="Clear local chat" onClick={clearChat} disabled={!messages.length || chatBusy}>
                <Trash2 size={15} aria-hidden="true" />
              </IconButton>
            </div>
          </header>

          <div
            className={`chat-messages ${messages.length ? "has-messages" : ""}`}
            ref={messageViewport}
            role="log"
            aria-live="polite"
            aria-label="Local chat messages"
          >
            {messages.length ? (
              messages.filter((message) => message.role !== "system").map((message, index) => (
                <article className={`chat-message role-${message.role}`} key={`${message.role}-${index}`}>
                  <span className="chat-message-avatar" aria-hidden="true">
                    {message.role === "assistant" ? <Bot size={15} /> : "You"}
                  </span>
                  <div>
                    <strong>{message.role === "assistant" ? "Dolphin" : "You"}</strong>
                    <p>{message.content}</p>
                  </div>
                </article>
              ))
            ) : (
              <div className="chat-empty">
                <span className="chat-empty-mark" aria-hidden="true"><Bot size={27} /></span>
                <h3>{isRunning ? "Ready when you are" : "Start the model to chat"}</h3>
                <p>
                  {isRunning
                    ? "Your messages stay on this computer and are sent only to the loopback model service."
                    : runtimeReady
                      ? "The first start downloads about 3.64 GB, then opens a private loopback service."
                      : "Review and install llama.cpp first. The model weights download only when you start it."}
                </p>
                {!runtimeReady && status && (
                  <button className="button primary" onClick={() => openReview("review")}>
                    <Download size={15} /> Review installation
                  </button>
                )}
                {runtimeReady && !isRunning && !isStarting && (
                  <button className="button primary" onClick={() => void startModel()} disabled={action !== null}>
                    <Play size={15} /> Start local model
                  </button>
                )}
                {isStarting && (
                  <div className="chat-preparing" role="status">
                    <Loader2 className="spin" size={15} />
                    {status?.phase === "downloading" ? "Downloading model weights…" : "Starting llama.cpp…"}
                  </div>
                )}
              </div>
            )}
            {chatBusy && (
              <div className="chat-thinking" role="status">
                <span className="chat-message-avatar" aria-hidden="true"><Bot size={15} /></span>
                <span>Dolphin is generating locally</span>
                <Loader2 className="spin" size={13} aria-hidden="true" />
              </div>
            )}
          </div>

          <div className="chat-composer-wrap">
            {chatError && <div className="chat-error" role="alert"><AlertTriangle size={14} />{chatError}</div>}
            <div className={`chat-composer ${isRunning ? "" : "disabled"}`}>
              <label className="sr-only" htmlFor="local-chat-prompt">Message the local model</label>
              <textarea
                id="local-chat-prompt"
                ref={promptField}
                value={prompt}
                rows={2}
                maxLength={12_000}
                disabled={!isRunning || chatBusy}
                placeholder={isRunning ? "Message the local model…" : "Start the model to enable chat"}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <button
                className="send-button"
                aria-label="Send message"
                title="Send message (Enter)"
                onClick={() => void sendMessage()}
                disabled={!isRunning || chatBusy || !prompt.trim()}
              >
                {chatBusy ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
              </button>
            </div>
            <div className="composer-note">
              <span>Enter to send · Shift+Enter for a new line</span>
              <span>AI output can be inaccurate or unsafe. You are responsible for how you use it.</span>
            </div>
          </div>
        </section>

        <aside className="local-ai-inspector" aria-label="Local model information and activity">
          <section className="model-facts-card">
            <div className="inspector-heading">
              <div><p className="eyebrow">Selected model</p><h3>Trinity Nano · MXFP4</h3></div>
              <Box size={17} aria-hidden="true" />
            </div>
            <dl>
              <div><dt>Model card</dt><dd>{status?.modelLicense ?? "Apache-2.0"}</dd></div>
              <div><dt>Base model</dt><dd>{status?.baseLicense ?? "OpenMDW-1.1"}</dd></div>
              <div><dt>Download</dt><dd>{status?.downloadSize ?? "3.64 GB"}</dd></div>
              <div><dt>Service</dt><dd>{status?.endpoint ?? "Not running"}</dd></div>
            </dl>
            <div className="license-caveat">
              <Info size={14} aria-hidden="true" />
              <p>The fine-tune card lists Apache-2.0; its Trinity Nano base has separate OpenMDW-1.1 terms. Review both before use.</p>
            </div>
          </section>

          <section className="local-activity-card">
            <div className="inspector-heading">
              <div><p className="eyebrow">Runtime activity</p><h3>llama.cpp log</h3></div>
              <div className="inspector-actions">
                <span>{visibleEvents.length}</span>
                <IconButton label="Clear visible local model logs" onClick={() => setLogStart(events.length)} disabled={!visibleEvents.length}>
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              </div>
            </div>
            <div className="local-event-list" tabIndex={0} aria-label="Local model runtime logs">
              {visibleEvents.length ? visibleEvents.slice(-100).map((event, index) => (
                <div className={`local-event level-${event.level}`} key={`${event.timestamp}-${index}`}>
                  <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
                  <span>{event.message.trim()}</span>
                </div>
              )) : (
                <div className="local-events-empty">
                  <Terminal size={19} aria-hidden="true" />
                  <p>Runtime and download updates appear here.</p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>

      <LocalModelInstallDialog
        open={reviewOpen}
        status={status}
        purpose={reviewPurpose}
        onClose={() => setReviewOpen(false)}
        onInstalled={onStatus}
        onTrusted={() => setModelTrustConfirmed(true)}
        onStartApproved={() => void startModel(true)}
        onNotice={onNotice}
      />
    </div>
  );
}

function LocalModelInstallDialog({
  open,
  status,
  purpose,
  onClose,
  onInstalled,
  onTrusted,
  onStartApproved,
  onNotice,
}: {
  open: boolean;
  status: LocalModelStatus | null;
  purpose: "review" | "start";
  onClose: () => void;
  onInstalled: (status: LocalModelStatus) => void;
  onTrusted: () => void;
  onStartApproved: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [plan, setPlan] = useState<LocalModelInstallPlan | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const runtimeReady = status?.runner.available ?? false;

  useEffect(() => {
    if (!open) return;
    setPlan(null);
    setTrusted(false);
    setError("");
    setLoadingPlan(true);
    void window.openforge.previewLocalModelInstall()
      .then(setPlan)
      .catch((planError) => setError(errorMessage(planError)))
      .finally(() => setLoadingPlan(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !installing) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, installing, onClose]);

  if (!open) return null;

  const installRuntime = async () => {
    setInstalling(true);
    setError("");
    try {
      const nextStatus = await window.openforge.installLocalModel(trusted);
      onInstalled(nextStatus);
      onTrusted();
      onNotice({ kind: "success", message: "llama.cpp is installed and ready." });
      onClose();
    } catch (installError) {
      setError(errorMessage(installError));
    } finally {
      setInstalling(false);
    }
  };

  const approveStart = () => {
    if (!trusted) return;
    onTrusted();
    onClose();
    if (purpose === "start") onStartApproved();
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !installing) onClose(); }}>
      <section className="install-dialog local-model-dialog" role="dialog" aria-modal="true" aria-labelledby="local-install-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Local model preset</p>
            <h2 id="local-install-title">Review Dolphin X1 setup</h2>
          </div>
          <IconButton label="Close local model setup" onClick={onClose} disabled={installing}>
            <X size={18} />
          </IconButton>
        </header>

        <div className="local-dialog-summary">
          <span className="preset-icon" aria-hidden="true"><Bot size={19} /></span>
          <div>
            <strong>Dolphin X1 Trinity Nano · MXFP4_MOE</strong>
            <small>3.64 GB on-demand model download · loopback-only llama.cpp server</small>
          </div>
          <span className="managed-badge">Local preset</span>
        </div>

        <div className="dialog-body local-dialog-body">
          {loadingPlan ? (
            <div className="dialog-plan-loading" role="status"><Loader2 className="spin" size={18} />Preparing the exact setup plan…</div>
          ) : plan ? (
            <>
              <div className="command-plan local-command-plan">
                <div className="plan-heading">
                  <span><Terminal size={15} /> Exact process &amp; network plan</span>
                  <small>{plan.commands.length} {plan.commands.length === 1 ? "step" : "steps"}</small>
                </div>
                <ol>{plan.commands.map((command, index) => <li key={`${command}-${index}`}><span /><code>{command}</code></li>)}</ol>
              </div>

              <div className="local-plan-section">
                <div className="plan-heading-inline"><span>License lineage</span><small>Review both</small></div>
                <div className="license-list">
                  {plan.licenses.map((license) => (
                    <button key={license.url} onClick={() => void window.openforge.openExternal(license.url)}>
                      <span><strong>{license.name}</strong><small>{license.license}</small></span>
                      <ExternalLink size={14} aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <p className="lineage-note"><Info size={14} />The model card and base model use separate terms. OpenForge does not bundle or relicense the model weights.</p>
              </div>

              <ul className="plan-notes local-plan-notes">
                {plan.notes.map((note) => <li key={note}><Info size={14} />{note}</li>)}
              </ul>

              <label className="trust-check">
                <input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />
                <span>
                  <strong>I reviewed the commands and licenses, and approve this local setup</strong>
                  <small>
                    {runtimeReady
                      ? "Starting downloads about 3.64 GB of third-party model weights and launches a local process. Model output is not provider-moderated."
                      : "llama.cpp is third-party software installed with your Windows account permissions. Starting later downloads the model weights."}
                  </small>
                </span>
              </label>
            </>
          ) : null}

          {installing && (
            <div className="local-installing" role="status">
              <Loader2 className="spin" size={17} />
              <span><strong>Installing llama.cpp</strong><small>Keep OpenForge open while Windows Package Manager finishes.</small></span>
            </div>
          )}
          {error && <div className="dialog-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        </div>

        <footer className="dialog-footer local-dialog-footer">
          <p><ShieldCheck size={14} />No model weights download until you choose Start local model.</p>
          {runtimeReady ? (
            <button className="button primary" onClick={approveStart} disabled={!plan || !trusted || loadingPlan}>
              {purpose === "start" ? <Play size={15} /> : <ShieldCheck size={15} />}
              {purpose === "start" ? "Approve & start" : "Approve for this session"}
            </button>
          ) : (
            <button className="button primary" onClick={() => void installRuntime()} disabled={!plan || !trusted || installing || loadingPlan}>
              {installing ? <Loader2 className="spin" size={15} /> : <Download size={15} />}
              {installing ? "Installing" : "Install llama.cpp"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function WelcomeView({
  onInstall,
  health,
}: {
  onInstall: () => void;
  health: SystemHealth | null;
}) {
  const readyTools = health
    ? [health.git, health.python, health.node].filter((tool) => tool.available).length
    : 0;
  return (
    <div className="welcome-view">
      <div className="welcome-orbit" aria-hidden="true">
        <div className="orbit-mark">
          <Zap size={28} />
        </div>
      </div>
      <p className="eyebrow">Local AI workspace</p>
      <h2>Run open-source AI<br />without the setup maze.</h2>
      <p className="welcome-lead">
        Install a GitHub project into an isolated local environment, review every command,
        and keep the live output in one place.
      </p>
      <div className="welcome-actions">
        <button className="button primary" onClick={onInstall}>
          <GitFork size={17} aria-hidden="true" />
          Install from GitHub
        </button>
        <button className="button secondary" onClick={() => void window.openforge.openExternal(DARK_BERT_URL)}>
          Explore DarkBERT
          <ArrowUpRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="readiness-strip">
        <div>
          <span className="readiness-value">{health ? `${readyTools}/3` : "—"}</span>
          <span>tools detected</span>
        </div>
        <div>
          <span className="readiness-value">Local</span>
          <span>execution mode</span>
        </div>
        <div>
          <span className="readiness-value">Visible</span>
          <span>install commands</span>
        </div>
      </div>
    </div>
  );
}

function ProjectWorkspace({
  project,
  tab,
  setTab,
  events,
  operation,
  onRun,
  onStop,
  onUpdate,
  onRemove,
  onNotice,
}: {
  project: ProjectRecord;
  tab: ProjectTab;
  setTab: (tab: ProjectTab) => void;
  events: ProjectEvent[];
  operation: string | null;
  onRun: (request: RunRequest) => Promise<void>;
  onStop: () => void;
  onUpdate: () => void;
  onRemove: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isRunning = project.status === "running" || project.status === "stopping";
  const isBusy = operation?.endsWith(project.id) || project.status === "installing";

  return (
    <div className="project-workspace">
      <header className="project-header">
        <div className="project-title-block">
          <div className="project-avatar large" aria-hidden="true">
            {projectInitials(project)}
          </div>
          <div>
            <div className="project-title-line">
              <h2>{project.name}</h2>
              <StatusBadge status={project.status} />
            </div>
            <button
              className="repo-link"
              onClick={() => void window.openforge.openExternal(project.repoUrl)}
            >
              <GitFork size={13} aria-hidden="true" />
              {project.owner}/{project.repo}
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="button secondary"
            onClick={() => void window.openforge.revealProject(project.id)}
          >
            <FolderOpen size={16} aria-hidden="true" />
            Open folder
          </button>
          {isRunning ? (
            <button className="button danger" onClick={onStop} disabled={project.status === "stopping" || !!isBusy}>
              {project.status === "stopping" ? <Loader2 className="spin" size={16} /> : <Square size={14} fill="currentColor" />}
              {project.status === "stopping" ? "Stopping" : "Stop"}
            </button>
          ) : (
            <button
              className="button primary"
              onClick={() => setTab("run")}
              disabled={project.status === "installing" || !!isBusy}
            >
              <Play size={15} fill="currentColor" aria-hidden="true" />
              Configure run
            </button>
          )}
          <div className="menu-wrap">
            <IconButton label="More project actions" onClick={() => setMenuOpen((current) => !current)} aria-expanded={menuOpen}>
              <MoreHorizontal size={18} aria-hidden="true" />
            </IconButton>
            {menuOpen && (
              <div className="action-menu" role="menu">
                <button role="menuitem" onClick={() => { setMenuOpen(false); onUpdate(); }} disabled={isRunning || !!isBusy}>
                  <RefreshCw size={15} aria-hidden="true" />
                  Check source for updates
                </button>
                <button className="destructive" role="menuitem" onClick={() => { setMenuOpen(false); onRemove(); }} disabled={isRunning || !!isBusy}>
                  <Trash2 size={15} aria-hidden="true" />
                  Remove project
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav className="tab-list" aria-label={`${project.name} sections`}>
        {(["overview", "run", "environment", "logs"] as const).map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            aria-current={tab === item ? "page" : undefined}
            onClick={() => setTab(item)}
          >
            {item === "logs" ? "Live logs" : item[0].toUpperCase() + item.slice(1)}
            {item === "logs" && events.length > 0 && <span>{Math.min(events.length, 999)}</span>}
          </button>
        ))}
      </nav>

      <div className="project-content">
        {tab === "overview" && (
          <OverviewPanel project={project} events={events} onRun={() => setTab("run")} onLogs={() => setTab("logs")} />
        )}
        {tab === "run" && (
          <RunPanel
            key={project.id}
            project={project}
            events={events}
            busy={operation === `run:${project.id}`}
            onRun={onRun}
            onStop={onStop}
            onNotice={onNotice}
          />
        )}
        {tab === "environment" && <EnvironmentPanel project={project} />}
        {tab === "logs" && (
          <LogsConsole project={project} events={events} onNotice={onNotice} expanded />
        )}
      </div>
    </div>
  );
}

function OverviewPanel({
  project,
  events,
  onRun,
  onLogs,
}: {
  project: ProjectRecord;
  events: ProjectEvent[];
  onRun: () => void;
  onLogs: () => void;
}) {
  const latest = events.at(-1);
  return (
    <div className="overview-grid">
      {project.status === "failed" && (
        <section className="inline-alert danger-alert overview-span">
          <AlertTriangle size={19} aria-hidden="true" />
          <div>
            <strong>The last operation needs attention</strong>
            <p>{project.lastError ?? "Open the logs for more detail."}</p>
          </div>
          <button onClick={onLogs}>View logs</button>
        </section>
      )}

      <section className="overview-hero overview-span">
        <div>
          <p className="eyebrow">Project status</p>
          <h3>{STATUS_LABELS[project.status]}</h3>
          <p>{STATUS_HELP[project.status]}</p>
        </div>
        <div className={`project-pulse status-${project.status}`} aria-hidden="true">
          {project.status === "running" ? <Activity size={30} /> : <CheckCircle2 size={30} />}
        </div>
        <button className="button primary" onClick={onRun} disabled={project.status === "installing" || project.status === "stopping"}>
          <Play size={15} fill="currentColor" aria-hidden="true" />
          {project.status === "running" ? "View active run" : "Start a run"}
        </button>
      </section>

      <section className="info-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Configuration</p>
            <h3>Runtime</h3>
          </div>
          <Code2 size={18} aria-hidden="true" />
        </div>
        <dl className="details-list">
          <div><dt>Runtime</dt><dd>{project.runtime === "python" ? "Python" : project.runtime === "node" ? "Node.js" : "Not detected"}</dd></div>
          <div><dt>Entry point</dt><dd className="mono">{project.runtime === "node" ? `npm run ${project.nodeScript ?? "start"}` : project.entryPoint || "Not configured"}</dd></div>
          <div><dt>Revision</dt><dd className="mono">{project.branch}</dd></div>
        </dl>
      </section>

      <section className="info-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Activity</p>
            <h3>Latest event</h3>
          </div>
          <Clock3 size={18} aria-hidden="true" />
        </div>
        {latest ? (
          <div className="latest-event">
            <span className={`event-mark level-${latest.level}`} aria-hidden="true" />
            <div>
              <p>{latest.message.trim().slice(0, 180)}</p>
              <small>{formatDate(latest.timestamp)}</small>
            </div>
          </div>
        ) : (
          <p className="muted-copy">No activity in this session yet.</p>
        )}
        <button className="text-button" onClick={onLogs}>Open live logs <ChevronRight size={14} /></button>
      </section>

      {project.presetId === "dark-bert" && (
        <section className="inline-alert overview-span">
          <ShieldCheck size={19} aria-hidden="true" />
          <div>
            <strong>Reviewed compatibility preset</strong>
            <p>
              This project is pinned to the reviewed 2022 revision and uses maintained package versions instead of its obsolete CUDA pins.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

function RunPanel({
  project,
  events,
  busy,
  onRun,
  onStop,
  onNotice,
}: {
  project: ProjectRecord;
  events: ProjectEvent[];
  busy: boolean;
  onRun: (request: RunRequest) => Promise<void>;
  onStop: () => void;
  onNotice: (notice: Notice) => void;
}) {
  const [model, setModel] = useState("albert");
  const [inputDirectory, setInputDirectory] = useState("");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [entryPoint, setEntryPoint] = useState(project.entryPoint);
  const [nodeScript, setNodeScript] = useState(project.nodeScript || "start");
  const [argumentText, setArgumentText] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const running = project.status === "running" || project.status === "stopping";
  const isDarkBert = project.presetId === "dark-bert";
  const genericArguments = linesToArguments(argumentText);
  const args = isDarkBert
    ? ["-m", model, "-i", inputDirectory, "-o", outputDirectory]
    : genericArguments;
  const commandName = project.runtime === "node" ? `npm run ${nodeScript}` : `python ${entryPoint}`;
  const canRun =
    project.status !== "installing" &&
    project.status !== "needs-setup" &&
    project.runtime !== "unknown" &&
    (!isDarkBert || (!!inputDirectory && !!outputDirectory)) &&
    (project.runtime !== "python" || !!entryPoint.trim()) &&
    (project.runtime !== "node" || !!nodeScript.trim());

  const pickFolder = async (target: "input" | "output") => {
    const value = await window.openforge.pickDirectory(
      target === "input" ? "Choose the HTML input folder" : "Choose an output folder",
    );
    if (!value) return;
    if (target === "input") setInputDirectory(value);
    else setOutputDirectory(value);
  };

  const submit = () => {
    if (!canRun) return;
    void onRun({
      projectId: project.id,
      entryPoint: project.runtime === "python" ? entryPoint : undefined,
      nodeScript: project.runtime === "node" ? nodeScript : undefined,
      args,
    });
  };

  if (project.runtime === "unknown" || project.status === "needs-setup") {
    return (
      <section className="unsupported-state">
        <CircleHelp size={32} aria-hidden="true" />
        <h3>OpenForge could not find a runnable project</h3>
        <p>
          A supported <span className="mono">requirements.txt</span>, <span className="mono">pyproject.toml</span>, or <span className="mono">package.json</span> was not detected.
        </p>
        <button className="button secondary" onClick={() => void window.openforge.revealProject(project.id)}>
          <FolderOpen size={16} /> Open project folder
        </button>
      </section>
    );
  }

  return (
    <div className="run-layout">
      <section className="run-config">
        <div className="section-title">
          <div>
            <p className="eyebrow">Launch configuration</p>
            <h3>{isDarkBert ? "Cluster an HTML corpus" : `Run ${project.name}`}</h3>
          </div>
          <span className="runtime-chip"><Code2 size={13} />{project.runtime === "python" ? "Python" : "Node.js"}</span>
        </div>

        {isDarkBert ? (
          <div className="form-stack">
            <fieldset className="model-fieldset">
              <legend>Embedding model</legend>
              <div className="segmented-options">
                {[
                  ["bert", "DistilBERT", "Fast, balanced"],
                  ["albert", "ALBERT", "Lower memory"],
                  ["roberta", "RoBERTa", "Rich semantics"],
                ].map(([value, label, help]) => (
                  <label key={value} className={model === value ? "selected" : ""}>
                    <input type="radio" name="model" value={value} checked={model === value} onChange={() => setModel(value)} />
                    <span><strong>{label}</strong><small>{help}</small></span>
                    <Check size={15} aria-hidden="true" />
                  </label>
                ))}
              </div>
            </fieldset>

            <FolderField
              label="Input documents"
              description="Folder containing at least 51 usable HTML documents"
              value={inputDirectory}
              placeholder="Choose an input folder"
              onChange={setInputDirectory}
              onBrowse={() => void pickFolder("input")}
            />
            <FolderField
              label="Chart output"
              description="Where generated cluster visualizations should be saved"
              value={outputDirectory}
              placeholder="Choose an output folder"
              onChange={setOutputDirectory}
              onBrowse={() => void pickFolder("output")}
            />

            <div className="inline-alert compact">
              <Info size={17} aria-hidden="true" />
              <p>First launch downloads a public sentence-transformer model and the NLTK words corpus.</p>
            </div>
          </div>
        ) : (
          <div className="form-stack">
            {project.runtime === "python" ? (
              <label className="field-group">
                <span>Python entry point</span>
                <small>Path relative to the managed project folder</small>
                <div className="input-shell mono-input"><FileCode2 size={15} /><input value={entryPoint} onChange={(event) => setEntryPoint(event.target.value)} placeholder="main.py" /></div>
              </label>
            ) : (
              <label className="field-group">
                <span>npm script</span>
                <small>Script name from package.json</small>
                <div className="input-shell mono-input"><Terminal size={15} /><input value={nodeScript} onChange={(event) => setNodeScript(event.target.value)} /></div>
              </label>
            )}
            <label className="field-group">
              <span>Launch arguments</span>
              <small>Enter one argument per line. Spaces within a line remain part of that argument.</small>
              <textarea className="argument-editor" value={argumentText} onChange={(event) => setArgumentText(event.target.value)} placeholder={"--port\n7860\n--share=false"} rows={6} />
            </label>
          </div>
        )}

        <button className="command-disclosure" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>
          <span><Terminal size={15} /> Command preview</span>
          {advancedOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {advancedOpen && (
          <div className="command-preview" tabIndex={0}>
            <span className="prompt">$</span>
            <code>{[commandName, ...args].map(quoteArgument).join(" ")}</code>
          </div>
        )}

        <div className="run-actions">
          <p>
            <ShieldCheck size={14} aria-hidden="true" />
            Runs locally with sensitive parent environment variables removed.
          </p>
          {running ? (
            <button className="button danger" onClick={onStop} disabled={project.status === "stopping"}>
              {project.status === "stopping" ? <Loader2 className="spin" size={16} /> : <Square size={13} fill="currentColor" />}
              {project.status === "stopping" ? "Stopping" : "Stop run"}
            </button>
          ) : (
            <button className="button primary run-button" onClick={submit} disabled={!canRun || busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <Play size={14} fill="currentColor" />}
              {busy ? "Starting" : "Start run"}
            </button>
          )}
        </div>
      </section>

      <LogsConsole project={project} events={events} onNotice={onNotice} />
    </div>
  );
}

function FolderField({
  label,
  description,
  value,
  placeholder,
  onChange,
  onBrowse,
}: {
  label: string;
  description: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
}) {
  const inputId = useId();
  return (
    <div className="field-group">
      <label htmlFor={inputId}>{label}</label>
      <small>{description}</small>
      <div className="folder-field">
        <FolderOpen size={16} aria-hidden="true" />
        <input id={inputId} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        <button type="button" onClick={onBrowse}>Browse</button>
      </div>
    </div>
  );
}

function LogsConsole({
  project,
  events,
  onNotice,
  expanded = false,
}: {
  project: ProjectRecord;
  events: ProjectEvent[];
  onNotice: (notice: Notice) => void;
  expanded?: boolean;
}) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [query, setQuery] = useState("");
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [startIndex, setStartIndex] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const visibleEvents = pausedAt === null ? events.slice(startIndex) : events.slice(startIndex, pausedAt);
  const filtered = visibleEvents.filter((event) => {
    if (filter !== "all" && event.level !== filter) return false;
    return !query.trim() || event.message.toLowerCase().includes(query.trim().toLowerCase());
  });

  useEffect(() => {
    if (!autoScroll || pausedAt !== null || !viewportRef.current) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [filtered.length, autoScroll, pausedAt]);

  const copyLogs = async () => {
    try {
      const text = filtered
        .map((event) => `[${formatTime(event.timestamp)}] ${event.level.toUpperCase()} ${event.message.trim()}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      onNotice({ kind: "success", message: "Visible logs copied to the clipboard." });
    } catch (error) {
      onNotice({ kind: "error", message: errorMessage(error) });
    }
  };

  return (
    <section className={`logs-console ${expanded ? "expanded" : ""}`}>
      <div className="console-heading">
        <div>
          <span className={`live-dot ${project.status === "running" ? "active" : ""}`} aria-hidden="true" />
          <strong>{project.status === "running" ? "Live output" : "Run output"}</strong>
          <span className="console-count">{visibleEvents.length}</span>
        </div>
        <div className="console-actions">
          <IconButton
            label={pausedAt === null ? "Pause log display" : "Resume log display"}
            onClick={() => setPausedAt((current) => (current === null ? events.length : null))}
            className={pausedAt !== null ? "active" : ""}
          >
            {pausedAt === null ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <IconButton label="Copy visible logs" onClick={() => void copyLogs()} disabled={!filtered.length}>
            <Copy size={14} />
          </IconButton>
          <IconButton label="Clear visible logs" onClick={() => { setStartIndex(events.length); setPausedAt(null); }} disabled={!visibleEvents.length}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      <div className="console-toolbar">
        <label className="console-search">
          <Search size={13} />
          <span className="sr-only">Search logs</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter output" />
        </label>
        <label className="select-shell">
          <SlidersHorizontal size={13} />
          <span className="sr-only">Filter log level</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as LogFilter)}>
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="warning">Warnings</option>
            <option value="error">Errors</option>
            <option value="success">Success</option>
          </select>
        </label>
        <label className="autoscroll-toggle">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          Follow latest
        </label>
      </div>

      <div
        className="console-viewport"
        ref={viewportRef}
        tabIndex={0}
        aria-label={`${project.name} process logs`}
        onScroll={(event) => {
          const element = event.currentTarget;
          const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 20;
          if (!atBottom && autoScroll) setAutoScroll(false);
        }}
      >
        {filtered.length ? (
          filtered.map((event, index) => (
            <div className={`log-line level-${event.level} type-${event.type}`} key={`${event.timestamp}-${index}`}>
              <time dateTime={event.timestamp}>{formatTime(event.timestamp)}</time>
              <span className="log-level">{event.level.slice(0, 4).toUpperCase()}</span>
              <pre>{event.message.trimEnd()}</pre>
            </div>
          ))
        ) : (
          <div className="console-empty">
            <Terminal size={22} aria-hidden="true" />
            <p>{events.length ? "No output matches this filter." : "Logs will appear here when the project starts."}</p>
          </div>
        )}
      </div>
      {!autoScroll && filtered.length > 0 && (
        <button className="jump-latest" onClick={() => {
          setAutoScroll(true);
          requestAnimationFrame(() => {
            if (viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
          });
        }}>
          Jump to latest <ChevronDown size={13} />
        </button>
      )}
    </section>
  );
}

function EnvironmentPanel({ project }: { project: ProjectRecord }) {
  return (
    <div className="environment-grid">
      <section className="environment-card primary-card">
        <div className="environment-icon"><Code2 size={21} /></div>
        <div>
          <p className="eyebrow">Detected runtime</p>
          <h3>{project.runtime === "python" ? "Python virtual environment" : project.runtime === "node" ? "Node.js project" : "Unknown runtime"}</h3>
          <p>{project.runtime === "python" ? "Dependencies are installed into a project-local .venv folder." : project.runtime === "node" ? "Dependencies are installed from the repository package manifest." : "No supported manifest was detected."}</p>
        </div>
        <StatusBadge status={project.status} />
      </section>

      <section className="info-panel">
        <div className="panel-heading"><div><p className="eyebrow">Launch</p><h3>Entry configuration</h3></div><Terminal size={18} /></div>
        <dl className="details-list">
          <div><dt>Runtime</dt><dd>{project.runtime}</dd></div>
          <div><dt>{project.runtime === "node" ? "npm script" : "Entry point"}</dt><dd className="mono">{project.runtime === "node" ? project.nodeScript ?? "start" : project.entryPoint || "Not detected"}</dd></div>
          <div><dt>Revision</dt><dd className="mono">{project.branch}</dd></div>
        </dl>
      </section>

      <section className="info-panel">
        <div className="panel-heading"><div><p className="eyebrow">Process safety</p><h3>Environment filtering</h3></div><ShieldCheck size={18} /></div>
        <p className="muted-copy">Token, secret, credential, cloud-provider, and runtime-injection variables are removed before child processes start.</p>
        <div className="security-tags"><span>Tokens</span><span>Passwords</span><span>Cloud keys</span><span>Runtime injection</span></div>
      </section>

      <section className="path-panel environment-span">
        <div><HardDrive size={17} /><span><strong>Managed project folder</strong><small>{project.directory}</small></span></div>
        <button className="button secondary" onClick={() => void window.openforge.revealProject(project.id)}><FolderOpen size={15} /> Show in folder</button>
      </section>
    </div>
  );
}

function SettingsView({
  health,
  refreshing,
  onRefresh,
}: {
  health: SystemHealth | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="settings-view">
      <header className="settings-header">
        <div><p className="eyebrow">OpenForge AI</p><h2>Settings & system health</h2><p>Tools and locations used to create isolated local project environments.</p></div>
        <button className="button secondary" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "spin" : ""} size={16} />
          {refreshing ? "Checking" : "Run checks"}
        </button>
      </header>

      <section className="settings-section">
        <div className="section-title"><div><p className="eyebrow">Readiness</p><h3>Developer tools</h3></div><span className="section-caption">Detected from your PATH</span></div>
        <div className="health-grid">
          <ToolCard icon={GitFork} name="Git" status={health?.git} required />
          <ToolCard icon={Code2} name="Python" status={health?.python} detail="For Python AI projects" />
          <ToolCard icon={PackageCheck} name="Node.js" status={health?.node} detail="For JavaScript AI projects" />
        </div>
      </section>

      <section className="settings-section">
        <div className="section-title"><div><p className="eyebrow">Storage</p><h3>Managed projects</h3></div></div>
        <div className="setting-row">
          <div className="setting-icon"><HardDrive size={18} /></div>
          <div><strong>Project directory</strong><small className="mono">{health?.projectsDirectory ?? "Loading…"}</small></div>
          <span className="managed-badge">App managed</span>
        </div>
      </section>

      <section className="settings-section">
        <div className="section-title"><div><p className="eyebrow">Security</p><h3>Execution boundaries</h3></div></div>
        <div className="security-list">
          <div><ShieldCheck size={18} /><span><strong>Context-isolated interface</strong><small>The renderer can access only the project operations exposed by OpenForge.</small></span><CheckCircle2 size={17} /></div>
          <div><Terminal size={18} /><span><strong>No command shell</strong><small>Executables receive validated argument arrays without shell interpolation.</small></span><CheckCircle2 size={17} /></div>
          <div><SlidersHorizontal size={18} /><span><strong>Sensitive variables filtered</strong><small>Common credentials and runtime injection variables are excluded from child processes.</small></span><CheckCircle2 size={17} /></div>
        </div>
      </section>

      <p className="settings-version">OpenForge AI {health?.appVersion ?? "—"}</p>
    </div>
  );
}

function ToolCard({
  icon: Icon,
  name,
  status,
  required = false,
  detail,
}: {
  icon: LucideIcon;
  name: string;
  status?: ToolStatus;
  required?: boolean;
  detail?: string;
}) {
  return (
    <article className={`tool-card ${status?.available ? "available" : "missing"}`}>
      <div className="tool-icon"><Icon size={19} /></div>
      <div className="tool-copy">
        <div><h4>{name}</h4>{required && <span>Required</span>}</div>
        <p>{status ? (status.available ? status.version || "Detected" : "Not detected") : "Checking…"}</p>
        <small>{status?.path ?? detail ?? "Restart OpenForge after installing."}</small>
      </div>
      {status?.available ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
    </article>
  );
}

function InstallDialog({
  open,
  events,
  onClose,
  onInstalled,
  onInstallFailed,
}: {
  open: boolean;
  events: Record<string, ProjectEvent[]>;
  onClose: () => void;
  onInstalled: (project: ProjectRecord) => void;
  onInstallFailed: () => void;
}) {
  const [preset, setPreset] = useState<PresetId>("dark-bert");
  const [repoUrl, setRepoUrl] = useState(DARK_BERT_URL);
  const [step, setStep] = useState<"source" | "review" | "install" | "done">("source");
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [installed, setInstalled] = useState<ProjectRecord | null>(null);
  const initialFocus = useRef<HTMLInputElement>(null);

  const eventProjectId = useMemo(() => {
    try {
      const url = new URL(repoUrl);
      const [owner, repository] = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
      if (!owner || !repository) return "";
      return `${owner}--${repository.replace(/\.git$/i, "")}`.toLowerCase();
    } catch {
      return "";
    }
  }, [repoUrl]);
  const installEvents = events[eventProjectId] ?? [];
  const latestInstallEvent = installEvents.at(-1);

  useEffect(() => {
    if (!open) return;
    setPreset("dark-bert");
    setRepoUrl(DARK_BERT_URL);
    setStep("source");
    setPlan(null);
    setTrusted(false);
    setBusy(false);
    setError("");
    setInstalled(null);
    const timeout = window.setTimeout(() => initialFocus.current?.focus(), 50);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const changePreset = (next: PresetId) => {
    setPreset(next);
    setRepoUrl(next === "dark-bert" ? DARK_BERT_URL : "");
    setError("");
  };

  const review = async () => {
    setBusy(true);
    setError("");
    try {
      const nextPlan = await window.openforge.previewInstall({ repoUrl, presetId: preset, trustConfirmed: false });
      setPlan(nextPlan);
      setStep("review");
    } catch (reviewError) {
      setError(errorMessage(reviewError));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    setBusy(true);
    setError("");
    setStep("install");
    try {
      const project = await window.openforge.installProject({ repoUrl, presetId: preset, trustConfirmed: trusted });
      setInstalled(project);
      setStep("done");
      onInstalled(project);
    } catch (installError) {
      setError(errorMessage(installError));
      setStep("review");
      onInstallFailed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">Add to workspace</p>
            <h2 id="install-title">Install from GitHub</h2>
          </div>
          <IconButton label="Close install dialog" onClick={onClose} disabled={busy}>
            <X size={18} />
          </IconButton>
        </header>

        <div className="stepper" aria-label="Installation progress">
          {[
            ["source", "Source"],
            ["review", "Review"],
            ["install", "Install"],
          ].map(([value, label], index) => {
            const positions = { source: 0, review: 1, install: 2, done: 3 } as const;
            const complete = positions[step] > index;
            const active = positions[step] === index || (step === "done" && index === 2);
            return (
              <div className={`${complete ? "complete" : ""} ${active ? "active" : ""}`} key={value}>
                <span>{complete ? <Check size={13} /> : index + 1}</span>
                <small>{label}</small>
              </div>
            );
          })}
        </div>

        <div className="dialog-body">
          {step === "source" && (
            <>
              <div className="preset-grid">
                <button className={preset === "dark-bert" ? "selected" : ""} onClick={() => changePreset("dark-bert")}>
                  <span className="preset-icon"><Zap size={19} /></span>
                  <span><strong>DarkBERT preset</strong><small>Reviewed compatibility setup</small></span>
                  {preset === "dark-bert" && <CheckCircle2 size={17} />}
                </button>
                <button className={preset === "auto" ? "selected" : ""} onClick={() => changePreset("auto")}>
                  <span className="preset-icon"><GitFork size={19} /></span>
                  <span><strong>Any repository</strong><small>Automatic Python or Node detection</small></span>
                  {preset === "auto" && <CheckCircle2 size={17} />}
                </button>
              </div>
              <label className="field-group repo-field">
                <span>GitHub repository URL</span>
                <small>Use the repository root URL. Public HTTPS repositories only.</small>
                <div className="input-shell"><GitFork size={16} /><input ref={initialFocus} value={repoUrl} readOnly={preset === "dark-bert"} onChange={(event) => setRepoUrl(event.target.value)} placeholder="https://github.com/owner/repository" /></div>
              </label>
              {preset === "dark-bert" && (
                <div className="inline-alert compact"><ShieldCheck size={17} /><p>Installs a pinned reviewed revision with maintained Python dependencies.</p></div>
              )}
            </>
          )}

          {step === "review" && plan && (
            <>
              <div className="review-source">
                <span className="preset-icon"><GitFork size={19} /></span>
                <div><strong>{repoUrl.replace("https://github.com/", "")}</strong><small>{plan.runtime === "unknown" ? "Runtime detected after cloning" : `${plan.runtime} project`}</small></div>
                <button onClick={() => setStep("source")}>Change</button>
              </div>
              <div className="command-plan">
                <div className="plan-heading"><span><Terminal size={15} /> Commands to run</span><small>{plan.commands.length} steps</small></div>
                <ol>{plan.commands.map((command) => <li key={command}><span /><code>{command}</code></li>)}</ol>
              </div>
              <ul className="plan-notes">{plan.notes.map((note) => <li key={note}><Info size={14} />{note}</li>)}</ul>
              <label className="trust-check">
                <input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />
                <span><strong>I trust this repository and reviewed the commands</strong><small>Open-source software can still execute unsafe code with your Windows account permissions.</small></span>
              </label>
            </>
          )}

          {step === "install" && (
            <div className="install-progress">
              <div className="progress-orbit"><Loader2 className="spin" size={27} /></div>
              <h3>Preparing your local environment</h3>
              <p>{latestInstallEvent?.message.trim() || "Cloning the repository and detecting its runtime…"}</p>
              <div className="progress-track"><span /></div>
              <small>Keep OpenForge open. Installation time depends on the project dependencies.</small>
              {installEvents.length > 0 && (
                <div className="mini-log">
                  {installEvents.slice(-4).map((event, index) => <p key={`${event.timestamp}-${index}`}><time>{formatTime(event.timestamp)}</time>{event.message.trim().slice(0, 150)}</p>)}
                </div>
              )}
            </div>
          )}

          {step === "done" && installed && (
            <div className="install-complete">
              <div className="complete-mark"><Check size={27} /></div>
              <p className="eyebrow">Installation complete</p>
              <h3>{installed.name} is ready</h3>
              <p>Its local environment and dependencies are configured in the managed projects folder.</p>
            </div>
          )}

          {error && <div className="dialog-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        </div>

        <footer className="dialog-footer">
          {step === "source" && (
            <><button className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => void review()} disabled={!repoUrl.trim() || busy}>{busy ? <Loader2 className="spin" size={16} /> : null}Review setup<ChevronRight size={15} /></button></>
          )}
          {step === "review" && (
            <><button className="button ghost" onClick={() => setStep("source")}>Back</button><button className="button primary" onClick={() => void install()} disabled={!trusted || busy}><Download size={16} />Install project</button></>
          )}
          {step === "install" && <p className="footer-progress"><Loader2 className="spin" size={14} /> Installation in progress</p>}
          {step === "done" && <button className="button primary" onClick={onClose}>Open project<ArrowUpRight size={15} /></button>}
        </footer>
      </section>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) cancelButtonRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [open, busy, onCancel]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop confirm-backdrop" role="presentation">
      <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <div className="confirm-icon"><Trash2 size={20} /></div>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div className="confirm-actions">
          <button ref={cancelButtonRef} className="button secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="button danger solid" onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : <Trash2 size={15} />}
            {busy ? "Removing" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
