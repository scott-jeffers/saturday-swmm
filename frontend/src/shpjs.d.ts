declare module 'shpjs' {
  import type { FeatureCollection } from 'geojson'
  type Result = FeatureCollection & { fileName?: string }
  function shp(input: ArrayBuffer | string): Promise<Result | Result[]>
  export default shp
}
