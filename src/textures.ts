import * as THREE from 'three';
import { ConcreteFinish, VisualStyle } from './types';

interface ConcreteMaterialSet {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  core: THREE.MeshStandardMaterial;
}

const materialCache = new Map<string, ConcreteMaterialSet>();
let glazingDayMat: THREE.MeshPhysicalMaterial | null = null;
let glazingNightMat: THREE.MeshStandardMaterial | null = null;
let waterMat: THREE.MeshPhysicalMaterial | null = null;
let greeneryMat: THREE.MeshStandardMaterial | null = null;
let blueprintLineMat: THREE.LineBasicMaterial | null = null;

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const FINISH_PALETTES: Record<
  ConcreteFinish,
  { base: [number, number, number]; dark: [number, number, number]; rough: number; grain: 'board' | 'bush' | 'travertine' | 'moss' }
> = {
  board_formed: {
    base: [168, 165, 158],
    dark: [122, 119, 113],
    rough: 0.84,
    grain: 'board',
  },
  bush_hammered: {
    base: [152, 148, 142],
    dark: [104, 100, 95],
    rough: 0.94,
    grain: 'bush',
  },
  travertine_pozzolan: {
    base: [198, 188, 170],
    dark: [156, 146, 128],
    rough: 0.76,
    grain: 'travertine',
  },
  weathered_moss: {
    base: [144, 148, 139],
    dark: [88, 102, 82],
    rough: 0.91,
    grain: 'moss',
  },
  ochre_oxide: {
    base: [182, 132, 106],
    dark: [134, 88, 66],
    rough: 0.85,
    grain: 'board',
  },
  charcoal_basalt: {
    base: [86, 89, 94],
    dark: [52, 54, 58],
    rough: 0.88,
    grain: 'bush',
  },
};

