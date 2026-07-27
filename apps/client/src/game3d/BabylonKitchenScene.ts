import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import {
  KITCHEN_LAYOUT,
  ROLE_LABELS,
  type PlayerRole,
} from "@cooking-game/shared";

import type {
  LobbyObjectSnapshot,
  LobbyPlayerSnapshot,
  LobbySnapshot,
} from "../network/RoomClient.js";
import type { BabylonRuntime } from "./BabylonKitchenWorld.js";
import {
  cameraGoal,
  dampCamera,
  occluderOpacity,
  type CameraState,
} from "./CameraController.js";
import type { CharacterAnimationState } from "./AnimationState.js";
import {
  RemoteSnapshotInterpolator,
  LocalPrediction,
  type MotionTransform,
} from "./SnapshotMotion.js";

const ROLE_COLORS: Readonly<Record<PlayerRole, string>> = {
  BLIND_COOK: "#e57946",
  RECIPE_KEEPER: "#56b8b1",
  DEAF_KITCHEN_GUIDE: "#81bc68",
};

export const PHASE_C_LIGHTING = {
  warmFillIntensity: 0.48,
  windowKeyIntensity: 0.82,
  materialEmissiveContribution: 0.018,
} as const;

interface CharacterNodes {
  readonly root: TransformNode;
  readonly body: Mesh;
  readonly leftArm: Mesh;
  readonly rightArm: Mesh;
  readonly heldAnchor: TransformNode;
  role: PlayerRole;
  animation: CharacterAnimationState;
}

