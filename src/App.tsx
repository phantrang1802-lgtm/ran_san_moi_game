/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GameHUD } from './components/GameHUD';
import { SnakeEngine } from './game/SnakeEngine';
import { soundEngine } from './game/sound';
import {
  CameraPreset,
  GameHudState,
  GameMode,
  GridDirection,
  SnakeSkinId,
  SpeedPreset,
} from './game/types';

const INITIAL_HUD: GameHudState = {
  phase: 'idle',
  score: 0,
  highScore: 0,
  length: 4,
  combo: 1,
  bonusActive: false,
  bonusTimeLeft: 0,
  deathReason: null,
  mode: 'classic',
  cameraPreset: 'isometric',
  speedPreset: 'normal',
  skinId: 'jade',
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<SnakeEngine | null>(null);

  const [hud, setHud] = useState<GameHudState>(INITIAL_HUD);
  const [muted, setMuted] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let engine: SnakeEngine | null = null;
    try {
      engine = new SnakeEngine(container, {
        onHudUpdate: (nextState) => {
          setHud(nextState);
        },
        onWebglError: (msg) => {
          setWebglError(msg);
        },
      });
      engineRef.current = engine;
    } catch {
      setWebglError('Không thể khởi tạo đồ họa 3D WebGL trên thiết bị này.');
    }

    return () => {
      if (engine) {
        engine.dispose();
      }
      engineRef.current = null;
      soundEngine.dispose();
    };
  }, []);

  const handleStart = useCallback(() => {
    engineRef.current?.startNewGame();
  }, []);

  const handleTogglePause = useCallback(() => {
    engineRef.current?.togglePause();
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundEngine.setMuted(next);
      return next;
    });
  }, []);

  const handleChangeMode = useCallback((mode: GameMode) => {
    engineRef.current?.setMode(mode);
  }, []);

  const handleChangeCamera = useCallback((preset: CameraPreset) => {
    engineRef.current?.setCameraPreset(preset);
  }, []);

  const handleChangeSpeed = useCallback((speed: SpeedPreset) => {
    engineRef.current?.setSpeedPreset(speed);
  }, []);

  const handleChangeSkin = useCallback((skin: SnakeSkinId) => {
    engineRef.current?.setSkin(skin);
  }, []);

  const handleSteer = useCallback((dir: GridDirection) => {
    engineRef.current?.steerInput(dir);
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0c141d]">
      {/* Isolated WebGL Canvas Mount */}
      <div
        ref={mountRef}
        className="h-full w-full"
        aria-label="Sân chơi Rắn Săn Mồi 3D"
      />

      {webglError ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#0c141d] p-6 text-center">
          <div className="max-w-md rounded-2xl border border-white/12 bg-slate-900/90 p-6">
            <h1 className="font-display text-xl font-bold text-slate-100">
              Không thể khởi tạo WebGL 3D
            </h1>
            <p className="mt-2 text-sm text-slate-300">{webglError}</p>
          </div>
        </div>
      ) : (
        <GameHUD
          hud={hud}
          muted={muted}
          onStart={handleStart}
          onTogglePause={handleTogglePause}
          onToggleMute={handleToggleMute}
          onChangeMode={handleChangeMode}
          onChangeCamera={handleChangeCamera}
          onChangeSpeed={handleChangeSpeed}
          onChangeSkin={handleChangeSkin}
          onSteer={handleSteer}
        />
      )}
    </main>
  );
}
