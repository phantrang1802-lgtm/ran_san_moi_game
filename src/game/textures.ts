import * as THREE from 'three';
import { GRID_SIZE } from './types';

export interface ProceduralTextureSet {
  boardAlbedo: THREE.CanvasTexture;
  boardBump: THREE.CanvasTexture;
  scaleAlbedo: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  glowSprite: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextureSet {
  const anisotropy = Math.max(1, Math.min(maxAnisotropy, 16));

  // 1. Stone Board Albedo Texture (1024x1024 for razor-sharp 20x20 tiles)
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 1024;
  boardCanvas.height = 1024;
  const bCtx = boardCanvas.getContext('2d')!;

  const tilePx = boardCanvas.width / GRID_SIZE;
  bCtx.fillStyle = '#131d29';
  bCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

  for (let gx = 0; gx < GRID_SIZE; gx++) {
    for (let gz = 0; gz < GRID_SIZE; gz++) {
      const isAlt = (gx + gz) % 2 === 0;
      const x = gx * tilePx;
      const y = gz * tilePx;

      // Subtle dark slate alternating tones
      bCtx.fillStyle = isAlt ? '#172331' : '#121c27';
      bCtx.fillRect(x + 1.5, y + 1.5, tilePx - 3, tilePx - 3);

      // Subtle inner chamfer highlight on top-left edge
      bCtx.strokeStyle = isAlt ? 'rgba(130, 180, 210, 0.08)' : 'rgba(110, 160, 195, 0.05)';
      bCtx.lineWidth = 1.5;
      bCtx.strokeRect(x + 3, y + 3, tilePx - 6, tilePx - 6);

      // Fine carved corner dot on every 4th intersection for spatial orientation
      if (gx % 4 === 0 && gz % 4 === 0 && gx > 0 && gz > 0) {
        bCtx.fillStyle = 'rgba(52, 211, 153, 0.28)';
        bCtx.beginPath();
        bCtx.arc(x, y, 2.5, 0, Math.PI * 2);
        bCtx.fill();
      }
    }
  }

  // Subtle stone grain speckles
  for (let i = 0; i < 3200; i++) {
    const sx = Math.random() * boardCanvas.width;
    const sy = Math.random() * boardCanvas.height;
    const alpha = Math.random() * 0.045;
    bCtx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    bCtx.fillRect(sx, sy, 2, 2);
  }

  // Subtle jade inlay framing border around playable perimeter
  bCtx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
  bCtx.lineWidth = 3;
  bCtx.strokeRect(2, 2, boardCanvas.width - 4, boardCanvas.height - 4);

  const boardAlbedo = new THREE.CanvasTexture(boardCanvas);
  boardAlbedo.colorSpace = THREE.SRGBColorSpace;
  boardAlbedo.anisotropy = anisotropy;
  boardAlbedo.needsUpdate = true;

  // 2. Stone Board Bump Map (Linear space - NoColorSpace)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 1024;
  bumpCanvas.height = 1024;
  const mCtx = bumpCanvas.getContext('2d')!;
  mCtx.fillStyle = '#c8c8c8';
  mCtx.fillRect(0, 0, 1024, 1024);

  for (let gx = 0; gx < GRID_SIZE; gx++) {
    for (let gz = 0; gz < GRID_SIZE; gz++) {
      const x = gx * tilePx;
      const y = gz * tilePx;
      // Grout seams recessed
      mCtx.strokeStyle = '#383838';
      mCtx.lineWidth = 3;
      mCtx.strokeRect(x, y, tilePx, tilePx);
    }
  }
  const boardBump = new THREE.CanvasTexture(bumpCanvas);
  boardBump.anisotropy = anisotropy;
  boardBump.needsUpdate = true;

  // 3. Reptile Hex-Scale Texture for Snake Body (256x256)
  const scaleCanvas = document.createElement('canvas');
  scaleCanvas.width = 256;
  scaleCanvas.height = 256;
  const sCtx = scaleCanvas.getContext('2d')!;
  sCtx.fillStyle = '#d4d4d4';
  sCtx.fillRect(0, 0, 256, 256);

  const hexW = 32;
  const hexH = 28;
  for (let row = -1; row < 12; row++) {
    for (let col = -1; col < 10; col++) {
      const cx = col * hexW + (row % 2 === 0 ? 0 : hexW * 0.5);
      const cy = row * hexH;
      const grad = sCtx.createRadialGradient(cx, cy - 3, 2, cx, cy, 16);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.7, '#d8d8d8');
      grad.addColorStop(1, '#7a7a7a');

      sCtx.fillStyle = grad;
      sCtx.beginPath();
      sCtx.ellipse(cx, cy, 14, 12, 0, 0, Math.PI * 2);
      sCtx.fill();
    }
  }

  const scaleAlbedo = new THREE.CanvasTexture(scaleCanvas);
  scaleAlbedo.colorSpace = THREE.SRGBColorSpace;
  scaleAlbedo.wrapS = THREE.RepeatWrapping;
  scaleAlbedo.wrapT = THREE.RepeatWrapping;
  scaleAlbedo.repeat.set(2, 2);
  scaleAlbedo.anisotropy = anisotropy;
  scaleAlbedo.needsUpdate = true;

  // 4. Soft Radial Contact Shadow Texture (128x128)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const shCtx = shadowCanvas.getContext('2d')!;
  const shGrad = shCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
  shGrad.addColorStop(0, 'rgba(0, 0, 0, 0.75)');
  shGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.32)');
  shGrad.addColorStop(1, 'rgba(0, 0, 0, 0.0)');
  shCtx.fillStyle = shGrad;
  shCtx.fillRect(0, 0, 128, 128);

  const contactShadow = new THREE.CanvasTexture(shadowCanvas);
  contactShadow.colorSpace = THREE.SRGBColorSpace;
  contactShadow.needsUpdate = true;

  // 5. Soft Glow Sprite for Fireflies & Collectibles
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 128;
  glowCanvas.height = 128;
  const gCtx = glowCanvas.getContext('2d')!;
  const gGrad = gCtx.createRadialGradient(64, 64, 2, 64, 64, 62);
  gGrad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  gGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.55)');
  gGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  gCtx.fillStyle = gGrad;
  gCtx.fillRect(0, 0, 128, 128);

  const glowSprite = new THREE.CanvasTexture(glowCanvas);
  glowSprite.colorSpace = THREE.SRGBColorSpace;
  glowSprite.needsUpdate = true;

  return {
    boardAlbedo,
    boardBump,
    scaleAlbedo,
    contactShadow,
    glowSprite,
    dispose: () => {
      boardAlbedo.dispose();
      boardBump.dispose();
      scaleAlbedo.dispose();
      contactShadow.dispose();
      glowSprite.dispose();
    },
  };
}
