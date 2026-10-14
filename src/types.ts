export type BuildingArchetype =
  | 'unite'
  | 'habitat'
  | 'barbican'
  | 'boston_city_hall'
  | 'nakagin'
  | 'geisel'
  | 'trellick'
  | 'salk'
  | 'spomenik'
  | 'plaza_pool';

export type PilotisStyle =
  | 'cylindrical'
  | 'v_strut'
  | 'cruciform'
  | 'tree_bent'
  | 'shear_blade';

export type MassingProfile =
  | 'monolith'
  | 'ziggurat'
  | 'inverted_ziggurat'
  | 'cantilever_cluster'
  | 'split_court'
  | 'terraced_step';

export type CoreType =
  | 'internal'
  | 'detached_tower'
  | 'twin_external'
  | 'exoskeleton';

export type FacadeSystem =
  | 'brise_soleil_grid'
  | 'vertical_fins'
  | 'ribbon_band'
  | 'recessed_loggia'
  | 'coffered_waffle'
  | 'capsule_porthole';

export type ConcreteFinish =
  | 'board_formed'
  | 'bush_hammered'
  | 'travertine_pozzolan'
  | 'weathered_moss'
  | 'ochre_oxide'
  | 'charcoal_basalt';

export type RoofFeature =
  | 'sculptural_vent'
  | 'barrel_vaults'
  | 'sky_garden'
  | 'water_tank'
  | 'brutalist_spire'
  | 'flat_coffered';

export type BuildingProgram =
  | 'social_housing'
  | 'civic_ministry'
  | 'cultural_forum'
  | 'research_institute'
  | 'mixed_metabolist'
  | 'monument';

export interface BuildingParams {
  id: string;
  name: string;
  architectRef: string;
  yearRef: string;
  archetype: BuildingArchetype;
  gridX: number; // -7 to +7
  gridZ: number; // -7 to +7
  footprintW: number; // in grid units (1 unit = 12m)
  footprintD: number; // in grid units
  rotation: number; // 0, 90, 180, 270 degrees

  // Massing & Tectonic Structure
  floors: number; // 1 to 32
  floorHeight: number; // 2.8m to 6.0m
  pilotisHeight: number; // 0 to 4 floors
  pilotisStyle: PilotisStyle;
  massingProfile: MassingProfile;
  cantileverOverhang: number; // 0.0m to 8.0m
  coreType: CoreType;

  // Envelope & Fenestration
  facadeSystem: FacadeSystem;
  briseSoleilDepth: number; // 0.2m to 2.4m
  finAngle: number; // -45 to +45 deg
  glazingRatio: number; // 0.15 to 0.75
  bayModuleWidth: number; // 3.0m to 8.0m

  // Materiality & Roofscape
  concreteFinish: ConcreteFinish;
  tieHoleDensity: number; // 0.0 to 1.0
  ecoGreenery: number; // 0.0 to 1.0 (Eco-Brutalism planters & trees)
  roofFeature: RoofFeature;
  program: BuildingProgram;
}

export interface SkybridgeLink {
  id: string;
  fromBuildingId: string;
  toBuildingId: string;
  floorLevel: number; // Floor index (e.g. 2, 4, 8)
  trussStyle: 'coffered_box' | 'vierendeel_truss' | 'open_walkway';
}

export type SimulationMode =
  | 'none'
  | 'solar'
  | 'circulation'
  | 'wind'
  | 'structural';

export type ViewMode =
  | 'orbit'
  | 'axonometric'
  | 'street'
  | 'drone';

export type VisualStyle =
  | 'photoreal'
  | 'herve_mono'
  | 'blueprint'
  | 'clay_maquette';

export type WeatherMode =
  | 'clear_brut'
  | 'london_drizzle'
  | 'morning_mist'
  | 'golden_cantilever'
  | 'sodium_night';

export type ToolMode =
  | 'select'
  | 'place'
  | 'skybridge'
  | 'pipette'
  | 'demolish';

export interface SectionCutState {
  enabled: boolean;
  axis: 'x' | 'y' | 'z';
  position: number; // -90 to +90 for X/Z, 2 to 120 for Y (horizontal plan cut)
}

export interface HeliodonState {
  timeOfDay: number; // 0.0 to 24.0 hours
  dayOfYear: number; // 1 to 365 (172 = Summer Solstice, 355 = Winter Solstice, 80 = Equinox)
  latitude: number; // -60 to +65 degrees
  autoAnimate: boolean;
}

export interface CityMetrics {
  totalBuildings: number;
  totalSkybridges: number;
  residentialCapacity: number;
  embodiedConcreteTonnes: number;
  groundPorosityPct: number; // % of ground plane left open via plazas + pilotis
  solarShadingEfficiencyPct: number; // How well brise-soleil & overhangs shade summer sun
  skybridgeConnectivityScore: number; // Streets-in-the-sky network index
  windComfortScore: number; // Pedestrian level aerodynamic comfort
  structuralSafetyIndex: number; // Tectonic stability score
}

export interface CityMasterplan {
  title: string;
  subtitle: string;
  architect: string;
  buildings: BuildingParams[];
  skybridges: SkybridgeLink[];
}
