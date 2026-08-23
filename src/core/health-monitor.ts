export interface HealthMonitorOptions {
  intervalMs: number;
  failureThreshold: number;
}

export class HealthMonitor {
  private timer: NodeJS.Timeout | undefined;
  private failures = 0;
  private checking = false;

  constructor(
    private readonly check: () => Promise<void>,
    private readonly onFailure: (failures: number, error: unknown) => void,
    private readonly onUnhealthy: () => Promise<void>,
    private readonly options: HealthMonitorOptions
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.checkNow(); }, this.options.intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.failures = 0;
  }

  async checkNow() {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.check();
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      this.onFailure(this.failures, error);
      if (this.failures >= this.options.failureThreshold) {
        this.failures = 0;
        await this.onUnhealthy();
      }
    } finally {
      this.checking = false;
    }
  }
}
