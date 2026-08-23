import type { Socket } from "node:net";

export class SocketReader {
  private buffer = Buffer.alloc(0);
  private ended = false;
  private failure: Error | undefined;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly socket: Socket) {
    socket.on("data", chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake();
    });
    socket.on("end", () => {
      this.ended = true;
      this.wake();
    });
    socket.on("error", error => {
      this.failure = error;
      this.wake();
    });
  }

  async read(size: number, timeoutMs = 8_000): Promise<Buffer> {
    if (!Number.isInteger(size) || size < 0) throw new RangeError("size must be a positive integer");
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < size) {
      if (this.failure) throw this.failure;
      if (this.ended || this.socket.destroyed) throw new Error("Socket closed before the message completed");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Socket read timed out");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Socket read timed out")), remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    const result = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return result;
  }

  release(): Buffer {
    const remaining = this.buffer;
    this.buffer = Buffer.alloc(0);
    this.socket.removeAllListeners("data");
    return remaining;
  }

  private wake() {
    for (const waiter of this.waiters.splice(0)) waiter();
  }
}
