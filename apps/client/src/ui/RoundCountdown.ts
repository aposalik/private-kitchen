export class RoundCountdown {
  private overlay!: HTMLElement;
  private digit!: HTMLElement;
  private timer: ReturnType<typeof setInterval> | undefined;
  private remaining = 0;

  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    const el = document.createElement("div");
    el.dataset.roundCountdown = "";
    el.className = "round-countdown";
    el.setAttribute("aria-live", "assertive");
    el.setAttribute("aria-atomic", "true");
    el.hidden = true;

    const digit = document.createElement("span");
    digit.dataset.countdownDigit = "";
    digit.className = "round-countdown__digit";
    el.append(digit);

    this.overlay = el;
    this.digit = digit;
    this.root.append(el);
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.remaining = 3;
    this.digit.textContent = String(this.remaining);
    this.overlay.hidden = false;
    this.timer = setInterval(() => {
      this.remaining -= 1;
      if (this.remaining <= 0) {
        this.stop();
      } else {
        this.digit.textContent = String(this.remaining);
      }
    }, 1000);
  }

  private stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.overlay.hidden = true;
  }

  destroy(): void {
    this.stop();
  }
}
