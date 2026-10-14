import * as THREE from 'three';
import {
  BuildingParams,
  SimulationMode,
  SkybridgeLink,
  VisualStyle,
} from './types';
import {
  getConcreteMaterials,
  getEdgeLineMaterial,
  getGlazingMaterial,
  getGreeneryMaterial,
  getWaterMaterial,
} from './textures';

export const GRID_UNIT_SIZE = 14; // 1 grid cell = 14 meters

function seededRand(seed: number): () => number {
  let s = Math.abs(seed) % 2147483647 || 12345;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function addMeshWithEdges(
  parent: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  visualStyle: VisualStyle,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  addEdges = true
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  if (rx || ry || rz) mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);

  if (addEdges && (visualStyle === 'blueprint' || visualStyle === 'herve_mono')) {
    const edges = new THREE.EdgesGeometry(geometry, 25);
    const line = new THREE.LineSegments(edges, getEdgeLineMaterial(visualStyle));
    mesh.add(line);
  }
  return mesh;
}

function getSimulationTierMaterial(
  simMode: SimulationMode,
  tierNormalized: number, // 0 at base, 1 at roof
  cantileverRatio: number,
  isPilotisOrCore: boolean,
  params: BuildingParams,
  sunAltitudeDeg: number = 45
): THREE.MeshStandardMaterial | null {
  if (simMode === 'none') return null;

  const color = new THREE.Color();

  if (simMode === 'solar') {
    // Solar Insolation vs Brise-Soleil Shading Efficiency
    // Deep brise-soleil and overhangs reduce direct solar thermal load on glazing
    const shadingFactor = Math.min(
      1,
      (params.briseSoleilDepth / 2.0) * 0.55 +
        (params.cantileverOverhang / 6.0) * 0.3 +
        Math.abs(params.finAngle) / 90
    );
    const exposure = Math.max(
      0.08,
      Math.min(1, tierNormalized * 0.75 + (sunAltitudeDeg / 90) * 0.45 - shadingFactor * 0.45)
    );
    // Cool Indigo/Cyan (well-shaded) -> Warm Amber -> Solar Crimson (high thermal load)
    if (exposure < 0.5) {
      color.lerpColors(new THREE.Color(0x1e4d92), new THREE.Color(0xf59e0b), exposure * 2);
    } else {
      color.lerpColors(new THREE.Color(0xf59e0b), new THREE.Color(0xef4444), (exposure - 0.5) * 2);
    }
  } else if (simMode === 'structural') {
    // Structural Load Path & Cantilever Bending Stress
    // High stress at pilotis base (compression) and extreme cantilever overhangs (bending moment)
    const compressionStress = (1 - tierNormalized) * (isPilotisOrCore ? 0.9 : 0.45);
    const bendingStress = cantileverRatio * (params.cantileverOverhang / 6.5) * 0.95;
    const totalStress = Math.min(1, Math.max(compressionStress, bendingStress));
    if (totalStress < 0.5) {
      color.lerpColors(new THREE.Color(0x10b981), new THREE.Color(0xeab308), totalStress * 2);
    } else {
      color.lerpColors(new THREE.Color(0xeab308), new THREE.Color(0xdc2626), (totalStress - 0.5) * 2);
    }
  } else if (simMode === 'circulation') {
    // Space Syntax / Pedestrian & Skybridge Vertical Activation
    const activeScore = isPilotisOrCore
      ? 0.92
      : Math.max(0.15, 1.0 - Math.abs(tierNormalized - 0.25) * 1.1);
    color.lerpColors(new THREE.Color(0x1e293b), new THREE.Color(0x38bdf8), activeScore);
  } else if (simMode === 'wind') {
    // Aerodynamic Wind Pressure & Porosity
    const windPressure =
      tierNormalized * 0.75 + (params.pilotisHeight > 0 ? -0.15 : 0.25);
    const clamped = Math.max(0, Math.min(1, windPressure));
    color.lerpColors(new THREE.Color(0x06b6d4), new THREE.Color(0xf97316), clamped);
  }

  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.65,
    metalness: 0.1,
  });
}