export function createBabylonKitchenRuntime(
  canvas: HTMLCanvasElement,
  options: { readonly reducedMotion: boolean },
): BabylonRuntime {
  const engine = new Engine(canvas, true, {
    antialias: true,
    preserveDrawingBuffer: true,
    stencil: true,
  });
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString("#2b2025ff");
  scene.ambientColor = Color3.FromHexString("#fff1d1");
  const presenters = new Map<string, CharacterNodes>();
  const ingredients = new Map<string, Mesh>();
  const interpolator = new RemoteSnapshotInterpolator();
  const occluders: Mesh[] = [];
  let snapshot: LobbySnapshot | undefined;
  let localPrediction: LocalPrediction | undefined;
  let activeLocalPlayerId: string | undefined;
  let cameraState = cameraGoal([], undefined);
  let lastFrameAt = performance.now();
  let firstRenderResolved = false;
  let resolveFirstRender!: () => void;
  const firstRender = new Promise<void>((resolve) => {
    resolveFirstRender = resolve;
  });

  const camera = new ArcRotateCamera(
    "group-camera",
    degrees(cameraState.azimuthDegrees),
    degrees(90 - cameraState.pitchDegrees),
    cameraState.distance,
    new Vector3(cameraState.targetX, 0, cameraState.targetZ),
    scene,
  );
  camera.fov = degrees(cameraState.fovDegrees);
  camera.lowerRadiusLimit = 50;
  camera.upperRadiusLimit = 82;
  camera.lowerBetaLimit = degrees(40);
  camera.upperBetaLimit = degrees(55);
  camera.inputs.clear();
  scene.activeCamera = camera;

  buildLighting(scene);
  buildKitchen(scene, occluders);

  const update = (next: LobbySnapshot): void => {
    snapshot = next;
    const now = performance.now();
    const players = next.players ?? [];
    syncWorldIngredients(scene, ingredients, next);
    const active = new Set(players.map(({ id }) => id));
    interpolator.removeExcept(active);
    for (const player of players) {
      let presenter = presenters.get(player.id);
      if (!presenter) {
        presenter = createCharacter(
          scene,
          player,
          player.id === next.sessionId,
          options.reducedMotion,
        );
        presenters.set(player.id, presenter);
      }
      if (presenter.role !== player.role) continue;
      interpolator.push(player.id, player, now);
      const transform = player.id === next.sessionId
        ? reconcileLocalPrediction(player)
        : interpolator.sample(player.id, now - 70) ?? player;
      applyCharacterTransform(presenter, transform, player, now, options.reducedMotion);
      syncHeldIngredient(scene, presenter, next, player.id);
    }
    for (const [id, presenter] of presenters) {
      if (active.has(id)) continue;
      presenter.root.dispose(false, true);
      presenters.delete(id);
    }
  };

  scene.onBeforeRenderObservable.add(() => {
    const now = performance.now();
    const deltaSeconds = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1_000));
    lastFrameAt = now;
    const players = snapshot?.players ?? [];
    localPrediction?.advance(deltaSeconds);
    const localPresenter = activeLocalPlayerId
      ? presenters.get(activeLocalPlayerId)
      : undefined;
    if (localPresenter && localPrediction) {
      const predicted = localPrediction.presentation;
      localPresenter.root.position.x = predicted.x;
      localPresenter.root.position.z = predicted.z;
      localPresenter.root.rotation.y = predicted.facingYaw;
    }
    const goal = cameraGoal(players, snapshot?.sessionId);
    cameraState = dampCamera(cameraState, goal, deltaSeconds, options.reducedMotion);
    camera.alpha = degrees(cameraState.azimuthDegrees);
    camera.beta = degrees(90 - cameraState.pitchDegrees);
    camera.radius = cameraState.distance;
    camera.fov = degrees(cameraState.fovDegrees);
    camera.setTarget(new Vector3(cameraState.targetX, 1.5, cameraState.targetZ));
    const local = players.find(({ id }) => id === snapshot?.sessionId);
    for (const wall of occluders) {
      const blocking = Boolean(local && (
        local.z < 12 || local.x < 8 || local.x > 92
      ));
      wall.visibility = occluderOpacity(blocking, wall.visibility, deltaSeconds);
    }
    if (!options.reducedMotion) animateIdle(presenters, now);
  });

  scene.onAfterRenderObservable.add(() => {
    canvas.dataset.activeMeshes = String(scene.getActiveMeshes().length);
    canvas.dataset.sceneMeshes = String(scene.meshes.length);
    canvas.dataset.renderWidth = String(engine.getRenderWidth());
    canvas.dataset.renderHeight = String(engine.getRenderHeight());
    canvas.dataset.cameraPosition = [
      camera.globalPosition.x,
      camera.globalPosition.y,
      camera.globalPosition.z,
    ].map((value) => value.toFixed(2)).join(",");
    canvas.dataset.cameraTarget = [
      camera.target.x,
      camera.target.y,
      camera.target.z,
    ].map((value) => value.toFixed(2)).join(",");
    canvas.dataset.activeMeshNames = scene.getActiveMeshes().data
      .slice(0, scene.getActiveMeshes().length)
      .map((mesh) => mesh.name)
      .join(",");
    canvas.dataset.sceneReady = String(scene.isReady());
    if (
      !firstRenderResolved
      && scene.isReady()
      && engine.getRenderWidth() > 0
      && engine.getRenderHeight() > 0
    ) {
      firstRenderResolved = true;
      resolveFirstRender();
    }
  });

  engine.runRenderLoop(() => scene.render());

  return {
    whenReady: () => firstRender,
    update,
    predictMovement: (axisX, axisZ, sequence) => {
      localPrediction?.applyInput({ axisX, axisZ, sequence }, 0);
    },
    resize: () => engine.resize(),
    render: () => scene.render(),
    restoreContext: () => engine.resize(),
    destroy: () => {
      engine.stopRenderLoop();
      scene.dispose();
      engine.dispose();
    },
  };

  function reconcileLocalPrediction(player: LobbyPlayerSnapshot): MotionTransform {
    if (!localPrediction || activeLocalPlayerId !== player.id) {
      activeLocalPlayerId = player.id;
      localPrediction = new LocalPrediction(player);
    }
    localPrediction.reconcile(player);
    return localPrediction.presentation;
  }
}

