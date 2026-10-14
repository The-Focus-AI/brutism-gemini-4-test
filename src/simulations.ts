import * as THREE from 'three';
import {
  BuildingParams,
  CityMetrics,
  HeliodonState,
  SimulationMode,
  SkybridgeLink,
} from './types';
import { GRID_UNIT_SIZE } from './buildingGenerator';

export interface SolarPosition {
  altitudeDeg: number;
  azimuthDeg: number;
  direction: THREE.Vector3;
  isNight: boolean;
}

export function calculateSolarPosition(heliodon: HeliodonState): SolarPosition {
  // Solar declination angle (degrees)
  const declination =
    23.45 * Math.sin(THREE.MathUtils.degToRad(((360 / 365) * (284 + heliodon.dayOfYear))));
  const latRad = THREE.MathUtils.degToRad(heliodon.latitude);
  const decRad = THREE.MathUtils.degToRad(declination);

  // Hour angle (15 deg per hour from solar noon = 12:00)
  const hourAngleDeg = (heliodon.timeOfDay - 12.0) * 15.0;
  const hourRad = THREE.MathUtils.degToRad(hourAngleDeg);

  const sinAlt =
    Math.sin(latRad) * Math.sin(decRad) +
    Math.cos(latRad) * Math.cos(decRad) * Math.cos(hourRad);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  const altitudeDeg = THREE.MathUtils.radToDeg(altRad);

  const cosAz =
    (Math.sin(decRad) - Math.sin(latRad) * Math.sin(altRad)) /
    Math.max(0.0001, Math.cos(latRad) * Math.cos(altRad));
  let azimuthDeg = THREE.MathUtils.radToDeg(
    Math.acos(Math.max(-1, Math.min(1, cosAz)))
  );
  if (hourAngleDeg > 0) {
    azimuthDeg = 360 - azimuthDeg;
  }

  const azRad = THREE.MathUtils.degToRad(azimuthDeg);
  const horizontal = Math.cos(altRad);
  const dir = new THREE.Vector3(
    Math.sin(azRad) * horizontal,
    Math.sin(altRad),
    -Math.cos(azRad) * horizontal
  ).normalize();

  return {
    altitudeDeg,
    azimuthDeg,
    direction: dir,
    isNight: altitudeDeg < 2.0,
  };
}

