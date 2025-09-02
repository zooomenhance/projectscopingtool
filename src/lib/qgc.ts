import { destination } from '@turf/turf'

export type QgcPlan = {
  fileType: 'Plan'
  geoFence: { version: 2; polygons: any[]; circles: any[] }
  groundStation: 'QGroundControl'
  mission: {
    version: 2
    cruiseSpeed?: number
    hoverSpeed?: number
    items: MissionItem[]
    plannedHomePosition: [number, number, number] // [lat, lon, alt MSL]
    vehicleType?: number
    firmwareType?: number
  }
  rallyPoints: { version: 2; points: any[] }
  version: 1
}

export type MissionItem = {
  AMslAlt?: boolean
  autoContinue: boolean
  command: number
  doJumpId: number
  frame: number
  params: [number, number, number, number, number, number, number]
  type: 'SimpleItem'
}

const MAV_CMD = { NAV_WAYPOINT: 16, DO_SET_CAM_TRIGG_DIST: 206 } as const
const MAV_FRAME = { GLOBAL: 0, GLOBAL_RELATIVE_ALT: 3 } as const

export type Camera = {
  name: string
  sensorWidth_mm: number
  sensorHeight_mm: number
  focalLength_mm: number
  imageWidth_px: number
  imageHeight_px: number
  pixelPitch_um?: number
}

// --- GSD helpers ---
export function gsdCmPerPx(heightAGL_m: number, cam: Camera) {
  if (cam.pixelPitch_um) {
    const gsd_m =
      (heightAGL_m * (cam.pixelPitch_um / 1e6)) / (cam.focalLength_mm / 1000)
    return gsd_m * 100
  } else {
    const gsd_m =
      ((heightAGL_m * (cam.sensorWidth_mm / 1000)) /
        (cam.focalLength_mm / 1000)) /
      cam.imageWidth_px
    return gsd_m * 100
  }
}

export function footprintMeters(heightAGL_m: number, cam: Camera) {
  const groundWidth_m =
    (heightAGL_m * (cam.sensorWidth_mm / 1000)) /
    (cam.focalLength_mm / 1000)
  const groundHeight_m =
    (heightAGL_m * (cam.sensorHeight_mm / 1000)) /
    (cam.focalLength_mm / 1000)
  return { groundWidth_m, groundHeight_m }
}

export function spacingFromOverlap(
  heightAGL_m: number,
  cam: Camera,
  overlapFrac: number,
  sidelapFrac: number
) {
  const { groundWidth_m, groundHeight_m } = footprintMeters(heightAGL_m, cam)
  const along_m = groundHeight_m * (1 - overlapFrac)  // trigger distance
  const across_m = groundWidth_m * (1 - sidelapFrac)  // line spacing
  return { along_m, across_m, footprint: { groundWidth_m, groundHeight_m } }
}

// --- Grid builder ---
export type GridParams = {
  startLat: number
  startLon: number
  headingDeg: number
  lineCount: number
  lineLength_m: number
  spacing_m: number
}

export function buildGrid(params: GridParams): [number, number][][] {
  const { startLat, startLon, headingDeg, lineCount, lineLength_m, spacing_m } =
    params
  const lines: [number, number][][] = []
  const ortho = (headingDeg + 90) % 360

  for (let i = 0; i < lineCount; i++) {
    const offsetStart = destination(
      [startLon, startLat],
      (i * spacing_m) / 1000,
      ortho,
      { units: 'kilometers' }
    ).geometry.coordinates

    const fwd = destination(offsetStart, lineLength_m / 1000, headingDeg, {
      units: 'kilometers',
    }).geometry.coordinates

    const coords = i % 2 === 0 ? [offsetStart, fwd] : [fwd, offsetStart]
    lines.push(coords.map(([lon, lat]) => [lat, lon]))
  }
  return lines
}

// --- Mission writer ---
let idCounter = 1
function nextId() {
  return idCounter++
}

function wp(lat: number, lon: number, relAlt_m: number): MissionItem {
  return {
    AMslAlt: false,
    autoContinue: true,
    command: MAV_CMD.NAV_WAYPOINT,
    doJumpId: nextId(),
    frame: MAV_FRAME.GLOBAL_RELATIVE_ALT,
    params: [0, 0, 0, 0, lat, lon, relAlt_m],
    type: 'SimpleItem',
  }
}

function camTrigDist(trigger_m: number): MissionItem {
  return {
    autoContinue: true,
    command: MAV_CMD.DO_SET_CAM_TRIGG_DIST,
    doJumpId: nextId(),
    frame: MAV_FRAME.GLOBAL,
    params: [trigger_m, 0, 0, 0, 0, 0, 0],
    type: 'SimpleItem',
  } as MissionItem
}

export type MakePlanOptions = {
  homeLat: number
  homeLon: number
  relAlt_m: number
  groundspeed_mps?: number
  hover_mps?: number
  trigger_m: number
  gridLines: [number, number][][]
  firmwareType?: number
  vehicleType?: number
}

export function makePlan(opts: MakePlanOptions): QgcPlan {
  idCounter = 1
  const items: MissionItem[] = []
  items.push(camTrigDist(opts.trigger_m))
  for (const line of opts.gridLines) {
    for (const [lat, lon] of line) items.push(wp(lat, lon, opts.relAlt_m))
  }
  return {
    fileType: 'Plan',
    version: 1,
    groundStation: 'QGroundControl',
    geoFence: { version: 2, polygons: [], circles: [] },
    rallyPoints: { version: 2, points: [] },
    mission: {
      version: 2,
      cruiseSpeed: opts.groundspeed_mps,
      hoverSpeed: opts.hover_mps,
      items,
      plannedHomePosition: [opts.homeLat, opts.homeLon, 0],
      firmwareType: opts.firmwareType ?? 12,
      vehicleType: opts.vehicleType ?? 3,
    },
  }
}

// Example camera preset
// Example camera presets
export const Cameras = {
  Mavic3T_Wide: {
    name: 'Mavic 3T Wide',
    sensorWidth_mm: 6.3,
    sensorHeight_mm: 4.7,
    focalLength_mm: 4.5,
    imageWidth_px: 4000,
    imageHeight_px: 3000,
  } as Camera,

  Phantom4Pro: {
    name: 'Phantom 4 Pro',
    sensorWidth_mm: 13.2,
    sensorHeight_mm: 8.8,
    focalLength_mm: 8.8,
    imageWidth_px: 5472,
    imageHeight_px: 3648,
  } as Camera,

  Mavic3T_Tele: {
    name: 'Mavic 3T Tele',
    sensorWidth_mm: 4.5,
    sensorHeight_mm: 3.4,
    focalLength_mm: 162, // telephoto lens
    imageWidth_px: 4000,
    imageHeight_px: 3000,
  } as Camera,
}