export function generateBuildingMesh(
  params: BuildingParams,
  visualStyle: VisualStyle,
  isNight: boolean,
  simMode: SimulationMode,
  sunAltitudeDeg: number = 45,
  clippingPlanes: THREE.Plane[] = []
): THREE.Group {
  const group = new THREE.Group();
  group.name = params.id;
  group.userData = { buildingId: params.id, params };

  const baseMats = getConcreteMaterials(
    params.concreteFinish,
    params.tieHoleDensity,
    visualStyle
  );
  const glassMat = getGlazingMaterial(isNight, visualStyle);
  const greenMat = getGreeneryMaterial(visualStyle);
  const waterMat = getWaterMaterial(visualStyle);

  const worldW = params.footprintW * GRID_UNIT_SIZE - 2.2;
  const worldD = params.footprintD * GRID_UNIT_SIZE - 2.2;
  const rand = seededRand(
    params.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  );

  // Special case: Sunken Water Forum / Brutalist Plaza (ARC-10)
  if (params.archetype === 'plaza_pool') {
    buildSunkenWaterPlaza(
      group,
      params,
      worldW,
      worldD,
      baseMats.primary,
      baseMats.secondary,
      waterMat,
      greenMat,
      visualStyle
    );
    applyClippingToGroup(group, clippingPlanes);
    return group;
  }

  // Special case: Yugoslav Spomenik Monument (ARC-09)
  if (params.archetype === 'spomenik') {
    buildSpomenikMonument(
      group,
      params,
      worldW,
      worldD,
      baseMats.primary,
      baseMats.secondary,
      greenMat,
      visualStyle,
      simMode,
      sunAltitudeDeg
    );
    applyClippingToGroup(group, clippingPlanes);
    return group;
  }

  // 1. Stepped Brutalist Plinth Base
  const plinthH = 0.8;
  const plinthGeo = new THREE.BoxGeometry(worldW + 1.4, plinthH, worldD + 1.4);
  addMeshWithEdges(
    group,
    plinthGeo,
    baseMats.secondary,
    visualStyle,
    0,
    plinthH / 2,
    0
  );

  // Salk Institute central horizon water channel or sunken plaza detail
  if (params.archetype === 'salk' || params.massingProfile === 'split_court') {
    const channelGeo = new THREE.BoxGeometry(2.4, 0.85, worldD + 1.2);
    addMeshWithEdges(
      group,
      channelGeo,
      waterMat,
      visualStyle,
      0,
      plinthH + 0.05,
      0,
      0,
      0,
      0,
      false
    );
  }

  const pilotisWorldH = params.pilotisHeight * params.floorHeight;
  const startFloorY = plinthH + pilotisWorldH;

  // 2. Pilotis (Ground-Level Structural Stilts)
  if (params.pilotisHeight > 0) {
    const pilotisMat =
      getSimulationTierMaterial(simMode, 0.05, 0.2, true, params, sunAltitudeDeg) ||
      baseMats.core;
    buildPilotisSupports(
      group,
      params,
      worldW,
      worldD,
      plinthH,
      pilotisWorldH,
      pilotisMat,
      visualStyle
    );

    // Coffered transfer slab at top of pilotis
    const transferGeo = new THREE.BoxGeometry(worldW * 0.94, 0.65, worldD * 0.94);
    addMeshWithEdges(
      group,
      transferGeo,
      pilotisMat,
      visualStyle,
      0,
      startFloorY - 0.3,
      0
    );
  }

  // 3. Primary Structural Cores (Internal, Detached Trellick Tower, Twin External, or Exoskeleton)
  const totalBuildingHeight =
    startFloorY + params.floors * params.floorHeight;
  const coreMat =
    getSimulationTierMaterial(simMode, 0.35, 0.3, true, params, sunAltitudeDeg) ||
    baseMats.core;

  buildStructuralCores(
    group,
    params,
    worldW,
    worldD,
    totalBuildingHeight,
    coreMat,
    glassMat,
    visualStyle
  );

  // 4. Floor-by-Floor Massing, Cantilevers, Brise-Soleil & Fenestration
  if (params.archetype === 'habitat' || params.massingProfile === 'cantilever_cluster') {
    buildHabitatOrCapsuleCluster(
      group,
      params,
      worldW,
      worldD,
      startFloorY,
      baseMats.primary,
      baseMats.secondary,
      glassMat,
      greenMat,
      visualStyle,
      simMode,
      sunAltitudeDeg,
      rand
    );
  } else {
    buildTieredBrutalistMassing(
      group,
      params,
      worldW,
      worldD,
      startFloorY,
      baseMats.primary,
      baseMats.secondary,
      glassMat,
      greenMat,
      visualStyle,
      simMode,
      sunAltitudeDeg
    );
  }

  // 5. Roofscape Tectonics (Le Corbusier Sculptural Vents, Barbican Barrel Vaults, Water Tanks, Sky Gardens)
  const roofMat =
    getSimulationTierMaterial(simMode, 1.0, 0.4, false, params, sunAltitudeDeg) ||
    baseMats.primary;
  buildRoofscapeFeatures(
    group,
    params,
    worldW,
    worldD,
    totalBuildingHeight,
    roofMat,
    baseMats.secondary,
    greenMat,
    visualStyle
  );

  // Apply World Grid Position & Rotation
  group.position.set(
    params.gridX * GRID_UNIT_SIZE,
    0,
    params.gridZ * GRID_UNIT_SIZE
  );
  group.rotation.y = THREE.MathUtils.degToRad(params.rotation);

  applyClippingToGroup(group, clippingPlanes);
  return group;
}

