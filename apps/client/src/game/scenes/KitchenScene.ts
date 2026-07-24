import Phaser from "phaser";

import type { LobbySnapshot } from "../../network/RoomClient.js";
import {
  kitchenObjectAppearance,
  projectKitchenWorld,
  type ProjectedKitchenObject,
} from "../KitchenWorldModel.js";

const COLORS = {
  wall: 0x4d241d,
  floor: 0x211d1b,
  floorLine: 0x6b5142,
  prep: 0x28766f,
  stove: 0xa85832,
  pass: 0xf2dfb5,
  lectern: 0x9b693e,
  sign: 0x315b56,
} as const;

export class KitchenScene extends Phaser.Scene {
  private snapshot: LobbySnapshot | undefined;
  private backdrop: Phaser.GameObjects.Graphics | undefined;
  private objects = new Map<string, Phaser.GameObjects.Container>();
  private reducedMotion: boolean;
  private created = false;

  constructor(reducedMotion = false) {
    super({ key: "kitchen-world" });
    this.reducedMotion = reducedMotion;
  }

  create(): void {
    this.created = true;
    this.cameras.main.setBackgroundColor("rgba(0,0,0,0)");
    this.scale.on("resize", () => this.renderWorld());
    this.renderWorld();
  }

  setSnapshot(snapshot: LobbySnapshot): void {
    this.snapshot = snapshot;
    if (this.created) this.renderWorld();
  }

  private renderWorld(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    if (width <= 0 || height <= 0) return;
    this.backdrop?.destroy();
    this.backdrop = this.add.graphics().setDepth(0);
    this.drawRoom(this.backdrop, width, height);

    if (!this.snapshot) return;
    const world = projectKitchenWorld(this.snapshot);
    this.drawStations(world.stations, width, height);
    this.drawAvatars(world.avatars, width, height);
    this.syncObjects(world.objects, width, height);

    const inactive = this.snapshot.roundStatus === "PAUSED"
      || this.snapshot.roundStatus === "WON"
      || this.snapshot.roundStatus === "LOST";
    this.cameras.main.setAlpha(inactive ? 0.62 : 1);
  }

  private drawRoom(
    graphics: Phaser.GameObjects.Graphics,
    width: number,
    height: number,
  ): void {
    graphics.fillStyle(COLORS.wall, 1);
    graphics.fillRect(0, 0, width, height * 0.48);
    const centerX = width / 2;
    const centerY = height * 0.52;
    const radiusX = width * 0.45;
    const radiusY = height * 0.39;
    graphics.fillStyle(COLORS.floor, 1);
    graphics.fillPoints([
      new Phaser.Geom.Point(centerX, centerY - radiusY),
      new Phaser.Geom.Point(centerX + radiusX, centerY),
      new Phaser.Geom.Point(centerX, centerY + radiusY),
      new Phaser.Geom.Point(centerX - radiusX, centerY),
    ], true);
    graphics.lineStyle(Math.max(1, width / 700), COLORS.floorLine, 0.45);
    for (let index = 1; index < 8; index += 1) {
      const ratio = index / 8;
      graphics.lineBetween(
        centerX - radiusX * ratio,
        centerY - radiusY * (1 - ratio),
        centerX + radiusX * (1 - ratio),
        centerY + radiusY * ratio,
      );
      graphics.lineBetween(
        centerX + radiusX * ratio,
        centerY - radiusY * (1 - ratio),
        centerX - radiusX * (1 - ratio),
        centerY + radiusY * ratio,
      );
    }
    graphics.fillStyle(0xffc46b, 0.12);
    graphics.fillCircle(width * 0.25, height * 0.18, height * 0.24);
    graphics.fillCircle(width * 0.72, height * 0.16, height * 0.25);
  }

  private drawStations(
    stations: ReturnType<typeof projectKitchenWorld>["stations"],
    width: number,
    height: number,
  ): void {
    for (const station of stations) {
      const key = `station-${station.id}`;
      this.children.getByName(key)?.destroy();
      this.children.getByName(`${key}-label`)?.destroy();
      const x = station.hotspot.left / 100 * width;
      const y = station.hotspot.top / 100 * height;
      const color = station.id === "PREP"
        ? COLORS.prep
        : station.id === "STOVE"
          ? COLORS.stove
          : station.id === "PASS"
            ? COLORS.pass
            : station.id === "LECTERN"
              ? COLORS.lectern
              : COLORS.sign;
      const shape = this.add.graphics();
      shape.name = key;
      shape.setDepth(station.depth);
      shape.fillStyle(0x000000, 0.28);
      shape.fillEllipse(x, y + height * 0.035, width * 0.15, height * 0.055);
      shape.fillStyle(color, 1);
      shape.fillPoints([
        new Phaser.Geom.Point(x, y - height * 0.045),
        new Phaser.Geom.Point(x + width * 0.07, y),
        new Phaser.Geom.Point(x, y + height * 0.045),
        new Phaser.Geom.Point(x - width * 0.07, y),
      ], true);
      shape.fillStyle(0x000000, 0.18);
      shape.fillRect(x - width * 0.055, y, width * 0.11, height * 0.055);
      if (station.id === "STOVE") {
        shape.lineStyle(3, 0xffc15b, 0.95);
        shape.strokeCircle(x, y - height * 0.005, height * 0.027);
      }
      const label = this.add.text(x, y + height * 0.064, station.label.toUpperCase(), {
        color: "#fff8e7",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: `${Math.max(10, Math.min(15, width / 74))}px`,
        fontStyle: "bold",
        stroke: "#18120e",
        strokeThickness: 4,
      });
      label.name = `${key}-label`;
      label.setOrigin(0.5, 0);
      label.setDepth(station.depth + 1);
    }
  }

