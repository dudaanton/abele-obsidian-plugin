/** Filled, labelled pictures stay identifiable even when a gallery crops their sides. */
export const COLUMN_IMAGES = [
  { name: 'sample-image.svg', label: 'Sample orange', rgb: [207, 79, 33] },
  { name: 'sample-second-image.svg', label: 'Sample teal', rgb: [0, 124, 131] },
].map((image) => ({
  ...image,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="rgb(${image.rgb.join(',')})"/><text x="240" y="174" text-anchor="middle" fill="white" font-family="sans-serif" font-weight="bold" font-size="40">${image.label}</text></svg>`,
}))

/** Self-contained geography makes map evidence independent of a tile server's first load. */
export const COLUMN_MAP_STYLE = {
  version: 8,
  sources: {
    sample: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { color: '#e3ad47' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [-55, -30],
                  [0, -30],
                  [0, 30],
                  [-55, 30],
                  [-55, -30],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { color: '#65aabd' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [0, -30],
                  [55, -30],
                  [55, 30],
                  [0, 30],
                  [0, -30],
                ],
              ],
            },
          },
        ],
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#e8f0f4' } },
    {
      id: 'sample-regions',
      type: 'fill',
      source: 'sample',
      paint: { 'fill-color': ['get', 'color'] },
    },
    {
      id: 'sample-boundaries',
      type: 'line',
      source: 'sample',
      paint: { 'line-color': '#34454d', 'line-width': 2 },
    },
  ],
}

/** Invented, portable content samples; each is rendered in its own two-column note. */
export const COLUMN_CONTENT = [
  { name: 'lists', body: '- First sample\n  - Nested sample\n- Second sample', selector: 'ul ul' },
  {
    name: 'tables',
    body: '| WideUnbrokenSampleHeadingAlpha | WideUnbrokenSampleHeadingBeta | WideUnbrokenSampleHeadingGamma |\n| --- | --- | --- |\n| One | Two | Three |',
    selector: '.abele-column-table table',
  },
  {
    name: 'code',
    body: '```js\nconst sample = "' + 'sample-'.repeat(70) + '"\n```',
    selector: 'pre code',
  },
  {
    name: 'math',
    body: 'Inline $x^2$ and display:\n\n$$\nx^2 + y^2 = 1\n$$',
    selector: '.math-block',
  },
  {
    name: 'attachments',
    body: '![[sample-image.svg]]\n\n![[sample-embed]]',
    selector: '.markdown-embed-content',
  },
  {
    name: 'tasks',
    body: '- [ ] First sample task\n- [ ] Second sample task',
    selector: 'input.task-list-item-checkbox',
  },
  {
    name: 'gallery',
    body: '::abele-gallery{layout=grid,height=160}::\n![[sample-image.svg|Sample orange]]\n![[sample-second-image.svg|Sample teal]]',
    selector: '.abele-gallery-widget-container img',
  },
  {
    name: 'diagrams',
    body: '```mermaid\nflowchart LR\n A[Sample start] --> B[Sample middle] --> C[Sample finish]\n```',
    selector: '.abele-mermaid svg',
  },
  {
    name: 'maps',
    body: '```abele-map\ncenter: [0, 0]\nzoom: 2\nheight: 220\ninteractive: false\npoints:\n  - lat: 0\n    lon: 0\n    label: Sample center\n```',
    selector: '.abele-map canvas',
  },
  {
    name: 'charts',
    body: '```abele-chart\ntype: bar\nheight: 220\nxLabels: [One, Two, Three]\nseries:\n  - name: Sample\n    data: [2, 4, 3]\n```',
    selector: '.abele-chart-container canvas',
  },
] as const

export function columnContentNote(body: string): string {
  return (
    'Before the sample.\n\n> [!abele-columns|ratio=2:1 mobile=stack]\n> > [!abele-column] Sample content\n' +
    body
      .split('\n')
      .map((line) => '> >' + (line ? ' ' + line : ''))
      .join('\n') +
    '\n>\n> > [!abele-column] Companion\n> > A companion paragraph.\n\nAfter the sample.\n'
  )
}
