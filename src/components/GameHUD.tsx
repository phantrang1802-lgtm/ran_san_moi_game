import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import {
  CameraPreset,
  GameHudState,
  GameMode,
  GridDirection,
  SNAKE_SKINS,
  SnakeSkinId,
  SpeedPreset,
} from '../game/types';

interface GameHUDProps {
  hud: GameHudState;
  muted: boolean;
  onStart: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onChangeMode: (mode: GameMode) => void;
  onChangeCamera: (preset: CameraPreset) => void;
  onChangeSpeed: (speed: SpeedPreset) => void;
  onChangeSkin: (skin: SnakeSkinId) => void;
  onSteer: (dir: GridDirection) => void;
}

const MODE_OPTIONS: Array<{ id: GameMode; label: string }> = [
  { id: 'classic', label: 'Cổ điển' },
  { id: 'portal', label: 'Xuyên tường' },
  { id: 'obstacles', label: 'Chướng ngại' },
];

const CAMERA_OPTIONS: Array<{ id: CameraPreset; label: string }> = [
  { id: 'isometric', label: 'Góc 3D' },
  { id: 'top', label: 'Từ trên' },
  { id: 'chase', label: 'Theo rắn' },
];

const SPEED_OPTIONS: Array<{ id: SpeedPreset; label: string }> = [
  { id: 'slow', label: 'Chậm' },
  { id: 'normal', label: 'Chuẩn' },
  { id: 'fast', label: 'Nhanh' },
];

const SKIN_LIST = Object.values(SNAKE_SKINS);

