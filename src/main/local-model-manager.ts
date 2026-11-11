import { spawn, execFile, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { EventEmitter } from "node:events";
import { createReadStream, promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import type {
  LocalChatMessage,
  LocalChatRequest,
  LocalChatResponse,
  LocalModelEvent,
  LocalModelInstallPlan,
  LocalModelPhase,
  LocalModelStatus,
  ToolStatus,
} from "../shared/types";

const execFileAsync = promisify(execFile);

const MODEL_ID = "dolphin-x1-trinity-nano" as const;
const MODEL_NAME = "Dolphin X1 Trinity Nano";
const MODEL_REPOSITORY = "dphn/Dolphin-X1-Trinity-Nano-GGUF";
const MODEL_REVISION = "5a4c1107c2b626e722faf75bfe6066c08dd75035";
const MODEL_FILENAME = "dolphin-x1-nano-MXFP4_MOE.gguf";
const MODEL_REFERENCE = `${MODEL_REPOSITORY}@${MODEL_REVISION}/${MODEL_FILENAME}`;
const MODEL_URL = `https://huggingface.co/${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${MODEL_FILENAME}?download=true`;
const MODEL_SIZE_BYTES = 3_643_650_560;
const MODEL_SHA256 = "c40cbf1e9dbf9bd9cb54bcb0ab9b479ee4f878e1d897fc06309e2085aa80cef9";
const RUNNER_PACKAGE_ID = "ggml.llamacpp";
const RUNNER_VERSION = "b12182";
const LOOPBACK_HOST = "127.0.0.1";
const CONTEXT_SIZE = 8_192;
const INSTALL_TIMEOUT_MS = 30 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 60_000;
const START_TIMEOUT_MS = 2 * 60 * 60_000;
const CHAT_TIMEOUT_MS = 5 * 60_000;
const SERVER_KEY = "local-model:server";

const WINGET_INSTALL_ARGS = [
  "install",
  "--id",
  RUNNER_PACKAGE_ID,
  "--exact",
  "--version",
  RUNNER_VERSION,
  "--source",
  "winget",
  "--silent",
  "--accept-package-agreements",
  "--accept-source-agreements",
  "--disable-interactivity",
] as const;

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
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
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

interface ValidatedChatRequest {
  messages: LocalChatMessage[];
  temperature: number;
  maxTokens: number;
}

type ServerAttemptResult =
  | { kind: "healthy" }
  | { kind: "address-in-use" }
  | { kind: "exited"; detail: string }
  | { kind: "timeout" };

function safeEnvironment(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => ALLOWED_ENVIRONMENT_KEYS.has(key.toUpperCase())),
    ),
    HF_HUB_DISABLE_TELEMETRY: "1",
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

export function validateLocalChatRequest(value: unknown): ValidatedChatRequest {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ["messages", "temperature", "maxTokens"])) {
    throw new Error("The local chat request is invalid.");
  }
  if (!Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 48) {
    throw new Error("A chat must contain between 1 and 48 messages.");
  }

  let totalCharacters = 0;
  const messages = value.messages.map((candidate): LocalChatMessage => {
    if (!isPlainObject(candidate) || !hasOnlyKeys(candidate, ["role", "content"])) {
      throw new Error("One or more chat messages are invalid.");
    }
    if (!(["system", "user", "assistant"] as const).includes(candidate.role as LocalChatMessage["role"])) {
      throw new Error("One or more chat messages use an unsupported role.");
    }
    if (
      typeof candidate.content !== "string" ||
      candidate.content.length < 1 ||
      candidate.content.length > 12_000 ||
      candidate.content.includes("\0") ||
      candidate.content.trim().length === 0
    ) {
      throw new Error("One or more chat messages have invalid content.");
    }
    totalCharacters += candidate.content.length;
    return {
      role: candidate.role as LocalChatMessage["role"],
      content: candidate.content,
    };
  });
  if (totalCharacters > 48_000) {
    throw new Error("The chat history is too large. Clear older messages and try again.");
  }

  const temperature = value.temperature === undefined ? 0.7 : value.temperature;
  if (typeof temperature !== "number" || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    throw new Error("Temperature must be a number from 0 to 2.");
  }
  const maxTokens = value.maxTokens === undefined ? 1_024 : value.maxTokens;
  if (!Number.isInteger(maxTokens) || (maxTokens as number) < 1 || (maxTokens as number) > 4_096) {
    throw new Error("Maximum tokens must be a whole number from 1 to 4096.");
  }

  return { messages, temperature, maxTokens: maxTokens as number };
}

