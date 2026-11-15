export type GamePhase = 'idle' | 'playing' | 'paused' | 'gameover';

export type GameMode = 'classic' | 'portal' | 'obstacles';

export type CameraPreset = 'isometric' | 'top' | 'chase';

export type SpeedPreset = 'slow' | 'normal' | 'fast';

export type SnakeSkinId = 'jade' | 'amber' | 'cobalt';

export type GridDirection = 'up' | 'down' | 'left' | 'right';

export interface GridCoord {
  x: number;
  z: number;
}

export interface SkinPalette {
  id: SnakeSkinId;
  label: string;
  swatchHex: string;
  primaryHex: number;
  secondaryHex: number;
  bellyHex: number;
  eyeHex: number;
  crestHex: number;
}

export const SNAKE_SKINS: Record<SnakeSkinId, SkinPalette> = {
  jade: {
    id: 'jade',
    label: 'Ngọc Lục Bảo',
    swatchHex: '#10b981',
    primaryHex: 0x0f8f63,
    secondaryHex: 0x074d37,
    bellyHex: 0xcbe8d7,
    eyeHex: 0xf59e0b,
    crestHex: 0x34d399,
  },
  amber: {
    id: 'amber',
    label: 'Hổ Phách Đỏ',
    swatchHex: '#f59e0b',
    primaryHex: 0xd94826,
    secondaryHex: 0x6e1f10,
    bellyHex: 0xf6dfc2,
    eyeHex: 0x38bdf8,
    crestHex: 0xfbbf24,
  },
  cobalt: {
    id: 'cobalt',
    label: 'Lam Bạch Kim',
    swatchHex: '#38bdf8',
    primaryHex: 0x1e6bb8,
    secondaryHex: 0x102f57,
    bellyHex: 0xd9e8f5,
    eyeHex: 0xf43f5e,
    crestHex: 0x67e8f9,
  },
};

export interface GameHudState {
  phase: GamePhase;
  score: number;
  highScore: number;
  length: number;
  combo: number;
  bonusActive: boolean;
  bonusTimeLeft: number; // 0..1 normalized
  deathReason: string | null;
  mode: GameMode;
  cameraPreset: CameraPreset;
  speedPreset: SpeedPreset;
  skinId: SnakeSkinId;
}

export const GRID_SIZE = 20;
export const CELL_SIZE = 1.0;

export const SPEED_BASE_INTERVAL: Record<SpeedPreset, number> = {
  slow: 0.175,
  normal: 0.132,
  fast: 0.095,
};