export const GameHUD: React.FC<GameHUDProps> = ({
  hud,
  muted,
  onStart,
  onTogglePause,
  onToggleMute,
  onChangeMode,
  onChangeCamera,
  onChangeSpeed,
  onChangeSkin,
  onSteer,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyH') {
        setDockCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between">
      {/* Top Bar: Minimal Single-Row Header */}
      <header className="pointer-events-auto mx-auto mt-3 flex w-[min(1120px,94vw)] items-center justify-between gap-4 rounded-xl border border-white/12 bg-[#0c131d]/90 px-4 py-2.5 shadow-lg">
        {/* Zone 1: Single-line Brand Wordmark */}
        <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0 sm:text-lg">
          Rắn Săn Mồi 3D
        </span>

        {/* Zone 2: Clean Unboxed Tabular Metrics */}
        <div className="flex items-center gap-3 text-xs text-slate-400 sm:gap-4 sm:text-sm">
          <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
            <span>Điểm</span>
            <span className="font-mono-num text-base font-bold text-emerald-400 sm:text-lg">
              {hud.score}
            </span>
          </div>

          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>

          <div className="flex items-baseline gap-1.5 whitespace-nowrap shrink-0">
            <span>Kỷ lục</span>
            <span className="font-mono-num font-semibold text-slate-100">
              {hud.highScore}
            </span>
          </div>

          <span aria-hidden="true" className="hidden text-slate-600 sm:inline">
            ·
          </span>

          <div className="hidden items-baseline gap-1.5 whitespace-nowrap shrink-0 sm:flex">
            <span>Độ dài</span>
            <span className="font-mono-num font-semibold text-slate-100">
              {hud.length}
            </span>
          </div>

          {hud.combo > 1 && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="font-mono-num font-bold text-amber-400 whitespace-nowrap shrink-0">
                Chuỗi x{hud.combo}
              </span>
            </>
          )}
        </div>

        {/* Zone 3: Functional Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {(hud.phase === 'playing' || hud.phase === 'paused') && (
            <button
              type="button"
              onClick={onTogglePause}
              aria-label={hud.phase === 'paused' ? 'Tiếp tục chơi' : 'Tạm dừng'}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-slate-800/80 px-3 text-xs font-medium text-slate-100 transition-colors hover:bg-slate-700/80 focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {hud.phase === 'paused' ? <Play size={14} /> : <Pause size={14} />}
              <span className="hidden sm:inline">
                {hud.phase === 'paused' ? 'Tiếp tục' : 'Tạm dừng'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 bg-slate-800/80 text-slate-200 transition-colors hover:bg-slate-700/80 focus-visible:outline-2 focus-visible:outline-emerald-400 shrink-0 cursor-pointer"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </header>

      {/* Active Starfruit Bonus Countdown Bar (Non-obstructive thin strip under top bar) */}
      {hud.bonusActive && hud.phase === 'playing' && (
        <div className="mx-auto mt-2 flex w-[min(320px,80vw)] flex-col items-center gap-1">
          <div className="flex w-full items-center justify-between text-xs font-medium text-teal-300">
            <span>Khế Ngọc Thưởng (+{35 * hud.combo})</span>
            <span className="font-mono-num">{Math.ceil(hud.bonusTimeLeft * 9)}s</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/90">
            <div
              className="h-full bg-teal-400 transition-transform duration-100 origin-left"
              style={{ transform: `scaleX(${hud.bonusTimeLeft})` }}
            />
          </div>
        </div>
      )}

      {/* Center Overlay Modal for Start / Pause / Game Over */}
      {hud.phase !== 'playing' && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-white/14 bg-[#0c131d]/92 p-6 text-center shadow-2xl">
            {hud.phase === 'idle' && (
              <>
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                  Rắn Săn Mồi 3D
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Điều khiển linh xà thu thập trái táo vàng và khế ngọc trên sân đá cổ. Chọn góc nhìn và chế độ bên dưới trước khi bắt đầu.
                </p>
                <div className="mt-5 flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={onStart}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-emerald-300 whitespace-nowrap cursor-pointer"
                  >
                    <Play size={16} />
                    <span>Bắt đầu chơi</span>
                  </button>
                </div>
                <p className="mt-4 text-xs text-slate-400">
                  {hud.cameraPreset === 'chase'
                    ? 'A / D hoặc Trái / Phải để rẽ · Space tạm dừng · H ẩn bảng điều khiển'
                    : 'WASD hoặc Phím mũi tên để di chuyển · Space tạm dừng · H ẩn bảng'}
                </p>
              </>
            )}

            {hud.phase === 'paused' && (
              <>
                <h2 className="font-display text-2xl font-bold text-slate-100">
                  Đang tạm dừng
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  Điểm hiện tại <span className="font-mono-num font-bold text-emerald-400">{hud.score}</span> · Độ dài{' '}
                  <span className="font-mono-num font-semibold text-slate-100">{hud.length}</span>
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onTogglePause}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 whitespace-nowrap cursor-pointer"
                  >
                    <Play size={16} />
                    <span>Tiếp tục</span>
                  </button>
                  <button
                    type="button"
                    onClick={onStart}
                    className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/14 bg-slate-800 px-4 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap cursor-pointer"
                  >
                    <RotateCcw size={15} />
                    <span>Chơi lại</span>
                  </button>
                </div>
              </>
            )}

            {hud.phase === 'gameover' && (
              <>
                <h2 className="font-display text-2xl font-bold text-rose-400">
                  Kết thúc lượt chơi
                </h2>
                {hud.deathReason && (
                  <p className="mt-1.5 text-sm text-slate-300">{hud.deathReason}</p>
                )}

                <div className="mt-5 grid grid-cols-3 divide-x divide-white/10 rounded-xl border border-white/10 bg-slate-900/75 py-3">
                  <div className="px-2">
                    <div className="text-xs text-slate-400">Điểm</div>
                    <div className="font-mono-num mt-0.5 text-xl font-bold text-emerald-400">
                      {hud.score}
                    </div>
                  </div>
                  <div className="px-2">
                    <div className="text-xs text-slate-400">Kỷ lục</div>
                    <div className="font-mono-num mt-0.5 text-xl font-bold text-amber-400">
                      {hud.highScore}
                    </div>
                  </div>
                  <div className="px-2">
                    <div className="text-xs text-slate-400">Độ dài</div>
                    <div className="font-mono-num mt-0.5 text-xl font-bold text-slate-100">
                      {hud.length}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onStart}
                  className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-emerald-300 whitespace-nowrap cursor-pointer"
                >
                  <RotateCcw size={16} />
                  <span>Chơi lại</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile Touch D-Pad (shown only on small screens during active play) */}
      {hud.phase === 'playing' && (
        <div className="pointer-events-auto fixed right-4 bottom-24 z-20 grid grid-cols-3 gap-1.5 md:hidden">
          {hud.cameraPreset !== 'chase' ? (
            <>
              <div />
              <button
                type="button"
                aria-label="Đi lên"
                onClick={() => onSteer('up')}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/14 bg-[#0c131d]/90 text-slate-100 active:bg-emerald-500 active:text-slate-950"
              >
                <ArrowUp size={20} />
              </button>
              <div />
              <button
                type="button"
                aria-label="Sang trái"
                onClick={() => onSteer('left')}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/14 bg-[#0c131d]/90 text-slate-100 active:bg-emerald-500 active:text-slate-950"
              >
                <ArrowLeft size={20} />
              </button>
              <button
                type="button"
                aria-label="Đi xuống"
                onClick={() => onSteer('down')}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/14 bg-[#0c131d]/90 text-slate-100 active:bg-emerald-500 active:text-slate-950"
              >
                <ArrowDown size={20} />
              </button>
              <button
                type="button"
                aria-label="Sang phải"
                onClick={() => onSteer('right')}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/14 bg-[#0c131d]/90 text-slate-100 active:bg-emerald-500 active:text-slate-950"
              >
                <ArrowRight size={20} />
              </button>
            </>
          ) : (
            <div className="col-span-3 flex gap-2">
              <button
                type="button"
                aria-label="Rẽ trái"
                onClick={() => onSteer('left')}
                className="flex h-12 w-14 items-center justify-center rounded-xl border border-white/14 bg-[#0c131d]/90 text-slate-100 active:bg-emerald-500 active:text-slate-950"
              >
                <ArrowLeft size={22} />
              </button>
              <button
                type="button"
                aria-label="Rẽ phải"
                onClick={() => onSteer('right')}
                className="flex h-12 w-14 items-center justify-center rounded-xl border border-white/14 bg-[#0c131d]/90 text-slate-100 active:bg-emerald-500 active:text-slate-950"
              >
                <ArrowRight size={22} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Unified Bottom Control Dock */}
      <div
        className="pointer-events-none fixed bottom-5 left-1/2 z-20 flex w-[min(920px,94vw)] -translate-x-1/2 flex-col items-center transition-transform duration-300 ease-out"
        style={{
          transform: dockCollapsed
            ? 'translateY(calc(100% - 14px))'
            : 'translateY(0)',
        }}
      >
        {/* Collapse / Expand Handle */}
        <button
          type="button"
          onClick={() => setDockCollapsed((prev) => !prev)}
          className="pointer-events-auto flex items-center gap-1.5 rounded-t-lg border border-b-0 border-white/12 bg-[#0c131d]/92 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-emerald-400 whitespace-nowrap cursor-pointer"
        >
          {dockCollapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          <span>{dockCollapsed ? 'Hiện bảng điều khiển' : 'Ẩn điều khiển'}</span>
        </button>

        {/* Horizontal Dock Panel */}
        <div className="pointer-events-auto flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2.5 rounded-xl border border-white/12 bg-[#0c131d]/92 px-4 py-2.5 shadow-2xl">
          {/* Mode Segmented Control */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-400 whitespace-nowrap">Chế độ</span>
            <div className="flex items-center gap-1 rounded-lg bg-slate-900/90 p-1">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeMode(opt.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    hud.mode === opt.id
                      ? 'bg-emerald-500 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Camera Segmented Control */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-400 whitespace-nowrap">Góc nhìn</span>
            <div className="flex items-center gap-1 rounded-lg bg-slate-900/90 p-1">
              {CAMERA_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeCamera(opt.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    hud.cameraPreset === opt.id
                      ? 'bg-sky-400 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Speed Segmented Control */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-slate-400 whitespace-nowrap">Tốc độ</span>
            <div className="flex items-center gap-1 rounded-lg bg-slate-900/90 p-1">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onChangeSpeed(opt.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    hud.speedPreset === opt.id
                      ? 'bg-amber-400 text-slate-950 font-semibold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Snake Skin Swatches */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-400 whitespace-nowrap">Màu vảy</span>
            <div className="flex items-center gap-1.5">
              {SKIN_LIST.map((skin) => (
                <button
                  key={skin.id}
                  type="button"
                  title={skin.label}
                  aria-label={skin.label}
                  onClick={() => onChangeSkin(skin.id)}
                  className={`h-6 w-6 rounded-full border-2 transition-transform cursor-pointer ${
                    hud.skinId === skin.id
                      ? 'scale-110 border-white'
                      : 'border-white/25 hover:scale-105'
                  }`}
                  style={{ backgroundColor: skin.swatchHex }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
