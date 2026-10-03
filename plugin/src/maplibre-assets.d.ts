declare module 'virtual:maplibre-assets' {
  /** MapLibre's trusted ESM sources, stored once each by the build. */
  const sources: { shared: string; main: string; worker: string }
  export default sources
}
