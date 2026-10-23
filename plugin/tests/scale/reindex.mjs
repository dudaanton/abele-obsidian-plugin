import { compareInventory } from './oracles.mjs'

export function declaredInterruptions(full) {
  const ordinary = [
    'kill mid-large-file',
    'quit mid-batch',
    'quit during comparison',
    'network drop',
    'plugin disable-enable',
    'pause mid-pull',
  ].map((kind) => ({ kind }))
  return [
    ...ordinary,
    ...(full
      ? [
          { kind: 'reindex', id: 'reindex-primary-upload', device: '0', phase: 'primary upload' },
          {
            kind: 'reindex',
            id: 'reindex-peer-download',
            device: '1',
            phase: 'peer initial download',
          },
          {
            kind: 'reindex',
            id: 'reindex-restart-comparison',
            device: '0',
            phase: 'restart comparison',
          },
        ]
      : []),
  ]
}

export function reindexEvidence(operation, renderer, wire, evidence) {
  const end = renderer.find(
    (row) =>
      row.event === 'reindex-complete' && row.id === operation.id && row.device === operation.device
  )
  const within = (row) =>
    row.device === operation.device &&
    (row.startedAt ?? row.at) >= operation.at &&
    (row.startedAt ?? row.at) <= (end?.at ?? Infinity)
  const rows = renderer.filter(within)
  const deletions = rows.filter((row) => row.event === 'vault-delete')
  const rendererHashes = rows.filter(
    (row) => row.event === 'renderer-hash' && row.source === 'abele'
  )
  const serverDeletions = wire
    .filter(within)
    .flatMap((row) => row.operations ?? [])
    .filter((op) => /delete|remove|unlink|tombstone/.test(op.op))
  const retained = new Set(evidence.before?.map((file) => file.path))
  const inventoryChanges =
    evidence.before && evidence.after
      ? compareInventory(
          evidence.before,
          evidence.after.filter((file) => retained.has(file.path))
        )
      : null
  // Pending ordinary transfers can overlap indexing. They cannot establish causality;
  // a pass needs the controller's independent redundant-transfer and hash evidence.
  const proven =
    end &&
    evidence.settled &&
    inventoryChanges?.length === 0 &&
    deletions.length === 0 &&
    serverDeletions.length === 0 &&
    (evidence.extraDeletes ?? 0) === 0 &&
    evidence.extraUploads === 0 &&
    evidence.extraDownloads === 0 &&
    evidence.extraRendererHashes === 0
  return {
    ...operation,
    completedAt: end?.at ?? null,
    durationMs: end ? end.at - operation.at : null,
    requests: wire.filter(within),
    writes: rows.filter((row) => row.event.startsWith('write-')),
    deletions,
    serverDeletions,
    rendererHashes,
    hostRendererHashes: rows.filter(
      (row) => row.event === 'renderer-hash' && row.source === 'host'
    ),
    notices: rows.filter((row) => row.event === 'notice'),
    longTasks: rows.filter((row) => row.event === 'long-task'),
    inventoryChanges,
    recoveryDeletions: evidence.extraDeletes ?? null,
    extraUploads: evidence.extraUploads ?? null,
    extraDownloads: evidence.extraDownloads ?? null,
    extraRendererHashes: evidence.extraRendererHashes ?? null,
    settled: evidence.settled ?? false,
    status: proven ? 'PASS' : 'FAIL',
  }
}

// Precise V8 call counts cover bundled JavaScript hashing, which native crypto
// wrappers cannot observe. Missing scripts or either reload segment remain unknown.
export async function javascriptHashEvidence(operation, rows, load) {
  const records = rows.filter(
    (row) =>
      row.id === operation.id &&
      row.device === operation.device &&
      row.event === 'reindex-js-coverage'
  )
  const segments = []
  for (const record of records) {
    try {
      const coverage = await load(record.file)
      const functions = coverage.result
        .filter((script) => /plugin:abele(?::|\/|$)/.test(script.url))
        .flatMap((script) => script.functions)
      const hashing = functions.filter((fn) => /sha256|sha2|hash|digest/i.test(fn.functionName))
      segments.push({
        file: record.file,
        recognized: hashing.some((fn) => /sha256/i.test(fn.functionName)),
        calls: hashing.reduce((sum, fn) => sum + (fn.ranges[0]?.count ?? 0), 0),
        functions: hashing
          .filter((fn) => fn.ranges[0]?.count > 0)
          .map((fn) => ({
            name: fn.functionName,
            count: fn.ranges[0].count,
            startOffset: fn.ranges[0].startOffset,
          })),
      })
    } catch {
      segments.push({ file: record.file, recognized: false, calls: null })
    }
  }
  const ready = rows.filter(
    (row) =>
      row.id === operation.id &&
      row.device === operation.device &&
      row.event === 'reindex-js-coverage-ready'
  )
  const complete =
    segments.length >= 2 &&
    segments.every((one) => one.recognized) &&
    ready.some((row) => row.at <= operation.at)
  return {
    complete,
    segments,
    calls: complete ? segments.reduce((sum, one) => sum + one.calls, 0) : null,
  }
}

export function hashTracepoints(source) {
  const points = []
  const classes = [...source.matchAll(/class HashMD(?:\$\d+)? extends [\w$]+\s*\{/g)]
  for (const match of classes) {
    const afterSuper = source.indexOf('super();', match.index)
    if (afterSuper < 0 || afterSuper - match.index > 400) continue
    const line = source.slice(0, afterSuper + 'super();'.length).split('\n').length
    for (let offset = 0; offset < 3; offset++) points.push(line + offset)
  }
  return points
}

export function digestCoverage(operation, entries, endAt) {
  const device = (row) => row.device === operation.device
  const startedAt = Math.max(
    0,
    ...entries
      .filter((row) => device(row) && row.event === 'renderer-start' && row.at <= operation.at)
      .map((row) => row.at)
  )
  const reloadAt = entries.find(
    (row) => device(row) && row.event === 'reindex-reloaded' && row.id === operation.id
  )?.at
  const observedBefore = entries.some(
    (row) =>
      device(row) &&
      row.implementation === 'javascript' &&
      row.at >= startedAt &&
      row.at <= operation.at
  )
  const observedAfter = entries.some(
    (row) =>
      device(row) &&
      row.implementation === 'javascript' &&
      row.at > (reloadAt ?? Infinity) &&
      row.at <= endAt
  )
  const bindings = entries.filter(
    (row) => device(row) && row.event === 'javascript-hash-observer-ready'
  )
  // Main-process binding acknowledgements and renderer digest receipts use different
  // queues. Actual observed digests prove activation; do not require the ack first.
  const complete =
    observedBefore &&
    observedAfter &&
    bindings.some((row) => row.at >= startedAt && row.at <= operation.at) &&
    bindings.some((row) => row.at > operation.at && row.at <= endAt)
  return { complete, startedAt, reloadAt, observedBefore, observedAfter }
}
