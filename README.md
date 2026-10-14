# BÉTON BRUT // MASTERPLAN
**Parametric Brutalist City Builder & Architectural Simulation Studio**  
*Created by TheFocus.AI Architectural Computation Studio*

---

## Original Prompts

### Initial Prompt
> create the ultimate brutalist city builder. you should have lots of controls over buildings in ways that are delightful and inuitive to people who just want to play, but are sophisticated and deep for people who know something about architecture. you should be able to play a lot with design and approach. there should be simulation modes and different ways to view or experience the city. make it stunning. i want to host this on netlify in the end

### Follow-Up Prompts
1. > start up a dev server
2. > stop that server please
3. > what is it circling? there are circles on it
4. > can you create a readme with the intial prompts we did for this?

---

## Quick Start & Netlify Deployment Recipes

### 1. Run Locally (Development Server)
```bash
pnpm install
pnpm run dev
```

### 2. Build Production Bundle (`dist/`)
```bash
pnpm exec tsc --noEmit
pnpm run build
pnpm run preview
```

### 3. Deploy to Netlify
This project includes a pre-configured [`netlify.toml`](./netlify.toml) (`command = "pnpm run build"`, `publish = "dist"`).

#### Option A: Netlify CLI (Instant Deploy)
```bash
pnpm dlx netlify-cli deploy --build --prod
```
*(Note: Use Safari when authenticating with Netlify in the browser.)*

#### Option B: Drag & Drop `dist/` Folder
1. Run `pnpm run build`
2. Drag the generated `dist/` folder directly into [app.netlify.com/drop](https://app.netlify.com/drop).

---

## Architectural Features & Controls

### 10 Iconic Brutalist Building Archetypes
- **ARC-01 // Unité d'Habitation** (*Le Corbusier, 1952*): Radiant slab elevated on muscular V-shaped pilotis, deep egg-crate brise-soleil duplex loggias, and sculptural rooftop ventilation chimneys.
- **ARC-02 // Habitat 67 Cluster** (*Moshe Safdie, 1967*): Interlocking cantilevered precast voxel modules with rooftop botanical gardens.
- **ARC-03 // Barbican Estate Tower** (*Chamberlin, Powell & Bon, 1976*): Bush-hammered coarse granite tower with sawtooth balcony bands and triple barrel-vaulted crowns.
- **ARC-04 // Inverted Civic Ziggurat** (*Kallmann McKinnell & Knowles, 1968*): Boston City Hall tribute with cantilevered deep-coffered upper tiers stepping outward above an open civic forum.
- **ARC-05 // Metabolist Capsule Core** (*Kisho Kurokawa, 1972*): Twin slip-formed service cores with plug-in cantilevered porthole capsules.
- **ARC-06 // Geisel Cantilever Crown** (*William Pereira, 1970*): 45° diagonal post-tensioned concrete tree bents supporting cantilevered octagonal reading tiers.
- **ARC-07 // Trellick Skybridge Slab** (*Ernő Goldfinger, 1972*): Razor-thin residential block connected every third story by flying skybridges to a detached lift and boiler tower.
- **ARC-08 // Salk Horizon Court** (*Louis Kahn, 1965*): Symmetrical pozzolanic concrete and travertine study wings angled at 45° flanking a central equatorial water channel.
- **ARC-09 // Yugoslav Spomenik** (*Živković & Bogdanović, 1971*): Radial crystalline concrete petals soaring outward from a stepped ceremonial amphitheater.
- **ARC-10 // Sunken Water Forum** (*Lawrence Halprin / Barbican, 1974*): Stepped concrete basin with reflecting pool, cypress planters, and brutalist plaza sculpture.

### 4 Real-Time Urban Simulation Modes
1. **01 SOLAR HELIODON**: Interactive 3D sun-path dome (Summer Solstice, Vernal Equinox, Winter Solstice) + facade solar insolation vs. brise-soleil shading efficiency heatmap.
2. **02 STREETS IN THE SKY**: Autonomous ground flâneurs, vertical core elevators, and elevated skybridge pedestrian flows with Space Syntax connectivity metrics.
3. **03 VENTURI WIND TUNNEL**: Animated 3D aerodynamic streamlines demonstrating how Le Corbusier *pilotis* liberate ground-level airflow compared to solid canyon blocks.
4. **04 STRUCTURAL LOAD PATH**: Finite-element compression and cantilever tension stress visualization across cores, pilotis piers, and overhangs.

### 4 Camera Views & 4 Monograph Rendering Styles
- **Camera Modes**: Perspective Orbit, True Parallel Orthographic Axonometric, First-Person 1.7m Flâneur Walk (`WASD` + mouse look + Ground Plaza vs. Elevated Skybridge toggle), and Autonomous Drone Tour.
- **Live 3D Section Cut**: Slice through the entire city along the `X-Axis`, `Z-Axis`, or `Horizontal Plan Cut` in real time.
- **Visual Styles**: Photoreal *Béton Brut*, *Lucien Hervé* High-Contrast 1950s B&W Photography, *Cyanotype* Technical Blueprint, and *Museum Clay Maquette*.
