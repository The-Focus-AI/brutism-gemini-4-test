import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BuildingArchetype,
  BuildingParams,
  HeliodonState,
  SectionCutState,
  SimulationMode,
  SkybridgeLink,
  ToolMode,
  ViewMode,
  VisualStyle,
  WeatherMode,
} from './types';
import {
  generateBuildingMesh,
  generateSkybridgeMesh,
  GRID_UNIT_SIZE,
} from './buildingGenerator';
import { createConcreteTextures } from './textures';
import {
  calculateSolarPosition,
  SolarPosition,
  UrbanSimulationVisualizer,
} from './simulations';
import { ARCHETYPE_PRESETS } from './presets';

export class BrutalistSceneManager {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public perspCamera: THREE.PerspectiveCamera;
  public orthoCamera: THREE.OrthographicCamera;
  public activeCamera: THREE.Camera;
  public controls: OrbitControls;

  private container: HTMLElement;
  private buildingsGroup: THREE.Group;
  private skybridgesGroup: THREE.Group;
  private environmentGroup: THREE.Group;
  private selectionBoxMesh: THREE.LineSegments;
  private ghostGroup: THREE.Group;
  private sectionPlaneHelper: THREE.Mesh;
  private rainPoints: THREE.Points | null = null;
  private plinthMesh: THREE.Mesh | null = null;

  private sunLight: THREE.DirectionalLight;
  private ambientLight: THREE.HemisphereLight;
  private plazaLights: THREE.PointLight[] = [];

  public simVisualizer: UrbanSimulationVisualizer;

  // State references
  public buildings: BuildingParams[] = [];
  public skybridges: SkybridgeLink[] = [];
  public selectedBuildingId: string | null = null;
  public skybridgeSourceId: string | null = null;

  public viewMode: ViewMode = 'orbit';
  public visualStyle: VisualStyle = 'photoreal';
  public weatherMode: WeatherMode = 'clear_brut';
  public simMode: SimulationMode = 'none';
  public toolMode: ToolMode = 'select';
  public activeArchetype: BuildingArchetype = 'unite';
  public placementRotation: number = 0;
  public skybridgeFloorLevel: number = 3;

  public heliodon: HeliodonState = {
    timeOfDay: 14.5,
    dayOfYear: 172,
    latitude: 42,
    autoAnimate: false,
  };

  public sectionCut: SectionCutState = {
    enabled: false,
    axis: 'x',
    position: 0,
  };

  // Street-level First-Person Flâneur controls
  public streetWalkElevated: boolean = false;
  private streetPos = new THREE.Vector3(0, 1.75, 42);
  private streetYaw = 0;
  private streetPitch = 0.12;
  private moveKeys = { w: false, a: false, s: false, d: false };
  private isDraggingStreetLook = false;

  // Raycasting
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hoveredGrid: { gx: number; gz: number } | null = null;
  private pointerDownPos = new THREE.Vector2();

  // Callbacks to UI
  private onSelectionChange: (bld: BuildingParams | null) => void;
  private onCityMutated: () => void;
  private onStatusToast: (msg: string) => void;

  private clock = new THREE.Clock();

  constructor(
    container: HTMLElement,
    callbacks: {
      onSelectionChange: (bld: BuildingParams | null) => void;
      onCityMutated: () => void;
      onStatusToast: (msg: string) => void;
    }
  ) {
    this.container = container;
    this.onSelectionChange = callbacks.onSelectionChange;
    this.onCityMutated = callbacks.onCityMutated;
    this.onStatusToast = callbacks.onStatusToast;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true, // Enables high-res architectural portfolio snapshot export
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xcbd2d9);
    this.scene.fog = new THREE.FogExp2(0xcbd2d9, 0.0022);

