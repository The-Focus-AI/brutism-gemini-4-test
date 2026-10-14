import './style.css';
import {
  BuildingArchetype,
  BuildingParams,
  ConcreteFinish,
  CoreType,
  FacadeSystem,
  MassingProfile,
  PilotisStyle,
  RoofFeature,
  SimulationMode,
  ToolMode,
  ViewMode,
  VisualStyle,
  WeatherMode,
} from './types';
import { ARCHETYPE_PRESETS, CURATED_MASTERPLANS } from './presets';
import { BrutalistSceneManager } from './sceneManager';
import { calculateSolarPosition, computeCityMetrics } from './simulations';
import { audio } from './audio';
import { GRID_UNIT_SIZE } from './buildingGenerator';

const viewportEl = document.getElementById('viewport-container')!;
const toastEl = document.getElementById('status-toast')!;
let toastTimer: number | null = null;

function showToast(msg: string) {
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.style.opacity = '0.72';
  }, 4200);
}

const sceneManager = new BrutalistSceneManager(viewportEl, {
  onSelectionChange: (bld) => {
    syncInspectorToBuilding(bld);
    audio.playTectonicClick(0.2);
  },
  onCityMutated: () => {
    updateTelemetryHUD();
    audio.playConcreteThud(1.1);
  },
  onStatusToast: (msg) => {
    showToast(msg);
  },
});

// Populate Left-Dock 10 Brutalist Archetype Cards
const archetypeListEl = document.getElementById('archetype-list')!;
Object.values(ARCHETYPE_PRESETS).forEach((preset) => {
  const card = document.createElement('div');
  card.className = `archetype-card ${
    preset.archetype === sceneManager.activeArchetype ? 'active' : ''
  }`;
  card.dataset.archetype = preset.archetype;
  card.innerHTML = `
    <div class="arch-card-top">
      <span class="arch-code">${preset.code} // ${preset.architectRef.split('(')[0].trim()}</span>
      <span class="arch-year">${preset.yearRef}</span>
    </div>
    <div class="arch-title">${preset.title}</div>
    <div class="arch-sub">${preset.subtitle}</div>
  `;
  card.addEventListener('click', () => {
    document
      .querySelectorAll('.archetype-card')
      .forEach((el) => el.classList.remove('active'));
    card.classList.add('active');
    sceneManager.activeArchetype = preset.archetype;
    audio.playTectonicClick(0.4);

    // If user is in select mode, switch to 'place' or notify they can morph or place
    if (sceneManager.toolMode === 'place') {
      sceneManager.updateGhostPreview();
    }
    showToast(
      `ARCHETYPE ARMED // ${preset.code} ${preset.title} — Click grid in POUR mode [B] or click ⚡ MORPH ARCHETYPE`
    );
  });
  archetypeListEl.appendChild(card);
});

// Load Default Masterplan ("NEW BARBICAN-CHANDIGARH")
function loadMasterplan(key: string) {
  const plan = CURATED_MASTERPLANS[key];
  if (!plan) return;
  sceneManager.buildings = structuredClone(plan.buildings);
  sceneManager.skybridges = structuredClone(plan.skybridges);
  sceneManager.selectedBuildingId = sceneManager.buildings[0]?.id || null;

  document.getElementById('masterplan-subtitle')!.textContent = plan.title;
  sceneManager.rebuildAllGeometry();
  syncInspectorToBuilding(sceneManager.buildings[0] || null);
  updateTelemetryHUD();
  audio.playConcreteThud(1.4);
  showToast(`LOADED MASTERPLAN // ${plan.title} (${plan.buildings.length} structures)`);
}