export function createConcreteTextures(
  finish: ConcreteFinish,
  tieHoleDensity: number
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512;
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = size;
  diffCanvas.height = size;
  const dCtx = diffCanvas.getContext('2d')!;

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d')!;

  const spec = FINISH_PALETTES[finish];
  const rand = seededRandom(
    finish.charCodeAt(0) * 131 + Math.round(tieHoleDensity * 100)
  );

  // Base fill
  dCtx.fillStyle = `rgb(${spec.base[0]}, ${spec.base[1]}, ${spec.base[2]})`;
  dCtx.fillRect(0, 0, size, size);

  bCtx.fillStyle = 'rgb(128, 128, 128)';
  bCtx.fillRect(0, 0, size, size);

  // Horizontal board-formed planks or stone lifts
  const numPlanks = spec.grain === 'bush' ? 8 : 16;
  const plankH = size / numPlanks;

  for (let i = 0; i < numPlanks; i++) {
    const y = i * plankH;
    const toneShift = (rand() - 0.5) * 20;
    const r = Math.min(255, Math.max(0, Math.round(spec.base[0] + toneShift)));
    const g = Math.min(255, Math.max(0, Math.round(spec.base[1] + toneShift)));
    const b = Math.min(255, Math.max(0, Math.round(spec.base[2] + toneShift)));

    dCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    dCtx.fillRect(0, y, size, plankH);

    const bVal = Math.round(128 + toneShift * 1.4);
    bCtx.fillStyle = `rgb(${bVal}, ${bVal}, ${bVal})`;
    bCtx.fillRect(0, y, size, plankH);

    // Plank wood grain streaks for board_formed
    if (spec.grain === 'board' || spec.grain === 'moss') {
      for (let s = 0; s < 14; s++) {
        const sy = y + rand() * plankH;
        const alpha = 0.04 + rand() * 0.06;
        dCtx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
        dCtx.fillRect(0, sy, size, 1 + rand() * 2);
        bCtx.fillStyle = rand() > 0.5 ? 'rgba(180,180,180,0.18)' : 'rgba(70,70,70,0.18)';
        bCtx.fillRect(0, sy, size, 1.5);
      }
    }

    // Formwork horizontal joint line
    dCtx.fillStyle = `rgba(${spec.dark[0]}, ${spec.dark[1]}, ${spec.dark[2]}, 0.55)`;
    dCtx.fillRect(0, y, size, 2);
    bCtx.fillStyle = ' rgb(45, 45, 45)';
    bCtx.fillRect(0, y, size, 2.5);
  }

  // Vertical formwork panel seams
  const cols = 4;
  const colW = size / cols;
  for (let c = 0; c < cols; c++) {
    const x = c * colW;
    dCtx.fillStyle = `rgba(${spec.dark[0]}, ${spec.dark[1]}, ${spec.dark[2]}, 0.45)`;
    dCtx.fillRect(x, 0, 2, size);
    bCtx.fillStyle = 'rgb(50, 50, 50)';
    bCtx.fillRect(x, 0, 2.5, size);
  }

  // Aggregate / Bush-hammered speckle or travertine pores
  const speckleCount = spec.grain === 'bush' ? 4200 : 1800;
  for (let i = 0; i < speckleCount; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = spec.grain === 'travertine' ? 4 + rand() * 10 : 1.5 + rand() * 3;
    const h = spec.grain === 'travertine' ? 1.5 + rand() * 2.5 : 1.5 + rand() * 3;
    const dark = rand() > 0.42;
    dCtx.fillStyle = dark ? 'rgba(20, 20, 18, 0.12)' : 'rgba(250, 248, 242, 0.10)';
    dCtx.fillRect(x, y, w, h);

    bCtx.fillStyle = dark ? 'rgba(40, 40, 40, 0.32)' : 'rgba(215, 215, 215, 0.28)';
    bCtx.fillRect(x, y, w, h);
  }

  // Eco-Brutalist rainwater vertical patina & moss streaks
  if (spec.grain === 'moss') {
    for (let i = 0; i < 36; i++) {
      const sx = rand() * size;
      const sw = 6 + rand() * 18;
      const sh = 90 + rand() * 260;
      const grad = dCtx.createLinearGradient(sx, 0, sx, sh);
      grad.addColorStop(0, 'rgba(62, 85, 52, 0.34)');
      grad.addColorStop(0.5, 'rgba(72, 92, 60, 0.16)');
      grad.addColorStop(1, 'rgba(72, 92, 60, 0.0)');
      dCtx.fillStyle = grad;
      dCtx.fillRect(sx, 0, sw, sh);
    }
  }

  // Form-tie cone holes (signature Brutalist tectonic detail!)
  if (tieHoleDensity > 0.05) {
    const holeRows = Math.max(2, Math.round(4 * tieHoleDensity + 2));
    const holeCols = Math.max(2, Math.round(6 * tieHoleDensity + 2));
    const cellW = size / holeCols;
    const cellH = size / holeRows;

    for (let r = 0; r < holeRows; r++) {
      for (let c = 0; c < holeCols; c++) {
        const cx = (c + 0.5) * cellW;
        const cy = (r + 0.5) * cellH;
        const radius = 5.5;

        // Outer cone bevel
        dCtx.beginPath();
        dCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        dCtx.fillStyle = `rgba(${spec.dark[0] - 25}, ${spec.dark[1] - 25}, ${spec.dark[2] - 25}, 0.85)`;
        dCtx.fill();

        // Inner dark tie hole
        dCtx.beginPath();
        dCtx.arc(cx, cy, radius * 0.52, 0, Math.PI * 2);
        dCtx.fillStyle = 'rgba(28, 27, 25, 0.92)';
        dCtx.fill();

        // Bump map deep indentation
        bCtx.beginPath();
        bCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        bCtx.fillStyle = 'rgb(15, 15, 15)';
        bCtx.fill();
      }
    }
  }

  const map = new THREE.CanvasTexture(diffCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(2, 2);

  return { map, bumpMap };
}

export function getConcreteMaterials(
  finish: ConcreteFinish,
  tieHoleDensity: number,
  visualStyle: VisualStyle
): ConcreteMaterialSet {
  const quantTie = Math.round(tieHoleDensity * 4) / 4;
  const key = `${finish}_${quantTie}_${visualStyle}`;
  if (materialCache.has(key)) {
    return materialCache.get(key)!;
  }

  if (visualStyle === 'blueprint') {
    const primary = new THREE.MeshStandardMaterial({
      color: 0x0d2b4e,
      roughness: 0.9,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const secondary = new THREE.MeshStandardMaterial({
      color: 0x133b69,
      roughness: 0.9,
      metalness: 0.05,
    });
    const core = new THREE.MeshStandardMaterial({
      color: 0x091e38,
      roughness: 0.95,
    });
    const set = { primary, secondary, core };
    materialCache.set(key, set);
    return set;
  }

  if (visualStyle === 'clay_maquette') {
    const primary = new THREE.MeshStandardMaterial({
      color: 0xe8e2d5,
      roughness: 0.92,
      metalness: 0.0,
    });
    const secondary = new THREE.MeshStandardMaterial({
      color: 0xd5cbb8,
      roughness: 0.88,
      metalness: 0.0,
    });
    const core = new THREE.MeshStandardMaterial({
      color: 0xc2b69f,
      roughness: 0.95,
    });
    const set = { primary, secondary, core };
    materialCache.set(key, set);
    return set;
  }

  const { map, bumpMap } = createConcreteTextures(
    visualStyle === 'herve_mono' ? 'bush_hammered' : finish,
    quantTie
  );
  const spec = FINISH_PALETTES[finish];

  const primary = new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale: visualStyle === 'herve_mono' ? 0.18 : 0.11,
    roughness: spec.rough,
    metalness: 0.04,
    color: visualStyle === 'herve_mono' ? 0xdcdcdc : 0xffffff,
  });

  const secondary = new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale: 0.08,
    roughness: Math.min(1, spec.rough + 0.05),
    metalness: 0.06,
    color: visualStyle === 'herve_mono' ? 0x9e9e9e : 0xd8d4cc,
  });

  const core = new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale: 0.14,
    roughness: 0.92,
    metalness: 0.05,
    color: visualStyle === 'herve_mono' ? 0x707070 : 0xb5b0a6,
  });

  const set = { primary, secondary, core };
  materialCache.set(key, set);
  return set;
}