function buildLighting(scene: Scene): void {
  const sky = new HemisphericLight("warm-fill", new Vector3(0, 1, 0), scene);
  sky.intensity = PHASE_C_LIGHTING.warmFillIntensity;
  sky.diffuse = Color3.FromHexString("#fff0cf");
  sky.groundColor = Color3.FromHexString("#493c48");
  const sun = new DirectionalLight("window-key", new Vector3(-0.45, -1, 0.35), scene);
  sun.position = new Vector3(18, 44, 6);
  sun.intensity = PHASE_C_LIGHTING.windowKeyIntensity;
  const shadows = new ShadowGenerator(1024, sun);
  shadows.useBlurExponentialShadowMap = true;
  shadows.blurKernel = 18;
  shadows.darkness = 0.25;
  scene.metadata = { shadows };
}

function buildKitchen(scene: Scene, occluders: Mesh[]): void {
  const floor = MeshBuilder.CreateGround("warm-checker-floor", {
    width: 104,
    height: 64,
    subdivisions: 2,
  }, scene);
  floor.position.set(50, 0, 30);
  floor.material = pbr(scene, "painted-floor", "#d8b58e", 0.88, 0.02);
  floor.receiveShadows = true;

  for (let x = 5; x < 100; x += 10) {
    for (let z = 5; z < 60; z += 10) {
      if ((x / 10 + z / 10) % 2 < 1) continue;
      const tile = MeshBuilder.CreateBox(`tile-${x}-${z}`, {
        width: 9.6,
        depth: 9.6,
        height: 0.08,
      }, scene);
      tile.position.set(x, 0.04, z);
      tile.material = pbr(scene, `tile-material-${x}-${z}`, "#edc5b4", 0.94, 0);
    }
  }

  const backWall = roundedBox(scene, "back-wall", 104, 11, 1, "#f3cfaa");
  backWall.position.set(50, 5.5, 60.5);
  const leftWall = roundedBox(scene, "left-wall", 1, 11, 62, "#efc5a4");
  leftWall.position.set(-0.5, 5.5, 30);
  const frontRail = roundedBox(scene, "front-occluder", 104, 3.5, 1.2, "#bf765a");
  frontRail.position.set(50, 1.75, -0.6);
  occluders.push(frontRail);

  for (const [id, station] of Object.entries(KITCHEN_LAYOUT.stations)) {
    const colors: Record<string, string> = {
      INGREDIENT_STORAGE: "#e9a36f",
      PREPARATION: "#64b6a9",
      STOVE: "#d96d55",
      SERVING_PASS: "#f2d391",
      RECIPE_LECTERN: "#79aebd",
      GESTURE_STATION: "#9bc879",
    };
    const counter = roundedBox(scene, `station-${id}`, 12, 4.8, 7, colors[id] ?? "#d99c73");
    counter.position.set(station.x, 2.4, station.z + 4);
    counter.receiveShadows = true;
    addStationProp(scene, id, station.x, station.z);
  }

  for (const collider of KITCHEN_LAYOUT.staticColliders) {
    const cabinet = roundedBox(
      scene,
      `authority-counter-${collider.minX}`,
      collider.maxX - collider.minX,
      5.5,
      collider.maxZ - collider.minZ,
      "#c9855e",
    );
    cabinet.position.set(
      (collider.minX + collider.maxX) / 2,
      2.75,
      (collider.minZ + collider.maxZ) / 2,
    );
  }
}