export function computeCityMetrics(
  buildings: BuildingParams[],
  skybridges: SkybridgeLink[],
  heliodon: HeliodonState
): CityMetrics {
  const totalBuildings = buildings.length;
  const totalSkybridges = skybridges.length;

  let residentialCapacity = 0;
  let embodiedConcreteTonnes = 0;
  let totalFootprintCells = 0;
  let openOrPilotisCells = 0;
  let shadingSum = 0;
  let windSum = 0;
  let structSum = 0;

  buildings.forEach((b) => {
    const cells = b.footprintW * b.footprintD;
    totalFootprintCells += cells;

    if (b.archetype === 'plaza_pool' || b.pilotisHeight >= 1) {
      openOrPilotisCells += cells * (b.archetype === 'plaza_pool' ? 1.0 : 0.82);
    }

    const floorAreaM2 = cells * 14 * 14 * b.floors;
    if (b.program === 'social_housing' || b.program === 'mixed_metabolist') {
      residentialCapacity += Math.round(floorAreaM2 / 32);
    } else if (b.program !== 'monument' && b.archetype !== 'plaza_pool') {
      residentialCapacity += Math.round(floorAreaM2 / 75);
    }

    // Concrete mass estimation
    const concreteFactor = 1.35 - b.glazingRatio * 0.55 + b.briseSoleilDepth * 0.22;
    embodiedConcreteTonnes += Math.round(floorAreaM2 * 0.68 * concreteFactor);

    // Solar shading efficiency (brise-soleil depth + fin angle + cantilever overhang)
    const bShade = Math.min(
      98,
      42 +
        (b.briseSoleilDepth / 2.2) * 32 +
        (b.cantileverOverhang / 6.0) * 18 +
        (Math.abs(b.finAngle) / 45) * 10 +
        b.ecoGreenery * 8
    );
    shadingSum += bShade;

    // Wind comfort (pilotis + stepped ziggurat + greenery improve pedestrian wind comfort)
    const bWind = Math.min(
      96,
      54 +
        (b.pilotisHeight > 0 ? 22 : -8) +
        (b.massingProfile === 'ziggurat' || b.massingProfile === 'cantilever_cluster' ? 12 : 0) +
        b.ecoGreenery * 14
    );
    windSum += bWind;

    // Structural safety index (core type + pilotis ratio vs cantilever overhang)
    const coreBonus =
      b.coreType === 'exoskeleton' || b.coreType === 'twin_external' ? 14 : 8;
    const overhangPenalty = Math.max(0, (b.cantileverOverhang - 4.0) * 4.5);
    const slendernessPenalty = Math.max(0, (b.floors - 18) * 0.9);
    const bStruct = Math.min(
      99,
      Math.max(58, 86 + coreBonus - overhangPenalty - slendernessPenalty)
    );
    structSum += bStruct;
  });

  const count = Math.max(1, totalBuildings);
  const groundPorosityPct = Math.round(
    Math.min(
      95,
      Math.max(
        18,
        ((225 - totalFootprintCells + openOrPilotisCells) / 225) * 100
      )
    )
  );

  const skybridgeConnectivityScore = Math.min(
    100,
    Math.round((totalSkybridges / Math.max(1, totalBuildings * 0.55)) * 100)
  );

  return {
    totalBuildings,
    totalSkybridges,
    residentialCapacity,
    embodiedConcreteTonnes,
    groundPorosityPct,
    solarShadingEfficiencyPct: Math.round(shadingSum / count),
    skybridgeConnectivityScore,
    windComfortScore: Math.round(windSum / count),
    structuralSafetyIndex: Math.round(structSum / count),
  };
}

interface CitizenParticle {
  mesh: THREE.Mesh;
  mode: 'ground' | 'skybridge' | 'elevator';
  start: THREE.Vector3;
  end: THREE.Vector3;
  progress: number;
  speed: number;
}

interface WindRibbon {
  line: THREE.Line;
  basePoints: THREE.Vector3[];
  phase: number;
  speed: number;
}

export class UrbanSimulationVisualizer {
  public rootGroup: THREE.Group;
  private heliodonGroup: THREE.Group;
  private windGroup: THREE.Group;
  private circulationGroup: THREE.Group;
  private structuralGroup: THREE.Group;

  private citizens: CitizenParticle[] = [];
  private windRibbons: WindRibbon[] = [];
  private sunOrbMesh: THREE.Mesh | null = null;
  private sunRayLine: THREE.Line | null = null;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'urban_simulations';

    this.heliodonGroup = new THREE.Group();
    this.windGroup = new THREE.Group();
    this.circulationGroup = new THREE.Group();
    this.structuralGroup = new THREE.Group();

    this.rootGroup.add(
      this.heliodonGroup,
      this.windGroup,
      this.circulationGroup,
      this.structuralGroup
    );

