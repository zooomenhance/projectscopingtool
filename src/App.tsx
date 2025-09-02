// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'

import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import MapboxDraw from 'maplibre-gl-draw'
import 'maplibre-gl-draw/dist/mapbox-gl-draw.css'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'

import {
  bbox,
  distance as turfDistance,
  destination,
  transformTranslate,
  lineString,
  lineSplit,
  booleanPointInPolygon,
  midpoint,
  length as turfLength,
  area as turfArea,
} from '@turf/turf'

import { Cameras, makePlan, spacingFromOverlap } from './lib/qgc'

const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined

type LatLon = [number, number] // [lat, lon]

/** ───────────────────────────────── Basemap style (raster) ───────────────────────────────── */
const baseStyle: StyleSpecification = {
  version: 8,
  sources: {
    osm:  { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
    esri: { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri' },
    usgs: { type: 'raster', tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'USGS' },
    retro90s: { type: 'raster', tiles: [''], tileSize: 256, attribution: 'Retro90s' }, 
},
  layers: [
    { id: 'basemap-sat',  type: 'raster', source: 'esri' },
    { id: 'basemap-usgs', type: 'raster', source: 'usgs' },
    { id: 'basemap-osm',  type: 'raster', source: 'osm'  },
    { id: 'basemap-retro90s',  type: 'raster', source: 'retro90s'  },
  ],
}
function addRetro90sLayers(map: maplibregl.Map, key?: string) {
  // 1) Vector source (OpenMapTiles via MapTiler)
  if (key && !map.getSource('mtl-vector')) {
    map.addSource('mtl-vector', {
      type: 'vector',
      url: `https://api.maptiler.com/tiles/v3/tiles.json?key=${key}`,
    })
  }
  // If no key, bail gracefully: we’ll just keep raster basemaps.
  if (!map.getSource('mtl-vector')) return

  const beforeId = map.getLayer('grid-lines') ? 'grid-lines' : undefined

  // 2) Background (paper)
  if (!map.getLayer('retro-bg')) {
    map.addLayer({ id: 'retro-bg', type: 'background',
      paint: { 'background-color': '#f4f0e8' } }, beforeId)
  }

  // 3) Water
  if (!map.getLayer('retro-water')) {
    map.addLayer({
      id: 'retro-water',
      type: 'fill',
      source: 'mtl-vector',
      'source-layer': 'water',
      paint: { 'fill-color': '#a3c5ff' }
    }, beforeId)
  }

  // 4) Landuse (parks etc.)
  if (!map.getLayer('retro-landuse')) {
    map.addLayer({
      id: 'retro-landuse',
      type: 'fill',
      source: 'mtl-vector',
      'source-layer': 'landuse',
      paint: { 'fill-color': '#e7f6e7', 'fill-opacity': 0.9 }
    }, beforeId)
  }

  // 5) Buildings
  if (!map.getLayer('retro-buildings')) {
    map.addLayer({
      id: 'retro-buildings',
      type: 'fill',
      source: 'mtl-vector',
      'source-layer': 'building',
      paint: { 'fill-color': '#ddd', 'fill-outline-color': '#111', 'fill-opacity': 0.85 }
    }, beforeId)
  }

  // 6) Road casing (black underlay)
  if (!map.getLayer('retro-road-case')) {
    map.addLayer({
      id: 'retro-road-case',
      type: 'line',
      source: 'mtl-vector',
      'source-layer': 'transportation',
      filter: ['in', ['get','class'], ['literal',
        ['motorway','trunk','primary','secondary','tertiary','minor','service']
      ]],
      paint: {
        'line-color': '#000',
        'line-width': [
          'match', ['get','class'],
          'motorway', 6, 'trunk', 5.5, 'primary', 5, 'secondary', 4, 'tertiary', 3.5, 2.5
        ],
        'line-opacity': 0.9
      }
    }, beforeId)
  }

  // 7) Road fill (pastel on top)
  if (!map.getLayer('retro-road')) {
    map.addLayer({
      id: 'retro-road',
      type: 'line',
      source: 'mtl-vector',
      'source-layer': 'transportation',
      filter: ['in', ['get','class'], ['literal',
        ['motorway','trunk','primary','secondary','tertiary','minor','service']
      ]],
      paint: {
        'line-color': [
          'match', ['get','class'],
          'motorway', '#ffb347', 'trunk', '#ffb347',
          'primary', '#ffd480',
          'secondary', '#ffe7ad',
          'tertiary', '#f6e7c1',
          /* default */ '#e5dfd0'
        ],
        'line-width': [
          'match', ['get','class'],
          'motorway', 4.5, 'trunk', 4, 'primary', 3.5, 'secondary', 3, 'tertiary', 2.5, 2
        ],
        'line-opacity': 0.95
      }
    }, beforeId)
  }

  // 8) Road names
  if (!map.getLayer('retro-road-names')) {
    map.addLayer({
      id: 'retro-road-names',
      type: 'symbol',
      source: 'mtl-vector',
      'source-layer': 'transportation_name',
      layout: {
        'text-field': ['coalesce', ['get','name:en'], ['get','name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'symbol-placement': 'line',
        'text-letter-spacing': 0.02
      },
      paint: {
        'text-color': '#222',
        'text-halo-color': '#fff',
        'text-halo-width': 2
      }
    }, beforeId)
  }

if (!map.getLayer('retro-place-labels')) {
    map.addLayer({
      id: 'retro-place-labels',
      type: 'symbol',
      source: 'mtl-vector',
      'source-layer': 'place',
      layout: {
        'text-field': ['coalesce', ['get','name:en'], ['get','name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['match', ['get','class'], 'city',16,'town',13,'village',11,10],
        'text-letter-spacing': 0,
      },
      paint: { 'text-color':'#111','text-halo-color':'#fff','text-halo-width':2,'text-halo-blur':0 },
    }, beforeId)
  }
  // Label shadows (1px offset) → drawn *below* the mains
  if (!map.getLayer('retro-place-labels-shadow')) {
    map.addLayer({
      id: 'retro-place-labels-shadow',
      type: 'symbol',
      source: 'mtl-vector',
      'source-layer': 'place',
      layout: {
        'text-field': ['coalesce', ['get','name:en'], ['get','name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['match', ['get','class'], 'city',16,'town',13,'village',11,10],
        'text-allow-overlap': true,
      },
      paint: { 'text-color':'#000', 'text-translate':[1,1], 'text-opacity':0.8 },
    }, 'retro-place-labels')
  }
  if (!map.getLayer('retro-road-names-shadow')) {
    map.addLayer({
      id: 'retro-road-names-shadow',
      type: 'symbol',
      source: 'mtl-vector',
      'source-layer': 'transportation_name',
      layout: {
        'text-field': ['coalesce', ['get','name:en'], ['get','name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'symbol-placement': 'line',
        'text-allow-overlap': true,
      },
      paint: { 'text-color':'#000', 'text-translate':[1,1], 'text-opacity':0.8 },
    }, 'retro-road-names')
  }

  // Start hidden; the basemap toggle will show/hide them.
  ;[
    'retro-bg','retro-water','retro-landuse','retro-buildings',
    'retro-road-case','retro-road','retro-road-names','retro-place-labels',
    'retro-road-names-shadow','retro-place-labels-shadow',
  ].forEach(id => map.setLayoutProperty(id, 'visibility', 'none'))
}
// ---------- Build lawnmower grid INSIDE polygon ----------
function buildGridInsidePolygon(
  poly: GeoJSON.Polygon,
  headingDeg: number,
  spacing_m: number
): LatLon[][] {
  const [minX, minY, maxX, maxY] = bbox(poly)
  const centerLon = (minX + maxX) / 2
  const centerLat = (minY + maxY) / 2

  const diag_m = turfDistance([minX, minY], [maxX, maxY], { units: 'kilometers' }) * 1000
  const lineLen_m = Math.max(500, diag_m * 2)

  const width_m =
    turfDistance([minX, centerLat], [maxX, centerLat], { units: 'kilometers' }) * 1000
  const height_m =
    turfDistance([centerLon, minY], [centerLon, maxY], { units: 'kilometers' }) * 1000
  const cover_m = Math.max(width_m, height_m) + spacing_m * 4

  const halfSteps = Math.ceil(cover_m / (2 * spacing_m))
  const ortho = (headingDeg + 90) % 360

  const pCenter: [number, number] = [centerLon, centerLat]
  const p1 = destination(pCenter, lineLen_m / 2000, headingDeg, { units: 'kilometers' }).geometry
    .coordinates
  const p2 = destination(pCenter, lineLen_m / 2000, (headingDeg + 180) % 360, {
    units: 'kilometers',
  }).geometry.coordinates
  const baseLine = lineString([p2, p1]) // [lon,lat]

  const polyFeat: GeoJSON.Feature<GeoJSON.Polygon> = { type: 'Feature', properties: {}, geometry: poly }
  const legs: LatLon[][] = []

  for (let i = -halfSteps; i <= halfSteps; i++) {
    const shifted = transformTranslate(baseLine, (i * spacing_m) / 1000, ortho, {
      units: 'kilometers',
    })

    let pieces: GeoJSON.Feature<GeoJSON.LineString>[]
    try {
      const split = lineSplit(shifted, polyFeat)
      pieces = split.features.length
        ? (split.features as GeoJSON.Feature<GeoJSON.LineString>[])
        : [shifted as unknown as GeoJSON.Feature<GeoJSON.LineString>]
    } catch {
      pieces = [shifted as unknown as GeoJSON.Feature<GeoJSON.LineString>]
    }

    for (const seg of pieces) {
      const coords = seg.geometry?.coordinates
      if (!coords || coords.length < 2) continue
      const mid = midpoint(coords[0], coords[coords.length - 1])
      if (booleanPointInPolygon(mid, polyFeat)) {
        const path = coords.map(([lon, lat]) => [lat, lon]) as LatLon[]
        legs.push(legs.length % 2 === 0 ? path : [...path].reverse()) // zig-zag
      }
    }
  }
  return legs
}

// ---------- Connect legs to a single continuous path ----------
function connectLegs(legs: LatLon[][]): LatLon[] {
  const out: LatLon[] = []
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i]
    if (!leg || leg.length < 2) continue
    if (out.length === 0) out.push(...leg)
    else {
      const last = out[out.length - 1]
      const start = leg[0]
      if (last[0] !== start[0] || last[1] !== start[1]) out.push(start) // connector
      out.push(...leg.slice(1))
    }
  }
  return out
}

// ---------- Segment legs by battery cap ----------
type Segment = {
  legs: LatLon[][]     // legs included
  pathLatLon: LatLon[] // connected path (lat,lon)
  distance_m: number
  time_s: number
}

function segmentByCap(
  legs: LatLon[][],
  speed_mps: number,
  turnTime_s: number,
  cap_min: number
): Segment[] {
  const budget_s = Math.max(60, cap_min * 60 - 60) // leave ~1 min reserve
  const segs: Segment[] = []
  let current: LatLon[][] = []
  let timeAccum = 0
  let distAccum = 0

  const legTimeAndDist = (leg: LatLon[]) => {
    if (!leg || leg.length < 2) return { t: 0, d: 0 }
    const ll = leg.map(([lat, lon]) => [lon, lat]) as [number, number][]
    const d = turfLength(lineString(ll), { units: 'kilometers' }) * 1000
    const t = speed_mps > 0 ? d / speed_mps : 0
    return { t, d }
  }

  legs.forEach((leg, idx) => {
    const { t, d } = legTimeAndDist(leg)
    const extraTurn = turnTime_s // pessimistic; simple per-leg overhead

    // if adding this leg would exceed budget, start a new segment (unless empty)
    if (current.length && (timeAccum + t + extraTurn > budget_s)) {
      const pathLatLon = connectLegs(current)
      const ll = pathLatLon.map(([lat, lon]) => [lon, lat]) as [number, number][]
      const segDist = turfLength(lineString(ll), { units: 'kilometers' }) * 1000
      segs.push({
        legs: current,
        pathLatLon: pathLatLon,
        distance_m: segDist,
        time_s: timeAccum,
      })
      current = []
      timeAccum = 0
      distAccum = 0
    }

    current.push(leg)
    timeAccum += t + extraTurn
    distAccum += d
  })

  if (current.length) {
    const pathLatLon = connectLegs(current)
    const ll = pathLatLon.map(([lat, lon]) => [lon, lat]) as [number, number][]
    const segDist = turfLength(lineString(ll), { units: 'kilometers' }) * 1000
    segs.push({
      legs: current,
      pathLatLon: pathLatLon,
      distance_m: segDist,
      time_s: timeAccum,
    })
  }

  return segs
}

// Colors for segmented paths
const SEG_COLORS = ['#ff4d00', '#00a1ff', '#22a745', '#cc33cc', '#ffaa00', '#8b5cf6', '#e11d48']
/** ───────────────────────────────── App ───────────────────────────────── */
export default function App() {
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const homeMarkerRef = useRef<maplibregl.Marker | null>(null)
  const segLayerIdsRef = useRef<string[]>([])

  const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY as string | undefined
 //hooks
  // View & mission state
  const [center, setCenter] = useState<LatLon>([40.7608, -111.891])
  const [heading, setHeading] = useState(0)
  const [heightAGL, setHeightAGL] = useState(100)
  const [overlap, setOverlap] = useState(0.75)
  const [sidelap, setSidelap] = useState(0.7)
  const [groundspeed, setGroundspeed] = useState(8)
  const [turnTime, setTurnTime] = useState(3)
  const [batteryCap, setBatteryCap] = useState(25)
  const [basemap, setBasemap] = useState<'streets' | 'satellite' | 'usgs' | 'retro90s'>('usgs')

  // Crosshatch & segmentation toggles
  const [crosshatch, setCrosshatch] = useState(false)
  const [autoSegment, setAutoSegment] = useState(false)

  // Camera
  const cameraKeys = Object.keys(Cameras) as string[]
  const [cameraKey, setCameraKey] = useState<string>(cameraKeys[0] || 'Mavic3T_Wide')
  const camera = useMemo(() => (Cameras as any)[cameraKey], [cameraKey])

  // AOI + Home
  const [aoi, setAoi] = useState<GeoJSON.Polygon | null>(null)
  const [home, setHome] = useState<LatLon>([center[0], center[1]])
  // state
  const [retro, setRetro] = useState(false)

// remember what the user was on before switching to retro
const lastNonRetro = useRef<'streets' | 'satellite' | 'usgs'>('streets')

  // Spacing
  const { along_m, across_m } = useMemo(
    () => spacingFromOverlap(heightAGL, camera, overlap, sidelap),
    [heightAGL, camera, overlap, sidelap]
  )

  // Primary & crosshatch legs
  const legsPrimary: LatLon[][] = useMemo(() => {
    if (!aoi || !aoi.coordinates?.[0] || aoi.coordinates[0].length < 4) return []
    return buildGridInsidePolygon(aoi, heading, across_m)
  }, [aoi, heading, across_m])

  const legsCross: LatLon[][] = useMemo(() => {
    if (!crosshatch || !aoi) return []
    return buildGridInsidePolygon(aoi, (heading + 90) % 360, across_m)
  }, [aoi, crosshatch, heading, across_m])

  const allLegs: LatLon[][] = useMemo(
    () => (crosshatch ? [...legsPrimary, ...legsCross] : legsPrimary),
    [legsPrimary, legsCross, crosshatch]
  )

  // Connected path for "single mission" view
  const rawPathLatLon = useMemo(() => connectLegs(allLegs), [allLegs])

  // Orient path so start is closest to Home
  const orientedPathLonLat: [number, number][] = useMemo(() => {
    if (rawPathLatLon.length < 2) return []
    const pathLL = rawPathLatLon.map(([lat, lon]) => [lon, lat] as [number, number])
    const homeLL: [number, number] = [home[1], home[0]]
    const dStart = turfDistance(homeLL, pathLL[0], { units: 'kilometers' })
    const dEnd = turfDistance(homeLL, pathLL[pathLL.length - 1], { units: 'kilometers' })
    return dStart <= dEnd ? pathLL : [...pathLL].reverse()
  }, [rawPathLatLon, home])

  // Entry/Return
  const entryCoords: [number, number][] = useMemo(() => {
    if (orientedPathLonLat.length < 2) return []
    return [[home[1], home[0]], orientedPathLonLat[0]]
  }, [orientedPathLonLat, home])

  const returnCoords: [number, number][] = useMemo(() => {
    if (orientedPathLonLat.length < 2) return []
    return [orientedPathLonLat[orientedPathLonLat.length - 1], [home[1], home[0]]]
  }, [orientedPathLonLat, home])

  // Distances & estimates (for whole plan)
  const mainPathDistance_m = useMemo(() => {
    if (orientedPathLonLat.length < 2) return 0
    return turfLength(lineString(orientedPathLonLat), { units: 'kilometers' }) * 1000
  }, [orientedPathLonLat])

  const entryReturnDistance_m = useMemo(() => {
    let sum = 0
    if (entryCoords.length === 2) sum += turfLength(lineString(entryCoords), { units: 'kilometers' }) * 1000
    if (returnCoords.length === 2) sum += turfLength(lineString(returnCoords), { units: 'kilometers' }) * 1000
    return sum
  }, [entryCoords, returnCoords])

  const totalDistance_m = mainPathDistance_m + entryReturnDistance_m

  const estTime_min = useMemo(() => {
    if (groundspeed <= 0 || totalDistance_m <= 0) return 0
    const pure_secs = totalDistance_m / groundspeed
    const turns = Math.max(0, allLegs.length - 1)
    const overhead_secs = turns * turnTime
    return (pure_secs + overhead_secs) / 60
  }, [totalDistance_m, groundspeed, allLegs.length, turnTime])

  const photoCount = useMemo(() => {
    if (along_m <= 0 || mainPathDistance_m <= 0) return 0
    return Math.ceil(mainPathDistance_m / along_m)
  }, [mainPathDistance_m, along_m])

  // Segments (by cap)
  const segments: Segment[] = useMemo(() => {
    if (!autoSegment) return [{
      legs: allLegs,
      pathLatLon: rawPathLatLon,
      distance_m: mainPathDistance_m,
      time_s: estTime_min * 60,
    }]
    return segmentByCap(allLegs, groundspeed, turnTime, batteryCap)
  }, [autoSegment, allLegs, rawPathLatLon, mainPathDistance_m, estTime_min, groundspeed, turnTime, batteryCap])

  // ------------- GeoJSONs for base (grid + single-path + entry/return) -------------
  const gridGeoJSON = useMemo(
    () =>
      ({
        type: 'FeatureCollection',
        features: allLegs.map((ln) => ({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: ln.map(([lat, lon]) => [lon, lat]) },
        })),
      }) as GeoJSON.FeatureCollection,
    [allLegs]
  )

  const pathGeoJSON = useMemo(
    () =>
      ({
        type: 'FeatureCollection',
        features: orientedPathLonLat.length
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: orientedPathLonLat } }]
          : [],
      }) as GeoJSON.FeatureCollection,
    [orientedPathLonLat]
  )

  const entryGeoJSON = useMemo(
    () =>
      ({
        type: 'FeatureCollection',
        features: entryCoords.length
          ? [{ type: 'Feature', properties: { role: 'entry' }, geometry: { type: 'LineString', coordinates: entryCoords } }]
          : [],
      }) as GeoJSON.FeatureCollection,
    [entryCoords]
  )

  const returnGeoJSON = useMemo(
    () =>
      ({
        type: 'FeatureCollection',
        features: returnCoords.length
          ? [{ type: 'Feature', properties: { role: 'return' }, geometry: { type: 'LineString', coordinates: returnCoords } }]
          : [],
      }) as GeoJSON.FeatureCollection,
    [returnCoords]
  )
    const aoiArea = useMemo(() => {
    if (!aoi?.coordinates?.[0] || aoi.coordinates[0].length < 4) {
        return { m2: 0, acres: 0, hectares: 0, sqmi: 0 }
    }
    const feat = { type: 'Feature', properties: {}, geometry: aoi } as GeoJSON.Feature<GeoJSON.Polygon>
    const m2 = turfArea(feat) // square meters
    return {
        m2,
        acres: m2 / 4046.8564224,
    }
    }, [aoi])

  // ---------- Map init ----------
  useEffect(() => {
  if (retro) {
    if (basemap !== 'retro90s') {
      if (basemap === 'streets' || basemap === 'satellite' || basemap === 'usgs') {
        lastNonRetro.current = basemap
      }
      setBasemap('retro90s')
    }
  } else {
    if (basemap === 'retro90s') setBasemap(lastNonRetro.current)
  }
}, [retro]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return
const styleWithGlyphs: StyleSpecification = {
  ...baseStyle,
  // enables text labels for the retro vector layers
  glyphs: MAPTILER_KEY
    ? `https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=${MAPTILER_KEY}`
    : undefined,
}
    const map = new maplibregl.Map({
      container: mapContainer.current!,
      style: styleWithGlyphs,
      center: [center[1], center[0]],
      zoom: 14,
      preserveDrawingBuffer: true, // needed for PNG snapshot
    })
    mapRef.current = map
    ;(window as any).map = map // handy for debugging

    map.on('moveend', () => {
      const c = map.getCenter()
      setCenter([c.lat, c.lng])
    })

    // Draw control
    const draw: any = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
    })
    map.addControl(draw as any, 'top-left')

    // Disable drag while drawing polygon
    map.on('draw.modechange' as any, (e: any) => {
      if (String(e.mode).startsWith('draw_polygon')) map.dragPan.disable()
      else map.dragPan.enable()
    })

    // Update AOI when created/updated/deleted
    const updateAOIFromDraw = () => {
      try {
        const feats = draw.getAll()
        const poly = feats.features.find((f: any) => f?.geometry?.type === 'Polygon') as
          | GeoJSON.Feature<GeoJSON.Polygon>
          | undefined
        const ring = poly?.geometry?.coordinates?.[0]
        if (!poly || !ring || ring.length < 4) setAoi(null)
        else setAoi(poly.geometry)
      } catch {
        setAoi(null)
      }
    }
    map.on('draw.create' as any, updateAOIFromDraw)
    map.on('draw.update' as any, updateAOIFromDraw)
    map.on('draw.delete' as any, () => setAoi(null))

    map.on('load', () => {
      map.setLayoutProperty('basemap-osm', 'visibility', 'none')
      map.setLayoutProperty('basemap-sat', 'visibility', 'none')
      map.setLayoutProperty('basemap-usgs', 'visibility', 'visible')
      map.setLayoutProperty('basemap-retro90s', 'visibility', 'none')

      if (!map.getSource('grid')) map.addSource('grid', { type: 'geojson', data: gridGeoJSON })
      if (!map.getSource('path')) map.addSource('path', { type: 'geojson', data: pathGeoJSON })
      if (!map.getSource('path-entry')) map.addSource('path-entry', { type: 'geojson', data: entryGeoJSON })
      if (!map.getSource('path-return')) map.addSource('path-return', { type: 'geojson', data: returnGeoJSON })

      if (!map.getLayer('grid-lines')) {
        map.addLayer({
          id: 'grid-lines',
          type: 'line',
          source: 'grid',
          paint: { 'line-width': 2, 'line-color': '#0077ff', 'line-opacity': 0.5 },
        })
      }
      if (!map.getLayer('path-line')) {
        map.addLayer({
          id: 'path-line',
          type: 'line',
          source: 'path',
          paint: { 'line-width': 3, 'line-color': '#ff4d00', 'line-opacity': 0.95 },
        })
      }
      if (!map.getLayer('path-entry-line')) {
        map.addLayer({
          id: 'path-entry-line',
          type: 'line',
          source: 'path-entry',
          paint: { 'line-width': 2, 'line-color': '#666', 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
        })
      }
      if (!map.getLayer('path-return-line')) {
        map.addLayer({
          id: 'path-return-line',
          type: 'line',
          source: 'path-return',
          paint: { 'line-width': 2, 'line-color': '#666', 'line-dasharray': [2, 2], 'line-opacity': 0.9 },
        })
      }
      homeMarkerRef.current = new maplibregl.Marker({ color: '#1e90ff', draggable: true })
        .setLngLat([home[1], home[0]])
        .addTo(map)
      homeMarkerRef.current.on('dragend', () => {
        const ll = homeMarkerRef.current!.getLngLat()
        setHome([ll.lat, ll.lng])
      })
      // Home marker
      homeMarkerRef.current = new maplibregl.Marker({ color: '#1e90ff', draggable: true })
        .setLngLat([home[1], home[0]])
        .addTo(map)
      homeMarkerRef.current.on('dragend', () => {
        const ll = homeMarkerRef.current!.getLngLat()
        setHome([ll.lat, ll.lng])
      })

      // Add retro vector basemap (hidden initially)
      addRetro90sLayers(map, MAPTILER_KEY)
    })

    return () => { map.remove(); mapRef.current = null; homeMarkerRef.current = null }
  }, [])


  // Update static sources
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    ;(map.getSource('grid') as GeoJSONSource | undefined)?.setData(gridGeoJSON as any)
    ;(map.getSource('path') as GeoJSONSource | undefined)?.setData(pathGeoJSON as any)
    ;(map.getSource('path-entry') as GeoJSONSource | undefined)?.setData(entryGeoJSON as any)
    ;(map.getSource('path-return') as GeoJSONSource | undefined)?.setData(returnGeoJSON as any)
  }, [gridGeoJSON, pathGeoJSON, entryGeoJSON, returnGeoJSON])

  // Basemap toggle
// Basemap toggle + Retro label tweaks
useEffect(() => {
  const map = mapRef.current
  if (!map || !map.isStyleLoaded()) return

  // helper to show/hide a layer if it exists
  const show = (id: string, vis: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none')
  }

  const streets = basemap === 'streets'
  const sat     = basemap === 'satellite'
  const usgs    = basemap === 'usgs'
  const retro   = basemap === 'retro90s'

  // 1) Raster basemaps
  show('basemap-osm',  streets)
  show('basemap-sat',  sat)
  show('basemap-usgs', usgs)

  // 2) Retro vector basemap (and shadows, if you added them)
;[
      'retro-bg','retro-water','retro-landuse','retro-buildings',
      'retro-road-case','retro-road','retro-road-names','retro-place-labels',
      'retro-road-names-shadow','retro-place-labels-shadow',
    ].forEach(id => show(id, retro))

  // 3) Pixelate canvas only in retro mode (chunky Win95 feel)
  map.getCanvas().style.imageRendering = retro ? 'pixelated' : ''

  // 4) Make retro labels crisp/bitmap-y (idempotent)
  if (retro) {
    const crisp = (id: string) => {
      if (!map.getLayer(id)) return
      map.setPaintProperty(id, 'text-color', '#111')
      map.setPaintProperty(id, 'text-halo-color', '#fff')
      map.setPaintProperty(id, 'text-halo-width', 2)
      map.setPaintProperty(id, 'text-halo-blur', 0)
      // tighten spacing a touch
      try { map.setLayoutProperty(id, 'text-letter-spacing', 0) } catch {}
    }
    crisp('retro-road-names')
    crisp('retro-place-labels')
  }
}, [basemap])

  // Home marker sync
  useEffect(() => {
    const m = homeMarkerRef.current
    if (m) m.setLngLat([home[1], home[0]])
  }, [home])

  // ---------- Dynamic segment layers (colored paths) ----------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    // Hide single-path layers when auto-segmenting
    const showSingle = !autoSegment
    ;['path-line', 'path-entry-line', 'path-return-line'].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', showSingle ? 'visible' : 'none')
    })

    // Remove prior segment layers/sources
    segLayerIdsRef.current.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id)
      const srcId = `${id}-src`
      if (map.getSource(srcId)) map.removeSource(srcId)
    })
    segLayerIdsRef.current = []

    if (!autoSegment) return

    segments.forEach((seg, i) => {
      const id = `seg-${i + 1}`
      const srcId = `${id}-src`
      const color = SEG_COLORS[i % SEG_COLORS.length]
      const gj = {
        type: 'FeatureCollection',
        features: seg.pathLatLon.length
          ? [{ type: 'Feature', properties: { seg: i + 1 }, geometry: { type: 'LineString', coordinates: seg.pathLatLon.map(([lat, lon]) => [lon, lat]) } }]
          : [],
      } as GeoJSON.FeatureCollection

      if (!map.getSource(srcId)) map.addSource(srcId, { type: 'geojson', data: gj })
      if (!map.getLayer(id)) {
        map.addLayer({
          id,
          type: 'line',
          source: srcId,
          paint: { 'line-width': 4, 'line-color': color, 'line-opacity': 0.95 },
        })
      }
      segLayerIdsRef.current.push(id)
    })
  }, [autoSegment, segments])
  // body class toggle (so CSS can target everything)
    useEffect(() => {
    document.body.classList.toggle('retro', retro)
    }, [retro])

  // ---------- Export .plan (single .plan using all legs) ----------
  function downloadPlan() {
    const plan = makePlan({
      homeLat: home[0],
      homeLon: home[1],
      relAlt_m: heightAGL,
      groundspeed_mps: groundspeed,
      trigger_m: Math.max(1, along_m),
      gridLines: allLegs,
    })
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mission.plan'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // ---------- Snapshot (PNG with small legend) ----------
  function snapshotPNG() {
    const map = mapRef.current
    if (!map) return
    const canvas = map.getCanvas()
    const w = canvas.width, h = canvas.height

    // Compose onto a new canvas so we can draw legend text
    const out = document.createElement('canvas')
    out.width = w; out.height = h
    const ctx = out.getContext('2d')!
    ctx.drawImage(canvas, 0, 0)

    // legend box
    const pad = 16
    const boxW = 320, boxH = 270
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillRect(pad, pad, boxW, boxH)
    ctx.strokeStyle = '#333'
    ctx.strokeRect(pad, pad, boxW, boxH)

    ctx.fillStyle = '#111'
    ctx.font = 'bold 24px sans-serif'
    ctx.fillText('Drone Flight Project Scoping', pad + 10, pad + 30)

    ctx.font = '14px sans-serif'
    const lines = [
      `Camera: ${(camera?.name) ?? cameraKey}`,
      `Alt: ${heightAGL} m AGL   Heading: ${heading}°`,
      `Speed: ${groundspeed} m/s   Turn: ${turnTime}s`,
      `Overlap/Sidelap: ${Math.round(overlap*100)}% / ${Math.round(sidelap*100)}%`,
      `Overlap trigger ≈ ${along_m.toFixed(2)} m`,
      `Flight line spacing ≈ ${across_m.toFixed(2)} m`,
      `Main path ≈ ${(mainPathDistance_m / 1000).toFixed(2)} km`,
      `Transit Distance (to and from home) ≈ ${(entryReturnDistance_m / 1000).toFixed(2)} km`,
      `Total dist: ${(totalDistance_m/1000).toFixed(2)} km   Est time: ${estTime_min.toFixed(1)} min`,
      `AOI: ${aoi ? aoiArea.acres.toFixed(2) + ' ac' : '—'}`,
      `Photos: ${photoCount}`,
      autoSegment ? `Segments: ${segments.length}` : `Segments: 1`,
    ]
    lines.forEach((t, i) => ctx.fillText(t, pad + 10, pad + 56 + i * 18))

    const url = out.toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = 'mission_snapshot.png'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="app">
      <div className="sidebar">
        <h1>Drone Flight Scoping Webapp</h1>
        
    <div className="row">
    <label>Theme</label>
    <div>
        <label className="small" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={retro} onChange={(e) => setRetro(e.target.checked)} />
        Retro (1999) mode
        </label>
    </div>
    {retro ? (
  <div className="marquee"> Welcome to my corner of the web</div>
) : null}
{retro && (
  <div className="small" style={{ marginTop: 8 }}>
    <img src="/retro/under_construction.gif" alt="Under Construction" height={18} />
    &nbsp;Best viewed at 800×600
  </div>
)}

    </div>

        {/* Camera */}
        <div className="row">
          <label>Camera</label>
          <select value={cameraKey} onChange={(e) => setCameraKey(e.target.value)}>
            {cameraKeys.map((k) => (
              <option key={k} value={k}>
                {(Cameras as any)[k].name || k}
              </option>
            ))}
          </select>
        </div>
        {/* Basemap */}
        <div className="row">
        <label>Basemap</label>
        <select
            value={basemap}
            disabled={retro}  // ← disables the dropdown while Retro mode is on
            onChange={(e) => {
            const val = e.target.value as 'streets' | 'satellite' | 'usgs' | 'retro90s'
            setBasemap(val)
            if (val !== 'retro90s') lastNonRetro.current = val  // keep memory of last non-retro
            }}
        >
            <option value="streets">Streets (OSM)</option>
            <option value="satellite">Satellite (Esri)</option>
            <option value="usgs">USGS Topo</option>
            <option value="retro90s">Retro MapQuest</option>
        </select>

        {retro && <div className="small">Basemap locked to Retro MapQuest while Retro mode is on.</div>}
        </div>
        {/* Home */}
        <div className="row">
          <label>Home</label>
          <button onClick={() => setHome(center)}>Set to map center</button>
        </div>

        <div className="row">
          <label>Height AGL (m)</label>
          <input type="number" value={heightAGL} step={5} onChange={(e) => setHeightAGL(Number(e.target.value) || 0)} />
        </div>

        {/* Overlap / Sidelap sliders */}
        <div className="row">
          <label>Overlap</label>
          <div>
            <input type="range" min={0} max={95} step={1}
              value={Math.round(overlap*100)}
              onChange={(e) => setOverlap(Number(e.target.value)/100)}
              style={{ width: '100%' }}
            />
            <div className="small">{Math.round(overlap*100)}%</div>
          </div>
        </div>

        <div className="row">
          <label>Sidelap</label>
          <div>
            <input type="range" min={0} max={95} step={1}
              value={Math.round(sidelap*100)}
              onChange={(e) => setSidelap(Number(e.target.value)/100)}
              style={{ width: '100%' }}
            />
            <div className="small">{Math.round(sidelap*100)}%</div>
          </div>
        </div>

        {/* Heading slider */}
        <div className="row">
          <label>Heading</label>
          <div>
            <input
              type="range" min={0} max={359} step={1}
              value={heading}
              onChange={(e) => setHeading(Number(e.target.value))}
              style={{ width: '100%' }}
              aria-label="Heading degrees"
            />
            <div className="small">{heading}°</div>
          </div>
        </div>
        
        {/* Speed/turn/battery */}
        <div className="row">
          <label>Groundspeed (m/s)</label>
          <input type="number" value={groundspeed} onChange={(e) => setGroundspeed(Number(e.target.value) || 0)} />
        </div>
        <div className="row">
          <label>Turn time (s)</label>
          <input type="number" value={turnTime} onChange={(e) => setTurnTime(Number(e.target.value) || 0)} />
        </div>
        <div className="row">
          <label>Battery cap (minutes)</label>
          <input type="number" value={batteryCap} onChange={(e) => setBatteryCap(Number(e.target.value) || 0)} />
        </div>

        {/* Crosshatch + auto-segment */}
        <div className="row">
          <label>Crosshatch</label>
          <input type="checkbox" checked={crosshatch} onChange={(e) => setCrosshatch(e.target.checked)} />
        </div>
        <div className="row">
          <label>Auto-segment (cap)</label>
          <input type="checkbox" checked={autoSegment} onChange={(e) => setAutoSegment(e.target.checked)} />
        </div>

        {/* Snapshot */}
        <div className="row">
          <label>Snapshot</label>
          <button onClick={snapshotPNG}>Save PNG</button>
        </div>

        {/* Stats */}
        <div className="info">
          <div>Overlap: {Math.round(overlap * 100)}%</div>
          <div>Sidelap: {Math.round(sidelap * 100)}%</div>
          <div>Along-track trigger ≈ {along_m.toFixed(2)} m</div>
          <div>Across-track spacing ≈ {across_m.toFixed(2)} m</div>
          <div>AOI: {aoi ? 'Yes (planning inside polygon)' : 'None (draw to plan)'} </div>
          <div>Main path ≈ {(mainPathDistance_m / 1000).toFixed(2)} km</div>
          <div>Transit (to/from home) ≈ {(entryReturnDistance_m / 1000).toFixed(2)} km</div>
          <div><strong>Total distance</strong> ≈ {(totalDistance_m / 1000).toFixed(2)} km</div>
          <div>AOI area: {aoi ? `${aoiArea.acres.toFixed(2)} ac` : '—'}</div>
          <div>Est. flight time ≈ {estTime_min.toFixed(1)} min</div>
          <div>Photos ≈ {photoCount}</div>
          {autoSegment && (
            <>
              <div style={{ marginTop: 6 }}><strong>Segments: {segments.length}</strong></div>
              <ul className="small" style={{ margin: '6px 0 0 16px' }}>
                {segments.map((s, i) => (
                  <li key={i}>
                    #{i + 1}: {(s.distance_m/1000).toFixed(2)} km · {(s.time_s/60).toFixed(1)} min
                  </li>
                ))}
              </ul>
            </>
          )}
          {retro && (
    <div className="small" style={{ marginTop: 8 }}>
        <img src="/retro/download.gif" alt="Download Plan" height={55} />
    </div>
    )}
        </div>

        <button onClick={downloadPlan} disabled={!allLegs.length}>
          Download .plan
        </button>
        <p className="small">Tip: draw an AOI, set Home, tune heading/overlaps. Use auto-segment to split long runs by your battery cap.</p>
       
          {retro && (
    <div className="small" style={{ marginTop: 8 }}>
        <img src="/retro/badge_best_viewed_800x600.gif" width="88" height="31" alt="Best viewed at 800x600" />
         <img src="/retro/badge_powered_by_frames.gif"   width="88" height="31" alt="Powered by Frames" />
    </div>
    )}

      </div>

      <div className="map" ref={mapContainer} />
    </div>
    
  )
}
