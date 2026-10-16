/** What the map's column of glyphs shows: north once turned, a location on its way, full screen. */
export type MapControlsState = {
  turned: boolean
  bearing: number
  locating: boolean
  full: boolean
}
