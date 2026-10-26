#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// Snapshot files can exceed the engine's single-string limit. Keep the input binary,
// decoding only individual top-level values and bounded batches of array elements.
export function parseSnapshotBuffer(bytes, chunkBytes = 1024 ** 2, parse = JSON.parse) {
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new Error('Invalid batch size')
  let at = 0
  const space = () => {
    while ([9, 10, 13, 32].includes(bytes[at])) at++
  }
  const expect = (byte) => {
    space()
    if (bytes[at++] !== byte) throw new SyntaxError('Invalid snapshot structure')
  }
  const endValue = (start) => {
    let depth = 0,
      quoted = false,
      escaped = false
    for (let i = start; i < bytes.length; i++) {
      const byte = bytes[i]
      if (quoted) {
        if (escaped) escaped = false
        else if (byte === 92) escaped = true
        else if (byte === 34) quoted = false
      } else if (byte === 34) quoted = true
      else if (byte === 91 || byte === 123) depth++
      else if (byte === 93 || byte === 125) {
        if (!depth) return i
        depth--
      } else if (byte === 44 && !depth) return i
    }
    throw new SyntaxError('Incomplete snapshot value')
  }
  const result = {}
  expect(123)
  space()
  while (bytes[at] !== 125) {
    // Object keys end at the colon, outside their quoted contents.
    let colon = at + 1,
      escaped = false
    if (bytes[at] !== 34) throw new SyntaxError('Invalid snapshot key')
    for (; colon < bytes.length; colon++) {
      if (escaped) escaped = false
      else if (bytes[colon] === 92) escaped = true
      else if (bytes[colon] === 34) break
    }
    const key = parse(bytes.subarray(at, colon + 1).toString('utf8'))
    at = colon + 1
    expect(58)
    space()
    let value
    if (bytes[at] === 91) {
      at++
      space()
      value = []
      let start = at
      if (bytes[at] !== 93) {
        while (true) {
          const end = endValue(at)
          if (end === at || ![44, 93].includes(bytes[end]))
            throw new SyntaxError('Invalid snapshot array')
          if (end - start >= chunkBytes || bytes[end] === 93) {
            const batch = parse('[' + bytes.subarray(start, end).toString('utf8') + ']')
            for (const element of batch) value.push(element)
            start = end + 1
          }
          at = end
          if (bytes[at] === 93) break
          at++
          space()
          if (bytes[at] === 93) throw new SyntaxError('Trailing snapshot array comma')
        }
      }
      at++
    } else {
      const end = endValue(at)
      value = parse(bytes.subarray(at, end).toString('utf8'))
      at = end
    }
    Object.defineProperty(result, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
    space()
    if (bytes[at] === 125) break
    expect(44)
    space()
    if (bytes[at] === 125) throw new SyntaxError('Trailing snapshot object comma')
  }
  expect(125)
  space()
  if (at !== bytes.length) throw new SyntaxError('Trailing snapshot data')
  return result
}

// Lengauer-Tarjan dominators over root-reachable, non-weak snapshot edges.
// These are graph retained sizes, not total renderer allocations or RSS.
export function retainedGraph(snapshot) {
  const { nodes, edges } = snapshot
  const meta = snapshot.snapshot.meta
  const nf = meta.node_fields.length,
    ef = meta.edge_fields.length
  const ec = meta.node_fields.indexOf('edge_count'),
    size = meta.node_fields.indexOf('self_size')
  const et = meta.edge_fields.indexOf('type'),
    to = meta.edge_fields.indexOf('to_node')
  const types = meta.edge_types[et],
    weak = types.indexOf('weak')
  const shortcut = types.indexOf('shortcut'),
    internal = types.indexOf('internal')
  const edgeName = meta.edge_fields.indexOf('name_or_index'),
    nodeId = meta.node_fields.indexOf('id')
  const ownership = new Uint8Array(edges.length / ef),
    weakMapTables = new Map()
  const owns = (n, e) => {
    const type = edges[e + et]
    if (type === weak || edges[e + to] === n * nf || (n !== 0 && type === shortcut)) return false
    if (type === internal && edgeName >= 0 && nodeId >= 0) {
      const name = edges[e + edgeName]
      if (!weakMapTables.has(name)) {
        const match = /^\d+ \/ part of key .* pair in WeakMap \(table @(\d+)\)\)$/.exec(
          snapshot.strings[name]
        )
        weakMapTables.set(name, match ? Number(match[1]) : null)
      }
      // A value needs both its weak key and table. Assign its retained size to the key,
      // rather than giving it two independent owners and losing that attribution.
      if (weakMapTables.get(name) === nodes[n * nf + nodeId]) return false
    }
    return true
  }
  const count = nodes.length / nf
  const offsets = new Uint32Array(count + 1),
    degrees = new Uint32Array(count)
  let edge = 0
  for (let n = 0; n < count; n++) {
    offsets[n] = edge
    const end = edge + nodes[n * nf + ec] * ef
    for (; edge < end; edge += ef)
      if (owns(n, edge)) {
        ownership[edge / ef] = 1
        degrees[edges[edge + to] / nf]++
      }
  }
  offsets[count] = edge
  const incomingOffsets = new Uint32Array(count + 1)
  for (let n = 0; n < count; n++) incomingOffsets[n + 1] = incomingOffsets[n] + degrees[n]
  const incoming = new Uint32Array(incomingOffsets[count]),
    position = incomingOffsets.slice()
  for (let n = 0; n < count; n++)
    for (let e = offsets[n]; e < offsets[n + 1]; e += ef)
      if (ownership[e / ef]) {
        const target = edges[e + to] / nf
        incoming[position[target]++] = n
      }
  const number = new Uint32Array(count),
    vertex = new Uint32Array(count + 1)
  const parent = new Uint32Array(count + 1),
    semi = new Uint32Array(count + 1)
  const ancestor = new Uint32Array(count + 1),
    label = new Uint32Array(count + 1)
  const bucket = new Uint32Array(count + 1),
    next = new Uint32Array(count + 1)
  const idom = new Uint32Array(count + 1)
  let reached = 1
  number[0] = 1
  const stack = [0],
    cursors = [offsets[0]]
  while (stack.length) {
    const top = stack.length - 1,
      n = stack[top]
    if (cursors[top] >= offsets[n + 1]) {
      stack.pop()
      cursors.pop()
      continue
    }
    const e = cursors[top]
    cursors[top] += ef
    if (!ownership[e / ef]) continue
    const target = edges[e + to] / nf
    if (number[target]) continue
    number[target] = ++reached
    vertex[reached] = target
    parent[reached] = number[n]
    stack.push(target)
    cursors.push(offsets[target])
  }
  for (let n = 1; n <= reached; n++) semi[n] = label[n] = n
  const evaluate = (v) => {
    if (!ancestor[v]) return label[v]
    const path = []
    let u = v
    while (ancestor[ancestor[u]]) {
      path.push(u)
      u = ancestor[u]
    }
    for (let i = path.length - 1; i >= 0; i--) {
      u = path[i]
      if (semi[label[ancestor[u]]] < semi[label[u]]) label[u] = label[ancestor[u]]
      ancestor[u] = ancestor[ancestor[u]]
    }
    return label[v]
  }
  for (let w = reached; w >= 2; w--) {
    const n = vertex[w]
    for (let e = incomingOffsets[n]; e < incomingOffsets[n + 1]; e++) {
      const v = number[incoming[e]]
      if (v) semi[w] = Math.min(semi[w], semi[evaluate(v)])
    }
    next[w] = bucket[semi[w]]
    bucket[semi[w]] = w
    ancestor[w] = parent[w]
    let v = bucket[parent[w]]
    bucket[parent[w]] = 0
    while (v) {
      const u = evaluate(v)
      idom[v] = semi[u] < semi[v] ? u : parent[w]
      v = next[v]
    }
  }
  for (let w = 2; w <= reached; w++) if (idom[w] !== semi[w]) idom[w] = idom[idom[w]]
  const retained = new Float64Array(count),
    dominators = new Int32Array(count).fill(-1)
  for (let w = 1; w <= reached; w++) {
    const n = vertex[w]
    retained[n] = nodes[n * nf + size]
    dominators[n] = w === 1 ? n : vertex[idom[w]]
  }
  for (let w = reached; w >= 2; w--) retained[vertex[idom[w]]] += retained[vertex[w]]
  return { retained, dominators, reachable: reached }
}

