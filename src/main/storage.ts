import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectRecord } from "../shared/types";

interface StorageShape {
  version: 1;
  projects: ProjectRecord[];
}

export class ProjectStorage {
  private readonly filePath: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "projects.json");
  }

  async list(): Promise<ProjectRecord[]> {
    const data = await this.read();
    return data.projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<ProjectRecord | undefined> {
    const projects = await this.list();
    return projects.find((project) => project.id === id);
  }

  async upsert(project: ProjectRecord): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await this.read();
      const index = data.projects.findIndex((item) => item.id === project.id);
      if (index >= 0) data.projects[index] = project;
      else data.projects.push(project);
      await this.write(data);
    });
  }

  async remove(id: string): Promise<void> {
    await this.enqueueWrite(async () => {
      const data = await this.read();
      data.projects = data.projects.filter((project) => project.id !== id);
      await this.write(data);
    });
  }

  private async read(): Promise<StorageShape> {
    try {
      const contents = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(contents) as Partial<StorageShape>;
      if (parsed.version !== 1 || !Array.isArray(parsed.projects)) {
        throw new Error("Unsupported project database format.");
      }
      return parsed as StorageShape;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return { version: 1, projects: [] };
      throw error;
    }
  }

  private async write(data: StorageShape): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(temporary, this.filePath);
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    this.writeChain = this.writeChain.then(operation, operation);
    await this.writeChain;
  }
}