    this.buildHeliodonDome();
  }

  private buildHeliodonDome() {
    const radius = 118;
    // Compass ring at ground level
    const ringGeo = new THREE.RingGeometry(radius - 1.2, radius, 96);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.25;
    this.heliodonGroup.add(ring);

    // 3 Solar Path Arcs: Summer Solstice (day 172), Equinox (day 80), Winter Solstice (day 355)
    const arcs = [
      { day: 172, color: 0xf97316 },
      { day: 80, color: 0xfacc15 },
      { day: 355, color: 0x38bdf8 },
    ];

    arcs.forEach(({ day, color }) => {
      const pts: THREE.Vector3[] = [];
      for (let hr = 5; hr <= 19; hr += 0.25) {
        const pos = calculateSolarPosition({
          timeOfDay: hr,
          dayOfYear: day,
          latitude: 42,
          autoAnimate: false,
        });
        if (pos.altitudeDeg >= 0) {
          pts.push(pos.direction.clone().multiplyScalar(radius));
        }
      }
      if (pts.length > 1) {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.65,
        });
        this.heliodonGroup.add(new THREE.Line(geo, mat));
      }
    });

    // Sun Orb & Ray to Origin
    const orbGeo = new THREE.SphereGeometry(3.2, 20, 20);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    this.sunOrbMesh = new THREE.Mesh(orbGeo, orbMat);
    this.heliodonGroup.add(this.sunOrbMesh);

    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 50, 0),
    ]);
    const rayMat = new THREE.LineDashedMaterial({
      color: 0xffd166,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.75,
    });
    this.sunRayLine = new THREE.Line(rayGeo, rayMat);
    this.heliodonGroup.add(this.sunRayLine);
  }

  public rebuildForCity(
    buildings: BuildingParams[],
    skybridges: SkybridgeLink[],
    simMode: SimulationMode
  ) {
    this.heliodonGroup.visible = simMode === 'solar';
    this.windGroup.visible = simMode === 'wind';
    this.circulationGroup.visible = true; // Citizens always live in the city; enhanced paths show in 'circulation' mode
    this.structuralGroup.visible = simMode === 'structural';

    this.rebuildCitizensAndCirculation(buildings, skybridges, simMode === 'circulation');
    if (simMode === 'wind') {
      this.rebuildWindTunnel(buildings);
    }
    if (simMode === 'structural') {
      this.rebuildStructuralVectors(buildings, skybridges);
    }
  }

  private rebuildCitizensAndCirculation(
    buildings: BuildingParams[],
    skybridges: SkybridgeLink[],
    showSpaceSyntax: boolean
  ) {
    while (this.circulationGroup.children.length > 0) {
      this.circulationGroup.remove(this.circulationGroup.children[0]);
    }
    this.citizens = [];

    const citizenGeo = new THREE.CapsuleGeometry(0.28, 0.95, 4, 8);
    const groundMat = new THREE.MeshBasicMaterial({
      color: showSpaceSyntax ? 0x38bdf8 : 0xe2e8f0,
    });
    const skyMat = new THREE.MeshBasicMaterial({
      color: showSpaceSyntax ? 0xfbbf24 : 0xf59e0b,
    });
    const liftMat = new THREE.MeshBasicMaterial({
      color: 0xff6b35,
    });

    // 1. Skybridge pedestrians ("Streets in the Sky")
    skybridges.forEach((link) => {
      const b1 = buildings.find((b) => b.id === link.fromBuildingId);
      const b2 = buildings.find((b) => b.id === link.toBuildingId);
      if (!b1 || !b2) return;

      const y = 0.8 + link.floorLevel * 3.4 + 0.65;
      const p1 = new THREE.Vector3(b1.gridX * GRID_UNIT_SIZE, y, b1.gridZ * GRID_UNIT_SIZE);
      const p2 = new THREE.Vector3(b2.gridX * GRID_UNIT_SIZE, y, b2.gridZ * GRID_UNIT_SIZE);

      for (let i = 0; i < 4; i++) {
        const mesh = new THREE.Mesh(citizenGeo, skyMat);
        this.circulationGroup.add(mesh);
        this.citizens.push({
          mesh,
          mode: 'skybridge',
          start: i % 2 === 0 ? p1.clone() : p2.clone(),
          end: i % 2 === 0 ? p2.clone() : p1.clone(),
          progress: Math.random(),
          speed: 0.08 + Math.random() * 0.06,
        });
      }
    });

    // 2. Vertical Elevator Cars moving along building cores
    buildings.forEach((b) => {
      if (b.floors < 4 || b.archetype === 'plaza_pool') return;
      const bx = b.gridX * GRID_UNIT_SIZE;
      const bz = b.gridZ * GRID_UNIT_SIZE + (b.coreType === 'detached_tower' ? 7.5 : 0);
      const topY = 0.8 + (b.pilotisHeight + b.floors) * b.floorHeight;

      const liftGeo = new THREE.BoxGeometry(1.4, 2.2, 1.4);
      const liftMesh = new THREE.Mesh(liftGeo, liftMat);
      this.circulationGroup.add(liftMesh);
      this.citizens.push({
        mesh: liftMesh,
        mode: 'elevator',
        start: new THREE.Vector3(bx, 1.5, bz),
        end: new THREE.Vector3(bx, topY - 1.5, bz),
        progress: Math.random(),
        speed: 0.14 + Math.random() * 0.08,
      });
    });

    // 3. Ground Plaza Flâneurs walking between buildings & under pilotis
    for (let i = 0; i < 36; i++) {
      const bA = buildings[i % buildings.length];
      const bB = buildings[(i * 3 + 1) % buildings.length];
      if (!bA || !bB) continue;

      const start = new THREE.Vector3(
        bA.gridX * GRID_UNIT_SIZE + (Math.random() - 0.5) * 8,
        1.15,
        bA.gridZ * GRID_UNIT_SIZE + (Math.random() - 0.5) * 8
      );
      const end = new THREE.Vector3(
        bB.gridX * GRID_UNIT_SIZE + (Math.random() - 0.5) * 8,
        1.15,
        bB.gridZ * GRID_UNIT_SIZE + (Math.random() - 0.5) * 8
      );

      if (start.distanceTo(end) < 4) continue;

      const mesh = new THREE.Mesh(citizenGeo, groundMat);
      this.circulationGroup.add(mesh);
      this.citizens.push({
        mesh,
        mode: 'ground',
        start,
        end,
        progress: Math.random(),
        speed: 0.04 + Math.random() * 0.04,
      });

      if (showSpaceSyntax) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([start, end]);
        const lineMat = new THREE.LineBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.35,
        });
        this.circulationGroup.add(new THREE.Line(lineGeo, lineMat));
      }
    }
  }

  private rebuildWindTunnel(buildings: BuildingParams[]) {
    while (this.windGroup.children.length > 0) {
      this.windGroup.remove(this.windGroup.children[0]);
    }
    this.windRibbons = [];

    // Create 28 aerodynamic streamlines at multiple heights (ground pilotis level + mid-rise + high-rise)
    const heights = [2.6, 8.5, 18.0, 32.0];
    heights.forEach((h) => {
      for (let zIdx = -4; zIdx <= 4; zIdx++) {
        const baseZ = zIdx * (GRID_UNIT_SIZE * 1.15);
        const pts: THREE.Vector3[] = [];
        let maxDeflection = 0;

        for (let x = -95; x <= 95; x += 4) {
          let zOffset = 0;
          let yOffset = 0;

          buildings.forEach((b) => {
            if (b.archetype === 'plaza_pool') return;
            const bx = b.gridX * GRID_UNIT_SIZE;
            const bz = b.gridZ * GRID_UNIT_SIZE;
            const bTop = (b.pilotisHeight + b.floors) * b.floorHeight;
            const pilotisClearH = b.pilotisHeight * b.floorHeight;

            const dx = x - bx;
            const dz = baseZ - bz;
            const distSq = dx * dx + dz * dz;
            const radius = Math.max(b.footprintW, b.footprintD) * GRID_UNIT_SIZE * 0.65;

            if (distSq < radius * radius * 2.2 && h < bTop) {
              // If streamline is below pilotis height, wind passes smoothly underneath with mild Venturi speed-up!
              if (h < pilotisClearH) {
                yOffset -= 0.4 * Math.exp(-distSq / (radius * radius));
              } else {
                // Solid building mass deflects wind around sides
                const sign = dz >= 0 ? 1 : -1;
                const push =
                  sign * (radius * 1.15) * Math.exp(-distSq / (radius * radius * 0.9));
                zOffset += push;
                maxDeflection = Math.max(maxDeflection, Math.abs(push));
              }
            }
          });

          pts.push(new THREE.Vector3(x, h + yOffset, baseZ + zOffset));
        }

        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const isTurbulent = maxDeflection > 4.5;
        const mat = new THREE.LineBasicMaterial({
          color: isTurbulent ? 0xf97316 : 0x22d3ee,
          transparent: true,
          opacity: 0.78,
        });
        const line = new THREE.Line(geo, mat);
        this.windGroup.add(line);
        this.windRibbons.push({
          line,
          basePoints: pts,
          phase: Math.random() * Math.PI * 2,
          speed: isTurbulent ? 4.5 : 2.8,
        });
      }
    });
  }

  private rebuildStructuralVectors(
    buildings: BuildingParams[],
    skybridges: SkybridgeLink[]
  ) {
    while (this.structuralGroup.children.length > 0) {
      this.structuralGroup.remove(this.structuralGroup.children[0]);
    }

    const loadMat = new THREE.LineBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.88,
    });
    const tensionMat = new THREE.LineBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.85,
    });

    buildings.forEach((b) => {
      if (b.archetype === 'plaza_pool') return;
      const bx = b.gridX * GRID_UNIT_SIZE;
      const bz = b.gridZ * GRID_UNIT_SIZE;
      const topY = 0.8 + (b.pilotisHeight + b.floors) * b.floorHeight;

      // Primary vertical axial load line down core into foundation
      const corePts = [
        new THREE.Vector3(bx, topY + 3, bz),
        new THREE.Vector3(bx, 0, bz),
      ];
      this.structuralGroup.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints(corePts), loadMat)
      );

      // Cantilever moment tie-back diagonals
      if (b.cantileverOverhang > 1.5) {
        const reach = (b.footprintW * GRID_UNIT_SIZE) / 2 + b.cantileverOverhang;
        [
          [reach, 0],
          [-reach, 0],
          [0, reach],
          [0, -reach],
        ].forEach(([ox, oz]) => {
          const diagPts = [
            new THREE.Vector3(bx, topY, bz),
            new THREE.Vector3(bx + ox, topY * 0.68, bz + oz),
            new THREE.Vector3(bx, Math.max(2, b.pilotisHeight * b.floorHeight), bz),
          ];
          this.structuralGroup.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(diagPts),
              tensionMat
            )
          );
        });
      }
    });

    skybridges.forEach((s) => {
      const b1 = buildings.find((b) => b.id === s.fromBuildingId);
      const b2 = buildings.find((b) => b.id === s.toBuildingId);
      if (!b1 || !b2) return;
      const y = 0.8 + s.floorLevel * 3.4;
      const p1 = new THREE.Vector3(b1.gridX * GRID_UNIT_SIZE, y + 1.5, b1.gridZ * GRID_UNIT_SIZE);
      const p2 = new THREE.Vector3(b2.gridX * GRID_UNIT_SIZE, y + 1.5, b2.gridZ * GRID_UNIT_SIZE);
      this.structuralGroup.add(
        new THREE.Line(new THREE.BufferGeometry().setFromPoints([p1, p2]), tensionMat)
      );
    });
  }

  public update(dt: number, time: number, solarPos: SolarPosition) {
    // Update Heliodon Sun Orb
    if (this.sunOrbMesh && this.sunRayLine) {
      const orbPos = solarPos.direction.clone().multiplyScalar(118);
      this.sunOrbMesh.position.copy(orbPos);
      const posAttr = this.sunRayLine.geometry.getAttribute(
        'position'
      ) as THREE.BufferAttribute;
      posAttr.setXYZ(0, orbPos.x, orbPos.y, orbPos.z);
      posAttr.setXYZ(1, 0, 0, 0);
      posAttr.needsUpdate = true;
    }

    // Animate Citizens & Elevators
    this.citizens.forEach((c) => {
      c.progress += dt * c.speed;
      const pingPong =
        c.progress % 2 <= 1 ? c.progress % 1 : 1 - (c.progress % 1);
      c.mesh.position.lerpVectors(c.start, c.end, pingPong);
    });

    // Animate Wind Streamlines
    if (this.windGroup.visible) {
      this.windRibbons.forEach((r) => {
        const posAttr = r.line.geometry.getAttribute(
          'position'
        ) as THREE.BufferAttribute;
        for (let i = 0; i < r.basePoints.length; i++) {
          const bp = r.basePoints[i];
          const wave = Math.sin(time * r.speed - i * 0.35 + r.phase) * 0.45;
          posAttr.setXYZ(i, bp.x, bp.y + wave * 0.4, bp.z + wave);
        }
        posAttr.needsUpdate = true;
      });
    }
  }
}