function addStationProp(scene: Scene, id: string, x: number, z: number): void {
  if (id === "STOVE") {
    const pot = MeshBuilder.CreateCylinder("stove-pot", {
      height: 2.2,
      diameter: 5,
      tessellation: 32,
    }, scene);
    pot.position.set(x, 5.7, z + 4);
    pot.material = pbr(scene, "mint-pot", "#7ec8aa", 0.42, 0.15);
    return;
  }
  if (id === "RECIPE_LECTERN") {
    const book = roundedBox(scene, "recipe-book", 5, 0.7, 4, "#7aa6bd");
    book.position.set(x, 5.4, z + 4);
    book.rotation.x = -0.18;
    return;
  }
  if (id === "GESTURE_STATION") {
    const board = roundedBox(scene, "gesture-board", 7, 5, 0.6, "#86bd78");
    board.position.set(x, 7.5, z + 6.5);
    return;
  }
  if (id === "PREPARATION") {
    const board = roundedBox(scene, "cutting-board", 6, 0.5, 4, "#e6bd83");
    board.position.set(x, 5.15, z + 4);
    return;
  }
  if (id === "SERVING_PASS") {
    const plate = MeshBuilder.CreateCylinder("serving-plate", {
      height: 0.35,
      diameter: 5,
      tessellation: 32,
    }, scene);
    plate.position.set(x, 5.1, z + 4);
    plate.material = pbr(scene, "serving-ceramic", "#b8cfec", 0.25, 0.05);
  }
}

function createCharacter(
  scene: Scene,
  player: LobbyPlayerSnapshot,
  local: boolean,
  reducedMotion: boolean,
): CharacterNodes {
  const root = new TransformNode(`player-${player.id}`, scene);
  const apron = pbr(scene, `role-${player.id}`, ROLE_COLORS[player.role], 0.7, 0.03);
  const fur = pbr(scene, `fur-${player.id}`, "#754b36", 0.92, 0);
  const muzzle = pbr(scene, `muzzle-${player.id}`, "#d6a679", 0.9, 0);
  const body = MeshBuilder.CreateCapsule(`body-${player.id}`, {
    height: 5.2,
    radius: 1.65,
    tessellation: 24,
  }, scene);
  body.parent = root;
  body.position.y = 3.4;
  body.material = apron;
  const head = MeshBuilder.CreateSphere(`head-${player.id}`, {
    diameter: 3.8,
    segments: 24,
  }, scene);
  head.parent = root;
  head.position.y = 7;
  head.material = fur;
  for (const direction of [-1, 1]) {
    const ear = MeshBuilder.CreateSphere(`ear-${direction}-${player.id}`, {
      diameter: 1.45,
      segments: 16,
    }, scene);
    ear.parent = root;
    ear.position.set(direction * 1.8, 7, 0);
    ear.material = muzzle;
  }
  const face = MeshBuilder.CreateSphere(`face-${player.id}`, {
    diameter: 2.25,
    segments: 20,
  }, scene);
  face.parent = root;
  face.scaling.y = 0.68;
  face.position.set(0, 6.65, 1.25);
  face.material = muzzle;
  const leftArm = limb(scene, root, `left-arm-${player.id}`, -2, 4.3, apron);
  const rightArm = limb(scene, root, `right-arm-${player.id}`, 2, 4.3, apron);
  limb(scene, root, `left-leg-${player.id}`, -0.9, 1.1, fur);
  limb(scene, root, `right-leg-${player.id}`, 0.9, 1.1, fur);
  addRoleAccessory(scene, root, player.role, player.id);
  const heldAnchor = new TransformNode(`held-${player.id}`, scene);
  heldAnchor.parent = root;
  heldAnchor.position.set(0, 4.4, 2.4);
  const playerName = player.displayName?.trim() || "Teammate";
  addMarker(
    scene,
    root,
    `${playerName} • ${ROLE_LABELS[player.role]}${local ? " • YOU" : ""}`,
    local,
  );
  root.position.set(player.x, 0, player.z);
  root.rotation.y = player.facingYaw;
  if (reducedMotion) body.rotation.z = 0;
  return {
    root,
    body,
    leftArm,
    rightArm,
    heldAnchor,
    role: player.role,
    animation: player.locomotion === "MOVE" ? "MOVE" : "IDLE",
  };
}

function limb(
  scene: Scene,
  parent: TransformNode,
  name: string,
  x: number,
  y: number,
  material: StandardMaterial,
): Mesh {
  const mesh = MeshBuilder.CreateCapsule(name, {
    height: 3,
    radius: 0.48,
    tessellation: 16,
  }, scene);
  mesh.parent = parent;
  mesh.position.set(x, y, 0);
  mesh.material = material;
  return mesh;
}

