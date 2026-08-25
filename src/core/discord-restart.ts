export class DiscordRestartGate {
  private active = false;
  private nextAllowedAt = 0;

  constructor(
    private readonly cooldownMs = 15_000,
    private readonly now: () => number = Date.now
  ) {}

  get isActive() {
    return this.active;
  }

  begin(): () => void {
    if (this.active) throw new Error("O reinício do Discord já está em andamento.");
    const remainingMs = this.nextAllowedAt - this.now();
    if (remainingMs > 0) {
      const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1_000));
      throw new Error(`Aguarde ${remainingSeconds}s antes de tentar reiniciar o Discord novamente.`);
    }
    this.active = true;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.active = false;
      this.nextAllowedAt = this.now() + this.cooldownMs;
    };
  }
}