export function summarizeHeap(snapshot, limit = 30) {
  const graph = retainedGraph(snapshot),
    meta = snapshot.snapshot.meta
  const nf = meta.node_fields.length,
    fields = Object.fromEntries(meta.node_fields.map((v, i) => [v, i]))
  const describe = (n) => ({
    node: n,
    id: snapshot.nodes[n * nf + fields.id],
    type: meta.node_types[fields.type][snapshot.nodes[n * nf + fields.type]],
    name: snapshot.strings[snapshot.nodes[n * nf + fields.name]],
    shallowBytes: snapshot.nodes[n * nf + fields.self_size],
    retainedBytes: graph.retained[n],
  })
  const top = [],
    groups = new Map()
  for (let n = 1; n < graph.retained.length; n++) {
    const row = describe(n),
      key = `${row.type}:${row.name}`
    const group = groups.get(key) ?? { type: row.type, name: row.name, count: 0, shallowBytes: 0 }
    group.count++
    group.shallowBytes += row.shallowBytes
    groups.set(key, group)
    if (graph.dominators[n] < 0) continue
    if (top.length < limit || row.retainedBytes > top.at(-1).retainedBytes) {
      top.push(row)
      top.sort((a, b) => b.retainedBytes - a.retainedBytes)
      top.length = Math.min(limit, top.length)
    }
  }
  for (const row of top) {
    row.dominatorPath = []
    let n = row.node
    for (let i = 0; i < 12 && n > 0; i++) {
      n = graph.dominators[n]
      row.dominatorPath.push(describe(n))
    }
  }
  return {
    nodeCount: graph.retained.length,
    reachable: graph.reachable,
    strongGraphBytes: graph.retained[0],
    semantics:
      'All-root graph dominators: weak/self edges and non-root shortcuts excluded; WeakMap values assigned to their key rather than duplicate table edges. Includes observer/debugger roots, without page-ownership filtering. Inclusive retained sizes overlap; native/off-heap RSS is not measured.',
    topRetainers: top,
    topShallowGroups: [...groups.values()]
      .sort((a, b) => b.shallowBytes - a.shallowBytes)
      .slice(0, limit),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = parseSnapshotBuffer(await readFile(process.argv[2]))
  await writeFile(process.argv[3], JSON.stringify(summarizeHeap(input), null, 2))
}
