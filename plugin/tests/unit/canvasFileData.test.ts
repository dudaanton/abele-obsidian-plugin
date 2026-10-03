import { expect, it } from 'vitest'
import { parseCanvasFile } from '@/canvas/fileData'

const graphs = [
  { nodes: [], edges: [] },
  {
    nodes: [
      { id: 'sample', type: 'text', text: 'Sample content', x: 0, y: 0, width: 200, height: 100 },
    ],
    edges: [],
  },
]
it.each(graphs)('rejects a JSON-string-wrapped graph %# instead of decoding it twice', (graph) => {
  const bytes = JSON.stringify(JSON.stringify(graph))
  expect(() => parseCanvasFile(bytes)).toThrow()
})
it.each(['', '{}', '{"nodes":[],"edges":[]}'])('reads native empty bytes %j', (bytes) => {
  expect(parseCanvasFile(bytes)).toEqual({ nodes: [], edges: [] })
})
it('still reads a populated object root', () => {
  expect(parseCanvasFile(JSON.stringify(graphs[1]))).toEqual(graphs[1])
})
