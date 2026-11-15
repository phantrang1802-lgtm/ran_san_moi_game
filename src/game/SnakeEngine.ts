import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ArenaEnvironmentRig,
  CollectibleRig,
  createAppleCollectible,
  createArenaEnvironment,
  createObstaclePillar,
  createSnakeHead,
  createStarfruitCollectible,
  SnakeHeadRig,
} from './models';
import { soundEngine } from './sound';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import {
  CameraPreset,
  CELL_SIZE,
  GameHudState,
  GameMode,
  GamePhase,
  GRID_SIZE,
  GridCoord,
  GridDirection,
  SNAKE_SKINS,
  SnakeSkinId,
  SPEED_BASE_INTERVAL,
  SpeedPreset,
} from './types';

const MAX_SEGMENTS = GRID_SIZE * GRID_SIZE;
const BURST_PARTICLE_COUNT = 36;
const BONUS_DURATION = 9.0; // seconds

// Pre-allocated math helpers (Zero GC in render loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3Scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _mat4 = new THREE.Matrix4();
const _color = new THREE.Color();

interface BurstParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  colorHex: number;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

function gridToWorld(gx: number, gz: number, out: THREE.Vector3): THREE.Vector3 {
  const half = (GRID_SIZE - 1) * 0.5 * CELL_SIZE;
  out.set(gx * CELL_SIZE - half, 0, gz * CELL_SIZE - half);
  return out;
}

function dirToDelta(dir: GridDirection): { dx: number; dz: number } {
  switch (dir) {
    case 'up':
      return { dx: 0, dz: -1 };
    case 'down':
      return { dx: 0, dz: 1 };
    case 'left':
      return { dx: -1, dz: 0 };
    case 'right':
      return { dx: 1, dz: 0 };
  }
}

function isOppositeDir(a: GridDirection, b: GridDirection): boolean {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  );
}

function turnRelative(current: GridDirection, turn: 'left' | 'right'): GridDirection {
  const cw: GridDirection[] = ['up', 'right', 'down', 'left'];
  const idx = cw.indexOf(current);
  return cw[(idx + (turn === 'right' ? 1 : 3)) % 4];
}

function getStorageKey(mode: GameMode): string {
  return `ran_san_moi_3d_highscore_${mode}`;
}

