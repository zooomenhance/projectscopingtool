# QGC Scoping Webapp (MVP)


A tiny browser app to scope UAS mapping jobs and export QGroundControl `*.plan` files without connecting to a vehicle.


## Features
- Set altitude, overlap, sidelap, heading, line length and count
- See a live grid overlay on a MapLibre map
- One-click download of a valid QGC `.plan` with camera trigger distance and waypoints


## Quick start
```bash
npm i
npm run dev
```
Open the local URL from Vite. Pan/zoom to your area of interest; the grid centers on the map center.


## Notes
- Map style uses the public MapLibre demo style. Replace `styleURL` in `src/App.tsx` with your own.
- The grid is a simple lawnmower and **does not clip to polygons** yet. Next steps: polygon drawing + line clipping with Turf.
- Terrain/AGL is constant. Next steps: sample a DEM and vary per-waypoint altitude offsets.
- Camera model is a single preset (Mavic 3T Wide). Add your own in `src/lib/qgc.ts`.
QGC Scoping Webapp

A lightweight web app to scope UAS (drone) survey projects in the browser. Draw an Area of Interest (AOI), generate an inside-AOI lawnmower pattern, preview the continuous flight path (with entry/return to Home), and export a QGroundControl .plan mission. Includes quick calculators for spacing, time, distance, and photo count—driven by camera, height, overlap, sidelap, and speed.

✨ Features (implemented)

Map & Basemaps

MapLibre GL map with OSM Streets, Esri Satellite, and USGS Topo basemaps (switchable in UI).

Robust layer ordering so overlays stay visible above the basemap and draw layers.

AOI Drawing

Polygon drawing via maplibre-gl-draw (MapLibre-friendly fork).

Planner only activates once an AOI polygon exists.

Inside-AOI Flight Grid

Generates lawnmower lines strictly inside the drawn AOI (no clipping artifacts).

Heading control with zig-zag leg ordering.

Continuous Flight Path

Legs are stitched into a single route (connectors between passes).

Home support:

Draggable Home marker.

“Set Home to map center” button.

Dashed entry (Home → first leg) and return (last leg → Home) segments.

Mission Export

Export QGC .plan using the AOI-based legs (via makePlan()).

Calculators & Live Stats

Camera selector (uses presets from lib/qgc.ts).

Height AGL (m), Heading (deg), Groundspeed (m/s).

Overlap/Sidelap sliders shown as percentages (0–95%).

Along-track trigger & across-track spacing from spacingFromOverlap.

Photo count estimate (based on main path distance / along-track trigger).

Estimated flight time using total distance (main + entry/return) and turn time (s) per leg.

Battery cap (min) with an over-cap warning.

🧩 Tech Stack

React + TypeScript + Vite

MapLibre GL for mapping (maplibre-gl)

maplibre-gl-draw for polygon drawing (⚠️ not @mapbox/mapbox-gl-draw)

@turf/turf for geospatial math (bbox, lineSplit, translate, length, etc.)

🚀 Getting Started
# in the project root (where package.json lives)
npm install

# dev server
npm run dev


Windows tip: if PowerShell blocks npm scripts (npm.ps1 cannot be loaded), run the dev server from Command Prompt or adjust PowerShell’s execution policy for your user.

🔧 Configuration / Key Files
src/
  App.tsx          # main app (map, UI, AOI draw, grid generation, path, stats)
  styles.css       # layout + small UI tweaks (ensure map controls are clickable)
  lib/
    qgc.ts         # Cameras presets, spacingFromOverlap(), makePlan() (QGC export)
index.html         # Vite entry

Cameras (add your own)

src/lib/qgc.ts includes Cameras presets. Example:

export const Cameras = {
  Mavic3T_Wide: {
    name: 'Mavic 3T Wide',
    sensorWidth_mm: 6.3,
    sensorHeight_mm: 4.7,
    focalLength_mm: 4.5,
    imageWidth_px: 4000,
    imageHeight_px: 3000,
  },
  // Add more:
  Phantom4Pro: { /* ... */ },
  Mavic3T_Tele: { /* ... */ },
}


The Camera dropdown in the app auto-builds from this object.

🗺️ Basemaps

All three basemaps are pre-wired in the style:

OSM Streets: https://tile.openstreetmap.org/{z}/{x}/{y}.png

Esri World Imagery (Satellite)

USGS Topo

The app toggles their visibility; overlays are moved to the top after load.

🧠 How the Grid Is Built (Inside-AOI)

We compute a long baseline through the AOI center at your heading, then translate it orthogonally by the across-track spacing to create a set of parallel scan lines.

Each line is split by the polygon boundary and only inside segments are kept (using Turf lineSplit + booleanPointInPolygon check on segment midpoints).

Legs are alternately reversed to achieve a zig-zag pattern.

📦 QGC Export

Exported via makePlan({...}) using:

