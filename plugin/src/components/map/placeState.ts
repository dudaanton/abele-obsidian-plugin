/** What the popup over a pressed place says: still looking, what was found, or that nothing was. */
export type PlaceState =
  | { kind: 'loading' }
  | { kind: 'place'; title: string; details: string[] }
  | { kind: 'unavailable' }
