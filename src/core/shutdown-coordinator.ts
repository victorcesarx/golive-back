export type ShutdownReason = "tray" | "application" | "windows-session";
export type ShutdownPhase = "running" | "stopping" | "stopped";

export class ShutdownCoordinator {
  readonly controller = new AbortController();
  private phaseValue: ShutdownPhase = "running";
  private reasonValue: ShutdownReason | undefined;
  private shutdownPromise: Promise<void> | undefined;
  private forceCleanupInvoked = false;

  constructor(
    private readonly cleanup: (reason: ShutdownReason) => Promise<void>,
    private readonly forceCleanup?: (reason: ShutdownReason) => void
  ) {}

  get signal() {
    return this.controller.signal;
  }

  get phase() {
    return this.phaseValue;
  }

  get reason() {
    return this.reasonValue;
  }

  get isStopping() {
    return this.phaseValue !== "running";
  }

  assertRunning() {
    if (this.isStopping) throw new Error("O GoLiveBack está sendo encerrado e não pode iniciar uma nova operação.");
  }

  request(reason: ShutdownReason): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.begin(reason);
    this.shutdownPromise = this.cleanup(reason).finally(() => {
      this.phaseValue = "stopped";
    });
    return this.shutdownPromise;
  }

  force(reason: ShutdownReason) {
    this.begin(reason);
    if (this.forceCleanupInvoked) return;
    this.forceCleanupInvoked = true;
    this.forceCleanup?.(reason);
  }

  private begin(reason: ShutdownReason) {
    if (this.phaseValue !== "running") return;
    this.phaseValue = "stopping";
    this.reasonValue = reason;
    this.controller.abort(reason);
  }
}