// Sync Right-Dock Parametric Inspector to Selected Building
function syncInspectorToBuilding(b: BuildingParams | null) {
  const emptyEl = document.getElementById('inspector-empty')!;
  const contentEl = document.getElementById('inspector-content')!;

  if (!b) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  const preset = ARCHETYPE_PRESETS[b.archetype];
  document.getElementById('insp-code-badge')!.textContent = preset.code;
  (document.getElementById('inp-bld-name') as HTMLInputElement).value = b.name;
  document.getElementById('insp-architect')!.textContent = `Ref: ${b.architectRef} (${b.yearRef})`;
  document.getElementById('insp-sector')!.textContent = `SEC (${b.gridX >= 0 ? '+' : ''}${b.gridX}, ${b.gridZ >= 0 ? '+' : ''}${b.gridZ})`;
  document.getElementById('insp-tectonic-note')!.textContent = preset.tectonicNote;

  // Tab 1: Massing & Structure
  setSliderValue('inp-floors', 'val-floors', b.floors, `${b.floors} FL`);
  setSliderValue(
    'inp-floor-height',
    'val-floor-height',
    b.floorHeight,
    `${b.floorHeight.toFixed(1)} m`
  );
  setSliderValue(
    'inp-foot-w',
    'val-foot-w',
    b.footprintW,
    `${b.footprintW * GRID_UNIT_SIZE}m (${b.footprintW}x)`
  );
  setSliderValue(
    'inp-foot-d',
    'val-foot-d',
    b.footprintD,
    `${b.footprintD * GRID_UNIT_SIZE}m (${b.footprintD}x)`
  );
  (document.getElementById('inp-massing-profile') as HTMLSelectElement).value =
    b.massingProfile;
  setSliderValue(
    'inp-cantilever',
    'val-cantilever',
    b.cantileverOverhang,
    `${b.cantileverOverhang.toFixed(1)} m`
  );
  setSliderValue(
    'inp-pilotis-height',
    'val-pilotis-height',
    b.pilotisHeight,
    `${b.pilotisHeight} STORIES`
  );
  (document.getElementById('inp-pilotis-style') as HTMLSelectElement).value =
    b.pilotisStyle;
  (document.getElementById('inp-core-type') as HTMLSelectElement).value =
    b.coreType;

  // Tab 2: Envelope & Brise-Soleil
  (document.getElementById('inp-facade-system') as HTMLSelectElement).value =
    b.facadeSystem;
  setSliderValue(
    'inp-brise-depth',
    'val-brise-depth',
    b.briseSoleilDepth,
    `${b.briseSoleilDepth.toFixed(1)} m`
  );
  setSliderValue('inp-fin-angle', 'val-fin-angle', b.finAngle, `${b.finAngle}°`);
  setSliderValue(
    'inp-glazing-ratio',
    'val-glazing-ratio',
    b.glazingRatio,
    `${Math.round(b.glazingRatio * 100)}%`
  );
  setSliderValue(
    'inp-bay-width',
    'val-bay-width',
    b.bayModuleWidth,
    `${b.bayModuleWidth.toFixed(1)} m`
  );

  // Tab 3: Materiality & Roofscape
  (document.getElementById('inp-concrete-finish') as HTMLSelectElement).value =
    b.concreteFinish;
  setSliderValue(
    'inp-tie-holes',
    'val-tie-holes',
    b.tieHoleDensity,
    `${Math.round(b.tieHoleDensity * 100)}%`
  );
  setSliderValue(
    'inp-greenery',
    'val-greenery',
    b.ecoGreenery,
    `${Math.round(b.ecoGreenery * 100)}%`
  );
  (document.getElementById('inp-roof-feature') as HTMLSelectElement).value =
    b.roofFeature;
}

function setSliderValue(
  inputId: string,
  labelId: string,
  val: number,
  text: string
) {
  const inp = document.getElementById(inputId) as HTMLInputElement;
  const lbl = document.getElementById(labelId);
  if (inp) inp.value = String(val);
  if (lbl) lbl.textContent = text;
}

function getSelectedBuilding(): BuildingParams | null {
  if (!sceneManager.selectedBuildingId) return null;
  return (
    sceneManager.buildings.find((b) => b.id === sceneManager.selectedBuildingId) ||
    null
  );
}