function trimmedOutput(chunk: Buffer): string {
  return chunk.toString("utf8").replace(/\r/g, "").slice(0, 64_000).trim();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class LocalModelManager extends EventEmitter {
  private readonly workingDirectory: string;
  private readonly modelPath: string;
  private phase: LocalModelPhase = "not-installed";
  private runner: ToolStatus = { available: false };
  private lastError: string | undefined;
  private serverProcess: ChildProcess | null = null;
  private installerProcess: ChildProcess | null = null;
  private serverPort: number | undefined;
  private serverApiKey: string | undefined;
  private lifecycleGeneration = 0;
  private chatInFlight = false;
  private shuttingDown = false;
  private readonly redactionSecrets = new Set<string>();
  private downloadAbortController: AbortController | null = null;
  private modelPreparationTask: Promise<void> | null = null;

  constructor(userDataDirectory: string) {
    super();
    this.workingDirectory = userDataDirectory;
    this.modelPath = path.join(userDataDirectory, "models", MODEL_FILENAME);
  }

  async getStatus(): Promise<LocalModelStatus> {
    const lifecycleBusy = ["starting", "downloading", "stopping"].includes(this.phase);
    if (!this.serverProcess && !this.installerProcess && !lifecycleBusy && !this.shuttingDown) {
      this.runner = await this.detectRunner();
      if (this.phase !== "error") this.phase = this.runner.available ? "ready" : "not-installed";
    }
    return this.statusSnapshot();
  }

  previewInstall(): LocalModelInstallPlan {
    return {
      commands: [
        `winget ${WINGET_INSTALL_ARGS.join(" ")}`,
        `HTTPS GET ${MODEL_URL} -> <OpenForge-data>\\models\\${MODEL_FILENAME}`,
        `Verify SHA-256 ${MODEL_SHA256}`,
        `llama-server -m <OpenForge-data>\\models\\${MODEL_FILENAME} --ctx-size ${CONTEXT_SIZE} --host ${LOOPBACK_HOST} --port <random-loopback-port> --api-key <session-secret> --no-agent --no-ui-mcp-proxy --no-webui --no-mmproj`,
      ],
      notes: [
        "The llama.cpp runner is pinned to the reviewed Windows package version shown above.",
        `The ${MODEL_FILENAME} GGUF is downloaded from pinned revision ${MODEL_REVISION.slice(0, 12)} on first start (3,643,650,560 bytes), then SHA-256 verified before chat is enabled.`,
        "The fine-tune card labels the model Apache-2.0, while its Arcee Trinity Nano base uses OpenMDW-1.1; both terms apply.",
        "Chat stays on this computer through a random loopback port protected by a per-session secret. OpenForge disables the server web UI, agent mode, MCP proxy, and multimodal projector.",
        "There is no provider-side moderation. Model output can be incorrect, harmful, or unlawful; you remain responsible for how you use it.",
      ],
      licenses: [
        {
          name: "llama.cpp runtime",
          license: "MIT",
          url: "https://github.com/ggml-org/llama.cpp/blob/b12182/LICENSE",
        },
        {
          name: "Dolphin X1 Trinity Nano GGUF fine-tune",
          license: "Apache-2.0 (model card)",
          url: "https://huggingface.co/dphn/Dolphin-X1-Trinity-Nano-GGUF",
        },
        {
          name: "Arcee Trinity Nano base model",
          license: "OpenMDW-1.1",
          url: "https://huggingface.co/arcee-ai/Trinity-Nano-Preview",
        },
      ],
    };
  }

  async install(trustConfirmed: unknown): Promise<LocalModelStatus> {
    if (trustConfirmed !== true) {
      throw new Error("Confirm that you trust the llama.cpp package and model sources before installing.");
    }
    if (process.platform !== "win32") {
      throw new Error("The one-click llama.cpp installer currently supports Windows only.");
    }
    if (
      this.installerProcess ||
      this.serverProcess ||
      this.modelPreparationTask ||
      ["starting", "downloading", "running", "stopping"].includes(this.phase)
    ) {
      throw new Error("The local model is already busy.");
    }

    this.runner = await this.detectRunner();
    if (this.runner.available) {
      this.setPhase("ready", "llama.cpp is already installed.", "success");
      return this.statusSnapshot();
    }

    const winget = await this.findWingetExecutable();
    if (!winget) throw new Error("Windows Package Manager (winget) is required for one-click install.");
    await fs.mkdir(this.workingDirectory, { recursive: true });
    this.setPhase("installing-runner", `Installing llama.cpp ${RUNNER_VERSION}…`, "info");
    this.emitLog(
      "info",
      `winget ${WINGET_INSTALL_ARGS.join(" ")}`,
      "installing-runner",
    );

    try {
      const exitCode = await this.runInstaller(winget, [...WINGET_INSTALL_ARGS]);
      if (exitCode !== 0) throw new Error(`llama.cpp installation exited with code ${exitCode}.`);
      this.runner = await this.detectRunner();
      if (!this.runner.available) {
        throw new Error("llama.cpp was installed, but llama-server.exe could not be located. Restart Windows and try again.");
      }
      this.setPhase("ready", "llama.cpp is installed. The model will download on first start.", "success");
      return this.statusSnapshot();
    } catch (error) {
      const message = this.safeError(error, "llama.cpp installation failed.");
      this.setError(message);
      throw new Error(message);
    }
  }

  async start(trustConfirmed: unknown): Promise<LocalModelStatus> {
    if (trustConfirmed !== true) {
      throw new Error("Review and confirm the pinned model source and licenses before starting local chat.");
    }
    if (this.installerProcess) throw new Error("Wait for the llama.cpp installation to finish.");
    if (this.serverProcess || ["starting", "downloading", "running"].includes(this.phase)) {
      return this.statusSnapshot();
    }

    this.runner = await this.detectRunner();
    if (!this.runner.available || !this.runner.path) {
      throw new Error("Install the llama.cpp runner before starting local chat.");
    }

    const generation = ++this.lifecycleGeneration;
    await fs.mkdir(path.dirname(this.modelPath), { recursive: true });
    this.lastError = undefined;
    this.setPhase("starting", "Starting the local model server…", "info");
    void this.launchServerWithRetry(this.runner.path, generation).catch((error) => {
      if (generation !== this.lifecycleGeneration || this.shuttingDown) return;
      this.setError(this.safeError(error, "The local model server could not start."));
    });
    return this.statusSnapshot();
  }

  async stop(): Promise<LocalModelStatus> {
    if (this.installerProcess) throw new Error("Wait for the llama.cpp installation to finish.");
    const child = this.serverProcess;
    const preparation = this.modelPreparationTask;
    ++this.lifecycleGeneration;
    const download = this.downloadAbortController;
    if (child || download) {
      this.setPhase("stopping", "Stopping the local model server…", "info");
      download?.abort();
    }
    if (child) {
      await this.stopProcessTree(child);
    }
    await preparation?.catch(() => undefined);
    this.serverProcess = null;
    this.serverApiKey = undefined;
    this.serverPort = undefined;
    this.runner = await this.detectRunner();
    this.setPhase(
      this.runner.available ? "ready" : "not-installed",
      this.runner.available ? "Local model server stopped." : "llama.cpp is not installed.",
      "success",
    );
    return this.statusSnapshot();
  }

  async sendChat(requestValue: unknown): Promise<LocalChatResponse> {
    const request = validateLocalChatRequest(requestValue);
    if (
      this.phase !== "running" ||
      !this.serverProcess ||
      !this.serverPort ||
      !Number.isSafeInteger(this.serverPort) ||
      this.serverPort < 1 ||
      this.serverPort > 65_535 ||
      !this.serverApiKey
    ) {
      throw new Error("Start the local model before sending a message.");
    }
    if (this.chatInFlight) throw new Error("Wait for the current local response to finish.");

    this.chatInFlight = true;
    const endpoint = `http://${LOOPBACK_HOST}:${this.serverPort}/v1/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
    timeout.unref();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.serverApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL_REFERENCE,
          messages: request.messages,
          temperature: request.temperature,
          max_tokens: request.maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
      const body = await this.readBoundedBody(response, 2 * 1024 * 1024);
      if (!response.ok) {
        throw new Error(`The local model returned HTTP ${response.status}.`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        throw new Error("The local model returned an invalid response.");
      }
      const content = this.extractAssistantContent(payload);
      return { message: { role: "assistant", content } };
    } catch (error) {
      if (controller.signal.aborted) throw new Error("The local response timed out.");
      throw new Error(this.safeError(error, "The local model request failed."));
    } finally {
      clearTimeout(timeout);
      this.chatInFlight = false;
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    ++this.lifecycleGeneration;
    this.downloadAbortController?.abort();
    const preparation = this.modelPreparationTask;
    const children = [this.serverProcess, this.installerProcess].filter(
      (child): child is ChildProcess => child !== null,
    );
    this.serverProcess = null;
    this.installerProcess = null;
    await Promise.all([
      ...children.map((child) => this.stopProcessTree(child)),
      preparation?.catch(() => undefined),
    ]);
    this.serverApiKey = undefined;
    this.serverPort = undefined;
  }

  private statusSnapshot(): LocalModelStatus {
    return {
      id: MODEL_ID,
      name: MODEL_NAME,
      description: "A compact local mixture-of-experts chat model with low refusal tuning.",
      phase: this.phase,
      runner: { ...this.runner },
      modelReference: MODEL_REFERENCE,
      modelLabel: "Dolphin X1 Trinity Nano GGUF",
      quantization: "MXFP4_MOE",
      downloadSize: "Approximately 3.64 GB",
      modelLicense: "Apache-2.0 (fine-tune model card)",
      baseLicense: "OpenMDW-1.1 (Arcee Trinity Nano base)",
      endpoint: this.serverPort ? `http://${LOOPBACK_HOST}:${this.serverPort}` : undefined,
      lastError: this.lastError,
    };
  }

  private setPhase(
    phase: LocalModelPhase,
    message: string,
    level: LocalModelEvent["level"],
  ): void {
    this.phase = phase;
    if (phase !== "error") this.lastError = undefined;
    this.emitModelEvent({ type: "status", level, message, phase });
  }

  private setError(message: string): void {
    this.lastError = message;
    this.phase = "error";
    this.emitModelEvent({ type: "status", level: "error", message, phase: "error" });
  }

  private emitLog(
    level: LocalModelEvent["level"],
    message: string,
    phase = this.phase,
  ): void {
    const sanitized = this.redactSecrets(message).trim();
    if (!sanitized) return;
    this.emitModelEvent({ type: "log", level, message: sanitized, phase });
  }

  private emitModelEvent(
    event: Omit<LocalModelEvent, "timestamp">,
  ): void {
    this.emit("local-model-event", {
      ...event,
      timestamp: new Date().toISOString(),
    } satisfies LocalModelEvent);
  }

  private async runInstaller(executable: string, args: string[]): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.installerProcess = null;
        callback();
      };
      const child = spawn(executable, args, {
        cwd: this.workingDirectory,
        shell: false,
        windowsHide: true,
        env: safeEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.installerProcess = child;
      const timeout = setTimeout(() => {
        void this.stopProcessTree(child);
        finish(() => reject(new Error("llama.cpp installation exceeded its 30 minute limit.")));
      }, INSTALL_TIMEOUT_MS);
      timeout.unref();

      child.stdout?.on("data", (chunk: Buffer) => this.emitLog("info", trimmedOutput(chunk)));
      child.stderr?.on("data", (chunk: Buffer) => this.emitLog("warning", trimmedOutput(chunk)));
      child.once("error", (error) => finish(() => reject(error)));
      child.once("close", (code, signal) => {
        if (signal) this.emitLog("warning", `Installer stopped (${signal}).`);
        finish(() => resolve(code ?? (signal ? 130 : 1)));
      });
    });
  }

  private async launchServerWithRetry(executable: string, generation: number): Promise<void> {
    const preparation = this.ensureVerifiedModel(generation);
    this.modelPreparationTask = preparation;
    try {
      await preparation;
    } finally {
      if (this.modelPreparationTask === preparation) this.modelPreparationTask = null;
    }
    if (generation !== this.lifecycleGeneration || this.shuttingDown) return;
    this.setPhase("starting", "Starting the verified local model…", "info");
    let finalResult: ServerAttemptResult | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (generation !== this.lifecycleGeneration || this.shuttingDown) return;
      const port = await this.reserveLoopbackPort();
      const apiKey = randomBytes(32).toString("base64url");
      this.redactionSecrets.add(apiKey);
      this.serverPort = port;
      this.serverApiKey = apiKey;
      if (attempt > 1) {
        this.setPhase("starting", `Retrying on a new loopback port (attempt ${attempt} of 3)…`, "warning");
      }
      finalResult = await this.runServerAttempt(executable, port, apiKey, generation);
      if (finalResult.kind === "healthy") return;
      this.serverPort = undefined;
      this.serverApiKey = undefined;
      if (finalResult.kind !== "address-in-use") break;
    }

    if (generation !== this.lifecycleGeneration || this.shuttingDown) return;
    if (finalResult?.kind === "timeout") {
      if (this.serverProcess) await this.stopProcessTree(this.serverProcess);
      this.serverProcess = null;
      throw new Error("The local model did not become ready within two hours.");
    }
    if (finalResult?.kind === "address-in-use") {
      throw new Error("The local model could not reserve a private loopback port after three attempts.");
    }
    throw new Error(finalResult?.kind === "exited" ? finalResult.detail : "The local model server exited.");
  }

  private async runServerAttempt(
    executable: string,
    port: number,
    apiKey: string,
    generation: number,
  ): Promise<ServerAttemptResult> {
    const args = [
      "-m",
      this.modelPath,
      "--ctx-size",
      String(CONTEXT_SIZE),
      "--host",
      LOOPBACK_HOST,
      "--port",
      String(port),
      "--api-key",
      apiKey,
      "--no-agent",
      "--no-ui-mcp-proxy",
      "--no-webui",
      "--no-mmproj",
    ];
    this.emitLog(
      "info",
      `llama-server -m <OpenForge-data>\\models\\${MODEL_FILENAME} --ctx-size ${CONTEXT_SIZE} --host ${LOOPBACK_HOST} --port ${port} --api-key <session-secret> --no-agent --no-ui-mcp-proxy --no-webui --no-mmproj`,
      "starting",
    );

    return await new Promise<ServerAttemptResult>((resolve) => {
      let settled = false;
      let markedHealthy = false;
      let addressInUse = false;
      let polling = false;
      const child = spawn(executable, args, {
        cwd: this.workingDirectory,
        shell: false,
        windowsHide: true,
        env: safeEnvironment(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.serverProcess = child;

      const finish = (result: ServerAttemptResult): void => {
        if (settled) return;
        settled = true;
        clearInterval(pollTimer);
        clearTimeout(startTimer);
        resolve(result);
      };
      const handleOutput = (level: "info" | "warning", chunk: Buffer): void => {
        const output = trimmedOutput(chunk);
        if (!output) return;
        if (/address.*(?:in use|already)|bind.*(?:failed|error)|WSAEADDRINUSE/i.test(output)) {
          addressInUse = true;
        }
        if (
          generation === this.lifecycleGeneration &&
          this.phase === "starting" &&
          /download|hugging[ -]?face|fetch|\.gguf|model.*load/i.test(output)
        ) {
          this.setPhase("downloading", "Downloading or verifying the local model…", "info");
        }
        this.emitLog(level, output);
      };

      child.stdout?.on("data", (chunk: Buffer) => handleOutput("info", chunk));
      child.stderr?.on("data", (chunk: Buffer) => handleOutput("warning", chunk));
      child.once("error", (error) => finish({ kind: "exited", detail: this.safeError(error, "llama-server failed to launch.") }));
      child.once("close", (code, signal) => {
        this.redactionSecrets.delete(apiKey);
        if (this.serverProcess === child) this.serverProcess = null;
        if (markedHealthy) {
          if (generation === this.lifecycleGeneration && !this.shuttingDown) {
            this.serverApiKey = undefined;
            this.serverPort = undefined;
            this.setError(
              signal
                ? `The local model server stopped unexpectedly (${signal}).`
                : `The local model server exited with code ${code ?? 1}.`,
            );
          }
          return;
        }
        finish(
          addressInUse
            ? { kind: "address-in-use" }
            : {
                kind: "exited",
                detail: signal
                  ? `The local model server stopped before it was ready (${signal}).`
                  : `The local model server exited with code ${code ?? 1} before it was ready.`,
              },
        );
      });

      const pollTimer = setInterval(() => {
        if (polling || settled || generation !== this.lifecycleGeneration) return;
        polling = true;
        void this.serverHealthy(port, apiKey)
          .then((healthy) => {
            if (!healthy || settled || generation !== this.lifecycleGeneration) return;
            markedHealthy = true;
            this.setPhase("running", "Local model is ready for private chat.", "success");
            finish({ kind: "healthy" });
          })
          .finally(() => {
            polling = false;
          });
      }, 1_500);
      pollTimer.unref();
      const startTimer = setTimeout(() => finish({ kind: "timeout" }), START_TIMEOUT_MS);
      startTimer.unref();
    });
  }

  private async serverHealthy(port: number, apiKey: string): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    timeout.unref();
    try {
      const response = await fetch(`http://${LOOPBACK_HOST}:${port}/health`, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async verifyModelFile(generation: number): Promise<void> {
    const stats = await fs.stat(this.modelPath);
    if (!stats.isFile() || stats.size !== MODEL_SIZE_BYTES) {
      throw new Error(
        `The pinned model file has an unexpected size (expected ${MODEL_SIZE_BYTES} bytes).`,
      );
    }
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(this.modelPath)) {
      if (generation !== this.lifecycleGeneration || this.shuttingDown) {
        throw new Error("Model verification was stopped.");
      }
      digest.update(chunk as Buffer);
    }
    if (digest.digest("hex") !== MODEL_SHA256) {
      throw new Error("The pinned model file did not match its published SHA-256 digest.");
    }
  }

  private async ensureVerifiedModel(generation: number): Promise<void> {
    this.setPhase("downloading", "Checking the pinned model file…", "info");
    try {
      await this.verifyModelFile(generation);
      this.emitLog("success", `Verified ${MODEL_FILENAME} (${MODEL_SHA256.slice(0, 12)}…).`);
      return;
    } catch {
      this.emitLog("info", "The pinned model is not present or did not verify; downloading a clean copy.");
    }

    if (generation !== this.lifecycleGeneration || this.shuttingDown) return;
    const temporaryPath = `${this.modelPath}.download`;
    await fs.mkdir(path.dirname(this.modelPath), { recursive: true });
    await fs.rm(temporaryPath, { force: true });
    const controller = new AbortController();
    this.downloadAbortController = controller;
    let timedOut = false;
    const downloadTimeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DOWNLOAD_TIMEOUT_MS);
    downloadTimeout.unref();

    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const response = await fetch(MODEL_URL, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "OpenForge-AI/1" },
      });
      if (!response.ok || !response.body) {
        throw new Error(`The pinned model download returned HTTP ${response.status}.`);
      }
      const contentLength = response.headers.get("content-length");
      if (contentLength !== null) {
        const declaredLength = Number(contentLength);
        if (!Number.isFinite(declaredLength) || declaredLength !== MODEL_SIZE_BYTES) {
          throw new Error("The pinned model download reported an unexpected size.");
        }
      }

      handle = await fs.open(temporaryPath, "wx");
      const digest = createHash("sha256");
      const reader = response.body.getReader();
      let downloaded = 0;
      let lastReportedPercent = -10;
      while (true) {
        if (generation !== this.lifecycleGeneration || this.shuttingDown) {
          controller.abort();
          throw new Error("The model download was stopped.");
        }
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.byteLength;
        if (downloaded > MODEL_SIZE_BYTES) {
          controller.abort();
          throw new Error("The pinned model download exceeded its expected size.");
        }
        digest.update(value);
        let offset = 0;
        while (offset < value.byteLength) {
          const { bytesWritten } = await handle.write(
            value,
            offset,
            value.byteLength - offset,
            null,
          );
          if (bytesWritten < 1) throw new Error("The model download could not be written to disk.");
          offset += bytesWritten;
        }
        const percent = Math.floor((downloaded / MODEL_SIZE_BYTES) * 100);
        if (percent >= lastReportedPercent + 10) {
          lastReportedPercent = percent;
          this.emitLog("info", `Model download ${Math.min(percent, 100)}% (${downloaded.toLocaleString()} bytes).`);
        }
      }
      await handle.sync();
      await handle.close();
      handle = undefined;

      if (downloaded !== MODEL_SIZE_BYTES) {
        throw new Error(`The pinned model download was incomplete (${downloaded} bytes received).`);
      }
      if (digest.digest("hex") !== MODEL_SHA256) {
        throw new Error("The downloaded model did not match its published SHA-256 digest.");
      }
      if (generation !== this.lifecycleGeneration || this.shuttingDown) {
        throw new Error("The model download was stopped.");
      }

      await fs.rm(this.modelPath, { force: true });
      await fs.rename(temporaryPath, this.modelPath);
      this.emitLog("success", `Downloaded and verified ${MODEL_FILENAME}.`);
    } catch (error) {
      controller.abort();
      await handle?.close().catch(() => undefined);
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      if (timedOut) throw new Error("The pinned model download exceeded its two hour limit.");
      throw error;
    } finally {
      clearTimeout(downloadTimeout);
      if (this.downloadAbortController === controller) this.downloadAbortController = null;
    }
  }

  private async reserveLoopbackPort(): Promise<number> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await new Promise<number>((resolve, reject) => {
          const server = net.createServer();
          server.unref();
          server.once("error", reject);
          server.listen(0, LOOPBACK_HOST, () => {
            const address = server.address();
            if (!address || typeof address === "string") {
              server.close(() => reject(new Error("Could not reserve a loopback port.")));
              return;
            }
            const port = address.port;
            server.close((error) => (error ? reject(error) : resolve(port)));
          });
        });
      } catch {
        await delay(50 * (attempt + 1));
      }
    }
    throw new Error("Could not reserve a private loopback port.");
  }

  private async detectRunner(): Promise<ToolStatus> {
    const candidates = await this.findRunnerExecutables();
    for (const executable of candidates) {
      try {
        const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
          timeout: 5_000,
          windowsHide: true,
          encoding: "utf8",
          env: safeEnvironment(),
        });
        const version = `${stdout}${stderr}`.trim().slice(0, 500);
        if (!/\b(?:b)?12182\b/i.test(version)) continue;
        return { available: true, path: executable, version };
      } catch {
        // Fail closed and try another WinGet-managed candidate.
      }
    }
    return { available: false };
  }

  private async findWingetExecutable(): Promise<string | null> {
    if (process.platform !== "win32") return null;
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData || !path.isAbsolute(localAppData)) return null;
    const candidate = path.resolve(localAppData, "Microsoft", "WindowsApps", "winget.exe");
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ["--version"], {
        timeout: 5_000,
        windowsHide: true,
        encoding: "utf8",
        env: safeEnvironment(),
      });
      return /^v?\d+(?:\.\d+)+/i.test(`${stdout}${stderr}`.trim()) ? candidate : null;
    } catch {
      return null;
    }
  }

  private async findRunnerExecutables(): Promise<string[]> {
    if (process.platform !== "win32") {
      const located = await this.findExecutable("llama-server");
      return located ? [located] : [];
    }

    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData || !path.isAbsolute(localAppData)) return [];

    const packagesRoot = path.join(localAppData, "Microsoft", "WinGet", "Packages");
    const candidates: string[] = [];
    try {
      const packages = await fs.readdir(packagesRoot, { withFileTypes: true });
      const llamaPackages = packages
        .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith(`${RUNNER_PACKAGE_ID}_`))
        .slice(0, 10);
      for (const packageEntry of llamaPackages) {
        const found = await this.findNamedFile(
          path.join(packagesRoot, packageEntry.name),
          "llama-server.exe",
          4,
        );
        if (found) candidates.push(found);
      }
    } catch {
      // A missing or unreadable WinGet package directory simply means the runner was not found.
    }

    const linked = path.join(localAppData, "Microsoft", "WinGet", "Links", "llama-server.exe");
    if (await this.isFile(linked)) {
      try {
        const target = await fs.realpath(linked);
        const relative = path.relative(path.resolve(packagesRoot), path.resolve(target));
        if (!relative.startsWith("..") && !path.isAbsolute(relative)) candidates.push(target);
      } catch {
        // Ignore an invalid or dangling WinGet link.
      }
    }
    return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
  }

  private async findNamedFile(directory: string, name: string, depth: number): Promise<string | null> {
    if (depth < 0) return null;
    let entries;
    try {
      entries = (await fs.readdir(directory, { withFileTypes: true })).slice(0, 500);
    } catch {
      return null;
    }
    const direct = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === name.toLowerCase());
    if (direct) return path.join(directory, direct.name);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const found = await this.findNamedFile(path.join(directory, entry.name), name, depth - 1);
      if (found) return found;
    }
    return null;
  }

  private async findExecutable(name: string): Promise<string | null> {
    const locator = process.platform === "win32" ? "where.exe" : "which";
    try {
      const { stdout } = await execFileAsync(locator, [name], {
        timeout: 5_000,
        windowsHide: true,
        encoding: "utf8",
      });
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => path.isAbsolute(line)) ?? null;
    } catch {
      return null;
    }
  }

  private async isFile(filePath: string): Promise<boolean> {
    try {
      return (await fs.stat(filePath)).isFile();
    } catch {
      return false;
    }
  }

  private async stopProcessTree(child: ChildProcess): Promise<void> {
    const pid = child.pid;
    if (!pid || !Number.isSafeInteger(pid) || pid <= 0) {
      child.kill("SIGTERM");
      return;
    }
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
          shell: false,
          windowsHide: true,
          stdio: "ignore",
        });
        const timeout = setTimeout(() => {
          killer.kill();
          child.kill("SIGTERM");
          resolve();
        }, 10_000);
        timeout.unref();
        const done = (): void => {
          clearTimeout(timeout);
          resolve();
        };
        killer.once("close", done);
        killer.once("error", () => {
          child.kill("SIGTERM");
          done();
        });
      });
      return;
    }
    child.kill("SIGTERM");
    const force = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 3_000);
    force.unref();
  }

  private async readBoundedBody(response: Response, maximumBytes: number): Promise<string> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      throw new Error("The local model response was unexpectedly large.");
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("The local model response was unexpectedly large.");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  }

  private extractAssistantContent(payload: unknown): string {
    if (!isPlainObject(payload) || !Array.isArray(payload.choices) || payload.choices.length < 1) {
      throw new Error("The local model response did not contain an assistant message.");
    }
    const choice = payload.choices[0];
    if (!isPlainObject(choice) || !isPlainObject(choice.message) || typeof choice.message.content !== "string") {
      throw new Error("The local model response did not contain valid text.");
    }
    const content = choice.message.content;
    if (content.length < 1 || content.length > 262_144 || content.includes("\0")) {
      throw new Error("The local model returned invalid text.");
    }
    return content;
  }

  private redactSecrets(value: string): string {
    let sanitized = value;
    for (const secret of this.redactionSecrets) {
      sanitized = sanitized.split(secret).join("[redacted]");
    }
    return sanitized
      .replace(/(--api-key(?:=|\s+))[^\s]+/gi, "$1[redacted]")
      .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, "$1[redacted]");
  }

  private safeError(error: unknown, fallback: string): string {
    const value = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
    const sanitized = this.redactSecrets(value).trim();
    return sanitized ? sanitized.slice(0, 2_000) : fallback;
  }
}
