/** Colors for 2D mesh edge boundary-condition types (map + legend). */

export const BC_TYPE_COLORS: Record<string, string> = {
  WALL: '#f8fafc',
  NORMAL_FLOW: '#38bdf8',
  SPECIFIED_STAGE: '#a855f7',
  SPECIFIED_FLOW: '#f59e0b',
  RATING_CURVE: '#ec4899',
  TS_STAGE: '#818cf8',
  TS_FLOW: '#fb923c',
}

export const BC_TYPE_LABELS: Record<string, string> = {
  WALL: 'Wall (closed)',
  NORMAL_FLOW: 'Normal flow',
  SPECIFIED_STAGE: 'Specified stage',
  SPECIFIED_FLOW: 'Specified flow',
  RATING_CURVE: 'Rating curve',
  TS_STAGE: 'Timeseries stage',
  TS_FLOW: 'Timeseries flow',
}

export function bcTypeColor(bcType: string): string {
  return BC_TYPE_COLORS[bcType.toUpperCase()] ?? '#94a3b8'
}