function bindInspectorInputs() {
  const bindRange = (
    inputId: string,
    applyFn: (b: BuildingParams, val: number) => void
  ) => {
    const el = document.getElementById(inputId) as HTMLInputElement;
    el.addEventListener('input', () => {
      const b = getSelectedBuilding();
      if (!b) return;
      applyFn(b, parseFloat(el.value));
      syncInspectorToBuilding(b);
      sceneManager.updateSingleBuilding(b.id);
      updateTelemetryHUD();
      audio.playTectonicClick(( parseFloat(el.value) % 5 ) * 0.15);
    });
  };

  const bindSelect = (
    selectId: string,
    applyFn: (b: BuildingParams, val: string) => void
  ) => {
    const el = document.getElementById(selectId) as HTMLSelectElement;
    el.addEventListener('change', () => {
      const b = getSelectedBuilding();
      if (!b) return;
      applyFn(b, el.value);
      syncInspectorToBuilding(b);
      sceneManager.updateSingleBuilding(b.id);
      updateTelemetryHUD();
      audio.playConcreteThud(0.8);
    });
  };

  document.getElementById('inp-bld-name')!.addEventListener('input', (e) => {
    const b = getSelectedBuilding();
    if (b) b.name = (e.target as HTMLInputElement).value;
  });

  bindRange('inp-floors', (b, v) => (b.floors = Math.round(v)));
  bindRange('inp-floor-height', (b, v) => (b.floorHeight = v));
  bindRange('inp-foot-w', (b, v) => (b.footprintW = Math.round(v)));
  bindRange('inp-foot-d', (b, v) => (b.footprintD = Math.round(v)));
  bindSelect(
    'inp-massing-profile',
    (b, v) => (b.massingProfile = v as MassingProfile)
  );
  bindRange('inp-cantilever', (b, v) => (b.cantileverOverhang = v));
  bindRange('inp-pilotis-height', (b, v) => (b.pilotisHeight = Math.round(v)));
  bindSelect('inp-pilotis-style', (b, v) => (b.pilotisStyle = v as PilotisStyle));
  bindSelect('inp-core-type', (b, v) => (b.coreType = v as CoreType));

  bindSelect('inp-facade-system', (b, v) => (b.facadeSystem = v as FacadeSystem));
  bindRange('inp-brise-depth', (b, v) => (b.briseSoleilDepth = v));
  bindRange('inp-fin-angle', (b, v) => (b.finAngle = Math.round(v)));
  bindRange('inp-glazing-ratio', (b, v) => (b.glazingRatio = v));
  bindRange('inp-bay-width', (b, v) => (b.bayModuleWidth = v));

  bindSelect(
    'inp-concrete-finish',
    (b, v) => (b.concreteFinish = v as ConcreteFinish)
  );
  bindRange('inp-tie-holes', (b, v) => (b.tieHoleDensity = v));
  bindRange('inp-greenery', (b, v) => (b.ecoGreenery = v));
  bindSelect('inp-roof-feature', (b, v) => (b.roofFeature = v as RoofFeature));

  // Inspector Tabs
  document.querySelectorAll('.insp-tab').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      document
        .querySelectorAll('.insp-tab')
        .forEach((b) => b.classList.remove('active'));
      document
        .querySelectorAll('.insp-tab-pane')
        .forEach((p) => p.classList.remove('active'));
      tabBtn.classList.add('active');
      const targetId = (tabBtn as HTMLElement).dataset.tab!;
      document.getElementById(targetId)?.classList.add('active');
      audio.playTectonicClick(0.3);
    });
  });

  // Playful 1-Click Architectural Actions
  document.getElementById('btn-mutate-bld')!.addEventListener('click', () => {
    const b = getSelectedBuilding();
    if (!b) return;
    const profiles: MassingProfile[] = [
      'monolith',
      'inverted_ziggurat',
      'ziggurat',
      'cantilever_cluster',
      'split_court',
      'terraced_step',
    ];
    const pilotisStyles: PilotisStyle[] = [
      'v_strut',
      'tree_bent',
      'cruciform',
      'shear_blade',
      'cylindrical',
    ];
    const facades: FacadeSystem[] = [
      'brise_soleil_grid',
      'coffered_waffle',
      'vertical_fins',
      'ribbon_band',
      'recessed_loggia',
      'capsule_porthole',
    ];
    const roofs: RoofFeature[] = [
      'sculptural_vent',
      'barrel_vaults',
      'sky_garden',
      'water_tank',
      'brutalist_spire',
      'flat_coffered',
    ];

    b.floors = Math.max(4, Math.min(28, b.floors + Math.round((Math.random() - 0.45) * 8)));
    b.pilotisHeight = Math.floor(Math.random() * 4);
    b.pilotisStyle = pilotisStyles[Math.floor(Math.random() * pilotisStyles.length)];
    b.massingProfile = profiles[Math.floor(Math.random() * profiles.length)];
    b.cantileverOverhang = Number((1.0 + Math.random() * 6.0).toFixed(1));
    b.facadeSystem = facades[Math.floor(Math.random() * facades.length)];
    b.briseSoleilDepth = Number((0.6 + Math.random() * 1.6).toFixed(1));
    b.finAngle = Math.round((Math.random() - 0.5) * 12) * 5;
    b.roofFeature = roofs[Math.floor(Math.random() * roofs.length)];

    syncInspectorToBuilding(b);
    sceneManager.updateSingleBuilding(b.id);
    updateTelemetryHUD();
    audio.playConcreteThud(1.0);
    showToast(`MUTATED TECTONIC DNA // Generated parametric variation for "${b.name}"`);
  });

  document.getElementById('btn-ecobrut-bld')!.addEventListener('click', () => {
    const b = getSelectedBuilding();
    if (!b) return;
    b.concreteFinish = 'weathered_moss';
    b.ecoGreenery = 0.95;
    b.roofFeature = 'sky_garden';
    syncInspectorToBuilding(b);
    sceneManager.updateSingleBuilding(b.id);
    updateTelemetryHUD();
    audio.playSkybridgeChord();
    showToast(`ECO-BRUTALIZED // Added hanging botanical terraces & weathered moss patina to "${b.name}"`);
  });

  document.getElementById('btn-rotate-bld')!.addEventListener('click', () => {
    const b = getSelectedBuilding();
    if (!b) return;
    b.rotation = (b.rotation + 90) % 360;
    sceneManager.updateSingleBuilding(b.id);
    audio.playTectonicClick(0.6);
    showToast(`ROTATED // "${b.name}" oriented to ${b.rotation}°`);
  });

  document.getElementById('btn-apply-archetype')!.addEventListener('click', () => {
    const b = getSelectedBuilding();
    if (!b) return;
    const preset = ARCHETYPE_PRESETS[sceneManager.activeArchetype];
    const keepPos = { id: b.id, gridX: b.gridX, gridZ: b.gridZ, rotation: b.rotation };
    Object.assign(b, structuredClone(preset.defaults), keepPos);
    syncInspectorToBuilding(b);
    sceneManager.updateSingleBuilding(b.id);
    updateTelemetryHUD();
    audio.playConcreteThud(1.3);
    showToast(`MORPHED ARCHETYPE // Transformed into ${preset.title}`);
  });

  document
    .getElementById('btn-apply-finish-all')!
    .addEventListener('click', () => {
      const b = getSelectedBuilding();
      if (!b) return;
      sceneManager.buildings.forEach((other) => {
        other.concreteFinish = b.concreteFinish;
        other.tieHoleDensity = b.tieHoleDensity;
      });
      sceneManager.rebuildAllGeometry();
      audio.playConcreteThud(1.5);
      showToast(
        `SECTOR MATERIAL UNIFIED // Applied ${b.concreteFinish.replace('_', ' ')} to all structures`
      );
    });

  document.getElementById('btn-focus-bld')!.addEventListener('click', () => {
    const b = getSelectedBuilding();
    if (b) {
      sceneManager.focusOnBuilding(b);
      showToast(`CAMERA TARGETED // Focused on "${b.name}"`);
    }
  });

  document.getElementById('btn-delete-bld')!.addEventListener('click', () => {
    const b = getSelectedBuilding();
    if (b) {
      audio.playDemolish();
      sceneManager.demolishBuilding(b.id);
    }
  });
}

