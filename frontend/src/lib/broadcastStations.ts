export type BroadcastStationCategory =
  | 'Yuge'
  | 'Jazzy'
  | 'Electronic'
  | 'New Wave'
  | 'Lounge'
  | 'Ambient'
  | 'Classical'

export interface BroadcastStation {
  id: string
  label: string
  shortLabel: string
  category: BroadcastStationCategory
  url: string
  /** Loop only local file beds — live streams should not loop. */
  loop: boolean
}

export const DEFAULT_STATION_ID = 'yuge-original'

export const BROADCAST_STATIONS: BroadcastStation[] = [
  {
    id: 'yuge-original',
    label: 'Forecast-Core',
    shortLabel: 'Forecast',
    category: 'Yuge',
    url: '/audio/coastal-starlight.mp3',
    loop: true,
  },
  {
    id: 'smooth-jazz',
    label: 'Smooth Jazz Global',
    shortLabel: 'Jazz',
    category: 'Jazzy',
    url: 'https://smoothjazz.cdnstream1.com/2585_128.mp3',
    loop: false,
  },
  {
    id: 'prog-house',
    label: 'Hirschmilch Prog House',
    shortLabel: 'House',
    category: 'Electronic',
    url: 'https://hirschmilch.de:7000/prog-house.mp3',
    loop: false,
  },
  {
    id: 'beat-blender',
    label: 'Beat Blender',
    shortLabel: 'Deep House',
    category: 'Electronic',
    url: 'https://ice1.somafm.com/beatblender-128-mp3',
    loop: false,
  },
  {
    id: 'fluid',
    label: 'Fluid',
    shortLabel: 'Fluid',
    category: 'Electronic',
    url: 'https://ice1.somafm.com/fluid-128-mp3',
    loop: false,
  },
  {
    id: 'nightwave',
    label: 'Nightwave Plaza',
    shortLabel: 'Vaporwave',
    category: 'New Wave',
    url: 'https://radio.plaza.one/mp3',
    loop: false,
  },
  {
    id: 'secret-agent',
    label: 'Secret Agent',
    shortLabel: 'Lounge',
    category: 'Lounge',
    url: 'https://ice1.somafm.com/secretagent-128-mp3',
    loop: false,
  },
  {
    id: 'groove-salad',
    label: 'Groove Salad',
    shortLabel: 'Chill',
    category: 'Ambient',
    url: 'https://ice1.somafm.com/groovesalad-128-mp3',
    loop: false,
  },
  {
    id: 'drone-zone',
    label: 'Drone Zone',
    shortLabel: 'Ambient',
    category: 'Ambient',
    url: 'https://ice1.somafm.com/dronezone-128-mp3',
    loop: false,
  },
  {
    id: 'wqxr',
    label: 'WQXR Classical',
    shortLabel: 'WQXR',
    category: 'Classical',
    url: 'https://stream.wqxr.org/wqxr',
    loop: false,
  },
  {
    id: 'kusc',
    label: 'KUSC Classical',
    shortLabel: 'KUSC',
    category: 'Classical',
    url: 'https://kuscstream.org/mp3/kusc128.mp3',
    loop: false,
  },
]

export const STATION_CATEGORIES: BroadcastStationCategory[] = [
  'Yuge',
  'Jazzy',
  'Electronic',
  'Lounge',
  'Ambient',
  'Classical',
  'New Wave',
]

export function getStation(id: string): BroadcastStation {
  return (
    BROADCAST_STATIONS.find((s) => s.id === id) ??
    BROADCAST_STATIONS.find((s) => s.id === DEFAULT_STATION_ID)!
  )
}

export function isValidStationId(id: string): boolean {
  return BROADCAST_STATIONS.some((s) => s.id === id)
}

export function listStationsByCategory(): {
  category: BroadcastStationCategory
  stations: BroadcastStation[]
}[] {
  return STATION_CATEGORIES.map((category) => ({
    category,
    stations: BROADCAST_STATIONS.filter((s) => s.category === category),
  })).filter((g) => g.stations.length > 0)
}
