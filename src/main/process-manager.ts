import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { ProjectEvent } from "../shared/types";

interface RunOptions {
  key: string;
  projectId: string;
  executable: string;
  args: string[];
  cwd: string;
  phase?: string;
  timeoutMs?: number;
}

const ALLOWED_ENVIRONMENT_KEYS = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMSPEC",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "NVIDIA_DRIVER_CAPABILITIES",
  "NVIDIA_VISIBLE_DEVICES",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PUBLIC",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
]);

function safeEnvironment(): NodeJS.ProcessEnv {
  const safe = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      const upper = key.toUpperCase();
      return (
        ALLOWED_ENVIRONMENT_KEYS.has(upper) ||
        upper === "CUDA_PATH" ||
        upper.startsWith("CUDA_PATH_V")
      );
    }),
  );
  return {
    ...safe,
    GIT_TERMINAL_PROMPT: "0",
    HF_HUB_DISABLE_TELEMETRY: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PYTHONNOUSERSITE: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
}

function displayArgument(value: string): string {
  if (/^[A-Za-z0-9_./:\\=@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function displayCommand(executable: string, args: string[]): string {
  const sensitiveFlags = /^(--?(?:api[-_]?key|token|password|secret|credential)|[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))$/i;
  const visible: string[] = [];
  let redactNext = false;
  for (const argument of args) {
    if (redactNext) {
      visible.push("[redacted]");
      redactNext = false;
      continue;
    }
    const equalIndex = argument.indexOf("=");
    if (equalIndex > 0 && sensitiveFlags.test(argument.slice(0, equalIndex))) {
      visible.push(`${argument.slice(0, equalIndex)}=[redacted]`);
      continue;
    }
    visible.push(displayArgument(argument));
    redactNext = sensitiveFlags.test(argument);
  }
  return [displayArgument(executable), ...visible].join(" ");
}

function trimChunk(chunk: Buffer): string {
  return chunk.toString("utf8").replace(/\r/g, "").slice(0, 64_000);
}

export class ProcessManager extends EventEmitter {
  private readonly active = new Map<string, ChildProcess>();

  async run(options: RunOptions): Promise<number> {
    if (this.active.has(options.key)) {
      throw new Error("A process is already active for this project.");
    }

    const command = displayCommand(options.executable, options.args);
    this.emitProject(options.projectId, "info", `${options.phase ? `${options.phase}: ` : ""}${command}`);

    return await new Promise<number>((resolve, reject) => {
      const child = spawn(options.executable, options.args, {
        cwd: options.cwd,
        shell: false,
        windowsHide: true,
        env: safeEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.active.set(options.key, child);
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            this.emitProject(
              options.projectId,
              "error",
              `${options.phase || "Operation"} exceeded its ${Math.round(options.timeoutMs! / 60_000)} minute limit and was stopped.`,
            );
            void this.stop(options.key);
          }, options.timeoutMs)
        : undefined;
      timeout?.unref();

      child.stdout?.on("data", (chunk: Buffer) => {
        const message = trimChunk(chunk);
        if (message) this.emitProject(options.projectId, "info", message);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const message = trimChunk(chunk);
        if (message) this.emitProject(options.projectId, "warning", message);
      });

      child.once("error", (error) => {
        if (timeout) clearTimeout(timeout);
        this.active.delete(options.key);
        this.emitProject(options.projectId, "error", error.message);
        reject(error);
      });
      child.once("close", (code, signal) => {
        if (timeout) clearTimeout(timeout);
        this.active.delete(options.key);
        if (signal) this.emitProject(options.projectId, "warning", `Process stopped (${signal}).`);
        resolve(code ?? (signal ? 130 : 1));
      });
    });
  }

  has(key: string): boolean {
    return this.active.has(key);
  }

  async stop(key: string): Promise<boolean> {
    const child = this.active.get(key);
    if (!child) return false;

    const pid = child.pid;
    if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
      child.kill("SIGTERM");
      return true;
    }

    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("close", () => resolve());
        killer.once("error", () => {
          child.kill("SIGTERM");
          resolve();
        });
      });
    } else {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 3_000).unref();
    }
    return true;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((key) => this.stop(key)));
  }

  private emitProject(
    projectId: string,
    level: ProjectEvent["level"],
    message: string,
  ): void {
    this.emit("project-event", {
      projectId,
      type: "log",
      level,
      message,
      timestamp: new Date().toISOString(),
    } satisfies ProjectEvent);
  }
}
