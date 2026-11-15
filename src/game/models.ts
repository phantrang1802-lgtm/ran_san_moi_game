import * as THREE from 'three';
import { ProceduralTextureSet } from './textures';
import { CELL_SIZE, GRID_SIZE, SkinPalette } from './types';

export interface SnakeHeadRig {
  group: THREE.Group;
  tonguePivot: THREE.Group;
  jawMesh: THREE.Mesh;
  primaryMat: THREE.MeshPhysicalMaterial;
  secondaryMat: THREE.MeshStandardMaterial;
  bellyMat: THREE.MeshStandardMaterial;
  eyeMat: THREE.MeshPhysicalMaterial;
  crestMat: THREE.MeshStandardMaterial;
  setSkin: (skin: SkinPalette) => void;
  dispose: () => void;
}

export interface CollectibleRig {
  group: THREE.Group;
  coreGroup: THREE.Group;
  orbitRing?: THREE.Mesh;
  dispose: () => void;
}

export interface ArenaEnvironmentRig {
  group: THREE.Group;
  lanternLights: THREE.Mesh[];
  fireflyPoints: THREE.Points;
  borderGlowMeshes: THREE.Mesh[];
  setModeBorderColor: (hex: number) => void;
  update: (elapsed: number) => void;
  dispose: () => void;
}

export function groundHeightAt(x: number, z: number): number {
  const halfBoard = (GRID_SIZE * CELL_SIZE) / 2 + 1.1;
  const distFromEdge = Math.max(Math.abs(x), Math.abs(z)) - halfBoard;
  if (distFromEdge <= 0) return -0.36;
  // Gentle rolling terraced garden outside the stone arena
  const wave =
    Math.sin(x * 0.14) * Math.cos(z * 0.14) * 0.55 +
    Math.sin(x * 0.06 + z * 0.05) * 0.45;
  const rise = Math.min(distFromEdge * 0.08, 1.8);
  return -0.65 + rise * 0.4 + wave * Math.min(distFromEdge * 0.12, 1.0);
}

