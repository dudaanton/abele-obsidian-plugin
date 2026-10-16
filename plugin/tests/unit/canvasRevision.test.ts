import { expect, it } from 'vitest'
import { canvasRevision } from '@/canvas/core/revision'
import { emptyCanvas } from '@/canvas/core/model'

it('versions JSON content independently of whitespace and object key order', async () => {
  const graph = emptyCanvas()
  expect(await canvasRevision('{"nodes":[],"edges":[],"extra":{"a":1,"b":2}}', graph)).toBe(
    await canvasRevision('{ "extra": {"b":2,"a":1}, "edges": [], "nodes": [] }\n', graph)
  )
})

it('retains array order and extension content in the persisted revision', async () => {
  const graph = emptyCanvas(),
    revision = await canvasRevision('{"nodes":[],"edges":[],"extra":[1,2]}', graph)
  expect(await canvasRevision('{"nodes":[],"edges":[],"extra":[2,1]}', graph)).not.toBe(revision)
  expect(await canvasRevision('{"nodes":[],"edges":[],"extra":[1,3]}', graph)).not.toBe(revision)
})

it('still versions pending native content independently of persisted source', async () => {
  const graph = emptyCanvas(),
    bytes = JSON.stringify(graph)
  expect(await canvasRevision(bytes, { ...graph, extra: 'Pending native content' })).not.toBe(
    await canvasRevision(bytes, graph)
  )
})

it('retains exact malformed-source evidence for local publication review', async () => {
  const graph = emptyCanvas()
  expect(await canvasRevision('{malformed', graph)).not.toBe(
    await canvasRevision('{malformed\n', graph)
  )
})