export function getGlazingMaterial(isNight: boolean, visualStyle: VisualStyle): THREE.Material {
  if (visualStyle === 'blueprint') {
    return new THREE.MeshBasicMaterial({
      color: 0x1e5799,
      transparent: true,
      opacity: 0.45,
    });
  }
  if (visualStyle === 'clay_maquette') {
    return new THREE.MeshStandardMaterial({
      color: 0x9aa5b1,
      roughness: 0.25,
      metalness: 0.1,
    });
  }

  if (isNight) {
    if (!glazingNightMat) {
      // Create warm sodium-vapor interior window grid texture
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#181c22';
      ctx.fillRect(0, 0, 256, 256);

      const rand = seededRandom(909);
      for (let r = 0; r < 8; r++) {
        for (let col = 0; col < 8; col++) {
          const lit = rand() > 0.34;
          if (lit) {
            const warm = rand() > 0.25 ? '#ffbe6b' : '#ffdca8';
            ctx.fillStyle = warm;
            ctx.fillRect(col * 32 + 3, r * 32 + 4, 26, 22);
            // Interior concrete slab shadow line
            ctx.fillStyle = '#2d241b';
            ctx.fillRect(col * 32 + 3, r * 32 + 16, 26, 3);
          } else {
            ctx.fillStyle = '#222830';
            ctx.fillRect(col * 32 + 3, r * 32 + 4, 26, 22);
          }
        }
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;

      glazingNightMat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(0xffa742),
        emissiveIntensity: 1.35,
        roughness: 0.2,
        metalness: 0.5,
      });
    }
    return glazingNightMat;
  }

  if (!glazingDayMat) {
    glazingDayMat = new THREE.MeshPhysicalMaterial({
      color: 0x22303c,
      roughness: 0.14,
      metalness: 0.65,
      reflectivity: 0.85,
      clearcoat: 0.6,
    });
  }
  return glazingDayMat;
}

export function getWaterMaterial(visualStyle: VisualStyle): THREE.Material {
  if (visualStyle === 'blueprint') {
    return new THREE.MeshBasicMaterial({ color: 0x0b3c68, wireframe: false });
  }
  if (!waterMat) {
    waterMat = new THREE.MeshPhysicalMaterial({
      color: 0x1b3b48,
      roughness: 0.08,
      metalness: 0.15,
      transmission: 0.35,
      transparent: true,
      opacity: 0.88,
      clearcoat: 1.0,
    });
  }
  return waterMat;
}

export function getGreeneryMaterial(visualStyle: VisualStyle): THREE.Material {
  if (visualStyle === 'blueprint') {
    return new THREE.MeshStandardMaterial({ color: 0x1b4f72, roughness: 0.9 });
  }
  if (visualStyle === 'herve_mono') {
    return new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.92 });
  }
  if (visualStyle === 'clay_maquette') {
    return new THREE.MeshStandardMaterial({ color: 0xa3b19b, roughness: 0.9 });
  }
  if (!greeneryMat) {
    greeneryMat = new THREE.MeshStandardMaterial({
      color: 0x3c5a3e,
      roughness: 0.88,
      metalness: 0.02,
    });
  }
  return greeneryMat;
}

export function getEdgeLineMaterial(visualStyle: VisualStyle): THREE.LineBasicMaterial {
  if (visualStyle === 'blueprint') {
    return new THREE.LineBasicMaterial({
      color: 0x7ce8ff,
      transparent: true,
      opacity: 0.82,
    });
  }
  if (visualStyle === 'herve_mono') {
    return new THREE.LineBasicMaterial({
      color: 0x111111,
      transparent: true,
      opacity: 0.45,
    });
  }
  if (!blueprintLineMat) {
    blueprintLineMat = new THREE.LineBasicMaterial({
      color: 0x262523,
      transparent: true,
      opacity: 0.22,
    });
  }
  return blueprintLineMat;
}
