import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import type {
  InstallRequest,
  LocalChatRequest,
  LocalModelEvent,
  ProjectEvent,
  RunRequest,
} from "../shared/types";
import { LocalModelManager } from "./local-model-manager";
import { ProcessManager } from "./process-manager";
import { ProjectManager } from "./project-manager";
import { isSafeExternalUrl } from "./validators";

let mainWindow: BrowserWindow | null = null;
const processes = new ProcessManager();
let projects: ProjectManager;
let localModels: LocalModelManager;
let shutdownStarted = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

if (
  process.platform === "win32" &&
  process.env.LOCALAPPDATA &&
  path.isAbsolute(process.env.LOCALAPPDATA)
) {
  app.setPath("userData", path.join(process.env.LOCALAPPDATA, "OpenForge AI"));
}

function packagedRendererUrl(): string {
  return pathToFileURL(path.join(__dirname, "../../dist/index.html")).href;
}

function devServerUrl(): string | null {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return null;
  try {
    const candidate = new URL(process.env.VITE_DEV_SERVER_URL);
    if (
      candidate.protocol !== "http:" ||
      candidate.hostname !== "127.0.0.1" ||
      candidate.port !== "5173"
    ) {
      return null;
    }
    return candidate.origin;
  } catch {
    return null;
  }
}

function rendererAllowed(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL();
  try {
    const candidate = new URL(url);
    const developmentUrl = devServerUrl();
    if (developmentUrl) {
      return candidate.origin === developmentUrl;
    }
    return candidate.href.split(/[?#]/, 1)[0] === packagedRendererUrl();
  } catch {
    return false;
  }
}

function secureHandle<T extends unknown[], R>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: T) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (event, ...args: T) => {
    if (!rendererAllowed(event)) throw new Error("Blocked request from an untrusted renderer.");
    return handler(event, ...args);
  });
}

function registerIpc(): void {
  secureHandle("projects:list", () => projects.listProjects());
  secureHandle("system:health", () => projects.getSystemHealth());
  secureHandle("projects:preview-install", (_event, request: InstallRequest) =>
    projects.previewInstall(request),
  );
  secureHandle("projects:install", (_event, request: InstallRequest) =>
    projects.installProject(request),
  );
  secureHandle("projects:run", (_event, request: RunRequest) => projects.runProject(request));
  secureHandle("projects:stop", (_event, projectId: string) => projects.stopProject(projectId));
  secureHandle("projects:update", (_event, projectId: string) => projects.updateProject(projectId));
  secureHandle("projects:remove", (_event, projectId: string) => projects.removeProject(projectId));
  secureHandle("dialog:directory", async (_event, title?: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: typeof title === "string" ? title.slice(0, 100) : "Choose folder",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  secureHandle("projects:reveal", async (_event, projectId: string) => {
    const directory = await projects.getProjectDirectory(projectId);
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  secureHandle("external:open", async (_event, url: string) => {
    if (!isSafeExternalUrl(url)) throw new Error("This external URL is not allowed.");
    await shell.openExternal(url);
  });
  secureHandle("local-model:status", () => localModels.getStatus());
  secureHandle("local-model:preview-install", () => localModels.previewInstall());
  secureHandle("local-model:install", (_event, trustConfirmed: boolean) =>
    localModels.install(trustConfirmed),
  );
  secureHandle("local-model:start", (_event, trustConfirmed: boolean) =>
    localModels.start(trustConfirmed),
  );
  secureHandle("local-model:stop", () => localModels.stop());
  secureHandle("local-model:chat", (_event, request: LocalChatRequest) =>
    localModels.sendChat(request),
  );
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#111315",
    title: "OpenForge AI",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = (() => {
      try {
        const candidate = new URL(url);
        const developmentUrl = devServerUrl();
        return developmentUrl
          ? candidate.origin === developmentUrl
          : candidate.href.split(/[?#]/, 1)[0] === packagedRendererUrl();
      } catch {
        return false;
      }
    })();
    if (!allowed) event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const developmentUrl = devServerUrl();
  if (developmentUrl) {
    await mainWindow.loadURL(developmentUrl);
  } else {
    await mainWindow.loadURL(packagedRendererUrl());
  }
}

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  Menu.setApplicationMenu(null);
  projects = new ProjectManager(app.getPath("userData"), app.getVersion(), processes);
  localModels = new LocalModelManager(app.getPath("userData"));
  processes.on("project-event", (event: ProjectEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("projects:event", event);
  });
  localModels.on("local-model-event", (event: LocalModelEvent) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("local-model:event", event);
    }
  });
  registerIpc();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (shutdownStarted) return;
  event.preventDefault();
  shutdownStarted = true;
  void Promise.all([
    Promise.resolve(projects?.shutdown()),
    Promise.resolve(localModels?.shutdown()),
  ]).finally(() => app.quit());
});