homeLat/Lon, relAlt_m, groundspeed_mps, trigger_m, and the inside-AOI gridLines.

(Planned enhancement) Optionally include entry/return legs as waypoints in the .plan sequence.

📊 Calculations

Spacing: spacingFromOverlap(heightAGL, camera, overlap, sidelap) → { along_m, across_m }

Photo Count: ceil(mainPathDistance / along_m)

Time: (totalDistance / groundspeed + turns * turnTime) / 60

totalDistance = mainPathDistance + entryReturnDistance

turns = legs.length - 1

⚠️ Known Constraints / Notes

Planner renders only after an AOI polygon exists.

If lines ever “disappear” after style changes, it’s almost always layer order or layer add timing. The current app reorders overlays on load/style events.

Use maplibre-gl-draw (not the Mapbox package) to avoid style validation errors in MapLibre.

🧪 Troubleshooting

No lines visible

Make sure you drew an AOI (the stats panel will show “AOI: Yes”).

Check the browser console; the app adds sources/layers idempotently and moves overlays to top.

“Failed to resolve …/maplibre-gl-draw.css”

Import path is: import 'maplibre-gl-draw/dist/mapbox-gl-draw.css'

“.ps1 cannot be loaded” on Windows

Use Command Prompt instead of PowerShell for npm run dev, or adjust user execution policy.

🗂️ Version Control Tips

Initialize Git and commit a baseline:

git init
echo node_modules/ > .gitignore
git add -A
git commit -m "baseline: working AOI planner with home legs + basemaps"
git tag -a v0.2-working -m "Working build YYYY-MM-DD"


Create feature branches for experiments:

git checkout -b feat/terrain-battery

🛣️ Roadmap (next)

Home legs in .plan export (waypoint sequence before/after survey).

Terrain extraction & terrain-following (constant AGL).

Battery model (energy per meter/turn, reserve, wind factor; pack count).

“Explain this plan” assistant panel (site considerations/briefing).

Screenshot/PDF export (map PNG + summary; preserveDrawingBuffer on map).



# QGC Scoping Webapp – Next Steps

## 1) Home points (polish)
- [ ] Make Home a dedicated state (done) and expose **lat/lon inputs** under the map.
- [ ] Add **Home altitude AGL/AMSL** selector; show takeoff/RTL altitude in info panel.
- [ ] Option to **snap Home to polygon edge** closest to first leg.
- [ ] Checkbox: **Return-to-Home at end** (toggle the dashed return leg).
- [ ] Export entry/return legs as waypoints in `.plan`.

## 2) Terrain extraction (DTM/DSM-aware planning)
- [ ] Add **terrain provider** option (USGS 3DEP / MapTiler Terrain / MapLibre DEM).
- [ ] Sample elevation along legs; compute **AGL profile**.
- [ ] Option: **follow terrain** (adjust relAlt per waypoint to keep constant AGL).
- [ ] Show **min/max clearance** and flag >N% grade risk.
- [ ] Cache tiles; fail gracefully offline.

## 3) Battery estimation (richer model)
- [ ] Inputs: craft mass, battery Wh/mAh, hover power (W), cruise power (W), **wind (m/s)**.
- [ ] Compute **energy per meter** (baseline + turns + climb margin).
- [ ] Reserve setting (% or minutes). Warn if **ETL > cap – reserve**.
- [ ] Multi-pack: suggest **required packs / swap points** (near Home).
- [ ] Export a **briefing block** into the `.plan` “notes”.

## 4) ChatGPT “Site Considerations” panel
- [ ] New sidebar tab that summarizes: area size, overflight risk, proximity to roads/buildings,
      sunrise/sunset, **wind sensitivity**, required GSD, estimated photos & storage.
- [ ] Button: **“Explain this plan”** → generate a plain-English briefing (no coordinates).
- [ ] Redact PII; never auto-send location unless user opts in.
- [ ] Use env var `VITE_OPENAI_API_KEY`; backoff & error UI.

## 5) Screenshots / exports
- [ ] Button: **“Export Map PNG”** – uses WebGL canvas `toDataURL` (enable `preserveDrawingBuffer`).
- [ ] Overlay legend (camera, height, overlaps, distance, time).
- [ ] Optional **PDF export** with one-page project brief.

---

## Quick references / code stubs

### Map screenshot (PNG)
```ts
// When creating the map (only if you need screenshots):
const map = new maplibregl.Map({
  container: mapContainer.current!,
  style: baseStyle,
  center: [center[1], center[0]],
  zoom: 14,
  preserveDrawingBuffer: true, // <-- needed for toDataURL()
})

// Handler
function exportPNG() {
  const canvas = mapRef.current?.getCanvas()
  if (!canvas) return
  const url = canvas.toDataURL('image/png')
  const a = document.createElement('a')
  a.href = url
  a.download = 'flight_plan.png'
  a.click()
}


## License
Apache-2.0