export type RuntimeKind = "python" | "node" | "unknown";

export type ProjectStatus =
  | "installing"
  | "ready"
  | "running"
  | "stopping"
  | "failed"
  | "needs-setup";

export type PresetId = "dark-bert" | "auto";

export interface ProjectRecord {
  id: string;
  name: string;
  owner: string;
  repo: string;
  repoUrl: string;
  directory: string;
  branch: string;
  runtime: RuntimeKind;
  status: ProjectStatus;
  presetId: PresetId;
  entryPoint: string;
  nodeScript?: string;
  installedAt: string;
  updatedAt: string;
  lastError?: string;
  lastExitCode?: number;
}

export interface InstallRequest {
  repoUrl: string;
  presetId: PresetId;
  trustConfirmed: boolean;
}

export interface RunRequest {
  projectId: string;
  entryPoint?: string;
  nodeScript?: string;
  args: string[];
}

export interface ProjectEvent {
  projectId: string;
  type: "log" | "status" | "progress";
  level: "info" | "warning" | "error" | "success";
  message: string;
  timestamp: string;
  status?: ProjectStatus;
}

export interface ToolStatus {
  available: boolean;
  version?: string;
  path?: string;
}

export interface SystemHealth {
  git: ToolStatus;
  python: ToolStatus;
  node: ToolStatus;
  projectsDirectory: string;
  appVersion: string;
}

export interface InstallPlan {
  runtime: RuntimeKind;
  commands: string[];
  notes: string[];
}

export type LocalModelPhase =
  | "not-installed"
  | "installing-runner"
  | "ready"
  | "starting"
  | "downloading"
  | "running"
  | "stopping"
  | "error";

export interface LocalModelStatus {
  id: "dolphin-x1-trinity-nano";
  name: string;
  description: string;
  phase: LocalModelPhase;
  runner: ToolStatus;
  modelReference: string;
  modelLabel: string;
  quantization: string;
  downloadSize: string;
  modelLicense: string;
  baseLicense: string;
  endpoint?: string;
  lastError?: string;
}

export interface LocalModelLicense {
  name: string;
  license: string;
  url: string;
}

export interface LocalModelInstallPlan {
  commands: string[];
  notes: string[];
  licenses: LocalModelLicense[];
}

export interface LocalModelEvent {
  type: "status" | "log";
  level: "info" | "warning" | "error" | "success";
  message: string;
  timestamp: string;
  phase?: LocalModelPhase;
}

export interface LocalChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LocalChatRequest {
  messages: LocalChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface LocalChatResponse {
  message: LocalChatMessage;
}

export interface OpenForgeAPI {
  listProjects(): Promise<ProjectRecord[]>;
  getSystemHealth(): Promise<SystemHealth>;
  previewInstall(request: InstallRequest): Promise<InstallPlan>;
  installProject(request: InstallRequest): Promise<ProjectRecord>;
  runProject(request: RunRequest): Promise<void>;
  stopProject(projectId: string): Promise<void>;
  updateProject(projectId: string): Promise<ProjectRecord>;
  removeProject(projectId: string): Promise<void>;
  pickDirectory(title?: string): Promise<string | null>;
  revealProject(projectId: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onProjectEvent(callback: (event: ProjectEvent) => void): () => void;
  getLocalModelStatus(): Promise<LocalModelStatus>;
  previewLocalModelInstall(): Promise<LocalModelInstallPlan>;
  installLocalModel(trustConfirmed: boolean): Promise<LocalModelStatus>;
  startLocalModel(trustConfirmed: boolean): Promise<LocalModelStatus>;
  stopLocalModel(): Promise<LocalModelStatus>;
  sendLocalChat(request: LocalChatRequest): Promise<LocalChatResponse>;
  onLocalModelEvent(callback: (event: LocalModelEvent) => void): () => void;
}

declare global {
  interface Window {
    openforge: OpenForgeAPI;
  }
}