function updateTelemetryHUD() {
  const metrics = computeCityMetrics(
    sceneManager.buildings,
    sceneManager.skybridges,
    sceneManager.heliodon
  );

  document.getElementById('metric-buildings-count')!.textContent =
    `${metrics.totalBuildings} BLDS / ${metrics.totalSkybridges} SKY`;
  document.getElementById('metric-concrete')!.textContent =
    `${metrics.embodiedConcreteTonnes.toLocaleString()} t`;
  document.getElementById('metric-pop')!.textContent =
    metrics.residentialCapacity.toLocaleString();
  document.getElementById('metric-porosity')!.textContent =
    `${metrics.groundPorosityPct}%`;
  document.getElementById('metric-shading')!.textContent =
    `${metrics.solarShadingEfficiencyPct}%`;
  document.getElementById('metric-skyways')!.textContent =
    `${metrics.skybridgeConnectivityScore} IDX`;
  document.getElementById('metric-safety')!.textContent =
    `${metrics.structuralSafetyIndex}%`;

  updateSimulationLegendBanner(metrics);
}

function updateSimulationLegendBanner(
  metrics = computeCityMetrics(
    sceneManager.buildings,
    sceneManager.skybridges,
    sceneManager.heliodon
  )
) {
  const banner = document.getElementById('sim-legend-banner')!;
  const mode = sceneManager.simMode;
  if (mode === 'none') {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  const titleEl = document.getElementById('sim-legend-title')!;
  const metricEl = document.getElementById('sim-legend-metric')!;
  const descEl = document.getElementById('sim-legend-desc')!;
  const barEl = document.getElementById('sim-gradient-bar')!;
  const lowEl = document.getElementById('sim-scale-low')!;
  const highEl = document.getElementById('sim-scale-high')!;

  barEl.className = `grad-bar ${mode}`;

  if (mode === 'solar') {
    titleEl.textContent = '01 // SOLAR INSOLATION & BRISE-SOLEIL SHADING STUDY';
    metricEl.textContent = `SHADING EFFICIENCY: ${metrics.solarShadingEfficiencyPct}%`;
    descEl.textContent =
      'Evaluates direct solar thermal exposure across facades. Increasing Brise-Soleil Fin Depth and Cantilever Overhangs shields glazing from summer solar gain.';
    lowEl.textContent = 'DEEP BRISE-SOLEIL SHADE';
    highEl.textContent = 'PEAK THERMAL INSOLATION';
  } else if (mode === 'circulation') {
    titleEl.textContent = '02 // "STREETS IN THE SKY" & SPACE SYNTAX FLOW';
    metricEl.textContent = `SKYWAY CONNECTIVITY: ${metrics.skybridgeConnectivityScore} IDX`;
    descEl.textContent =
      'Maps vertical elevator cores, ground pilotis permeability, and elevated Alison & Peter Smithson skybridge walkways linking towers above traffic.';
    lowEl.textContent = 'QUIET PRIVATE ZONE';
    highEl.textContent = 'HIGH-FLUX SKYBRIDGE HUB';
  } else if (mode === 'wind') {
    titleEl.textContent = '03 // AERODYNAMIC VENTURI WIND TUNNEL & PILOTIS POROSITY';
    metricEl.textContent = `PEDESTRIAN COMFORT: ${metrics.windComfortScore}%`;
    descEl.textContent =
      '3D streamlines reveal airflow deflection. Lifting buildings on Le Corbusier Pilotis liberates ground airflow, preventing turbulent downdraft canyons.';
    lowEl.textContent = 'LAMINAR BREEZE (PILOTIS)';
    highEl.textContent = 'VENTURI CANYON SHEAR';
  } else if (mode === 'structural') {
    titleEl.textContent = '04 // TECTONIC LOAD PATH & CANTILEVER BENDING STRESS';
    metricEl.textContent = `TECTONIC SAFETY: ${metrics.structuralSafetyIndex}%`;
    descEl.textContent =
      'Visualizes axial compression flowing down slip-form cores and pilotis piers alongside tension tie-back forces in dramatic cantilevered overhangs.';
    lowEl.textContent = 'NOMINAL COMPRESSION';
    highEl.textContent = 'PEAK CANTILEVER MOMENT';
  }
}

function updateHeliodonReadout() {
  const solar = calculateSolarPosition(sceneManager.heliodon);
  const hrs = Math.floor(sceneManager.heliodon.timeOfDay);
  const mins = Math.floor((sceneManager.heliodon.timeOfDay - hrs) * 60);
  const timeStr = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  document.getElementById('val-solar-readout')!.textContent =
    `${timeStr} // ALT ${Math.round(solar.altitudeDeg)}° AZ ${Math.round(solar.azimuthDeg)}°`;
  (document.getElementById('inp-time-of-day') as HTMLInputElement).value = String(
    sceneManager.heliodon.timeOfDay
  );
}

// Bind Top Bar, Left Dock Tools & Bottom Deck Controls
function bindGlobalControls() {
  // Masterplan Switcher
  const mpSelect = document.getElementById('masterplan-select') as HTMLSelectElement;
  mpSelect.addEventListener('change', () => {
    loadMasterplan(mpSelect.value);
  });

  // Simulation Mode Bar
  document.querySelectorAll('#sim-mode-bar .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('#sim-mode-bar .seg-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      sceneManager.simMode = (btn as HTMLElement).dataset.sim as SimulationMode;
      sceneManager.rebuildAllGeometry();
      updateSimulationLegendBanner();
      audio.playTectonicClick(0.5);
    });
  });

  // View / Camera Mode Bar
  const streetHud = document.getElementById('street-walk-hud')!;
  const setViewUI = (mode: ViewMode) => {
    document.querySelectorAll('#view-mode-bar .seg-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.view === mode);
    });
    streetHud.classList.toggle('hidden', mode !== 'street');
    sceneManager.setViewMode(mode);
    audio.playTectonicClick(0.4);
  };

  document.querySelectorAll('#view-mode-bar .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.view as ViewMode;
      setViewUI(mode);
    });
  });

  document.getElementById('btn-street-elevation')!.addEventListener('click', (e) => {
    sceneManager.streetWalkElevated = !sceneManager.streetWalkElevated;
    (e.target as HTMLElement).textContent = sceneManager.streetWalkElevated
      ? 'ELEVATION: SKYBRIDGE DECK (+11.6m)'
      : 'ELEVATION: GROUND PLAZA (+1.7m)';
    audio.playSkybridgeChord();
  });

  document.getElementById('btn-exit-street')!.addEventListener('click', () => {
    setViewUI('orbit');
  });

  // Tool Mode Bar
  const setToolUI = (tool: ToolMode) => {
    sceneManager.toolMode = tool;
    sceneManager.skybridgeSourceId = null;
    document.querySelectorAll('#tool-mode-bar .tool-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tool === tool);
    });
    document
      .getElementById('skybridge-config')!
      .classList.toggle('hidden', tool !== 'skybridge');
    sceneManager.updateGhostPreview();
    audio.playTectonicClick(0.2);
  };

  document.querySelectorAll('#tool-mode-bar .tool-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setToolUI((btn as HTMLElement).dataset.tool as ToolMode);
    });
  });

  // Keyboard shortcuts for Tools (V, B, L, I, X)
  window.addEventListener('keydown', (e) => {
    if (
      document.activeElement &&
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)
    ) {
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'v') setToolUI('select');
    if (k === 'b') setToolUI('place');
    if (k === 'l') setToolUI('skybridge');
    if (k === 'i') setToolUI('pipette');
    if (k === 'x') setToolUI('demolish');
  });

  // Skybridge Deck Level Slider
  const skyLvlInp = document.getElementById('inp-skybridge-level') as HTMLInputElement;
  skyLvlInp.addEventListener('input', () => {
    sceneManager.skybridgeFloorLevel = parseInt(skyLvlInp.value, 10);
    document.getElementById('val-skybridge-level')!.textContent =
      `LVL +${sceneManager.skybridgeFloorLevel}`;
  });

  // Heliodon Controls
  const timeInp = document.getElementById('inp-time-of-day') as HTMLInputElement;
  timeInp.addEventListener('input', () => {
    sceneManager.heliodon.timeOfDay = parseFloat(timeInp.value);
    updateHeliodonReadout();
    if (sceneManager.simMode === 'solar') {
      sceneManager.rebuildAllGeometry();
    }
  });

  const seasonSelect = document.getElementById('inp-season') as HTMLSelectElement;
  seasonSelect.addEventListener('change', () => {
    sceneManager.heliodon.dayOfYear = parseInt(seasonSelect.value, 10);
    updateHeliodonReadout();
    if (sceneManager.simMode === 'solar') {
      sceneManager.rebuildAllGeometry();
    }
  });

  const sunPlayBtn = document.getElementById('btn-sun-play')!;
  sunPlayBtn.addEventListener('click', () => {
    sceneManager.heliodon.autoAnimate = !sceneManager.heliodon.autoAnimate;
    sunPlayBtn.textContent = sceneManager.heliodon.autoAnimate
      ? '⏸ PAUSE SUN'
      : '▶ ORBIT SUN';
    sunPlayBtn.classList.toggle('accent-btn', sceneManager.heliodon.autoAnimate);
  });

  // Live 3D Section Cut Controls
  const chkSection = document.getElementById('chk-section-cut') as HTMLInputElement;
  chkSection.addEventListener('change', () => {
    sceneManager.sectionCut.enabled = chkSection.checked;
    sceneManager.rebuildAllGeometry();
    audio.playConcreteThud(0.9);
    showToast(
      chkSection.checked
        ? `SECTION CUT ACTIVE // Slicing along ${sceneManager.sectionCut.axis.toUpperCase()}-Axis`
        : 'SECTION CUT DISABLED // Full monolith geometry restored'
    );
  });

  document.querySelectorAll('#section-axis-bar .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('#section-axis-bar .seg-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      sceneManager.sectionCut.axis = (btn as HTMLElement).dataset.axis as 'x' | 'y' | 'z';
      if (sceneManager.sectionCut.enabled) {
        sceneManager.rebuildAllGeometry();
      }
    });
  });

  const secPosInp = document.getElementById('inp-section-pos') as HTMLInputElement;
  secPosInp.addEventListener('input', () => {
    sceneManager.sectionCut.position = parseFloat(secPosInp.value);
    if (!sceneManager.sectionCut.enabled) {
      chkSection.checked = true;
      sceneManager.sectionCut.enabled = true;
    }
    sceneManager.rebuildAllGeometry();
  });

  // Visual Rendering Style Bar
  document.querySelectorAll('#visual-style-bar .seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document
        .querySelectorAll('#visual-style-bar .seg-btn')
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const style = (btn as HTMLElement).dataset.style as VisualStyle;
      sceneManager.visualStyle = style;

      document.body.classList.remove(
        'style-photoreal',
        'style-herve_mono',
        'style-blueprint',
        'style-clay_maquette'
      );
      document.body.classList.add(`style-${style}`);

      sceneManager.rebuildAllGeometry();
      audio.playTectonicClick(0.5);
    });
  });

  // Weather Mode Selector
  const weatherSelect = document.getElementById('inp-weather') as HTMLSelectElement;
  weatherSelect.addEventListener('change', () => {
    sceneManager.weatherMode = weatherSelect.value as WeatherMode;
    sceneManager.rebuildAllGeometry();
    audio.playConcreteThud(0.7);
  });

  // Audio Toggle
  const audioBtn = document.getElementById('btn-audio-toggle')!;
  audioBtn.addEventListener('click', () => {
    audio.enabled = !audio.enabled;
    audioBtn.classList.toggle('active', audio.enabled);
    audioBtn.textContent = audio.enabled ? '🔊 AUDIO' : '🔇 MUTED';
  });

  // Architectural Portfolio Plate PNG Snapshot
  document.getElementById('btn-snapshot')!.addEventListener('click', () => {
    exportArchitecturalPlatePNG();
  });

  // Export Masterplan JSON
  document.getElementById('btn-export-json')!.addEventListener('click', () => {
    const payload = {
      studio: 'TheFocus.AI // BÉTON BRUT MASTERPLAN',
      exportedAt: new Date().toISOString(),
      buildings: sceneManager.buildings,
      skybridges: sceneManager.skybridges,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `beton-brut-masterplan-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('EXPORTED BLUEPRINT // Masterplan JSON saved to disk');
  });
}

// Generates a framed Swiss Brutalist Architectural Monograph Plate PNG from the live WebGL canvas
function exportArchitecturalPlatePNG() {
  const glCanvas = sceneManager.renderer.domElement;
  const outCanvas = document.createElement('canvas');
  const pad = 48;
  const footerH = 110;
  outCanvas.width = glCanvas.width + pad * 2;
  outCanvas.height = glCanvas.height + pad * 2 + footerH;

  const ctx = outCanvas.getContext('2d')!;
  ctx.fillStyle = '#141517';
  ctx.fillRect(0, 0, outCanvas.width, outCanvas.height);

  // Draw 3D render
  ctx.drawImage(glCanvas, pad, pad);

  // Draw Swiss Architectural Frame Border
  ctx.strokeStyle = '#ff5a1f';
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, glCanvas.width, glCanvas.height);

  // Title Block Footer
  const fy = pad + glCanvas.height + 34;
  ctx.fillStyle = '#ece8df';
  ctx.font = 'bold 22px "Space Grotesk", sans-serif';
  ctx.fillText('BÉTON BRUT // ARCHITECTURAL MONOGRAPH PLATE', pad, fy);

  ctx.fillStyle = '#ff5a1f';
  ctx.font = 'bold 14px "JetBrains Mono", monospace';
  const subtitle = document.getElementById('masterplan-subtitle')!.textContent || '';
  ctx.fillText(`${subtitle} — THEFOCUS.AI COMPUTATION STUDIO`, pad, fy + 26);

  const metrics = computeCityMetrics(
    sceneManager.buildings,
    sceneManager.skybridges,
    sceneManager.heliodon
  );
  ctx.fillStyle = '#a09d95';
  ctx.font = '13px "JetBrains Mono", monospace';
  ctx.fillText(
    `STRUCTURES: ${metrics.totalBuildings}  |  SKYWAYS: ${metrics.totalSkybridges}  |  EMBODIED CONCRETE: ${metrics.embodiedConcreteTonnes.toLocaleString()} t  |  POROSITY: ${metrics.groundPorosityPct}%  |  SHADING: ${metrics.solarShadingEfficiencyPct}%`,
    pad,
    fy + 52
  );

  const link = document.createElement('a');
  link.download = `beton-brut-plate-${Date.now()}.png`;
  link.href = outCanvas.toDataURL('image/png');
  link.click();
  audio.playSkybridgeChord();
  showToast('ARCHITECTURAL PLATE CAPTURED // High-res framed PNG downloaded');
}

// Initialize Studio
bindInspectorInputs();
bindGlobalControls();
loadMasterplan('chandigarh_barbican');
updateHeliodonReadout();
sceneManager.animateLoop(() => {
  updateHeliodonReadout();
});