    const aspect = container.clientWidth / container.clientHeight;
    this.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.5, 900);
    this.perspCamera.position.set(105, 82, 125);

    const frustum = 95;
    this.orthoCamera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      -500,
      1000
    );
    this.orthoCamera.position.set(120, 120, 120);
    this.orthoCamera.lookAt(0, 0, 0);

    this.activeCamera = this.perspCamera;

    this.controls = new OrbitControls(this.perspCamera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 340;
    this.controls.target.set(0, 14, 0);

    // Lighting
    this.ambientLight = new THREE.HemisphereLight(0xdbe4ee, 0x5c5852, 0.72);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xfff6e5, 2.2);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    const d = 135;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 420;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Warm night uplights across the plaza
    [
      [-35, 8, -35],
      [35, 8, -35],
      [-35, 8, 35],
      [35, 8, 35],
      [0, 12, 0],
    ].forEach(([x, y, z]) => {
      const pt = new THREE.PointLight(0xff9e44, 0, 95, 1.5);
      pt.position.set(x, y, z);
      this.scene.add(pt);
      this.plazaLights.push(pt);
    });

    this.environmentGroup = new THREE.Group();
    this.buildingsGroup = new THREE.Group();
    this.skybridgesGroup = new THREE.Group();
    this.ghostGroup = new THREE.Group();
    this.scene.add(
      this.environmentGroup,
      this.buildingsGroup,
      this.skybridgesGroup,
      this.ghostGroup
    );

    // Selection wireframe box
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const boxEdges = new THREE.EdgesGeometry(boxGeo);
    this.selectionBoxMesh = new THREE.LineSegments(
      boxEdges,
      new THREE.LineBasicMaterial({ color: 0xff5a1f, linewidth: 2 })
    );
    this.selectionBoxMesh.visible = false;
    this.scene.add(this.selectionBoxMesh);

    // Visual Section Plane laser frame
    const secGeo = new THREE.PlaneGeometry(220, 140);
    const secMat = new THREE.MeshBasicMaterial({
      color: 0xff5a1f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    this.sectionPlaneHelper = new THREE.Mesh(secGeo, secMat);
    const secEdges = new THREE.EdgesGeometry(secGeo);
    this.sectionPlaneHelper.add(
      new THREE.LineSegments(
        secEdges,
        new THREE.LineBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.7 })
      )
    );
    this.sectionPlaneHelper.visible = false;
    this.scene.add(this.sectionPlaneHelper);

    // Urban Simulation Visualizer
    this.simVisualizer = new UrbanSimulationVisualizer();
    this.scene.add(this.simVisualizer.rootGroup);

    this.buildUrbanConcretePlinth();
    this.buildRainParticles();
    this.bindEvents();
    this.updateLightingAndAtmosphere();
  }

  private buildUrbanConcretePlinth() {
    const plinthSize = 15 * GRID_UNIT_SIZE; // 210m x 210m masterplan slab
    const { map, bumpMap } = createConcreteTextures('board_formed', 0.4);
    map.repeat.set(18, 18);
    bumpMap.repeat.set(18, 18);

    const plinthMat = new THREE.MeshStandardMaterial({
      map,
      bumpMap,
      bumpScale: 0.06,
      color: 0xbab6ae,
      roughness: 0.85,
      metalness: 0.05,
    });

    const plinthGeo = new THREE.BoxGeometry(plinthSize, 4, plinthSize);
    this.plinthMesh = new THREE.Mesh(plinthGeo, plinthMat);
    this.plinthMesh.position.y = -2;
    this.plinthMesh.receiveShadow = true;
    this.environmentGroup.add(this.plinthMesh);

    // Brutalist Coffered Sub-Plinth Base & Retaining Wall
    const subGeo = new THREE.BoxGeometry(plinthSize + 8, 8, plinthSize + 8);
    const subMat = new THREE.MeshStandardMaterial({
      color: 0x52504c,
      roughness: 0.92,
    });
    const subMesh = new THREE.Mesh(subGeo, subMat);
    subMesh.position.y = -6.2;
    this.environmentGroup.add(subMesh);

    // Architectural Grid Hairlines on the Concrete Plinth
    const gridHelper = new THREE.GridHelper(
      plinthSize,
      15,
      0x3f3d3a,
      0x7d7972
    );
    gridHelper.position.y = 0.04;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.45;
    this.environmentGroup.add(gridHelper);
  }

  private buildRainParticles() {
    const count = 2400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 220;
      positions[i * 3 + 1] = Math.random() * 120;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 220;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xdbeafe,
      size: 0.45,
      transparent: true,
      opacity: 0.55,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  public getActiveClippingPlanes(): THREE.Plane[] {
    if (!this.sectionCut.enabled) {
      this.sectionPlaneHelper.visible = false;
      return [];
    }
    this.sectionPlaneHelper.visible = true;
    const pos = this.sectionCut.position;

    if (this.sectionCut.axis === 'x') {
      this.sectionPlaneHelper.position.set(pos, 55, 0);
      this.sectionPlaneHelper.rotation.set(0, Math.PI / 2, 0);
      return [new THREE.Plane(new THREE.Vector3(-1, 0, 0), pos)];
    } else if (this.sectionCut.axis === 'z') {
      this.sectionPlaneHelper.position.set(0, 55, pos);
      this.sectionPlaneHelper.rotation.set(0, 0, 0);
      return [new THREE.Plane(new THREE.Vector3(0, 0, -1), pos)];
    } else {
      // Horizontal Architectural Floor Plan Cut (Y axis)
      const cutY = Math.max(2, pos + 45);
      this.sectionPlaneHelper.position.set(0, cutY, 0);
      this.sectionPlaneHelper.rotation.set(Math.PI / 2, 0, 0);
      return [new THREE.Plane(new THREE.Vector3(0, -1, 0), cutY)];
    }
  }

  public rebuildAllGeometry() {
    while (this.buildingsGroup.children.length > 0) {
      this.buildingsGroup.remove(this.buildingsGroup.children[0]);
    }
    while (this.skybridgesGroup.children.length > 0) {
      this.skybridgesGroup.remove(this.skybridgesGroup.children[0]);
    }

    const solarPos = calculateSolarPosition(this.heliodon);
    const isNight =
      solarPos.isNight || this.weatherMode === 'sodium_night';
    const clipPlanes = this.getActiveClippingPlanes();

    this.buildings.forEach((b) => {
      const meshGroup = generateBuildingMesh(
        b,
        this.visualStyle,
        isNight,
        this.simMode,
        solarPos.altitudeDeg,
        clipPlanes
      );
      this.buildingsGroup.add(meshGroup);
    });

    this.skybridges.forEach((s) => {
      const fromBld = this.buildings.find((b) => b.id === s.fromBuildingId);
      const toBld = this.buildings.find((b) => b.id === s.toBuildingId);
      if (fromBld && toBld) {
        const bridgeMesh = generateSkybridgeMesh(
          s,
          fromBld,
          toBld,
          this.visualStyle,
          this.simMode,
          clipPlanes
        );
        this.skybridgesGroup.add(bridgeMesh);
      }
    });

    this.simVisualizer.rebuildForCity(
      this.buildings,
      this.skybridges,
      this.simMode
    );
    this.updateSelectionHighlight();
    this.updateGhostPreview();
  }

  public updateSingleBuilding(buildingId: string) {
    const existing = this.buildingsGroup.getObjectByName(buildingId);
    if (existing) {
      this.buildingsGroup.remove(existing);
    }
    const b = this.buildings.find((item) => item.id === buildingId);
    if (!b) return;

    const solarPos = calculateSolarPosition(this.heliodon);
    const isNight =
      solarPos.isNight || this.weatherMode === 'sodium_night';
    const clipPlanes = this.getActiveClippingPlanes();

    const meshGroup = generateBuildingMesh(
      b,
      this.visualStyle,
      isNight,
      this.simMode,
      solarPos.altitudeDeg,
      clipPlanes
    );
    this.buildingsGroup.add(meshGroup);
    this.updateSelectionHighlight();
    this.simVisualizer.rebuildForCity(
      this.buildings,
      this.skybridges,
      this.simMode
    );
  }

  public updateSelectionHighlight() {
    if (!this.selectedBuildingId) {
      this.selectionBoxMesh.visible = false;
      return;
    }
    const b = this.buildings.find((item) => item.id === this.selectedBuildingId);
    if (!b) {
      this.selectionBoxMesh.visible = false;
      return;
    }

    const w = b.footprintW * GRID_UNIT_SIZE + Math.max(0, b.cantileverOverhang * 1.4);
    const d = b.footprintD * GRID_UNIT_SIZE + Math.max(0, b.cantileverOverhang * 1.4);
    const h = Math.max(
      4,
      0.8 + (b.pilotisHeight + b.floors) * b.floorHeight + 3.5
    );

    this.selectionBoxMesh.scale.set(w, h, d);
    this.selectionBoxMesh.position.set(
      b.gridX * GRID_UNIT_SIZE,
      h / 2,
      b.gridZ * GRID_UNIT_SIZE
    );
    this.selectionBoxMesh.rotation.y = THREE.MathUtils.degToRad(b.rotation);
    this.selectionBoxMesh.visible = true;
  }

  public updateGhostPreview() {
    while (this.ghostGroup.children.length > 0) {
      this.ghostGroup.remove(this.ghostGroup.children[0]);
    }
    if (this.toolMode !== 'place' || !this.hoveredGrid) return;

    const preset = ARCHETYPE_PRESETS[this.activeArchetype];
    const w = preset.defaults.footprintW * GRID_UNIT_SIZE - 1.5;
    const d = preset.defaults.footprintD * GRID_UNIT_SIZE - 1.5;
    const h =
      (preset.defaults.pilotisHeight + preset.defaults.floors) *
      preset.defaults.floorHeight;

    const occupied = this.isGridCellOccupied(
      this.hoveredGrid.gx,
      this.hoveredGrid.gz
    );
    const ghostColor = occupied ? 0xef4444 : 0xff5a1f;

    const geo = new THREE.BoxGeometry(w, Math.max(3, h), d);
    const mat = new THREE.MeshBasicMaterial({
      color: ghostColor,
      transparent: true,
      opacity: 0.28,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      this.hoveredGrid.gx * GRID_UNIT_SIZE,
      Math.max(3, h) / 2,
      this.hoveredGrid.gz * GRID_UNIT_SIZE
    );
    mesh.rotation.y = THREE.MathUtils.degToRad(this.placementRotation);

    const edges = new THREE.EdgesGeometry(geo);
    mesh.add(
      new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({ color: ghostColor })
      )
    );
    this.ghostGroup.add(mesh);
  }

  public isGridCellOccupied(gx: number, gz: number, ignoreId?: string): boolean {
    return this.buildings.some((b) => {
      if (b.id === ignoreId) return false;
      const dx = Math.abs(b.gridX - gx);
      const dz = Math.abs(b.gridZ - gz);
      return dx < 1 && dz < 1;
    });
  }

  public setViewMode(mode: ViewMode) {
    this.viewMode = mode;
    if (mode === 'axonometric') {
      this.activeCamera = this.orthoCamera;
      this.controls.object = this.orthoCamera;
      this.controls.enabled = true;
      this.orthoCamera.position.set(140, 115, 140);
      this.orthoCamera.zoom = 0.85;
      this.orthoCamera.updateProjectionMatrix();
      this.controls.update();
    } else if (mode === 'street') {
      this.activeCamera = this.perspCamera;
      this.controls.enabled = false;
      this.perspCamera.fov = 62;
      this.perspCamera.updateProjectionMatrix();
      this.streetPos.y = this.streetWalkElevated ? 11.6 : 1.75;
      this.onStatusToast(
        'STREET FLÂNEUR MODE // Use WASD or Arrow Keys to walk, Drag mouse to look up at pilotis & cantilevers'
      );
    } else {
      this.activeCamera = this.perspCamera;
      this.perspCamera.fov = 45;
      this.perspCamera.updateProjectionMatrix();
      this.controls.object = this.perspCamera;
      this.controls.enabled = true;
    }
  }

  public focusOnBuilding(b: BuildingParams) {
    if (this.viewMode === 'street') return;
    const tx = b.gridX * GRID_UNIT_SIZE;
    const tz = b.gridZ * GRID_UNIT_SIZE;
    const th = ((b.pilotisHeight + b.floors) * b.floorHeight) * 0.45;
    this.controls.target.set(tx, th, tz);
  }

  public updateLightingAndAtmosphere(): SolarPosition {
    const solarPos = calculateSolarPosition(this.heliodon);
    const sunDist = 185;
    this.sunLight.position.copy(solarPos.direction.clone().multiplyScalar(sunDist));

    const isNight =
      solarPos.isNight || this.weatherMode === 'sodium_night';

    if (this.rainPoints) {
      this.rainPoints.visible = this.weatherMode === 'london_drizzle';
    }

    // Wet reflective concrete ground in London Drizzle mode
    if (this.plinthMesh) {
      const pMat = this.plinthMesh.material as THREE.MeshStandardMaterial;
      if (this.visualStyle === 'blueprint') {
        pMat.color.setHex(0x071a30);
        pMat.roughness = 0.9;
      } else if (this.visualStyle === 'herve_mono') {
        pMat.color.setHex(0x888888);
        pMat.roughness = 0.75;
      } else if (this.weatherMode === 'london_drizzle') {
        pMat.color.setHex(0x7d8082);
        pMat.roughness = 0.22; // Wet specular sheen
        pMat.metalness = 0.25;
      } else {
        pMat.color.setHex(0xbab6ae);
        pMat.roughness = 0.85;
        pMat.metalness = 0.05;
      }
    }

    // Visual style & weather sky/fog tuning
    if (this.visualStyle === 'blueprint') {
      this.scene.background = new THREE.Color(0x061527);
      this.scene.fog = new THREE.FogExp2(0x061527, 0.0018);
      this.sunLight.intensity = 1.4;
      this.sunLight.color.setHex(0x9be2ff);
      this.ambientLight.intensity = 0.9;
    } else if (this.visualStyle === 'herve_mono') {
      this.scene.background = new THREE.Color(0x161616);
      this.scene.fog = new THREE.FogExp2(0x161616, 0.0024);
      this.sunLight.intensity = 3.2; // Stark Lucien Hervé chiaroscuro contrast
      this.sunLight.color.setHex(0xffffff);
      this.ambientLight.intensity = 0.32;
    } else if (isNight) {
      this.scene.background = new THREE.Color(0x0d131c);
      this.scene.fog = new THREE.FogExp2(0x0d131c, 0.0032);
      this.sunLight.intensity = 0.22;
      this.sunLight.color.setHex(0x64748b);
      this.ambientLight.intensity = 0.28;
      this.plazaLights.forEach((pt) => (pt.intensity = 2.6));
    } else if (this.weatherMode === 'london_drizzle') {
      this.scene.background = new THREE.Color(0x6e7882);
      this.scene.fog = new THREE.FogExp2(0x6e7882, 0.0046);
      this.sunLight.intensity = 1.05;
      this.sunLight.color.setHex(0xcbd5e1);
      this.ambientLight.intensity = 0.85;
      this.plazaLights.forEach((pt) => (pt.intensity = 0.6));
    } else if (this.weatherMode === 'morning_mist') {
      this.scene.background = new THREE.Color(0xd6d9dc);
      this.scene.fog = new THREE.FogExp2(0xd6d9dc, 0.0068);
      this.sunLight.intensity = 1.55;
      this.sunLight.color.setHex(0xfff1d6);
      this.ambientLight.intensity = 0.82;
      this.plazaLights.forEach((pt) => (pt.intensity = 0));
    } else if (
      this.weatherMode === 'golden_cantilever' ||
      solarPos.altitudeDeg < 18
    ) {
      this.scene.background = new THREE.Color(0xc99c7e);
      this.scene.fog = new THREE.FogExp2(0xc99c7e, 0.0028);
      this.sunLight.intensity = 2.6;
      this.sunLight.color.setHex(0xffa952);
      this.ambientLight.intensity = 0.55;
      this.plazaLights.forEach((pt) => (pt.intensity = 0.8));
    } else {
      // Clear Brutalist Sun
      this.scene.background = new THREE.Color(0xc4cdd6);
      this.scene.fog = new THREE.FogExp2(0xc4cdd6, 0.0019);
      this.sunLight.intensity = 2.35;
      this.sunLight.color.setHex(0xfff7eb);
      this.ambientLight.intensity = 0.72;
      this.plazaLights.forEach((pt) => (pt.intensity = 0));
    }

    return solarPos;
  }

  private bindEvents() {
    const dom = this.renderer.domElement;

    window.addEventListener('resize', () => {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      const aspect = w / h;

      this.perspCamera.aspect = aspect;
      this.perspCamera.updateProjectionMatrix();

      const frustum = 95;
      this.orthoCamera.left = (-frustum * aspect) / 2;
      this.orthoCamera.right = (frustum * aspect) / 2;
      this.orthoCamera.top = frustum / 2;
      this.orthoCamera.bottom = -frustum / 2;
      this.orthoCamera.updateProjectionMatrix();

      this.renderer.setSize(w, h);
    });

    dom.addEventListener('pointerdown', (e) => {
      this.pointerDownPos.set(e.clientX, e.clientY);
      if (this.viewMode === 'street') {
        this.isDraggingStreetLook = true;
      }
    });

    window.addEventListener('pointerup', (e) => {
      this.isDraggingStreetLook = false;
      const dist = Math.hypot(
        e.clientX - this.pointerDownPos.x,
        e.clientY - this.pointerDownPos.y
      );
      if (dist < 6 && e.target === dom && e.button === 0) {
        this.handleCanvasClick(e);
      }
    });

    dom.addEventListener('pointermove', (e) => {
      if (this.viewMode === 'street' && this.isDraggingStreetLook) {
        this.streetYaw -= e.movementX * 0.0045;
        this.streetPitch = Math.max(
          -1.1,
          Math.min(1.25, this.streetPitch - e.movementY * 0.0045)
        );
        return;
      }

      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (this.toolMode === 'place') {
        this.raycaster.setFromCamera(this.pointer, this.activeCamera);
        const hit = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
          const gx = Math.max(-7, Math.min(7, Math.round(hit.x / GRID_UNIT_SIZE)));
          const gz = Math.max(-7, Math.min(7, Math.round(hit.z / GRID_UNIT_SIZE)));
          if (
            !this.hoveredGrid ||
            this.hoveredGrid.gx !== gx ||
            this.hoveredGrid.gz !== gz
          ) {
            this.hoveredGrid = { gx, gz };
            this.updateGhostPreview();
          }
        }
      }
    });

    window.addEventListener('keydown', (e) => {
      if (
        document.activeElement &&
        ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)
      ) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') this.moveKeys.w = true;
      if (k === 's' || e.key === 'ArrowDown') this.moveKeys.s = true;
      if (k === 'a' || e.key === 'ArrowLeft') this.moveKeys.a = true;
      if (k === 'd' || e.key === 'ArrowRight') this.moveKeys.d = true;

      if (k === 'r') {
        this.placementRotation = (this.placementRotation + 90) % 360;
        if (this.selectedBuildingId && this.toolMode === 'select') {
          const b = this.buildings.find((i) => i.id === this.selectedBuildingId);
          if (b) {
            b.rotation = (b.rotation + 90) % 360;
            this.updateSingleBuilding(b.id);
            this.onSelectionChange(b);
            this.onCityMutated();
          }
        } else {
          this.updateGhostPreview();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') this.moveKeys.w = false;
      if (k === 's' || e.key === 'ArrowDown') this.moveKeys.s = false;
      if (k === 'a' || e.key === 'ArrowLeft') this.moveKeys.a = false;
      if (k === 'd' || e.key === 'ArrowRight') this.moveKeys.d = false;
    });
  }

  private handleCanvasClick(e: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.activeCamera);

    // Check building intersection first
    const hits = this.raycaster.intersectObjects(this.buildingsGroup.children, true);
    let hitBuildingId: string | null = null;
    if (hits.length > 0) {
      let obj: THREE.Object3D | null = hits[0].object;
      while (obj && !obj.userData?.buildingId) {
        obj = obj.parent;
      }
      if (obj?.userData?.buildingId) {
        hitBuildingId = obj.userData.buildingId;
      }
    }

    if (this.toolMode === 'place') {
      const pt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, pt)) {
        const gx = Math.max(-7, Math.min(7, Math.round(pt.x / GRID_UNIT_SIZE)));
        const gz = Math.max(-7, Math.min(7, Math.round(pt.z / GRID_UNIT_SIZE)));
        this.placeBuildingAt(gx, gz);
      }
      return;
    }

    if (this.toolMode === 'demolish') {
      if (hitBuildingId) {
        this.demolishBuilding(hitBuildingId);
      }
      return;
    }

    if (this.toolMode === 'pipette') {
      if (hitBuildingId) {
        const sourceBld = this.buildings.find((b) => b.id === hitBuildingId);
        if (sourceBld) {
          this.activeArchetype = sourceBld.archetype;
          this.selectedBuildingId = sourceBld.id;
          this.updateSelectionHighlight();
          this.onSelectionChange(sourceBld);
          this.onStatusToast(
            `PIPETTE COPIED // Sampled tectonic parameters from "${sourceBld.name}"`
          );
        }
      }
      return;
    }

    if (this.toolMode === 'skybridge') {
      if (!hitBuildingId) {
        this.skybridgeSourceId = null;
        this.onStatusToast(
          'SKYBRIDGE TOOL // Click first building, then click destination building'
        );
        return;
      }
      if (!this.skybridgeSourceId) {
        this.skybridgeSourceId = hitBuildingId;
        this.selectedBuildingId = hitBuildingId;
        this.updateSelectionHighlight();
        const b1 = this.buildings.find((b) => b.id === hitBuildingId);
        this.onStatusToast(
          `SKYBRIDGE ORIGIN: "${b1?.name}" // Now click a second building to span an elevated walkway`
        );
      } else if (this.skybridgeSourceId !== hitBuildingId) {
        this.connectSkybridge(this.skybridgeSourceId, hitBuildingId);
        this.skybridgeSourceId = null;
      }
      return;
    }

    // Default 'select' mode
    this.selectedBuildingId = hitBuildingId;
    this.updateSelectionHighlight();
    const selected =
      this.buildings.find((b) => b.id === hitBuildingId) || null;
    this.onSelectionChange(selected);
  }

  public placeBuildingAt(gx: number, gz: number) {
    if (this.isGridCellOccupied(gx, gz)) {
      this.onStatusToast(
        'SECTOR OCCUPIED // Select existing structure or demolish before pouring new foundations'
      );
      return;
    }
    const preset = ARCHETYPE_PRESETS[this.activeArchetype];
    const newBld: BuildingParams = {
      id: `bld_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      gridX: gx,
      gridZ: gz,
      rotation: this.placementRotation,
      ...structuredClone(preset.defaults),
    };
    this.buildings.push(newBld);
    this.selectedBuildingId = newBld.id;
    this.rebuildAllGeometry();
    this.onSelectionChange(newBld);
    this.onCityMutated();
    this.onStatusToast(
      `CONSTRUCTED // ${newBld.name} at Sector (${gx >= 0 ? '+' : ''}${gx}, ${gz >= 0 ? '+' : ''}${gz})`
    );
  }

  public demolishBuilding(buildingId: string) {
    const bld = this.buildings.find((b) => b.id === buildingId);
    this.buildings = this.buildings.filter((b) => b.id !== buildingId);
    this.skybridges = this.skybridges.filter(
      (s) => s.fromBuildingId !== buildingId && s.toBuildingId !== buildingId
    );
    if (this.selectedBuildingId === buildingId) {
      this.selectedBuildingId = this.buildings[0]?.id || null;
      this.onSelectionChange(
        this.buildings.find((b) => b.id === this.selectedBuildingId) || null
      );
    }
    this.rebuildAllGeometry();
    this.onCityMutated();
    if (bld) {
      this.onStatusToast(`DEMOLISHED // Cleared "${bld.name}" from masterplan`);
    }
  }

  public connectSkybridge(fromId: string, toId: string) {
    const b1 = this.buildings.find((b) => b.id === fromId);
    const b2 = this.buildings.find((b) => b.id === toId);
    if (!b1 || !b2) return;

    const maxValidFloor = Math.min(
      b1.pilotisHeight + b1.floors - 1,
      b2.pilotisHeight + b2.floors - 1
    );
    const floorLevel = Math.max(
      1,
      Math.min(this.skybridgeFloorLevel, maxValidFloor)
    );

    const newLink: SkybridgeLink = {
      id: `sky_${Date.now()}`,
      fromBuildingId: fromId,
      toBuildingId: toId,
      floorLevel,
      trussStyle: 'vierendeel_truss',
    };
    this.skybridges.push(newLink);
    this.rebuildAllGeometry();
    this.onCityMutated();
    this.onStatusToast(
      `STREET IN THE SKY // Linked "${b1.name}" ↔ "${b2.name}" at Level +${floorLevel}`
    );
  }

  public animateLoop(onFrameTick?: () => void) {
    const tick = () => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.1, this.clock.getDelta());
      const elapsed = this.clock.getElapsedTime();

      if (this.heliodon.autoAnimate) {
        this.heliodon.timeOfDay = (this.heliodon.timeOfDay + dt * 0.85) % 24;
        if (onFrameTick) onFrameTick();
      }

      const solarPos = this.updateLightingAndAtmosphere();
      this.simVisualizer.update(dt, elapsed, solarPos);

      // Animate falling rain in London Drizzle mode
      if (this.rainPoints && this.rainPoints.visible) {
        const pos = this.rainPoints.geometry.getAttribute(
          'position'
        ) as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) - dt * 58;
          if (y < 0) y = 115;
          pos.setY(i, y);
        }
        pos.needsUpdate = true;
      }

      // Camera Mode Updates
      if (this.viewMode === 'drone') {
        const angle = elapsed * 0.16;
        const radius = 135;
        this.perspCamera.position.set(
          Math.cos(angle) * radius,
          68 + Math.sin(elapsed * 0.4) * 14,
          Math.sin(angle) * radius
        );
        this.perspCamera.lookAt(0, 18, 0);
      } else if (this.viewMode === 'street') {
        const speed = 22 * dt;
        const forward = new THREE.Vector3(
          -Math.sin(this.streetYaw),
          0,
          -Math.cos(this.streetYaw)
        );
        const right = new THREE.Vector3(
          Math.cos(this.streetYaw),
          0,
          -Math.sin(this.streetYaw)
        );

        if (this.moveKeys.w) this.streetPos.addScaledVector(forward, speed);
        if (this.moveKeys.s) this.streetPos.addScaledVector(forward, -speed);
        if (this.moveKeys.d) this.streetPos.addScaledVector(right, speed);
        if (this.moveKeys.a) this.streetPos.addScaledVector(right, -speed);

        this.streetPos.x = Math.max(-98, Math.min(98, this.streetPos.x));
        this.streetPos.z = Math.max(-98, Math.min(98, this.streetPos.z));
        const targetY = this.streetWalkElevated ? 11.6 : 1.75;
        this.streetPos.y += (targetY - this.streetPos.y) * 0.12;

        this.perspCamera.position.copy(this.streetPos);
        const lookTarget = new THREE.Vector3(
          this.streetPos.x - Math.sin(this.streetYaw) * Math.cos(this.streetPitch),
          this.streetPos.y + Math.sin(this.streetPitch),
          this.streetPos.z - Math.cos(this.streetYaw) * Math.cos(this.streetPitch)
        );
        this.perspCamera.lookAt(lookTarget);
      } else {
        this.controls.update();
      }

      this.renderer.render(this.scene, this.activeCamera);
    };
    tick();
  }
}
