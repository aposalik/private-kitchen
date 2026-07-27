export interface CameraPlayerPoint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
}

export interface CameraState {
  readonly targetX: number;
  readonly targetZ: number;
  readonly distance: number;
  readonly pitchDegrees: number;
  readonly azimuthDegrees: number;
  readonly fovDegrees: number;
}

const CAMERA_LIMITS = {
  minDistance: 50,
  maxDistance: 82,
  pitchDegrees: 42,
  azimuthDegrees: -45,
  fovDegrees: 50,
} as const;

export function cameraGoal(
  players: readonly CameraPlayerPoint[],
  _localId: string | undefined,
): CameraState {
  const finitePlayers = players.filter(({ x, z }) => Number.isFinite(x) && Number.isFinite(z));
  const visible = finitePlayers.length > 0
    ? finitePlayers
    : [{ id: "camera-origin", x: 50, z: 30 }];
  const targetX = visible.reduce((sum, player) => sum + player.x, 0) / visible.length;
  const targetZ = visible.reduce((sum, player) => sum + player.z, 0) / visible.length;
  const separation = visible.reduce((largest, first) =>
    Math.max(largest, ...visible.map((second) =>
      Math.hypot(first.x - second.x, first.z - second.z))), 0);
  return {
    targetX: round(targetX),
    targetZ: round(targetZ),
    distance: clamp(
      CAMERA_LIMITS.minDistance + Math.min(separation, 64) * 0.5,
      CAMERA_LIMITS.minDistance,
      CAMERA_LIMITS.maxDistance,
    ),
    pitchDegrees: CAMERA_LIMITS.pitchDegrees,
    azimuthDegrees: CAMERA_LIMITS.azimuthDegrees,
    fovDegrees: CAMERA_LIMITS.fovDegrees,
  };
}

export function dampCamera(
  current: CameraState,
  goal: CameraState,
  deltaSeconds: number,
  reducedMotion: boolean,
): CameraState {
  const safeGoal = finiteCameraState(goal) ? goal : cameraGoal([], undefined);
  if (reducedMotion || !finiteCameraState(current)) return safeGoal;
  const blend = 1 - Math.exp(-6 * clamp(deltaSeconds, 0, 0.1));
  return {
    targetX: lerp(current.targetX, safeGoal.targetX, blend),
    targetZ: lerp(current.targetZ, safeGoal.targetZ, blend),
    distance: lerp(current.distance, safeGoal.distance, blend),
    pitchDegrees: lerp(current.pitchDegrees, safeGoal.pitchDegrees, blend),
    azimuthDegrees: safeGoal.azimuthDegrees,
    fovDegrees: lerp(current.fovDegrees, safeGoal.fovDegrees, blend),
  };
}

function finiteCameraState(state: CameraState): boolean {
  return Object.values(state).every(Number.isFinite);
}

export function occluderOpacity(
  occluding: boolean,
  current: number,
  deltaSeconds: number,
): number {
  const goal = occluding ? 0.16 : 1;
  const blend = 1 - Math.exp(-8 * clamp(deltaSeconds, 0, 1));
  const next = lerp(clamp(current, 0.16, 1), goal, blend);
  return Math.abs(next - goal) < 0.001 ? goal : next;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}