function loadHighScore(mode: GameMode): number {
  try {
    const val = localStorage.getItem(getStorageKey(mode));
    return val ? Math.max(0, parseInt(val, 10) || 0) : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(mode: GameMode, score: number) {
  try {
    localStorage.setItem(getStorageKey(mode), String(score));
  } catch {
    // ignore storage errors
  }
}

export interface SnakeEngineCallbacks {
  onHudUpdate: (state: GameHudState) => void;
  onWebglError: (message: string) => void;
}

export class SnakeEngine {
  private container: HTMLElement;
  private callbacks: SnakeEngineCallbacks;
  private isSoftwareGl: boolean;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private textures!: ProceduralTextureSet;
  private arena!: ArenaEnvironmentRig;

  private snakeHead!: SnakeHeadRig;
  private dorsalInst!: THREE.InstancedMesh;
  private bellyInst!: THREE.InstancedMesh;
  private segShadowInst!: THREE.InstancedMesh;
  private dorsalMat!: THREE.MeshPhysicalMaterial;
  private bellyMat!: THREE.MeshStandardMaterial;

  private appleRig!: CollectibleRig;
  private starfruitRig!: CollectibleRig;
  private collectibleLight!: THREE.PointLight;

  private burstInst!: THREE.InstancedMesh;
  private particles: BurstParticle[] = [];

  private obstacleGroup = new THREE.Group();
  private obstacleRigs: Array<{ coord: GridCoord; rig: { group: THREE.Group; dispose: () => void } }> =
    [];

  // Game State
  private phase: GamePhase = 'idle';
  private mode: GameMode = 'classic';
  private cameraPreset: CameraPreset = 'isometric';
  private speedPreset: SpeedPreset = 'normal';
  private skinId: SnakeSkinId = 'jade';

  private snake: GridCoord[] = [];
  private prevSnake: GridCoord[] = [];
  private dir: GridDirection = 'right';
  private inputQueue: GridDirection[] = [];
  private appleCoord: GridCoord = { x: 14, z: 10 };
  private bonusCoord: GridCoord | null = null;
  private bonusTimer = 0;
  private foodsEatenCount = 0;

  private score = 0;
  private highScore = 0;
  private combo = 1;
  private comboDecayTimer = 0;
  private deathReason: string | null = null;
  private shakeIntensity = 0;

  // Timing & Interpolation
  private stepAccumulator = 0;
  private stepInterval = SPEED_BASE_INTERVAL.normal;
  private elapsed = 0;

  // Camera smooth state
  private camPosCurrent = new THREE.Vector3(0, 20, 17);
  private camTargetCurrent = new THREE.Vector3(0, 0, 0.8);
  private camPosGoal = new THREE.Vector3(0, 20, 17);
  private camTargetGoal = new THREE.Vector3(0, 0, 0.8);
  private currentHeadAngle = Math.PI / 2;

  // Loop & lifecycle
  private frameId = 0;
  private disposed = false;
  private contextLost = false;
  private disposables: Array<{ dispose: () => void }> = [];

  // Touch swipe tracking
  private touchStartX = 0;
  private touchStartY = 0;

  constructor(container: HTMLElement, callbacks: SnakeEngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();
    this.highScore = loadHighScore(this.mode);

    this.initScene();
    this.resetGameBoard(true);
    this.bindEvents();
    this.emitHud();
    this.startLoop();
  }

  private initScene() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: !this.isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      this.callbacks.onWebglError('Trình duyệt hiện tại không hỗ trợ WebGL để hiển thị 3D.');
      throw new Error('WebGL initialization failed');
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.container.appendChild(canvas);

    this.scene = new THREE.Scene();
    const bgHex = 0x0c141d;
    this.scene.background = new THREE.Color(bgHex);
    this.scene.fog = new THREE.FogExp2(bgHex, 0.0135);

    this.camera = new THREE.PerspectiveCamera(46, width / height, 0.2, 160);
    this.camera.position.copy(this.camPosCurrent);
    this.camera.lookAt(this.camTargetCurrent);

    // Mandatory Studio Environment Reflection via RoomEnvironment
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.disposables.push(envTex);
    pmremGenerator.dispose();

    // 3-Point Warm/Cool Studio + Atmospheric Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x88bae8, 0x16222c, 0.85);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    keyLight.position.set(14, 24, 13);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 65;
    keyLight.shadow.camera.left = -15;
    keyLight.shadow.camera.right = 15;
    keyLight.shadow.camera.top = 15;
    keyLight.shadow.camera.bottom = -15;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x4fd1c5, 0.95);
    rimLight.position.set(-14, 11, -15);
    this.scene.add(rimLight);

    // Procedural Textures
    this.textures = createProceduralTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.disposables.push(this.textures);

    // Arena Environment
    this.arena = createArenaEnvironment(this.textures, this.isSoftwareGl);
    this.scene.add(this.arena.group);
    this.disposables.push(this.arena);

    // Obstacles Group
    this.scene.add(this.obstacleGroup);

    // Snake Head + Instanced Body Segments
    const skin = SNAKE_SKINS[this.skinId];
    this.snakeHead = createSnakeHead(skin, this.textures, this.isSoftwareGl);
    this.scene.add(this.snakeHead.group);
    this.disposables.push(this.snakeHead);

    const dorsalGeo = new THREE.SphereGeometry(0.41, 16, 12);
    dorsalGeo.scale(1.04, 0.78, 1.14);
    this.dorsalMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: this.textures.scaleAlbedo,
      roughness: 0.25,
      metalness: 0.3,
      clearcoat: 0.82,
      clearcoatRoughness: 0.2,
    });
    this.dorsalInst = new THREE.InstancedMesh(dorsalGeo, this.dorsalMat, MAX_SEGMENTS);
    this.dorsalInst.castShadow = !this.isSoftwareGl;
    this.dorsalInst.receiveShadow = !this.isSoftwareGl;
    this.dorsalInst.frustumCulled = false;
    this.dorsalInst.count = 0;

    const bellyGeo = new THREE.CylinderGeometry(0.32, 0.34, 0.2, 12);
    this.bellyMat = new THREE.MeshStandardMaterial({
      color: skin.bellyHex,
      roughness: 0.74,
      metalness: 0.04,
    });
    this.bellyInst = new THREE.InstancedMesh(bellyGeo, this.bellyMat, MAX_SEGMENTS);
    this.bellyInst.receiveShadow = !this.isSoftwareGl;
    this.bellyInst.frustumCulled = false;
    this.bellyInst.count = 0;

    const segShadowGeo = new THREE.PlaneGeometry(0.92, 0.92);
    segShadowGeo.rotateX(-Math.PI / 2);
    const segShadowMat = new THREE.MeshBasicMaterial({
      map: this.textures.contactShadow,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.segShadowInst = new THREE.InstancedMesh(segShadowGeo, segShadowMat, MAX_SEGMENTS);
    this.segShadowInst.frustumCulled = false;
    this.segShadowInst.count = 0;

    this.scene.add(this.dorsalInst, this.bellyInst, this.segShadowInst);
    this.disposables.push(
      dorsalGeo,
      this.dorsalMat,
      bellyGeo,
      this.bellyMat,
      segShadowGeo,
      segShadowMat,
    );

    // Collectibles
    this.appleRig = createAppleCollectible(this.textures, this.isSoftwareGl);
    this.scene.add(this.appleRig.group);
    this.disposables.push(this.appleRig);

    this.starfruitRig = createStarfruitCollectible(this.textures, this.isSoftwareGl);
    this.starfruitRig.group.visible = false;
    this.scene.add(this.starfruitRig.group);
    this.disposables.push(this.starfruitRig);

    this.collectibleLight = new THREE.PointLight(0xff6b6b, 2.2, 6.0, 2);
    this.collectibleLight.position.set(0, 1.1, 0);
    this.scene.add(this.collectibleLight);

    // Burst Particle Pool (InstancedMesh)
    const particleGeo = new THREE.OctahedronGeometry(0.11, 0);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.65,
      roughness: 0.2,
      metalness: 0.2,
    });
    this.burstInst = new THREE.InstancedMesh(particleGeo, particleMat, BURST_PARTICLE_COUNT);
    this.burstInst.frustumCulled = false;
    this.burstInst.count = BURST_PARTICLE_COUNT;
    this.scene.add(this.burstInst);
    this.disposables.push(particleGeo, particleMat);

    for (let i = 0; i < BURST_PARTICLE_COUNT; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: -10,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.5,
        colorHex: 0xfbbf24,
      });
      _mat4.makeScale(0, 0, 0);
      this.burstInst.setMatrixAt(i, _mat4);
      this.burstInst.setColorAt(i, _color.setHex(0xffffff));
    }
    this.burstInst.instanceMatrix.needsUpdate = true;
    if (this.burstInst.instanceColor) this.burstInst.instanceColor.needsUpdate = true;

    // Pre-warm shaders on GPU
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    canvas.addEventListener('touchstart', this.handleTouchStart, { passive: true });
    canvas.addEventListener('touchend', this.handleTouchEnd, { passive: true });
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.contextLost = true;
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.emitHud();
    }
  };

  private handleContextRestored = () => {
    this.contextLost = false;
  };

  private handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private handleTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      this.touchStartX = e.touches[0].clientX;
      this.touchStartY = e.touches[0].clientY;
    }
  };

  private handleTouchEnd = (e: TouchEvent) => {
    if (e.changedTouches.length !== 1 || this.phase !== 'playing') return;
    const dx = e.changedTouches[0].clientX - this.touchStartX;
    const dy = e.changedTouches[0].clientY - this.touchStartY;
    if (Math.hypot(dx, dy) < 26) return;

    if (this.cameraPreset === 'chase') {
      if (Math.abs(dx) > Math.abs(dy)) {
        this.steerRelative(dx > 0 ? 'right' : 'left');
      }
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      this.queueDirection(dx > 0 ? 'right' : 'left');
    } else {
      this.queueDirection(dy > 0 ? 'down' : 'up');
    }
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    const code = e.code;

    if (code === 'Space') {
      e.preventDefault();
      soundEngine.unlock();
      if (this.phase === 'idle' || this.phase === 'gameover') {
        this.startNewGame();
      } else if (this.phase === 'playing') {
        this.togglePause();
      } else if (this.phase === 'paused') {
        this.togglePause();
      }
      return;
    }

    if (code === 'Enter' && (this.phase === 'idle' || this.phase === 'gameover')) {
      e.preventDefault();
      soundEngine.unlock();
      this.startNewGame();
      return;
    }

    if (code === 'KeyP' || code === 'Escape') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        this.togglePause();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    if (this.cameraPreset === 'chase') {
      if (code === 'ArrowLeft' || code === 'KeyA') {
        e.preventDefault();
        this.steerRelative('left');
      } else if (code === 'ArrowRight' || code === 'KeyD') {
        e.preventDefault();
        this.steerRelative('right');
      }
      return;
    }

    let nextDir: GridDirection | null = null;
    if (code === 'ArrowUp' || code === 'KeyW') nextDir = 'up';
    else if (code === 'ArrowDown' || code === 'KeyS') nextDir = 'down';
    else if (code === 'ArrowLeft' || code === 'KeyA') nextDir = 'left';
    else if (code === 'ArrowRight' || code === 'KeyD') nextDir = 'right';

    if (nextDir) {
      e.preventDefault();
      soundEngine.unlock();
      this.queueDirection(nextDir);
    }
  };

  public steerInput(input: GridDirection) {
    soundEngine.unlock();
    if (this.phase !== 'playing') return;
    if (this.cameraPreset === 'chase') {
      if (input === 'left' || input === 'right') {
        this.steerRelative(input);
      }
    } else {
      this.queueDirection(input);
    }
  }

  private steerRelative(turn: 'left' | 'right') {
    const lastPlanned =
      this.inputQueue.length > 0 ? this.inputQueue[this.inputQueue.length - 1] : this.dir;
    const nextDir = turnRelative(lastPlanned, turn);
    this.queueDirection(nextDir);
  }

  private queueDirection(nextDir: GridDirection) {
    if (this.inputQueue.length >= 2) return;
    const lastPlanned =
      this.inputQueue.length > 0 ? this.inputQueue[this.inputQueue.length - 1] : this.dir;
    if (nextDir === lastPlanned || isOppositeDir(lastPlanned, nextDir)) return;
    this.inputQueue.push(nextDir);
    soundEngine.playTurn();
  }

  private clearObstacles() {
    this.obstacleRigs.forEach((item) => {
      this.obstacleGroup.remove(item.rig.group);
      item.rig.dispose();
    });
    this.obstacleRigs = [];
  }

  private buildObstacles() {
    this.clearObstacles();
    if (this.mode !== 'obstacles') return;

    // Symmetric tactical stone pillar layout away from center starting lane
    const layout: GridCoord[] = [
      { x: 4, z: 4 },
      { x: 15, z: 4 },
      { x: 4, z: 15 },
      { x: 15, z: 15 },
      { x: 9, z: 3 },
      { x: 10, z: 16 },
      { x: 3, z: 10 },
      { x: 16, z: 9 },
    ];

    layout.forEach((coord) => {
      const rig = createObstaclePillar(this.isSoftwareGl);
      gridToWorld(coord.x, coord.z, _vec3A);
      rig.group.position.copy(_vec3A);
      this.obstacleGroup.add(rig.group);
      this.obstacleRigs.push({ coord, rig });
    });
  }

  private isOccupied(x: number, z: number): boolean {
    for (let i = 0; i < this.snake.length; i++) {
      if (this.snake[i].x === x && this.snake[i].z === z) return true;
    }
    for (let i = 0; i < this.obstacleRigs.length; i++) {
      if (this.obstacleRigs[i].coord.x === x && this.obstacleRigs[i].coord.z === z) return true;
    }
    if (this.bonusCoord && this.bonusCoord.x === x && this.bonusCoord.z === z) return true;
    return false;
  }

  private spawnApple() {
    const freeCells: GridCoord[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        if (!this.isOccupied(x, z)) {
          freeCells.push({ x, z });
        }
      }
    }
    if (freeCells.length === 0) return;
    const chosen = freeCells[Math.floor(Math.random() * freeCells.length)];
    this.appleCoord = chosen;
    gridToWorld(chosen.x, chosen.z, _vec3A);
    this.appleRig.group.position.copy(_vec3A);
    this.collectibleLight.position.set(_vec3A.x, 1.1, _vec3A.z);
    this.collectibleLight.color.setHex(0xff6b6b);
  }

  private spawnBonusFruit() {
    const freeCells: GridCoord[] = [];
    for (let x = 1; x < GRID_SIZE - 1; x++) {
      for (let z = 1; z < GRID_SIZE - 1; z++) {
        if (x === this.appleCoord.x && z === this.appleCoord.z) continue;
        if (!this.isOccupied(x, z)) {
          freeCells.push({ x, z });
        }
      }
    }
    if (freeCells.length === 0) return;
    const chosen = freeCells[Math.floor(Math.random() * freeCells.length)];
    this.bonusCoord = chosen;
    this.bonusTimer = BONUS_DURATION;
    gridToWorld(chosen.x, chosen.z, _vec3A);
    this.starfruitRig.group.position.copy(_vec3A);
    this.starfruitRig.group.visible = true;
  }

  private resetGameBoard(isIdlePreview = false) {
    this.snake = [
      { x: 10, z: 10 },
      { x: 9, z: 10 },
      { x: 8, z: 10 },
      { x: 7, z: 10 },
    ];
    this.prevSnake = this.snake.map((s) => ({ ...s }));
    this.dir = 'right';
    this.inputQueue = [];
    this.currentHeadAngle = Math.PI / 2;

    this.score = 0;
    this.combo = 1;
    this.comboDecayTimer = 0;
    this.foodsEatenCount = 0;
    this.deathReason = null;
    this.bonusCoord = null;
    this.bonusTimer = 0;
    this.starfruitRig.group.visible = false;
    this.stepAccumulator = 0;
    this.stepInterval = SPEED_BASE_INTERVAL[this.speedPreset];

    this.buildObstacles();
    this.spawnApple();

    const modeColors: Record<GameMode, number> = {
      classic: 0x10b981,
      portal: 0x38bdf8,
      obstacles: 0xf59e0b,
    };
    this.arena.setModeBorderColor(modeColors[this.mode]);

    if (!isIdlePreview) {
      this.phase = 'playing';
    }
    this.syncSegmentVisuals(1.0, 0);
    this.emitHud();
  }

  public startNewGame() {
    soundEngine.unlock();
    this.resetGameBoard(false);
  }

  public togglePause() {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.emitHud();
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.clock.getDelta();
      this.emitHud();
    }
  }

  public setMode(mode: GameMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.highScore = loadHighScore(mode);
    if (this.phase === 'idle' || this.phase === 'gameover') {
      this.phase = 'idle';
      this.resetGameBoard(true);
    } else {
      this.startNewGame();
    }
  }

  public setCameraPreset(preset: CameraPreset) {
    this.cameraPreset = preset;
    this.emitHud();
  }

  public setSpeedPreset(speed: SpeedPreset) {
    this.speedPreset = speed;
    this.recomputeStepInterval();
    this.emitHud();
  }

  public setSkin(skinId: SnakeSkinId) {
    this.skinId = skinId;
    const palette = SNAKE_SKINS[skinId];
    this.snakeHead.setSkin(palette);
    this.bellyMat.color.setHex(palette.bellyHex);
    this.emitHud();
  }

  private recomputeStepInterval() {
    const base = SPEED_BASE_INTERVAL[this.speedPreset];
    const speedup = Math.min(this.foodsEatenCount * 0.0014, base * 0.36);
    this.stepInterval = Math.max(0.058, base - speedup);
  }

  private emitBurst(worldX: number, worldZ: number, colorHex: number) {
    let spawned = 0;
    for (let i = 0; i < BURST_PARTICLE_COUNT && spawned < 18; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = worldX;
        p.y = 0.45;
        p.z = worldZ;
        const angle = (spawned / 18) * Math.PI * 2 + Math.random() * 0.3;
        const speed = 2.6 + Math.random() * 3.4;
        p.vx = Math.cos(angle) * speed;
        p.vy = 3.2 + Math.random() * 3.0;
        p.vz = Math.sin(angle) * speed;
        p.life = 0;
        p.maxLife = 0.45 + Math.random() * 0.25;
        p.colorHex = colorHex;
        spawned++;
      }
    }
  }

  private stepSimulation() {
    if (this.phase === 'idle') {
      // Gentle automated perimeter patrol for lively idle viewport
      const head = this.snake[0];
      let nextDir = this.dir;
      if (this.dir === 'right' && head.x >= 14) nextDir = 'down';
      else if (this.dir === 'down' && head.z >= 14) nextDir = 'left';
      else if (this.dir === 'left' && head.x <= 5) nextDir = 'up';
      else if (this.dir === 'up' && head.z <= 5) nextDir = 'right';
      this.dir = nextDir;

      const { dx, dz } = dirToDelta(this.dir);
      this.prevSnake = this.snake.map((s) => ({ ...s }));
      const nextHead = { x: head.x + dx, z: head.z + dz };
      this.snake.unshift(nextHead);
      this.snake.pop();
      return;
    }

    if (this.phase !== 'playing') return;

    if (this.inputQueue.length > 0) {
      this.dir = this.inputQueue.shift()!;
    }

    const head = this.snake[0];
    const { dx, dz } = dirToDelta(this.dir);
    let nx = head.x + dx;
    let nz = head.z + dz;

    // Boundary check
    if (nx < 0 || nx >= GRID_SIZE || nz < 0 || nz >= GRID_SIZE) {
      if (this.mode === 'portal') {
        nx = (nx + GRID_SIZE) % GRID_SIZE;
        nz = (nz + GRID_SIZE) % GRID_SIZE;
      } else {
        this.triggerGameOver('Va vào tường đá biên');
        return;
      }
    }

    // Obstacle check
    for (let i = 0; i < this.obstacleRigs.length; i++) {
      if (this.obstacleRigs[i].coord.x === nx && this.obstacleRigs[i].coord.z === nz) {
        this.triggerGameOver('Đâm vào cột đá cổ');
        return;
      }
    }

    const eatingApple = nx === this.appleCoord.x && nz === this.appleCoord.z;
    const eatingBonus =
      this.bonusCoord !== null && nx === this.bonusCoord.x && nz === this.bonusCoord.z;

    // Self-collision check (tail tip vacates unless eating)
    const checkLen = eatingApple || eatingBonus ? this.snake.length : this.snake.length - 1;
    for (let i = 0; i < checkLen; i++) {
      if (this.snake[i].x === nx && this.snake[i].z === nz) {
        this.triggerGameOver('Tự cắn vào thân rắn');
        return;
      }
    }

    this.prevSnake = this.snake.map((s) => ({ ...s }));
    this.snake.unshift({ x: nx, z: nz });

    if (eatingApple) {
      this.foodsEatenCount++;
      const gained = 10 * this.combo;
      this.score += gained;
      this.combo = Math.min(this.combo + 1, 8);
      this.comboDecayTimer = 4.2;
      this.recomputeStepInterval();

      gridToWorld(nx, nz, _vec3A);
      this.emitBurst(_vec3A.x, _vec3A.z, 0xf43f5e);
      soundEngine.playEat(this.combo);

      if (this.score > this.highScore) {
        this.highScore = this.score;
        saveHighScore(this.mode, this.highScore);
      }

      this.spawnApple();
      if (!this.bonusCoord && this.foodsEatenCount % 5 === 0) {
        this.spawnBonusFruit();
      }
      this.emitHud();
    } else if (eatingBonus) {
      this.foodsEatenCount++;
      const gained = 35 * this.combo;
      this.score += gained;
      this.combo = Math.min(this.combo + 2, 8);
      this.comboDecayTimer = 5.0;
      this.bonusCoord = null;
      this.bonusTimer = 0;
      this.starfruitRig.group.visible = false;

      gridToWorld(nx, nz, _vec3A);
      this.emitBurst(_vec3A.x, _vec3A.z, 0x2dd4bf);
      soundEngine.playBonusEat();

      if (this.score > this.highScore) {
        this.highScore = this.score;
        saveHighScore(this.mode, this.highScore);
      }
      this.emitHud();
    } else {
      this.snake.pop();
    }
  }

  private triggerGameOver(reason: string) {
    this.phase = 'gameover';
    this.deathReason = reason;
    this.shakeIntensity = 0.45;
    soundEngine.playGameOver();

    gridToWorld(this.snake[0].x, this.snake[0].z, _vec3A);
    this.emitBurst(_vec3A.x, _vec3A.z, 0xf59e0b);
    this.emitHud();
  }

  private syncSegmentVisuals(alpha: number, elapsed: number) {
    const count = this.snake.length;
    if (count === 0) return;

    const palette = SNAKE_SKINS[this.skinId];
    const headCurr = this.snake[0];
    const headPrev = this.prevSnake[0] || headCurr;

    const jumpX = Math.abs(headCurr.x - headPrev.x);
    const jumpZ = Math.abs(headCurr.z - headPrev.z);
    const tHead = jumpX > 1.5 || jumpZ > 1.5 ? 1.0 : alpha;

    const hx = THREE.MathUtils.lerp(headPrev.x, headCurr.x, tHead);
    const hz = THREE.MathUtils.lerp(headPrev.z, headCurr.z, tHead);
    gridToWorld(hx, hz, _vec3A);

    // Subtle slither bob
    const slitherY = Math.sin(elapsed * 7.5) * 0.025;
    this.snakeHead.group.position.set(_vec3A.x, slitherY, _vec3A.z);

    // Target head rotation toward direction
    const { dx, dz } = dirToDelta(this.dir);
    const targetAngle = Math.atan2(dx, dz);
    let diff = targetAngle - this.currentHeadAngle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.currentHeadAngle += diff * 0.28;
    this.snakeHead.group.rotation.y = this.currentHeadAngle;

    // Tongue flick animation (more excited when near apple!)
    const distToApple = Math.hypot(
      this.appleCoord.x - headCurr.x,
      this.appleCoord.z - headCurr.z,
    );
    const tongueFreq = distToApple < 3.5 ? 11.0 : 3.2;
    const flick = Math.max(0, Math.sin(elapsed * tongueFreq));
    this.snakeHead.tonguePivot.scale.z = 0.2 + flick * 0.95;
    this.snakeHead.tonguePivot.rotation.x = Math.sin(elapsed * 22) * 0.12 * flick;

    // Body Segments via InstancedMesh
    const bodyCount = Math.max(0, count - 1);
    this.dorsalInst.count = bodyCount;
    this.bellyInst.count = bodyCount;
    this.segShadowInst.count = bodyCount;

    for (let i = 1; i < count; i++) {
      const curr = this.snake[i];
      const prev = this.prevSnake[i] || curr;
      const segJump =
        Math.abs(curr.x - prev.x) > 1.5 || Math.abs(curr.z - prev.z) > 1.5;
      const t = segJump ? 1.0 : alpha;

      const sx = THREE.MathUtils.lerp(prev.x, curr.x, t);
      const sz = THREE.MathUtils.lerp(prev.z, curr.z, t);
      gridToWorld(sx, sz, _vec3A);

      // Compute forward tangent toward previous segment (closer to head)
      const ahead = this.snake[i - 1];
      const aheadPrev = this.prevSnake[i - 1] || ahead;
      const aheadJump =
        Math.abs(ahead.x - aheadPrev.x) > 1.5 || Math.abs(ahead.z - aheadPrev.z) > 1.5;
      const tAhead = aheadJump ? 1.0 : alpha;
      const ax = THREE.MathUtils.lerp(aheadPrev.x, ahead.x, tAhead);
      const az = THREE.MathUtils.lerp(aheadPrev.z, ahead.z, tAhead);
      gridToWorld(ax, az, _vec3B);

      let dirX = _vec3B.x - _vec3A.x;
      let dirZ = _vec3B.z - _vec3A.z;
      if (Math.hypot(dirX, dirZ) > 2.5 || Math.hypot(dirX, dirZ) < 0.001) {
        dirX = dx;
        dirZ = dz;
      }
      const segAngle = Math.atan2(dirX, dirZ);

      // Taper smoothly toward the tail
      const progress = i / Math.max(1, count - 1);
      const taper = 1.0 - progress * 0.42;
      const waveY = Math.sin(elapsed * 7.5 - i * 0.65) * 0.025 * taper;
      const lateralWiggle = Math.sin(elapsed * 6.0 - i * 0.8) * 0.04 * taper;

      // Apply slight perpendicular slither offset
      const perpX = Math.cos(segAngle) * lateralWiggle;
      const perpZ = -Math.sin(segAngle) * lateralWiggle;

      // Dorsal armored vertebra
      _euler.set(0, segAngle, 0);
      _quat.setFromEuler(_euler);
      _vec3Scale.set(taper, taper, taper);
      _vec3B.set(_vec3A.x + perpX, 0.36 * taper + waveY, _vec3A.z + perpZ);
      _mat4.compose(_vec3B, _quat, _vec3Scale);
      this.dorsalInst.setMatrixAt(i - 1, _mat4);

      // Alternating scale band tint
      const isBand = i % 2 === 0;
      _color.setHex(isBand ? palette.primaryHex : palette.secondaryHex);
      this.dorsalInst.setColorAt(i - 1, _color);

      // Ventral belly plate
      _vec3B.set(_vec3A.x + perpX, 0.12 * taper, _vec3A.z + perpZ);
      _vec3Scale.set(taper * 0.92, taper, taper * 0.92);
      _mat4.compose(_vec3B, _quat, _vec3Scale);
      this.bellyInst.setMatrixAt(i - 1, _mat4);

      // Grounded contact shadow
      _vec3B.set(_vec3A.x + perpX, 0.014, _vec3A.z + perpZ);
      _quat.identity();
      _vec3Scale.set(taper, 1, taper);
      _mat4.compose(_vec3B, _quat, _vec3Scale);
      this.segShadowInst.setMatrixAt(i - 1, _mat4);
    }

    this.dorsalInst.instanceMatrix.needsUpdate = true;
    if (this.dorsalInst.instanceColor) this.dorsalInst.instanceColor.needsUpdate = true;
    this.bellyInst.instanceMatrix.needsUpdate = true;
    this.segShadowInst.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(delta: number) {
    const headPos = this.snakeHead.group.position;
    const { dx, dz } = dirToDelta(this.dir);

    if (this.phase === 'idle') {
      const orbitAngle = this.elapsed * 0.18;
      this.camPosGoal.set(
        Math.sin(orbitAngle) * 19.5,
        15.5,
        Math.cos(orbitAngle) * 19.5,
      );
      this.camTargetGoal.set(0, 0, 0);
    } else if (this.cameraPreset === 'top') {
      this.camPosGoal.set(0, 26.0, 2.4);
      this.camTargetGoal.set(0, 0, 0);
    } else if (this.cameraPreset === 'chase') {
      const backX = -Math.sin(this.currentHeadAngle);
      const backZ = -Math.cos(this.currentHeadAngle);
      this.camPosGoal.set(
        headPos.x + backX * 5.8,
        4.6,
        headPos.z + backZ * 5.8,
      );
      this.camTargetGoal.set(
        headPos.x + dx * 3.4,
        0.55,
        headPos.z + dz * 3.4,
      );
    } else {
      // Tactical Isometric 3D View with subtle head tracking
      this.camPosGoal.set(headPos.x * 0.16, 19.5, 16.8 + headPos.z * 0.1);
      this.camTargetGoal.set(headPos.x * 0.12, 0, 0.6 + headPos.z * 0.1);
    }

    const lambda = this.cameraPreset === 'chase' ? 6.5 : 5.0;
    this.camPosCurrent.x = THREE.MathUtils.damp(this.camPosCurrent.x, this.camPosGoal.x, lambda, delta);
    this.camPosCurrent.y = THREE.MathUtils.damp(this.camPosCurrent.y, this.camPosGoal.y, lambda, delta);
    this.camPosCurrent.z = THREE.MathUtils.damp(this.camPosCurrent.z, this.camPosGoal.z, lambda, delta);

    this.camTargetCurrent.x = THREE.MathUtils.damp(
      this.camTargetCurrent.x,
      this.camTargetGoal.x,
      lambda,
      delta,
    );
    this.camTargetCurrent.y = THREE.MathUtils.damp(
      this.camTargetCurrent.y,
      this.camTargetGoal.y,
      lambda,
      delta,
    );
    this.camTargetCurrent.z = THREE.MathUtils.damp(
      this.camTargetCurrent.z,
      this.camTargetGoal.z,
      lambda,
      delta,
    );

    // Subtle impact shake on collision
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.005) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity = THREE.MathUtils.damp(this.shakeIntensity, 0, 10, delta);
    }

    this.camera.position.set(
      this.camPosCurrent.x + shakeX,
      this.camPosCurrent.y + shakeY,
      this.camPosCurrent.z,
    );
    this.camera.lookAt(this.camTargetCurrent);

    // Dynamic subtle FOV boost in chase cam or high combo
    const targetFov = this.cameraPreset === 'chase' ? 54 + Math.min(this.combo, 6) * 0.8 : 46;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 5, delta);
      this.camera.updateProjectionMatrix();
    }
  }

  private updateParticles(delta: number) {
    let anyUpdated = false;
    for (let i = 0; i < BURST_PARTICLE_COUNT; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyUpdated = true;
      p.life += delta;
      if (p.life >= p.maxLife) {
        p.active = false;
        _mat4.makeScale(0, 0, 0);
        this.burstInst.setMatrixAt(i, _mat4);
        continue;
      }
      p.vy -= 12.5 * delta;
      p.x += p.vx * delta;
      p.y = Math.max(0.05, p.y + p.vy * delta);
      p.z += p.vz * delta;

      const s = 1.0 - p.life / p.maxLife;
      _vec3A.set(p.x, p.y, p.z);
      _euler.set(p.life * 6, p.life * 8, 0);
      _quat.setFromEuler(_euler);
      _vec3Scale.setScalar(s);
      _mat4.compose(_vec3A, _quat, _vec3Scale);
      this.burstInst.setMatrixAt(i, _mat4);
      this.burstInst.setColorAt(i, _color.setHex(p.colorHex));
    }

    if (anyUpdated) {
      this.burstInst.instanceMatrix.needsUpdate = true;
      if (this.burstInst.instanceColor) this.burstInst.instanceColor.needsUpdate = true;
    }
  }

  private updateCollectibles(elapsed: number, delta: number) {
    // Apple gentle bob & spin
    this.appleRig.coreGroup.position.y = 0.08 + Math.sin(elapsed * 3.2) * 0.07;
    this.appleRig.coreGroup.rotation.y = elapsed * 1.4;

    if (this.bonusCoord && this.phase === 'playing') {
      this.bonusTimer -= delta;
      if (this.bonusTimer <= 0) {
        this.bonusCoord = null;
        this.bonusTimer = 0;
        this.starfruitRig.group.visible = false;
        this.emitHud();
      } else {
        this.starfruitRig.coreGroup.position.y = 0.1 + Math.sin(elapsed * 4.5) * 0.09;
        this.starfruitRig.coreGroup.rotation.y = -elapsed * 2.2;
        if (this.starfruitRig.orbitRing) {
          this.starfruitRig.orbitRing.rotation.z = elapsed * 3.5;
        }
      }
    }
  }

  private emitHud() {
    this.callbacks.onHudUpdate({
      phase: this.phase,
      score: this.score,
      highScore: this.highScore,
      length: this.snake.length,
      combo: this.combo,
      bonusActive: this.bonusCoord !== null,
      bonusTimeLeft: this.bonusCoord ? Math.max(0, this.bonusTimer / BONUS_DURATION) : 0,
      deathReason: this.deathReason,
      mode: this.mode,
      cameraPreset: this.cameraPreset,
      speedPreset: this.speedPreset,
      skinId: this.skinId,
    });
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) {
        if (sync) gl.deleteSync(sync);
        return;
      }
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;

    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1);
    this.elapsed += delta;

    if (!this.contextLost) {
      if (this.phase === 'playing') {
        this.stepAccumulator += delta;
        const interval = this.stepInterval;
        while (this.stepAccumulator >= interval && this.phase === 'playing') {
          this.stepAccumulator -= interval;
          this.stepSimulation();
        }
        if (this.combo > 1) {
          this.comboDecayTimer -= delta;
          if (this.comboDecayTimer <= 0) {
            this.combo = 1;
            this.emitHud();
          }
        }
        if (this.bonusCoord) {
          // Keep HUD timer bar smooth without excessive React re-renders: ~12fps when bonus active
          if (Math.floor(this.elapsed * 12) !== Math.floor((this.elapsed - delta) * 12)) {
            this.emitHud();
          }
        }
      } else if (this.phase === 'idle') {
        const idleInterval = 0.18;
        this.stepAccumulator += delta;
        if (this.stepAccumulator >= idleInterval) {
          this.stepAccumulator -= idleInterval;
          this.stepSimulation();
        }
      }

      const activeInterval = this.phase === 'idle' ? 0.18 : this.stepInterval;
      const interpAlpha =
        this.phase === 'paused' || this.phase === 'gameover'
          ? 1.0
          : THREE.MathUtils.clamp(this.stepAccumulator / activeInterval, 0, 1);

      this.syncSegmentVisuals(interpAlpha, this.elapsed);
      this.updateCollectibles(this.elapsed, delta);
      this.updateParticles(delta);
      this.arena.update(this.elapsed);
      this.updateCamera(delta);

      this.renderer.render(this.scene, this.camera);
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private startLoop() {
    this.clock.start();
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    canvas.removeEventListener('touchstart', this.handleTouchStart);
    canvas.removeEventListener('touchend', this.handleTouchEnd);

    this.clearObstacles();
    this.disposables.forEach((d) => d.dispose());
    this.renderer.dispose();

    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