function addRoleAccessory(
  scene: Scene,
  root: TransformNode,
  role: PlayerRole,
  id: string,
): void {
  if (role === "BLIND_COOK") {
    const hat = MeshBuilder.CreateCylinder(`chef-hat-${id}`, {
      height: 1.6,
      diameterTop: 3.4,
      diameterBottom: 2.5,
      tessellation: 24,
    }, scene);
    hat.parent = root;
    hat.position.y = 9.2;
    hat.material = pbr(scene, `hat-${id}`, "#fff1dc", 0.95, 0);
    const blindfold = roundedBox(scene, `blindfold-${id}`, 3.4, 0.7, 0.45, "#9a5579");
    blindfold.parent = root;
    blindfold.position.set(0, 7.25, 1.72);
    return;
  }
  if (role === "RECIPE_KEEPER") {
    const book = roundedBox(scene, `keeper-book-${id}`, 2.6, 3.4, 0.55, "#397d86");
    book.parent = root;
    book.position.set(-2.1, 4.3, 1);
    book.rotation.z = -0.2;
    return;
  }
  const paddle = roundedBox(scene, `guide-paddle-${id}`, 1.8, 2.7, 0.35, "#f2c861");
  paddle.parent = root;
  paddle.position.set(2.5, 5.2, 0.6);
}

function addMarker(
  scene: Scene,
  root: TransformNode,
  text: string,
  local: boolean,
): void {
  const texture = new DynamicTexture(`marker-texture-${text}`, {
    width: 512,
    height: 128,
  }, scene, true);
  texture.hasAlpha = true;
  texture.drawText(text.toUpperCase(), null, 82, "bold 42px sans-serif", "#fff8e8", "#00000088", true);
  const material = new StandardMaterial(`marker-material-${text}`, scene);
  material.diffuseTexture = texture;
  material.emissiveColor = local
    ? Color3.FromHexString("#ffe58a")
    : Color3.FromHexString("#fff8e8");
  material.useAlphaFromDiffuseTexture = true;
  material.disableLighting = true;
  const marker = MeshBuilder.CreatePlane(`marker-${text}`, {
    width: 7.4,
    height: 1.85,
  }, scene);
  marker.parent = root;
  marker.position.set(0, 10.6, 0);
  marker.billboardMode = Mesh.BILLBOARDMODE_ALL;
  marker.material = material;
}

function applyCharacterTransform(
  presenter: CharacterNodes,
  transform: MotionTransform,
  player: LobbyPlayerSnapshot,
  now: number,
  reducedMotion: boolean,
): void {
  presenter.root.position.x = transform.x;
  presenter.root.position.z = transform.z;
  presenter.root.rotation.y = transform.facingYaw;
  presenter.animation = player.locomotion === "MOVE"
    ? "MOVE"
    : presenter.heldAnchor.getChildren().length > 0
      ? "CARRY"
      : "IDLE";
  if (reducedMotion) return;
  const stride = presenter.animation === "MOVE" ? Math.sin(now / 110) * 0.55 : 0;
  presenter.leftArm.rotation.x = stride;
  presenter.rightArm.rotation.x = -stride;
}

function syncHeldIngredient(
  scene: Scene,
  presenter: CharacterNodes,
  snapshot: LobbySnapshot,
  playerId: string,
): void {
  const held = snapshot.objects?.find(({ heldBy }) => heldBy === playerId);
  const children = presenter.heldAnchor.getChildMeshes();
  if (!held) {
    for (const child of children) child.dispose();
    return;
  }
  if (children[0]?.metadata?.objectId === held.id) return;
  for (const child of children) child.dispose();
  const colors = {
    TOMATO: "#e85148",
    ONION: "#ead6a6",
    CARROT: "#f28a3a",
    POTATO: "#b98a59",
  } as const;
  const ingredient = MeshBuilder.CreateSphere(`held-ingredient-${held.id}`, {
    diameter: 1.7,
    segments: 18,
  }, scene);
  ingredient.parent = presenter.heldAnchor;
  ingredient.material = pbr(scene, `ingredient-${held.id}`, colors[held.kind], 0.55, 0.02);
  ingredient.metadata = { objectId: held.id };
}

