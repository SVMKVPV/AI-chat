import { contextBridge, ipcRenderer } from "electron";
import type {
  InstallRequest,
  LocalChatRequest,
  LocalModelEvent,
  OpenForgeAPI,
  ProjectEvent,
  RunRequest,
} from "../shared/types";

const api: OpenForgeAPI = {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  getSystemHealth: () => ipcRenderer.invoke("system:health"),
  previewInstall: (request: InstallRequest) => ipcRenderer.invoke("projects:preview-install", request),
  installProject: (request: InstallRequest) => ipcRenderer.invoke("projects:install", request),
  runProject: (request: RunRequest) => ipcRenderer.invoke("projects:run", request),
  stopProject: (projectId: string) => ipcRenderer.invoke("projects:stop", projectId),
  updateProject: (projectId: string) => ipcRenderer.invoke("projects:update", projectId),
  removeProject: (projectId: string) => ipcRenderer.invoke("projects:remove", projectId),
  pickDirectory: (title?: string) => ipcRenderer.invoke("dialog:directory", title),
  revealProject: (projectId: string) => ipcRenderer.invoke("projects:reveal", projectId),
  openExternal: (url: string) => ipcRenderer.invoke("external:open", url),
  onProjectEvent: (callback: (event: ProjectEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: ProjectEvent) => callback(payload);
    ipcRenderer.on("projects:event", listener);
    return () => ipcRenderer.removeListener("projects:event", listener);
  },
  getLocalModelStatus: () => ipcRenderer.invoke("local-model:status"),
  previewLocalModelInstall: () => ipcRenderer.invoke("local-model:preview-install"),
  installLocalModel: (trustConfirmed: boolean) =>
    ipcRenderer.invoke("local-model:install", trustConfirmed),
  startLocalModel: (trustConfirmed: boolean) =>
    ipcRenderer.invoke("local-model:start", trustConfirmed),
  stopLocalModel: () => ipcRenderer.invoke("local-model:stop"),
  sendLocalChat: (request: LocalChatRequest) => ipcRenderer.invoke("local-model:chat", request),
  onLocalModelEvent: (callback: (event: LocalModelEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: LocalModelEvent) => callback(payload);
    ipcRenderer.on("local-model:event", listener);
    return () => ipcRenderer.removeListener("local-model:event", listener);
  },
};

contextBridge.exposeInMainWorld("openforge", api);
