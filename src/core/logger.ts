import { appendFile, mkdir, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { redactSensitiveText } from "./sensitive-data.js";

const MAX_LOG_BYTES = 256 * 1024;
const MAX_TAIL_LINES = 120;

function timestamp(date = new Date()): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false
  }).format(date);
}

export class AppLogger {
  readonly file: string;
  private writeQueue = Promise.resolve();

  constructor(directory: string) {
    this.file = path.join(directory, "goliveback.log");
  }

  info(message: string) {
    this.enqueue("INFO", message);
  }

  error(message: string) {
    this.enqueue("ERROR", message);
  }

  async tail(): Promise<string> {
    await this.writeQueue;
    try {
      const contents = await readFile(this.file, "utf8");
      return contents.split(/\r?\n/).filter(Boolean).slice(-MAX_TAIL_LINES).join("\n");
    } catch {
      return "";
    }
  }

  private enqueue(level: string, message: string) {
    const readableLevel = level === "ERROR" ? "ERRO" : "INFO";
    const line = `[${timestamp()}] ${readableLevel} | ${redactSensitiveText(message).slice(0, 2_000)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      try {
        if ((await stat(this.file)).size > MAX_LOG_BYTES) {
          await rename(this.file, `${this.file}.old`).catch(() => undefined);
        }
      } catch {
        // The file does not exist yet.
      }
      await appendFile(this.file, line, "utf8");
    }).catch(() => undefined);
  }
}