function syncWorldIngredients(
  scene: Scene,
  ingredients: Map<string, Mesh>,
  snapshot: LobbySnapshot,
): void {
  const visible = new Set(
    (snapshot.objects ?? [])
      .filter(({ heldBy }) => heldBy === undefined)
      .map(({ id }) => id),
  );
  for (const [id, mesh] of ingredients) {
    if (visible.has(id)) continue;
    mesh.dispose();
    ingredients.delete(id);
  }
  for (const object of snapshot.objects ?? []) {
    if (object.heldBy) continue;
    let ingredient = ingredients.get(object.id);
    if (!ingredient) {
      ingredient = createIngredientMesh(scene, object.id, object.kind);
      ingredients.set(object.id, ingredient);
    }
    const target = object.location === "POT"
      ? KITCHEN_LAYOUT.stations.STOVE
      : { x: object.x, z: object.y };
    ingredient.position.set(
      target.x,
      object.location === "POT" ? 6.5 : 1.2,
      target.z + (object.location === "POT" ? 4 : 0),
    );
    ingredient.scaling.y = object.preparation === "CHOPPED" ? 0.55 : 1;
    ingredient.visibility = object.preparation === "RUINED" ? 0.62 : 1;
  }
}

function createIngredientMesh(
  scene: Scene,
  id: string,
  kind: LobbyObjectSnapshot["kind"],
): Mesh {
  const colors = {
    TOMATO: "#e85148",
    ONION: "#ead6a6",
    CARROT: "#f28a3a",
    POTATO: "#b98a59",
  } as const;
  const mesh = kind === "CARROT"
    ? MeshBuilder.CreateCapsule(`ingredient-${id}`, {
        height: 2.7,
        radius: 0.72,
        tessellation: 18,
      }, scene)
    : MeshBuilder.CreateSphere(`ingredient-${id}`, {
        diameter: kind === "POTATO" ? 2.15 : 1.9,
        segments: 18,
      }, scene);
  if (kind === "CARROT") mesh.rotation.z = Math.PI / 2;
  mesh.material = pbr(scene, `ingredient-material-${id}`, colors[kind], 0.55, 0.02);
  mesh.metadata = { objectId: id, kind };
  return mesh;
}

function animateIdle(
  presenters: ReadonlyMap<string, CharacterNodes>,
  now: number,
): void {
  let index = 0;
  for (const presenter of presenters.values()) {
    if (presenter.animation === "IDLE" || presenter.animation === "CARRY") {
      presenter.body.position.y = 3.4 + Math.sin(now / 620 + index) * 0.08;
    }
    index += 1;
  }
}

function roundedBox(
  scene: Scene,
  name: string,
  width: number,
  height: number,
  depth: number,
  color: string,
): Mesh {
  const mesh = MeshBuilder.CreateBox(name, {
    width,
    height,
    depth,
  }, scene);
  mesh.material = pbr(scene, `${name}-material`, color, 0.78, 0.03);
  mesh.enableEdgesRendering();
  mesh.edgesWidth = 1.2;
  mesh.edgesColor = new Color4(0.25, 0.12, 0.1, 0.16);
  const shadows = (scene.metadata as { shadows?: ShadowGenerator } | undefined)?.shadows;
  shadows?.addShadowCaster(mesh);
  return mesh;
}

function pbr(
  scene: Scene,
  name: string,
  color: string,
  roughness: number,
  metallic: number,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  const baseColor = Color3.FromHexString(color);
  material.diffuseColor = baseColor;
  material.emissiveColor = baseColor.scale(
    PHASE_C_LIGHTING.materialEmissiveContribution,
  );
  material.specularColor = Color3.White().scale(Math.max(0.04, metallic * 0.45));
  material.specularPower = Math.max(8, (1 - roughness) * 96);
  return material;
}

function degrees(value: number): number {
  return value * Math.PI / 180;
}