export function createArenaEnvironment(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): ArenaEnvironmentRig {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const lanternLights: THREE.Mesh[] = [];
  const borderGlowMeshes: THREE.Mesh[] = [];

  const boardSpan = GRID_SIZE * CELL_SIZE; // 20
  const halfSpan = boardSpan / 2; // 10

  // 1. Expansive Outer Terraced Terrain (eliminates floating-box-in-void look)
  const terrainGeo = new THREE.PlaneGeometry(140, 140, 72, 72);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    posAttr.setY(i, groundHeightAt(vx, vz));
  }
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardMaterial({
    color: 0x16222c,
    roughness: 0.92,
    metalness: 0.04,
  });
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = !isSoftwareGl;
  group.add(terrainMesh);
  disposables.push(terrainGeo, terrainMat);

  // 2. Stepped Stone Arena Plinth (sits beneath the playable board)
  const plinthGeo = new THREE.BoxGeometry(boardSpan + 1.8, 0.52, boardSpan + 1.8);
  const plinthMat = new THREE.MeshStandardMaterial({
    color: 0x1e2b38,
    roughness: 0.78,
    metalness: 0.12,
  });
  const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
  plinthMesh.position.set(0, -0.27, 0);
  plinthMesh.receiveShadow = !isSoftwareGl;
  plinthMesh.castShadow = !isSoftwareGl;
  group.add(plinthMesh);
  disposables.push(plinthGeo, plinthMat);

  // 3. Playable Carved Stone Board Surface (y = 0)
  const boardGeo = new THREE.BoxGeometry(boardSpan, 0.14, boardSpan);
  const boardMat = new THREE.MeshStandardMaterial({
    map: textures.boardAlbedo,
    bumpMap: textures.boardBump,
    bumpScale: 0.015,
    roughness: 0.62,
    metalness: 0.14,
  });
  const boardMesh = new THREE.Mesh(boardGeo, boardMat);
  boardMesh.position.set(0, -0.07, 0);
  boardMesh.receiveShadow = !isSoftwareGl;
  group.add(boardMesh);
  disposables.push(boardGeo, boardMat);

  // 4. Sculpted Perimeter Stone Curbs + Recessed Energy Trim (4 sides)
  const curbMat = new THREE.MeshStandardMaterial({
    color: 0x263646,
    roughness: 0.68,
    metalness: 0.22,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x10b981,
    emissiveIntensity: 0.65,
    roughness: 0.3,
    metalness: 0.5,
  });
  disposables.push(curbMat, trimMat);

  const curbLen = boardSpan + 0.7;
  const curbGeoX = new THREE.BoxGeometry(curbLen, 0.28, 0.38);
  const curbGeoZ = new THREE.BoxGeometry(0.38, 0.28, curbLen);
  const trimGeoX = new THREE.BoxGeometry(boardSpan + 0.08, 0.06, 0.07);
  const trimGeoZ = new THREE.BoxGeometry(0.07, 0.06, boardSpan + 0.08);
  disposables.push(curbGeoX, curbGeoZ, trimGeoX, trimGeoZ);

  const offset = halfSpan + 0.2;
  const sides = [
    { pos: [0, 0.12, -offset], geo: curbGeoX, tPos: [0, 0.03, -halfSpan - 0.03], tGeo: trimGeoX },
    { pos: [0, 0.12, offset], geo: curbGeoX, tPos: [0, 0.03, halfSpan + 0.03], tGeo: trimGeoX },
    { pos: [-offset, 0.12, 0], geo: curbGeoZ, tPos: [-halfSpan - 0.03, 0.03, 0], tGeo: trimGeoZ },
    { pos: [offset, 0.12, 0], geo: curbGeoZ, tPos: [halfSpan + 0.03, 0.03, 0], tGeo: trimGeoZ },
  ];

  sides.forEach((s) => {
    const curb = new THREE.Mesh(s.geo, curbMat);
    curb.position.set(s.pos[0], s.pos[1], s.pos[2]);
    curb.castShadow = !isSoftwareGl;
    curb.receiveShadow = !isSoftwareGl;
    group.add(curb);

    const trim = new THREE.Mesh(s.tGeo, trimMat);
    trim.position.set(s.tPos[0], s.tPos[1], s.tPos[2]);
    group.add(trim);
    borderGlowMeshes.push(trim);
  });

  // 5. Four Multi-Part Corner Stone Lanterns (5-part composite THREE.Group each)
  const lanternBaseGeo = new THREE.BoxGeometry(0.9, 0.3, 0.9);
  const lanternShaftGeo = new THREE.CylinderGeometry(0.24, 0.3, 0.72, 6);
  const lanternCoreGeo = new THREE.OctahedronGeometry(0.24, 0);
  const lanternRoofGeo = new THREE.ConeGeometry(0.65, 0.42, 4);
  const lanternFinialGeo = new THREE.SphereGeometry(0.1, 12, 12);

  const lanternStoneMat = new THREE.MeshStandardMaterial({
    color: 0x334455,
    roughness: 0.72,
    metalness: 0.16,
  });
  const lanternRoofMat = new THREE.MeshStandardMaterial({
    color: 0x1e2a36,
    roughness: 0.38,
    metalness: 0.55,
  });
  const lanternGlowMat = new THREE.MeshStandardMaterial({
    color: 0xffd27d,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.35,
    roughness: 0.25,
    metalness: 0.1,
  });

  disposables.push(
    lanternBaseGeo,
    lanternShaftGeo,
    lanternCoreGeo,
    lanternRoofGeo,
    lanternFinialGeo,
    lanternStoneMat,
    lanternRoofMat,
    lanternGlowMat,
  );

  const cornerCoords = [
    [-halfSpan - 0.55, -halfSpan - 0.55],
    [halfSpan + 0.55, -halfSpan - 0.55],
    [-halfSpan - 0.55, halfSpan + 0.55],
    [halfSpan + 0.55, halfSpan + 0.55],
  ];

  cornerCoords.forEach(([cx, cz]) => {
    const lantern = new THREE.Group();
    lantern.position.set(cx, 0, cz);

    const base = new THREE.Mesh(lanternBaseGeo, lanternStoneMat);
    base.position.y = 0.15;
    base.castShadow = !isSoftwareGl;
    base.receiveShadow = !isSoftwareGl;

    const shaft = new THREE.Mesh(lanternShaftGeo, lanternStoneMat);
    shaft.position.y = 0.65;
    shaft.castShadow = !isSoftwareGl;

    const core = new THREE.Mesh(lanternCoreGeo, lanternGlowMat);
    core.position.y = 1.18;
    lanternLights.push(core);

    const roof = new THREE.Mesh(lanternRoofGeo, lanternRoofMat);
    roof.position.y = 1.56;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = !isSoftwareGl;

    const finial = new THREE.Mesh(lanternFinialGeo, lanternGlowMat);
    finial.position.y = 1.82;

    lantern.add(base, shaft, core, roof, finial);
    group.add(lantern);
  });

  // 6. Stylized Multi-Part Cypress / Pine Grove & Rock Outcrops Around Perimeter
  // Use InstancedMesh for repeated rocks and trees (> 20 items) with computeBoundingSphere()
  const rockGeo = new THREE.DodecahedronGeometry(0.85, 1);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x3b4958,
    roughness: 0.85,
    metalness: 0.08,
    flatShading: true,
  });
  const rockCount = 42;
  const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rockInst.castShadow = !isSoftwareGl;
  rockInst.receiveShadow = !isSoftwareGl;

  const dummy = new THREE.Object3D();
  const tintColor = new THREE.Color();

  for (let i = 0; i < rockCount; i++) {
    const angle = (i / rockCount) * Math.PI * 2 + (i % 3) * 0.12;
    const radius = 14.2 + (i % 5) * 3.1 + Math.sin(i * 2.7) * 1.6;
    const rx = Math.cos(angle) * radius;
    const rz = Math.sin(angle) * radius;
    const ry = groundHeightAt(rx, rz);

    const scaleBase = 0.65 + (i % 4) * 0.25;
    dummy.position.set(rx, ry + scaleBase * 0.35, rz);
    dummy.rotation.set((i % 7) * 0.3, angle * 1.7, (i % 5) * 0.2);
    dummy.scale.set(
      scaleBase * (0.9 + (i % 3) * 0.15),
      scaleBase * 0.65,
      scaleBase * (0.85 + ((i + 1) % 3) * 0.15),
    );
    dummy.updateMatrix();
    rockInst.setMatrixAt(i, dummy.matrix);

    const shade = 0.85 + (i % 5) * 0.07;
    tintColor.setRGB(shade * 0.9, shade * 0.95, shade * 1.02);
    rockInst.setColorAt(i, tintColor);
  }
  rockInst.instanceMatrix.needsUpdate = true;
  if (rockInst.instanceColor) rockInst.instanceColor.needsUpdate = true;
  rockInst.computeBoundingSphere();
  group.add(rockInst);
  disposables.push(rockGeo, rockMat);

  // Stylized multi-part pine/cypress trees (trunk + 2-tier foliage via InstancedMesh)
  const treeCount = 26;
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 1.6, 7);
  trunkGeo.translate(0, 0.8, 0); // bottom-center pivot
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x4b382c,
    roughness: 0.9,
    metalness: 0.02,
  });

  const foliageLowGeo = new THREE.ConeGeometry(1.15, 2.1, 7);
  foliageLowGeo.translate(0, 2.2, 0);
  const foliageTopGeo = new THREE.ConeGeometry(0.82, 1.85, 7);
  foliageTopGeo.translate(0, 3.3, 0);
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0x1e5c4a,
    roughness: 0.72,
    metalness: 0.04,
    flatShading: true,
  });

  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const foliageLowInst = new THREE.InstancedMesh(foliageLowGeo, foliageMat, treeCount);
  const foliageTopInst = new THREE.InstancedMesh(foliageTopGeo, foliageMat, treeCount);
  trunkInst.castShadow = !isSoftwareGl;
  foliageLowInst.castShadow = !isSoftwareGl;
  foliageTopInst.castShadow = !isSoftwareGl;
  foliageLowInst.receiveShadow = !isSoftwareGl;

  for (let i = 0; i < treeCount; i++) {
    const angle = (i / treeCount) * Math.PI * 2 + 0.18;
    const radius = 16.5 + (i % 4) * 3.8;
    const tx = Math.cos(angle) * radius;
    const tz = Math.sin(angle) * radius;
    const ty = groundHeightAt(tx, tz);
    const scale = 0.85 + ((i * 7) % 10) * 0.04; // +/-15% natural variation

    dummy.position.set(tx, ty - 0.1, tz);
    dummy.rotation.set(0, angle, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();

    trunkInst.setMatrixAt(i, dummy.matrix);
    foliageLowInst.setMatrixAt(i, dummy.matrix);
    foliageTopInst.setMatrixAt(i, dummy.matrix);

    const tint = 0.85 + (i % 4) * 0.1;
    tintColor.setRGB(tint * 0.88, tint * 1.05, tint * 0.95);
    foliageLowInst.setColorAt(i, tintColor);
    foliageTopInst.setColorAt(i, tintColor);
  }
  trunkInst.instanceMatrix.needsUpdate = true;
  foliageLowInst.instanceMatrix.needsUpdate = true;
  foliageTopInst.instanceMatrix.needsUpdate = true;
  if (foliageLowInst.instanceColor) foliageLowInst.instanceColor.needsUpdate = true;
  if (foliageTopInst.instanceColor) foliageTopInst.instanceColor.needsUpdate = true;
  trunkInst.computeBoundingSphere();
  foliageLowInst.computeBoundingSphere();
  foliageTopInst.computeBoundingSphere();

  group.add(trunkInst, foliageLowInst, foliageTopInst);
  disposables.push(trunkGeo, trunkMat, foliageLowGeo, foliageTopGeo, foliageMat);

  // 7. Ambient Garden Fireflies (Points with custom radial glow texture)
  const fireflyCount = 48;
  const fireflyPos = new Float32Array(fireflyCount * 3);
  const fireflyBase = new Float32Array(fireflyCount * 3);
  for (let i = 0; i < fireflyCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 11.5 + Math.random() * 14;
    const fx = Math.cos(angle) * r;
    const fz = Math.sin(angle) * r;
    const fy = 0.8 + Math.random() * 3.4;
    fireflyPos[i * 3] = fx;
    fireflyPos[i * 3 + 1] = fy;
    fireflyPos[i * 3 + 2] = fz;
    fireflyBase[i * 3] = fx;
    fireflyBase[i * 3 + 1] = fy;
    fireflyBase[i * 3 + 2] = fz;
  }
  const fireflyGeo = new THREE.BufferGeometry();
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
  const fireflyMat = new THREE.PointsMaterial({
    size: 0.42,
    map: textures.glowSprite,
    color: 0x99f6e4,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fireflyPoints = new THREE.Points(fireflyGeo, fireflyMat);
  group.add(fireflyPoints);
  disposables.push(fireflyGeo, fireflyMat);

  return {
    group,
    lanternLights,
    fireflyPoints,
    borderGlowMeshes,
    setModeBorderColor: (hex: number) => {
      trimMat.color.setHex(hex);
      trimMat.emissive.setHex(hex);
    },
    update: (elapsed: number) => {
      for (let i = 0; i < lanternLights.length; i++) {
        lanternLights[i].rotation.y = elapsed * 0.9 + i;
      }
      const attr = fireflyGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < fireflyCount; i++) {
        const bx = fireflyBase[i * 3];
        const by = fireflyBase[i * 3 + 1];
        const bz = fireflyBase[i * 3 + 2];
        attr.setXYZ(
          i,
          bx + Math.sin(elapsed * 0.7 + i) * 0.45,
          by + Math.sin(elapsed * 1.15 + i * 1.7) * 0.35,
          bz + Math.cos(elapsed * 0.65 + i * 0.9) * 0.45,
        );
      }
      attr.needsUpdate = true;
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/**
 * 6-part Composite Procedural Snake Head (+Z forward)
 */
export function createSnakeHead(
  skin: SkinPalette,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): SnakeHeadRig {
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];

  const primaryMat = new THREE.MeshPhysicalMaterial({
    color: skin.primaryHex,
    map: textures.scaleAlbedo,
    roughness: 0.24,
    metalness: 0.32,
    clearcoat: 0.85,
    clearcoatRoughness: 0.18,
  });
  const secondaryMat = new THREE.MeshStandardMaterial({
    color: skin.secondaryHex,
    roughness: 0.58,
    metalness: 0.14,
  });
  const bellyMat = new THREE.MeshStandardMaterial({
    color: skin.bellyHex,
    roughness: 0.72,
    metalness: 0.05,
  });
  const eyeMat = new THREE.MeshPhysicalMaterial({
    color: skin.eyeHex,
    emissive: skin.eyeHex,
    emissiveIntensity: 0.55,
    roughness: 0.12,
    metalness: 0.1,
    clearcoat: 1.0,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x05080c,
    roughness: 0.2,
    metalness: 0.1,
  });
  const crestMat = new THREE.MeshStandardMaterial({
    color: skin.crestHex,
    roughness: 0.32,
    metalness: 0.52,
  });
  const tongueMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0x9f1239,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.05,
  });

  disposables.push(
    primaryMat,
    secondaryMat,
    bellyMat,
    eyeMat,
    pupilMat,
    crestMat,
    tongueMat,
  );

  // 1. Primary Silhouette: Sculpted Extruded Cranium & Snout
  const headShape = new THREE.Shape();
  headShape.moveTo(0, 0.5); // Snout tip (+Z after rotation)
  headShape.quadraticCurveTo(0.4, 0.42, 0.44, -0.05);
  headShape.quadraticCurveTo(0.42, -0.42, 0.22, -0.46);
  headShape.lineTo(-0.22, -0.46);
  headShape.quadraticCurveTo(-0.42, -0.42, -0.44, -0.05);
  headShape.quadraticCurveTo(-0.4, 0.42, 0, 0.5);

  const craniumGeo = new THREE.ExtrudeGeometry(headShape, {
    depth: 0.32,
    bevelEnabled: true,
    bevelThickness: 0.11,
    bevelSize: 0.08,
    bevelSegments: 3,
    curveSegments: 12,
  });
  // Orient shape so Z in 2D shape becomes +Z forward in 3D, extrusion depth along +Y
  craniumGeo.rotateX(-Math.PI / 2);
  craniumGeo.translate(0, 0.22, 0);
  const craniumMesh = new THREE.Mesh(craniumGeo, primaryMat);
  craniumMesh.castShadow = !isSoftwareGl;
  craniumMesh.receiveShadow = !isSoftwareGl;
  group.add(craniumMesh);
  disposables.push(craniumGeo);

  // 2. Secondary Silhouette: Lower Jaw / Chin Plate
  const jawGeo = new THREE.BoxGeometry(0.54, 0.14, 0.72);
  const jawMesh = new THREE.Mesh(jawGeo, bellyMat);
  jawMesh.position.set(0, 0.14, 0.04);
  jawMesh.castShadow = !isSoftwareGl;
  group.add(jawMesh);
  disposables.push(jawGeo);

  // 3. Secondary Silhouette: Twin Brow Ridge Armor Plates
  const browGeo = new THREE.BoxGeometry(0.18, 0.12, 0.42);
  const leftBrow = new THREE.Mesh(browGeo, secondaryMat);
  leftBrow.position.set(-0.24, 0.54, 0.04);
  leftBrow.rotation.set(0.12, 0.18, 0.22);
  const rightBrow = new THREE.Mesh(browGeo, secondaryMat);
  rightBrow.position.set(0.24, 0.54, 0.04);
  rightBrow.rotation.set(0.12, -0.18, -0.22);
  group.add(leftBrow, rightBrow);
  disposables.push(browGeo);

  // 4. Accent Detail: Crown Dorsal Fin / Crest
  const crestShape = new THREE.Shape();
  crestShape.moveTo(-0.34, 0);
  crestShape.lineTo(0.12, 0.22);
  crestShape.lineTo(0.28, 0);
  crestShape.closePath();
  const crestGeo = new THREE.ExtrudeGeometry(crestShape, {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 2,
  });
  crestGeo.rotateY(Math.PI / 2);
  crestGeo.translate(-0.03, 0.58, -0.08);
  const crestMesh = new THREE.Mesh(crestGeo, crestMat);
  crestMesh.castShadow = !isSoftwareGl;
  group.add(crestMesh);
  disposables.push(crestGeo);

  // 5. Accent Detail: Glowing Amber Eyes + Vertical Slit Pupils
  const eyeGeo = new THREE.SphereGeometry(0.115, 16, 16);
  const pupilGeo = new THREE.BoxGeometry(0.035, 0.14, 0.05);
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.31, 0.44, 0.18);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.31, 0.44, 0.18);

  const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
  leftPupil.position.set(-0.39, 0.44, 0.22);
  const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
  rightPupil.position.set(0.39, 0.44, 0.22);
  group.add(leftEye, rightEye, leftPupil, rightPupil);
  disposables.push(eyeGeo, pupilGeo);

  // 6. Accent Detail: Articulated Forked Tongue
  const tonguePivot = new THREE.Group();
  tonguePivot.position.set(0, 0.2, 0.44);
  const stemGeo = new THREE.BoxGeometry(0.06, 0.025, 0.3);
  const forkGeo = new THREE.BoxGeometry(0.04, 0.02, 0.16);
  const stemMesh = new THREE.Mesh(stemGeo, tongueMat);
  stemMesh.position.set(0, 0, 0.14);
  const forkL = new THREE.Mesh(forkGeo, tongueMat);
  forkL.position.set(-0.055, 0, 0.31);
  forkL.rotation.y = -0.45;
  const forkR = new THREE.Mesh(forkGeo, tongueMat);
  forkR.position.set(0.055, 0, 0.31);
  forkR.rotation.y = 0.45;
  tonguePivot.add(stemMesh, forkL, forkR);
  group.add(tonguePivot);
  disposables.push(stemGeo, forkGeo);

  return {
    group,
    tonguePivot,
    jawMesh,
    primaryMat,
    secondaryMat,
    bellyMat,
    eyeMat,
    crestMat,
    setSkin: (nextSkin: SkinPalette) => {
      primaryMat.color.setHex(nextSkin.primaryHex);
      secondaryMat.color.setHex(nextSkin.secondaryHex);
      bellyMat.color.setHex(nextSkin.bellyHex);
      eyeMat.color.setHex(nextSkin.eyeHex);
      eyeMat.emissive.setHex(nextSkin.eyeHex);
      crestMat.color.setHex(nextSkin.crestHex);
    },
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/**
 * Multi-part Glossy Sun-Apple Collectible (3 parts + grounded contact shadow)
 */
export function createAppleCollectible(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): CollectibleRig {
  const group = new THREE.Group();
  const coreGroup = new THREE.Group();
  group.add(coreGroup);

  const disposables: Array<{ dispose: () => void }> = [];

  // Lathe profile for sculpted apple silhouette
  const profile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.22, 0.03),
    new THREE.Vector2(0.36, 0.18),
    new THREE.Vector2(0.38, 0.42),
    new THREE.Vector2(0.24, 0.62),
    new THREE.Vector2(0.08, 0.56),
    new THREE.Vector2(0.0, 0.52),
  ];
  const bodyGeo = new THREE.LatheGeometry(profile, 22);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: 0xe63946,
    emissive: 0x5c0a14,
    emissiveIntensity: 0.3,
    roughness: 0.16,
    metalness: 0.08,
    clearcoat: 0.95,
    clearcoatRoughness: 0.1,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = !isSoftwareGl;
  coreGroup.add(bodyMesh);

  // Metallic gold stem
  const stemGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.22, 10);
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    roughness: 0.25,
    metalness: 0.9,
  });
  const stemMesh = new THREE.Mesh(stemGeo, stemMat);
  stemMesh.position.set(0, 0.62, 0);
  stemMesh.rotation.z = -0.15;
  coreGroup.add(stemMesh);

  // Sculpted emerald leaf
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 0);
  leafShape.quadraticCurveTo(0.14, 0.08, 0.24, 0);
  leafShape.quadraticCurveTo(0.14, -0.08, 0, 0);
  const leafGeo = new THREE.ExtrudeGeometry(leafShape, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 1,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x34d399,
    roughness: 0.48,
    metalness: 0.1,
  });
  const leafMesh = new THREE.Mesh(leafGeo, leafMat);
  leafMesh.position.set(0.02, 0.68, 0);
  leafMesh.rotation.set(-0.4, 0.3, 0.45);
  coreGroup.add(leafMesh);

  // Grounded contact shadow disc
  const shadowGeo = new THREE.PlaneGeometry(0.95, 0.95);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.015;
  group.add(shadowMesh);

  disposables.push(bodyGeo, bodyMat, stemGeo, stemMat, leafGeo, leafMat, shadowGeo, shadowMat);

  return {
    group,
    coreGroup,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/**
 * Multi-part Celestial Jade Starfruit Collectible (Crystal Core + Orbiting Gold Ring + Contact Shadow)
 */
export function createStarfruitCollectible(
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): CollectibleRig {
  const group = new THREE.Group();
  const coreGroup = new THREE.Group();
  group.add(coreGroup);

  const disposables: Array<{ dispose: () => void }> = [];

  const crystalGeo = new THREE.OctahedronGeometry(0.32, 0);
  const crystalMat = new THREE.MeshPhysicalMaterial({
    color: 0x2dd4bf,
    emissive: 0x0d9488,
    emissiveIntensity: 0.65,
    roughness: 0.1,
    metalness: 0.2,
    clearcoat: 1.0,
  });
  const crystalMesh = new THREE.Mesh(crystalGeo, crystalMat);
  crystalMesh.position.y = 0.44;
  crystalMesh.castShadow = !isSoftwareGl;
  coreGroup.add(crystalMesh);

  const ringGeo = new THREE.TorusGeometry(0.42, 0.035, 10, 28);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.35,
    roughness: 0.2,
    metalness: 0.92,
  });
  const orbitRing = new THREE.Mesh(ringGeo, ringMat);
  orbitRing.position.y = 0.44;
  orbitRing.rotation.x = Math.PI / 3;
  coreGroup.add(orbitRing);

  const shadowGeo = new THREE.PlaneGeometry(1.05, 1.05);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: textures.contactShadow,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.015;
  group.add(shadowMesh);

  disposables.push(crystalGeo, crystalMat, ringGeo, ringMat, shadowGeo, shadowMat);

  return {
    group,
    coreGroup,
    orbitRing,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/**
 * 3-part Carved Stone Obstacle Pillar (bottom-center pivot grounded at y = 0)
 */
export function createObstaclePillar(isSoftwareGl: boolean): {
  group: THREE.Group;
  dispose: () => void;
} {
  const group = new THREE.Group();

  const baseGeo = new THREE.BoxGeometry(0.86, 0.18, 0.86);
  const shaftGeo = new THREE.CylinderGeometry(0.3, 0.38, 0.72, 6);
  const runeGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.1, 6);
  const capGeo = new THREE.ConeGeometry(0.34, 0.24, 6);

  const stoneMat = new THREE.MeshStandardMaterial({
    color: 0x3a4856,
    roughness: 0.82,
    metalness: 0.12,
  });
  const runeMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.85,
    roughness: 0.28,
    metalness: 0.45,
  });

  const base = new THREE.Mesh(baseGeo, stoneMat);
  base.position.y = 0.09;
  base.castShadow = !isSoftwareGl;
  base.receiveShadow = !isSoftwareGl;

  const shaft = new THREE.Mesh(shaftGeo, stoneMat);
  shaft.position.y = 0.54;
  shaft.castShadow = !isSoftwareGl;
  shaft.receiveShadow = !isSoftwareGl;

  const rune = new THREE.Mesh(runeGeo, runeMat);
  rune.position.y = 0.68;

  const cap = new THREE.Mesh(capGeo, stoneMat);
  cap.position.y = 1.02;
  cap.castShadow = !isSoftwareGl;

  group.add(base, shaft, rune, cap);

  return {
    group,
    dispose: () => {
      baseGeo.dispose();
      shaftGeo.dispose();
      runeGeo.dispose();
      capGeo.dispose();
      stoneMat.dispose();
      runeMat.dispose();
    },
  };
}