  private drawAvatars(
    avatars: ReturnType<typeof projectKitchenWorld>["avatars"],
    width: number,
    height: number,
  ): void {
    const apronColors = [0x6ab6d9, 0xe69a45, 0x81c78c];
    avatars.forEach((avatar, index) => {
      const key = `avatar-${avatar.role}`;
      this.children.getByName(key)?.destroy();
      this.children.getByName(`${key}-label`)?.destroy();
      const x = avatar.hotspot.left / 100 * width;
      const y = avatar.hotspot.top / 100 * height - height * 0.085;
      const radius = Math.max(8, Math.min(width, height) * 0.025);
      const monkey = this.add.graphics();
      monkey.name = key;
      monkey.setDepth(avatar.depth);
      monkey.fillStyle(0x2b1710, 0.3);
      monkey.fillEllipse(x, y + radius * 3.2, radius * 3.4, radius);
      monkey.fillStyle(0x744329, 1);
      monkey.fillCircle(x, y, radius * 1.3);
      monkey.fillCircle(x - radius * 1.25, y, radius * 0.58);
      monkey.fillCircle(x + radius * 1.25, y, radius * 0.58);
      monkey.fillStyle(0xc98c5e, 1);
      monkey.fillEllipse(x, y + radius * 0.25, radius * 1.45, radius);
      monkey.fillStyle(apronColors[index]!, 1);
      monkey.fillRoundedRect(
        x - radius,
        y + radius * 1.15,
        radius * 2,
        radius * 2.2,
        radius * 0.35,
      );
      monkey.fillStyle(0x17100d, 1);
      monkey.fillCircle(x - radius * 0.42, y - radius * 0.15, radius * 0.12);
      monkey.fillCircle(x + radius * 0.42, y - radius * 0.15, radius * 0.12);
      const roleLabel = avatar.role === "BLIND_COOK"
        ? "COOK"
        : avatar.role === "RECIPE_KEEPER"
          ? "KEEPER"
          : "GUIDE";
      const label = this.add.text(x, y + radius * 3.05, roleLabel, {
        color: "#fff8e7",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: `${Math.max(10, Math.min(14, width / 80))}px`,
        fontStyle: "bold",
        stroke: "#18120e",
        strokeThickness: 4,
      });
      label.name = `${key}-label`;
      label.setOrigin(0.5, 0);
      label.setDepth(avatar.depth + 1);
      if (!this.reducedMotion) {
        this.tweens.add({
          targets: monkey,
          y: -Math.max(1, radius * 0.12),
          duration: 1_800 + index * 180,
          yoyo: true,
          repeat: -1,
          ease: "Sine.InOut",
        });
      }
    });
  }

  private syncObjects(
    objects: readonly ProjectedKitchenObject[],
    width: number,
    height: number,
  ): void {
    const activeIds = new Set(objects.map(({ id }) => id));
    for (const [id, visual] of this.objects) {
      if (!activeIds.has(id)) {
        visual.destroy();
        this.objects.delete(id);
      }
    }
    for (const object of objects) {
      let visual = this.objects.get(object.id);
      if (visual && visual.name !== object.visualState) {
        visual.destroy();
        this.objects.delete(object.id);
        visual = undefined;
      }
      visual ??= this.createObject(object);
      this.objects.set(object.id, visual);
      const appearance = kitchenObjectAppearance(object.visualState);
      visual.setPosition(
        object.hotspot.left / 100 * width,
        object.hotspot.top / 100 * height - height * 0.035,
      );
      visual.setDepth(object.depth + 20);
      visual.setAlpha(appearance.alpha);
      visual.setScale(appearance.scale);
    }
  }

  private createObject(
    object: ProjectedKitchenObject,
  ): Phaser.GameObjects.Container {
    const appearance = kitchenObjectAppearance(object.visualState);
    const color = object.kind === "TOMATO"
      ? 0xe45b45
      : object.kind === "ONION"
        ? 0xe8d4a2
        : object.kind === "CARROT"
          ? 0xf2993f
          : 0xb98c58;
    const parts: Phaser.GameObjects.GameObject[] = [
      this.add.ellipse(0, 10, 32, 10, 0x000000, 0.3),
      this.add.circle(0, 0, 13, color),
    ];
    if (appearance.detail === "CHOP_MARKS") {
      const marks = this.add.graphics();
      marks.lineStyle(2, 0x4a241b, 0.85);
      marks.lineBetween(-8, -5, 7, 5);
      marks.lineBetween(-8, 2, 5, 9);
      parts.push(marks);
    } else if (appearance.detail === "BUBBLES") {
      parts.push(
        this.add.circle(-8, -10, 3, 0xffe5a8, 0.82),
        this.add.circle(8, -7, 4, 0xffe5a8, 0.68),
        this.add.circle(1, -15, 2, 0xffffff, 0.75),
      );
    } else if (appearance.detail === "SMOKE") {
      parts.push(
        this.add.circle(-5, -10, 5, 0x3d3632, 0.72),
        this.add.circle(2, -16, 6, 0x5c514b, 0.62),
        this.add.circle(8, -23, 4, 0x746861, 0.5),
      );
    } else {
      parts.push(this.add.circle(-4, -5, 3, 0xffffff, 0.42));
    }
    const container = this.add.container(0, 0, parts);
    container.name = object.visualState;
    return container;
  }
}
