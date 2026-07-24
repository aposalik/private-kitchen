import type { DrawingColor, DrawingStroke, DrawingWidth } from "@cooking-game/shared";

export class DrawingBoard {
  readonly canvas = document.createElement("canvas");
  private points: Array<{ x: number; y: number }> | undefined;
  private pointerId: number | undefined;

  constructor(
    private readonly editable: boolean,
    private readonly send: (color: DrawingColor, width: DrawingWidth, points: readonly { x: number; y: number }[]) => void,
  ) {
    this.canvas.width = 480;
    this.canvas.height = 240;
    this.canvas.dataset.drawingBoard = "";
    this.canvas.dataset.editable = String(editable);
    this.canvas.setAttribute("aria-label", editable ? "Constrained drawing board" : "Recipe Keeper drawing board");
    this.canvas.setAttribute("role", "img");
    if (editable) {
      this.canvas.tabIndex = 0;
      this.canvas.addEventListener("pointerdown", (event) => this.start(event));
      this.canvas.addEventListener("pointermove", (event) => this.move(event));
      this.canvas.addEventListener("pointerup", (event) => this.finish(event));
      this.canvas.addEventListener("pointercancel", () => this.cancel());
      this.canvas.addEventListener("lostpointercapture", () => this.cancel());
    }
  }

  render(strokes: readonly DrawingStroke[]): void {
    this.canvas.dataset.strokeCount = String(strokes.length);
    if (!("CanvasRenderingContext2D" in globalThis)) return;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of strokes) {
      context.beginPath();
      context.strokeStyle = colorValue(stroke.color);
      context.lineWidth = stroke.width === "THIN" ? 2 : stroke.width === "MEDIUM" ? 5 : 9;
      stroke.points.forEach((point, index) => {
        const x = point.x * this.canvas.width;
        const y = point.y * this.canvas.height;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.stroke();
    }
  }

  private start(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.points = [this.normalized(event)];
    this.canvas.setPointerCapture?.(event.pointerId);
  }
  private move(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || !this.points || this.points.length >= 64) return;
    this.addPoint(this.normalized(event));
  }
  private finish(event: PointerEvent): void {
    if (event.pointerId !== this.pointerId || !this.points) return;
    this.addPoint(this.normalized(event));
    const points = this.points;
    this.cancel();
    if (points.length >= 2) this.send("BLACK", "MEDIUM", points);
  }
  private cancel(): void { this.points = undefined; this.pointerId = undefined; }
  private addPoint(point: { x: number; y: number }): void {
    const previous = this.points?.at(-1);
    if (!previous || previous.x !== point.x || previous.y !== point.y) this.points?.push(point);
  }
  private normalized(event: PointerEvent): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width),
      y: clamp((event.clientY - bounds.top) / bounds.height),
    };
  }
}

function clamp(value: number): number { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function colorValue(color: DrawingColor): string {
  return { BLACK: "#18181b", RED: "#dc2626", BLUE: "#2563eb", GREEN: "#16a34a" }[color];
}