function buildPilotisSupports(
  group: THREE.Group,
  params: BuildingParams,
  worldW: number,
  worldD: number,
  plinthH: number,
  pilotisH: number,
  mat: THREE.Material,
  visualStyle: VisualStyle
) {
  const colsX = Math.max(2, Math.round(worldW / params.bayModuleWidth));
  const colsZ = Math.max(2, Math.round(worldD / Math.max(4.5, params.bayModuleWidth)));
  const spanX = worldW * 0.78;
  const spanZ = worldD * 0.74;

  if (params.pilotisStyle === 'tree_bent') {
    // Geisel Library 45-degree diagonal concrete bents rising from center plinth
    const numBents = 8;
    for (let i = 0; i < numBents; i++) {
      const angle = (i / numBents) * Math.PI * 2;
      const strutLen = Math.hypot(pilotisH, Math.min(worldW, worldD) * 0.34);
      const strutGeo = new THREE.BoxGeometry(1.15, strutLen, 1.45);
      const radius = Math.min(worldW, worldD) * 0.22;
      const cx = Math.cos(angle) * radius;
      const cz = Math.sin(angle) * radius;

      const mesh = new THREE.Mesh(strutGeo, mat);
      mesh.position.set(cx, plinthH + pilotisH * 0.5, cz);
      mesh.rotation.y = -angle;
      mesh.rotation.z = -0.46;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    // Central core pedestal
    const pedGeo = new THREE.BoxGeometry(worldW * 0.34, pilotisH, worldD * 0.34);
    addMeshWithEdges(
      group,
      pedGeo,
      mat,
      visualStyle,
      0,
      plinthH + pilotisH / 2,
      0
    );
    return;
  }

  for (let ix = 0; ix < colsX; ix++) {
    const x = colsX === 1 ? 0 : -spanX / 2 + (ix / (colsX - 1)) * spanX;
    for (let iz = 0; iz < colsZ; iz++) {
      // Keep interior open on multi-bay buildings
      if (colsZ > 2 && iz > 0 && iz < colsZ - 1 && ix > 0 && ix < colsX - 1) {
        continue;
      }
      const z = colsZ === 1 ? 0 : -spanZ / 2 + (iz / (colsZ - 1)) * spanZ;

      if (params.pilotisStyle === 'v_strut') {
        // Unité d'Habitation muscular V-shaped pilotis
        const legGeo = new THREE.BoxGeometry(0.85, pilotisH * 1.06, 1.25);
        addMeshWithEdges(
          group,
          legGeo,
          mat,
          visualStyle,
          x,
          plinthH + pilotisH / 2,
          z - 0.55,
          0.22,
          0,
          0
        );
        addMeshWithEdges(
          group,
          legGeo,
          mat,
          visualStyle,
          x,
          plinthH + pilotisH / 2,
          z + 0.55,
          -0.22,
          0,
          0
        );
      } else if (params.pilotisStyle === 'cruciform') {
        const g1 = new THREE.BoxGeometry(1.5, pilotisH, 0.55);
        const g2 = new THREE.BoxGeometry(0.55, pilotisH, 1.5);
        addMeshWithEdges(group, g1, mat, visualStyle, x, plinthH + pilotisH / 2, z);
        addMeshWithEdges(group, g2, mat, visualStyle, x, plinthH + pilotisH / 2, z);
      } else if (params.pilotisStyle === 'shear_blade') {
        const bladeGeo = new THREE.BoxGeometry(0.65, pilotisH, 2.4);
        addMeshWithEdges(
          group,
          bladeGeo,
          mat,
          visualStyle,
          x,
          plinthH + pilotisH / 2,
          z
        );
      } else {
        // Cylindrical pilotis
        const cylGeo = new THREE.CylinderGeometry(0.65, 0.58, pilotisH, 12);
        addMeshWithEdges(
          group,
          cylGeo,
          mat,
          visualStyle,
          x,
          plinthH + pilotisH / 2,
          z,
          0,
          0,
          0,
          false
        );
      }
    }
  }
}

function buildStructuralCores(
  group: THREE.Group,
  params: BuildingParams,
  worldW: number,
  worldD: number,
  totalH: number,
  coreMat: THREE.Material,
  glassMat: THREE.Material,
  visualStyle: VisualStyle
) {
  if (params.coreType === 'detached_tower' || params.archetype === 'trellick') {
    // Ernő Goldfinger Trellick-style detached slip-form service tower + flying skybridges every 3rd floor
    const towerH = totalH + 5.5;
    const towerW = 4.2;
    const towerD = 4.6;
    const towerX = -worldW * 0.32;
    const towerZ = worldD * 0.5 + 4.4;

    const towerGeo = new THREE.BoxGeometry(towerW, towerH, towerD);
    addMeshWithEdges(
      group,
      towerGeo,
      coreMat,
      visualStyle,
      towerX,
      towerH / 2,
      towerZ
    );

    // Top cantilevered boiler house crown (signature Goldfinger silhouette)
    const boilerGeo = new THREE.BoxGeometry(towerW + 3.2, 3.8, towerD + 2.8);
    addMeshWithEdges(
      group,
      boilerGeo,
      coreMat,
      visualStyle,
      towerX + 0.8,
      towerH - 1.2,
      towerZ
    );

    // Flying skybridges every 3 floors connecting lift tower to slab
    for (let f = Math.max(1, params.pilotisHeight); f < params.floors + params.pilotisHeight; f += 3) {
      const bridgeY = 0.8 + f * params.floorHeight + params.floorHeight * 0.5;
      const bridgeLen = 5.2;
      const bridgeGeo = new THREE.BoxGeometry(2.4, 2.2, bridgeLen);
      addMeshWithEdges(
        group,
        bridgeGeo,
        coreMat,
        visualStyle,
        towerX,
        bridgeY,
        worldD * 0.5 + 1.8
      );
      // Glazing strip on skybridge
      const winGeo = new THREE.BoxGeometry(2.5, 0.9, bridgeLen * 0.7);
      addMeshWithEdges(
        group,
        winGeo,
        glassMat,
        visualStyle,
        towerX,
        bridgeY + 0.2,
        worldD * 0.5 + 1.8,
        0,
        0,
        0,
        false
      );
    }
  } else if (params.coreType === 'twin_external') {
    const coreH = totalH + 2.8;
    const coreGeo = new THREE.BoxGeometry(3.6, coreH, 3.6);
    addMeshWithEdges(
      group,
      coreGeo,
      coreMat,
      visualStyle,
      -worldW * 0.26,
      coreH / 2,
      0
    );
    addMeshWithEdges(
      group,
      coreGeo,
      coreMat,
      visualStyle,
      worldW * 0.26,
      coreH / 2,
      0
    );
  } else if (params.coreType === 'exoskeleton') {
    const numCols = 4;
    for (let i = 0; i < numCols; i++) {
      const x = -worldW * 0.46 + (i / (numCols - 1)) * (worldW * 0.92);
      const colGeo = new THREE.BoxGeometry(1.1, totalH, 1.3);
      addMeshWithEdges(
        group,
        colGeo,
        coreMat,
        visualStyle,
        x,
        totalH / 2,
        worldD * 0.48
      );
      addMeshWithEdges(
        group,
        colGeo,
        coreMat,
        visualStyle,
        x,
        totalH / 2,
        -worldD * 0.48
      );
    }
  } else {
    // Internal slip-form structural shear core (visible when section cut is active or through pilotis)
    const coreGeo = new THREE.BoxGeometry(
      Math.max(3.2, worldW * 0.28),
      totalH + 1.6,
      Math.max(3.2, worldD * 0.32)
    );
    addMeshWithEdges(
      group,
      coreGeo,
      coreMat,
      visualStyle,
      0,
      (totalH + 1.6) / 2,
      0
    );
  }
}

function buildHabitatOrCapsuleCluster(
  group: THREE.Group,
  params: BuildingParams,
  worldW: number,
  worldD: number,
  startY: number,
  primaryMat: THREE.Material,
  secondaryMat: THREE.Material,
  glassMat: THREE.Material,
  greenMat: THREE.Material,
  visualStyle: VisualStyle,
  simMode: SimulationMode,
  sunAltitudeDeg: number,
  rand: () => number
) {
  const isNakagin =
    params.archetype === 'nakagin' || params.facadeSystem === 'capsule_porthole';

  if (isNakagin) {
    // Kisho Kurokawa Nakagin Capsule Tower: twin cores with plug-in porthole boxes cantilevered in all 4 directions
    const coresX = [-worldW * 0.22, worldW * 0.22];
    const capW = 3.2 + params.cantileverOverhang * 0.35;
    const capH = params.floorHeight * 0.86;
    const capD = 4.6 + params.cantileverOverhang * 0.45;

    for (let f = 0; f < params.floors; f++) {
      const y = startY + f * params.floorHeight + params.floorHeight * 0.5;
      const tierNorm = f / Math.max(1, params.floors - 1);
      const tierMat =
        getSimulationTierMaterial(simMode, tierNorm, 0.75, false, params, sunAltitudeDeg) ||
        (f % 3 === 0 ? secondaryMat : primaryMat);

      coresX.forEach((cx, cIdx) => {
        for (let dir = 0; dir < 4; dir++) {
          if (rand() < 0.18) continue;
          const angle = (dir * Math.PI) / 2 + ((f + cIdx) % 2) * 0.08;
          const offset = 2.6 + (f % 2) * 0.65;
          const gx = cx + Math.cos(angle) * offset;
          const gz = Math.sin(angle) * offset;

          const capGeo = new THREE.BoxGeometry(capW, capH, capD);
          const capMesh = addMeshWithEdges(
            group,
            capGeo,
            tierMat,
            visualStyle,
            gx,
            y,
            gz,
            0,
            angle,
            0
          );

          // Iconic Nakagin circular porthole window on the outer end of each capsule
          const portholeGeo = new THREE.CylinderGeometry(
            capH * 0.32,
            capH * 0.32,
            0.3,
            16
          );
          const porthole = new THREE.Mesh(portholeGeo, glassMat);
          porthole.rotation.x = Math.PI / 2;
          porthole.position.set(0, 0, capD / 2 + 0.04);
          capMesh.add(porthole);
        }
      });
    }
    return;
  }

  // Moshe Safdie Habitat 67 interlocking cantilevered modular cluster
  const modW = Math.max(4.4, params.bayModuleWidth);
  const modD = Math.max(6.8, params.bayModuleWidth * 1.45);
  const modH = params.floorHeight * 0.92;

  for (let f = 0; f < params.floors; f++) {
    const tierNorm = f / Math.max(1, params.floors - 1);
    const y = startY + f * params.floorHeight + params.floorHeight * 0.5;
    const tierMat =
      getSimulationTierMaterial(simMode, tierNorm, 0.7, false, params, sunAltitudeDeg) ||
      (f % 2 === 0 ? primaryMat : secondaryMat);

    // Pyramid tapering as we go up, with bold cantilevered projections
    const modulesOnFloor = Math.max(
      2,
      Math.round((1.15 - tierNorm * 0.55) * (params.footprintW * 2.2))
    );

    for (let m = 0; m < modulesOnFloor; m++) {
      const spreadX = (m / Math.max(1, modulesOnFloor - 1) - 0.5) * (worldW * 0.85);
      const cantShiftZ =
        ((m + f) % 3 - 1) * (1.8 + params.cantileverOverhang * 0.45);
      const rotMod = ((m + f) % 2) * (Math.PI / 2);

      const boxGeo = new THREE.BoxGeometry(modW, modH, modD);
      const mesh = addMeshWithEdges(
        group,
        boxGeo,
        tierMat,
        visualStyle,
        spreadX,
        y,
        cantShiftZ,
        0,
        rotMod,
        0
      );

      // Recessed glazing on module face
      const winGeo = new THREE.BoxGeometry(
        modW * params.glazingRatio,
        modH * 0.62,
        modD + 0.12
      );
      const win = new THREE.Mesh(winGeo, glassMat);
      mesh.add(win);

      // Habitat 67 rooftop planter terrace on top of module
      if (params.ecoGreenery > 0.15 && rand() < params.ecoGreenery * 0.85) {
        const planterGeo = new THREE.BoxGeometry(modW * 0.75, 0.55, modD * 0.4);
        const planter = new THREE.Mesh(planterGeo, greenMat);
        planter.position.set(0, modH * 0.5 + 0.25, modD * 0.22);
        mesh.add(planter);
      }
    }
  }
}

function buildTieredBrutalistMassing(
  group: THREE.Group,
  params: BuildingParams,
  worldW: number,
  worldD: number,
  startY: number,
  primaryMat: THREE.Material,
  secondaryMat: THREE.Material,
  glassMat: THREE.Material,
  greenMat: THREE.Material,
  visualStyle: VisualStyle,
  simMode: SimulationMode,
  sunAltitudeDeg: number
) {
  const isSplitCourt =
    params.archetype === 'salk' || params.massingProfile === 'split_court';

  for (let f = 0; f < params.floors; f++) {
    const tierNorm = f / Math.max(1, params.floors - 1);
    const y = startY + f * params.floorHeight;

    // Calculate floor plate dimensions based on MassingProfile & CantileverOverhang
    let scaleW = 1.0;
    let scaleD = 1.0;
    let cantRatio = 0.2;

    if (params.massingProfile === 'inverted_ziggurat') {
      // Steps dramatically outward as floors rise (Boston City Hall / Geisel Library)
      const stepFactor = Math.max(0, (f - 1) / Math.max(1, params.floors - 1));
      const extraMeters = stepFactor * params.cantileverOverhang * 2.0;
      scaleW = (worldW + extraMeters) / worldW;
      scaleD = (worldD + extraMeters) / worldD;
      cantRatio = stepFactor;
    } else if (params.massingProfile === 'ziggurat') {
      // Steps inward as floors rise
      const stepFactor = tierNorm * 0.48;
      scaleW = 1.0 - stepFactor;
      scaleD = 1.0 - stepFactor * 0.75;
      cantRatio = 0.25;
    } else if (params.massingProfile === 'terraced_step') {
      scaleW = 1.0;
      scaleD = 1.0 - tierNorm * 0.52;
      cantRatio = 0.35;
    } else {
      // Monolith with optional mid-level Unité sky-street or subtle overhang
      const hasMidCantilever = f === Math.floor(params.floors * 0.45);
      const extra = hasMidCantilever ? params.cantileverOverhang * 0.65 : 0;
      scaleW = (worldW + extra) / worldW;
      scaleD = (worldD + extra) / worldD;
      cantRatio = hasMidCantilever ? 0.65 : 0.2;
    }

    const plateW = Math.max(4.5, worldW * scaleW);
    const plateD = Math.max(4.5, worldD * scaleD);

    const slabMat =
      getSimulationTierMaterial(simMode, tierNorm, cantRatio, false, params, sunAltitudeDeg) ||
      primaryMat;
    const finMat =
      getSimulationTierMaterial(simMode, tierNorm, cantRatio * 1.1, false, params, sunAltitudeDeg) ||
      secondaryMat;

    if (isSplitCourt) {
      // Twin symmetrical Salk wings flanking central water axis with 45° study towers
      const wingW = plateW * 0.34;
      [-plateW * 0.33, plateW * 0.33].forEach((wx, wIdx) => {
        buildSingleFloorPlateAndEnvelope(
          group,
          params,
          wingW,
          plateD,
          wx,
          y,
          0,
          f,
          slabMat,
          finMat,
          glassMat,
          greenMat,
          visualStyle,
          wIdx === 0 ? 1 : -1
        );
      });
    } else {
      buildSingleFloorPlateAndEnvelope(
        group,
        params,
        plateW,
        plateD,
        0,
        y,
        0,
        f,
        slabMat,
        finMat,
        glassMat,
        greenMat,
        visualStyle,
        0
      );
    }
  }
}

function buildSingleFloorPlateAndEnvelope(
  group: THREE.Group,
  params: BuildingParams,
  plateW: number,
  plateD: number,
  offsetX: number,
  floorBottomY: number,
  offsetZ: number,
  floorIndex: number,
  slabMat: THREE.Material,
  finMat: THREE.Material,
  glassMat: THREE.Material,
  greenMat: THREE.Material,
  visualStyle: VisualStyle,
  salkDirection: number
) {
  const fh = params.floorHeight;
  const slabThickness = 0.42;

  // 1. Horizontal Concrete Floor Slab
  const slabGeo = new THREE.BoxGeometry(
    plateW + params.briseSoleilDepth * 0.6,
    slabThickness,
    plateD + params.briseSoleilDepth * 0.6
  );
  addMeshWithEdges(
    group,
    slabGeo,
    slabMat,
    visualStyle,
    offsetX,
    floorBottomY + slabThickness / 2,
    offsetZ
  );

  // 2. Recessed Core Glazing Volume
  const recess = Math.min(1.8, params.briseSoleilDepth * 0.75);
  const coreGlassW = Math.max(2.0, plateW - recess * 2);
  const coreGlassD = Math.max(2.0, plateD - recess * 2);
  const glassH = fh - slabThickness;

  // Concrete spandrel wall vs glazing ratio
  const spandrelH = glassH * (1 - params.glazingRatio);
  if (spandrelH > 0.25) {
    const spandrelGeo = new THREE.BoxGeometry(
      coreGlassW + 0.2,
      spandrelH,
      coreGlassD + 0.2
    );
    addMeshWithEdges(
      group,
      spandrelGeo,
      slabMat,
      visualStyle,
      offsetX,
      floorBottomY + slabThickness + spandrelH / 2,
      offsetZ
    );
  }

  const windowGeo = new THREE.BoxGeometry(
    coreGlassW,
    glassH - spandrelH,
    coreGlassD
  );
  addMeshWithEdges(
    group,
    windowGeo,
    glassMat,
    visualStyle,
    offsetX,
    floorBottomY + slabThickness + spandrelH + (glassH - spandrelH) / 2,
    offsetZ,
    0,
    0,
    0,
    false
  );

  // 3. Tectonic Brise-Soleil Fins, Sawtooth Balconies, or Angled Salk Study Towers
  const numBaysX = Math.max(2, Math.round(plateW / params.bayModuleWidth));
  const numBaysZ = Math.max(2, Math.round(plateD / params.bayModuleWidth));
  const finRad = THREE.MathUtils.degToRad(params.finAngle);
  const finDepth = params.briseSoleilDepth;

  if (salkDirection !== 0) {
    // Salk 45-degree angled study bay projections facing courtyard
    for (let iz = 0; iz < numBaysZ; iz++) {
      const z = -plateD * 0.38 + (iz / Math.max(1, numBaysZ - 1)) * (plateD * 0.76);
      const studyGeo = new THREE.BoxGeometry(2.2, fh * 0.9, 2.4);
      addMeshWithEdges(
        group,
        studyGeo,
        finMat,
        visualStyle,
        offsetX + salkDirection * (plateW * 0.5 + 0.4),
        floorBottomY + fh / 2,
        z,
        0,
        salkDirection * (Math.PI / 4),
        0
      );
    }
    return;
  }

  if (
    params.facadeSystem === 'brise_soleil_grid' ||
    params.facadeSystem === 'vertical_fins' ||
    params.facadeSystem === 'coffered_waffle'
  ) {
    // Vertical Brise-Soleil Fins along North & South facades
    for (let ix = 0; ix <= numBaysX; ix++) {
      const x = offsetX - plateW / 2 + (ix / numBaysX) * plateW;
      const finGeo = new THREE.BoxGeometry(0.28, fh - slabThickness, finDepth);
      const midY = floorBottomY + slabThickness + (fh - slabThickness) / 2;

      addMeshWithEdges(
        group,
        finGeo,
        finMat,
        visualStyle,
        x,
        midY,
        offsetZ + plateD / 2,
        0,
        finRad,
        0,
        false
      );
      addMeshWithEdges(
        group,
        finGeo,
        finMat,
        visualStyle,
        x,
        midY,
        offsetZ - plateD / 2,
        0,
        -finRad,
        0,
        false
      );
    }

    // Horizontal Sun-Breaker Louver shelf at mid-story for egg-crate brise-soleil or coffered waffle
    if (
      params.facadeSystem === 'brise_soleil_grid' ||
      params.facadeSystem === 'coffered_waffle'
    ) {
      const louverGeo = new THREE.BoxGeometry(
        plateW + finDepth * 0.8,
        0.22,
        finDepth * 1.05
      );
      const midY = floorBottomY + fh * 0.58;
      addMeshWithEdges(
        group,
        louverGeo,
        finMat,
        visualStyle,
        offsetX,
        midY,
        offsetZ + plateD / 2,
        0,
        0,
        0,
        false
      );
      addMeshWithEdges(
        group,
        louverGeo,
        finMat,
        visualStyle,
        offsetX,
        midY,
        offsetZ - plateD / 2,
        0,
        0,
        0,
        false
      );
    }
  } else if (params.facadeSystem === 'ribbon_band') {
    // Barbican-style deep bush-hammered balcony parapet bands with sawtooth rhythm
    const parapetH = fh * 0.42;
    const parapetGeo = new THREE.BoxGeometry(
      plateW + finDepth * 0.9,
      parapetH,
      plateD + finDepth * 0.9
    );
    addMeshWithEdges(
      group,
      parapetGeo,
      finMat,
      visualStyle,
      offsetX,
      floorBottomY + slabThickness + parapetH / 2,
      offsetZ
    );
  }

  // 4. Eco-Brutalist Cantilevered Concrete Planters & Hanging Foliage
  if (
    params.ecoGreenery > 0.15 &&
    floorIndex % 2 === 0 &&
    (floorIndex * 7) % 10 < params.ecoGreenery * 10
  ) {
    const planterW = Math.min(plateW * 0.45, 6.5);
    const planterGeo = new THREE.BoxGeometry(planterW, 0.65, 1.1);
    const sideZ =
      floorIndex % 4 === 0 ? offsetZ + plateD / 2 + 0.5 : offsetZ - plateD / 2 - 0.5;
    addMeshWithEdges(
      group,
      planterGeo,
      greenMat,
      visualStyle,
      offsetX + ((floorIndex % 3) - 1) * (plateW * 0.2),
      floorBottomY + 0.55,
      sideZ,
      0,
      0,
      0,
      false
    );
  }
}

function buildRoofscapeFeatures(
  group: THREE.Group,
  params: BuildingParams,
  worldW: number,
  worldD: number,
  roofY: number,
  primaryMat: THREE.Material,
  secondaryMat: THREE.Material,
  greenMat: THREE.Material,
  visualStyle: VisualStyle
) {
  // Roof parapet slab
  const capW =
    params.massingProfile === 'ziggurat'
      ? worldW * 0.55
      : params.massingProfile === 'inverted_ziggurat'
      ? worldW + params.cantileverOverhang * 1.8
      : worldW;
  const capD =
    params.massingProfile === 'ziggurat'
      ? worldD * 0.62
      : params.massingProfile === 'inverted_ziggurat'
      ? worldD + params.cantileverOverhang * 1.8
      : worldD;

  const capGeo = new THREE.BoxGeometry(capW, 0.65, capD);
  addMeshWithEdges(group, capGeo, primaryMat, visualStyle, 0, roofY + 0.32, 0);

  if (params.roofFeature === 'sculptural_vent') {
    // Le Corbusier Unité d'Habitation Marseilles sculptural tapered ventilation chimneys & rooftop gymnasium
    const stack1 = new THREE.CylinderGeometry(1.6, 1.1, 5.2, 12);
    const stack2 = new THREE.CylinderGeometry(1.3, 0.9, 4.4, 12);
    addMeshWithEdges(
      group,
      stack1,
      primaryMat,
      visualStyle,
      -capW * 0.22,
      roofY + 2.8,
      0
    );
    addMeshWithEdges(
      group,
      stack2,
      secondaryMat,
      visualStyle,
      capW * 0.08,
      roofY + 2.4,
      0
    );
    // Rooftop sculptural concrete canopy / theatre wall
    const gymGeo = new THREE.BoxGeometry(capW * 0.35, 3.2, capD * 0.65);
    addMeshWithEdges(
      group,
      gymGeo,
      secondaryMat,
      visualStyle,
      capW * 0.26,
      roofY + 1.8,
      0
    );
  } else if (params.roofFeature === 'barrel_vaults') {
    // Barbican Estate iconic triple concrete barrel-vaulted rooftop crown
    const numVaults = 3;
    const vaultR = (capW * 0.85) / (numVaults * 2);
    for (let v = 0; v < numVaults; v++) {
      const vx = -capW * 0.28 + v * (capW * 0.28);
      const cylGeo = new THREE.CylinderGeometry(
        vaultR,
        vaultR,
        capD * 0.85,
        16,
        1,
        false,
        0,
        Math.PI
      );
      const mesh = new THREE.Mesh(cylGeo, primaryMat);
      mesh.rotation.z = Math.PI / 2;
      mesh.rotation.y = Math.PI / 2;
      mesh.position.set(vx, roofY + 0.6, 0);
      mesh.castShadow = true;
      group.add(mesh);
    }
  } else if (params.roofFeature === 'water_tank') {
    // Brutalist elevated concrete cylindrical water tower on 4 struts
    const tankGeo = new THREE.CylinderGeometry(2.4, 2.4, 3.6, 16);
    addMeshWithEdges(
      group,
      tankGeo,
      secondaryMat,
      visualStyle,
      0,
      roofY + 4.2,
      0
    );
    const legGeo = new THREE.BoxGeometry(0.45, 2.8, 0.45);
    [
      [-1.2, -1.2],
      [1.2, -1.2],
      [-1.2, 1.2],
      [1.2, 1.2],
    ].forEach(([lx, lz]) => {
      addMeshWithEdges(
        group,
        legGeo,
        primaryMat,
        visualStyle,
        lx,
        roofY + 1.8,
        lz
      );
    });
  } else if (params.roofFeature === 'sky_garden' || params.ecoGreenery > 0.5) {
    // Eco-Brutalist rooftop cypress & concrete pergola garden
    const gardenGeo = new THREE.BoxGeometry(capW * 0.78, 0.9, capD * 0.72);
    addMeshWithEdges(
      group,
      gardenGeo,
      greenMat,
      visualStyle,
      0,
      roofY + 0.9,
      0,
      0,
      0,
      0,
      false
    );
    // Brutalist concrete pergola frame above greenery
    for (let i = -2; i <= 2; i++) {
      const beamGeo = new THREE.BoxGeometry(0.35, 2.4, capD * 0.78);
      addMeshWithEdges(
        group,
        beamGeo,
        primaryMat,
        visualStyle,
        i * (capW * 0.16),
        roofY + 1.8,
        0
      );
    }
  } else if (params.roofFeature === 'brutalist_spire') {
    const spireGeo = new THREE.ConeGeometry(2.2, 9.5, 4);
    addMeshWithEdges(
      group,
      spireGeo,
      primaryMat,
      visualStyle,
      0,
      roofY + 5.2,
      0
    );
  }
}

function buildSunkenWaterPlaza(
  group: THREE.Group,
  params: BuildingParams,
  worldW: number,
  worldD: number,
  primaryMat: THREE.Material,
  secondaryMat: THREE.Material,
  waterMat: THREE.Material,
  greenMat: THREE.Material,
  visualStyle: VisualStyle
) {
  // Stepped concrete amphitheater perimeter
  const rimGeo = new THREE.BoxGeometry(worldW + 1.6, 1.1, worldD + 1.6);
  addMeshWithEdges(group, rimGeo, primaryMat, visualStyle, 0, 0.55, 0);

  // Reflecting pool water surface
  const poolGeo = new THREE.BoxGeometry(worldW * 0.82, 0.65, worldD * 0.82);
  addMeshWithEdges(
    group,
    poolGeo,
    waterMat,
    visualStyle,
    0,
    0.45,
    0,
    0,
    0,
    0,
    false
  );

  // Brutalist stepping platforms & sculptural concrete monoliths in the water
  const island1 = new THREE.BoxGeometry(worldW * 0.32, 1.15, worldD * 0.28);
  addMeshWithEdges(
    group,
    island1,
    secondaryMat,
    visualStyle,
    -worldW * 0.16,
    0.6,
    worldD * 0.12
  );

  // Eco-Brutalist cypress tree planters on stepping islands
  if (params.ecoGreenery > 0.1) {
    const planter = new THREE.BoxGeometry(worldW * 0.25, 0.8, worldD * 0.22);
    addMeshWithEdges(
      group,
      planter,
      greenMat,
      visualStyle,
      -worldW * 0.16,
      1.35,
      worldD * 0.12,
      0,
      0,
      0,
      false
    );

    // Sculptural cypress cones
    for (let t = -1; t <= 1; t++) {
      const treeGeo = new THREE.ConeGeometry(0.95, 4.8, 7);
      addMeshWithEdges(
        group,
        treeGeo,
        greenMat,
        visualStyle,
        -worldW * 0.16 + t * 1.5,
        3.6,
        worldD * 0.12,
        0,
        0,
        0,
        false
      );
    }
  }

  // Abstract Henry Moore / Barbara Hepworth / Chillida style brutalist plaza sculpture
  const sculptGeo = new THREE.TorusKnotGeometry(1.35, 0.42, 48, 8, 2, 3);
  addMeshWithEdges(
    group,
    sculptGeo,
    primaryMat,
    visualStyle,
    worldW * 0.18,
    2.4,
    -worldD * 0.14,
    0,
    0,
    0,
    false
  );
  const pedGeo = new THREE.BoxGeometry(2.4, 1.4, 2.4);
  addMeshWithEdges(
    group,
    pedGeo,
    secondaryMat,
    visualStyle,
    worldW * 0.18,
    0.7,
    -worldD * 0.14
  );

  group.position.set(
    params.gridX * GRID_UNIT_SIZE,
    0,
    params.gridZ * GRID_UNIT_SIZE
  );
  group.rotation.y = THREE.MathUtils.degToRad(params.rotation);
}

function buildSpomenikMonument(
  group: THREE.Group,
  params: BuildingParams,
  worldW: number,
  worldD: number,
  primaryMat: THREE.Material,
  secondaryMat: THREE.Material,
  greenMat: THREE.Material,
  visualStyle: VisualStyle,
  simMode: SimulationMode,
  sunAltitudeDeg: number
) {
  const mat =
    getSimulationTierMaterial(simMode, 0.7, 0.85, false, params, sunAltitudeDeg) ||
    primaryMat;

  // Stepped circular ceremonial amphitheater base
  for (let s = 0; s < 3; s++) {
    const r = Math.min(worldW, worldD) * (0.52 - s * 0.1);
    const cyl = new THREE.CylinderGeometry(r, r * 1.08, 0.9, 12);
    addMeshWithEdges(group, cyl, secondaryMat, visualStyle, 0, s * 0.85 + 0.45, 0);
  }

  // Radial soaring crystalline concrete petals (Sutjeska / Kosmaj / Kadinjača tribute)
  const height = params.floors * params.floorHeight;
  const numPetals = 6;
  const tiltAngle = 0.28 + (params.cantileverOverhang / 8.0) * 0.38;

  for (let i = 0; i < numPetals; i++) {
    const angle = (i / numPetals) * Math.PI * 2;
    const petalGeo = new THREE.BoxGeometry(2.4, height, 4.8);
    const radius = 3.2;
    const px = Math.cos(angle) * radius;
    const pz = Math.sin(angle) * radius;

    const mesh = new THREE.Mesh(petalGeo, mat);
    mesh.position.set(px, 2.4 + height * 0.46, pz);
    mesh.rotation.y = -angle;
    mesh.rotation.z = -tiltAngle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    if (visualStyle === 'blueprint' || visualStyle === 'herve_mono') {
      const edges = new THREE.EdgesGeometry(petalGeo, 25);
      mesh.add(new THREE.LineSegments(edges, getEdgeLineMaterial(visualStyle)));
    }
  }

  // Central oculus ring at mid-height
  const ringGeo = new THREE.TorusGeometry(4.2, 0.85, 8, 16);
  addMeshWithEdges(
    group,
    ringGeo,
    secondaryMat,
    visualStyle,
    0,
    2.4 + height * 0.55,
    0,
    Math.PI / 2,
    0,
    0,
    false
  );

  if (params.ecoGreenery > 0.2) {
    for (let c = 0; c < 4; c++) {
      const a = (c / 4) * Math.PI * 2 + Math.PI / 4;
      const tree = new THREE.ConeGeometry(1.1, 5.2, 7);
      addMeshWithEdges(
        group,
        tree,
        greenMat,
        visualStyle,
        Math.cos(a) * (worldW * 0.44),
        3.2,
        Math.sin(a) * (worldD * 0.44),
        0,
        0,
        0,
        false
      );
    }
  }

  group.position.set(
    params.gridX * GRID_UNIT_SIZE,
    0,
    params.gridZ * GRID_UNIT_SIZE
  );
  group.rotation.y = THREE.MathUtils.degToRad(params.rotation);
}

// Generate elevated Brutalist Skybridge ("Streets in the Sky") connecting two buildings
export function generateSkybridgeMesh(
  link: SkybridgeLink,
  fromBld: BuildingParams,
  toBld: BuildingParams,
  visualStyle: VisualStyle,
  simMode: SimulationMode,
  clippingPlanes: THREE.Plane[] = []
): THREE.Group {
  const group = new THREE.Group();
  group.name = link.id;
  group.userData = { skybridgeId: link.id, link };

  const mats = getConcreteMaterials('board_formed', 0.8, visualStyle);
  const bridgeMat =
    simMode === 'circulation'
      ? new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.35,
          roughness: 0.4,
        })
      : simMode === 'structural'
      ? new THREE.MeshStandardMaterial({
          color: 0xf59e0b,
          roughness: 0.5,
        })
      : mats.primary;

  const p1 = new THREE.Vector3(
    fromBld.gridX * GRID_UNIT_SIZE,
    0.8 + link.floorLevel * 3.4,
    fromBld.gridZ * GRID_UNIT_SIZE
  );
  const p2 = new THREE.Vector3(
    toBld.gridX * GRID_UNIT_SIZE,
    0.8 + link.floorLevel * 3.4,
    toBld.gridZ * GRID_UNIT_SIZE
  );

  const dist = p1.distanceTo(p2);
  const mid = p1.clone().add(p2).multiplyScalar(0.5);
  const angle = Math.atan2(p2.x - p1.x, p2.z - p1.z);

  const deckW = 3.2;
  const deckH = 0.55;

  // Main deck slab
  const deckGeo = new THREE.BoxGeometry(deckW, deckH, dist);
  addMeshWithEdges(
    group,
    deckGeo,
    bridgeMat,
    visualStyle,
    mid.x,
    mid.y,
    mid.z,
    0,
    angle,
    0
  );

  // Brutalist Vierendeel truss walls or concrete parapets
  const parapetH = link.trussStyle === 'open_walkway' ? 1.25 : 2.8;
  const leftParapet = new THREE.BoxGeometry(0.32, parapetH, dist);
  const rightParapet = new THREE.BoxGeometry(0.32, parapetH, dist);

  const subGroup = new THREE.Group();
  subGroup.position.copy(mid);
  subGroup.rotation.y = angle;
  group.add(subGroup);

  addMeshWithEdges(
    subGroup,
    leftParapet,
    mats.secondary,
    visualStyle,
    -deckW / 2 + 0.16,
    parapetH / 2,
    0
  );
  addMeshWithEdges(
    subGroup,
    rightParapet,
    mats.secondary,
    visualStyle,
    deckW / 2 - 0.16,
    parapetH / 2,
    0
  );

  if (link.trussStyle !== 'open_walkway') {
    const roofGeo = new THREE.BoxGeometry(deckW + 0.4, 0.38, dist);
    addMeshWithEdges(
      subGroup,
      roofGeo,
      bridgeMat,
      visualStyle,
      0,
      parapetH,
      0
    );
  }

  // Intermediate monumental V-pier support if skybridge span is long
  if (dist > GRID_UNIT_SIZE * 2.2) {
    const pierH = mid.y;
    const pierGeo = new THREE.BoxGeometry(1.2, pierH, 1.8);
    addMeshWithEdges(
      subGroup,
      pierGeo,
      mats.core,
      visualStyle,
      0,
      -pierH / 2,
      0
    );
  }

  applyClippingToGroup(group, clippingPlanes);
  return group;
}

function applyClippingToGroup(
  group: THREE.Group,
  clippingPlanes: THREE.Plane[]
) {
  if (!clippingPlanes.length) return;
  group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => {
          const clone = m.clone();
          clone.clippingPlanes = clippingPlanes;
          clone.clipShadows = true;
          clone.side = THREE.DoubleSide;
          return clone;
        });
      } else if (mesh.material) {
        const clone = mesh.material.clone();
        clone.clippingPlanes = clippingPlanes;
        clone.clipShadows = true;
        clone.side = THREE.DoubleSide;
        mesh.material = clone;
      }
    }
  });
}
