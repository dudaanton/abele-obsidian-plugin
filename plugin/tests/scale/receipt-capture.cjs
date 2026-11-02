// Read-only, allowlisted diagnostic export. Never export credentials or unrelated metadata.
exports.scheduleHashWarmup = (work, emit, schedule = queueMicrotask) => schedule(() => {
  const startedAt = Date.now()
  try { work() } finally {
    emit({ event: 'javascript-hash-tracepoint-setup', phase: 'warm-up', startedAt, endedAt: Date.now() })
  }
})

exports.instrumentReceiptAccess = function (source) {
  for (const name of ['durableHostOf', 'storageOf', 'BoundedVaultIo'])
    if (!new RegExp(`\\b(?:function|const|let|var|class) ${name}\\b`).test(source))
      throw new Error('Receipt diagnostic binding unavailable')
  const fingerprints = [...new Set([...source.matchAll(/\b(?:var|let|const|class) (ObsidianFileSystem(?:\$\d+)?)\b/g)].map(match => match[1]))]
  const constructors = [...new Set([...source.matchAll(/\bclass (SHA256(?:\$\d+)?) extends /g)].map(match => match[1]))]
  return (
    source +
    `\nglobalThis.__scaleReceiptHost = application => durableHostOf(storageOf(application));
globalThis.__scaleWrapFingerprints?.(BoundedVaultIo);
${fingerprints.map(name => `globalThis.__scaleWrapFingerprints?.(${name});`).join('\n')}
${constructors.length ? `globalThis.__scaleWarmHashConstructors?.(()=>{${constructors.map(name => `new ${name}();`).join('')}});` : ''}\n`
  )
}

exports.captureRuntime = async function (runtime, host) {
  const state = runtime.options?.state
  const fs = runtime.options?.fs
  if (state?.db && host?.scanInstallation && typeof fs?.pathKey === 'function')
    return captureCommitted(state.db, fs, host)
  if (
    !state?.transaction ||
    !state.metadataKeys ||
    !host?.scanInstallation ||
    typeof fs?.pathKey !== 'function'
  )
    throw new Error('Receipt diagnostic state unavailable')
  return state.transaction(async (tx) => {
    const targets = []
    const keys = await tx.metadataKeys('pull-write:')
    for (const key of keys) {
      const intent = JSON.parse(await tx.getMeta(key))
      if (!intent) continue
      if (typeof intent.target !== 'string' || typeof intent.sha !== 'string')
        throw new Error('Invalid pending receipt diagnostic')
      const entry = await tx.byFileId(intent.fileId)
      const proof = host.scanInstallation(fs.pathKey(intent.target))
      targets.push({
        target: intent.target,
        sha: intent.sha,
        size: intent.size,
        fileId: intent.fileId,
        versionId: intent.versionId,
        stageId: intent.stageId,
        receiptId: intent.receiptId,
        stage: intent.stage,
        pending: entry?.versionId !== intent.versionId || entry?.sha !== intent.sha,
        // An existing proof is never declared unusable merely because a diagnostic
        // did not validate it. Absence is an explicit lookup, not a missing snapshot.
        usableIdentityReceipt: proof !== undefined,
        identityReceipt: proof
          ? {
              identity: proof.identity,
              sha: proof.sha,
              size: proof.size,
              mtime: proof.mtime,
              ctime: proof.ctime,
              contentRevision: proof.contentRevision,
            }
          : null,
      })
    }
    const prepared = JSON.parse((await tx.getMeta('plugin:prepared-upload-sources')) ?? 'null')
    return {
      targets,
      uploads: (prepared?.rows ?? []).map((x) => ({ path: x.path, sha: x.sha, size: x.size })),
    }
  })
}

// SDK overlays may await the deliberately held network request. Snapshot committed
// rows with one native readonly transaction, independently of that mutation queue.
function captureCommitted(db, fs, host) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'meta'], 'readonly')
    const targets = []
    let uploads = []
    tx.oncomplete = () => resolve({ targets, uploads })
    tx.onabort = () => reject(new Error('Committed receipt snapshot aborted'))
    const fail = () => tx.abort()
    const metadata = tx.objectStore('meta')
    const prepared = metadata.get('plugin:plugin:prepared-upload-sources')
    prepared.onerror = fail
    prepared.onsuccess = () => {
      try {
        const value = JSON.parse(prepared.result?.value ?? 'null')
        uploads = (value?.rows ?? []).map((x) => ({ path: x.path, sha: x.sha, size: x.size }))
      } catch {
        fail()
      }
    }
    const prefix = 'plugin:pull-write:'
    const range =
      typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange.bound(prefix, prefix + '\uffff')
    const keys = metadata.openKeyCursor(range)
    keys.onerror = fail
    keys.onsuccess = () => {
      const cursor = keys.result
      if (!cursor) return
      if (String(cursor.key).startsWith(prefix)) {
        const request = metadata.get(cursor.key)
        request.onerror = fail
        request.onsuccess = () => {
          try {
            const intent = JSON.parse(request.result?.value ?? 'null')
            if (!intent || typeof intent.target !== 'string' || typeof intent.sha !== 'string')
              return fail()
            const entry = tx.objectStore('entries').index('byFileId').getAll(intent.fileId)
            entry.onerror = fail
            entry.onsuccess = () => {
              try {
                const row = entry.result[0]
                const proof = host.scanInstallation(fs.pathKey(intent.target))
                targets.push({
                  target: intent.target,
                  sha: intent.sha,
                  size: intent.size,
                  fileId: intent.fileId,
                  versionId: intent.versionId,
                  stageId: intent.stageId,
                  receiptId: intent.receiptId,
                  stage: intent.stage,
                  pending: row?.versionId !== intent.versionId || row?.sha !== intent.sha,
                  usableIdentityReceipt: proof !== undefined,
                  identityReceipt: proof
                    ? {
                        identity: proof.identity,
                        sha: proof.sha,
                        size: proof.size,
                        mtime: proof.mtime,
                        ctime: proof.ctime,
                        contentRevision: proof.contentRevision,
                      }
                    : null,
                })
              } catch {
                fail()
              }
            }
          } catch {
            fail()
          }
        }
      }
      cursor.continue()
    }
  })
}

exports.captureHostStages = async function (host, state, owner, pathKey) {
  if (!host?.db || !host.namespace) throw new Error('Host receipt database unavailable')
  const rows = await new Promise((resolve, reject) => {
    const values = []
    const tx = host.db.transaction(['host-records-v3'], 'readonly')
    tx.oncomplete = () => resolve(values)
    tx.onabort = () => reject(new Error('Host receipt transaction aborted'))
    const prefix = JSON.stringify([host.namespace, 'abele-sync-writes']).slice(0, -1) + ','
    const range =
      typeof IDBKeyRange === 'undefined' ? undefined : IDBKeyRange.bound(prefix, prefix + '\uffff')
    const request = tx.objectStore('host-records-v3').openCursor(range)
    request.onerror = () => tx.abort()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const row = cursor.value
      if (
        row.namespace === host.namespace &&
        row.key === 'abele-sync-writes' &&
        row.id !== '!header'
      )
        values.push(row.value)
      cursor.continue()
    }
  })
  const targets = []
  for (const row of rows) {
    if (
      row.owner !== owner ||
      !row.disposableSource ||
      !row.temp ||
      !row.replacementSha ||
      row.backup ||
      row.retiredGeneration ||
      row.streaming?.base !== null ||
      row.streaming.retainBase ||
      row.streaming.retainedBackup
    )
      continue
    const entry = await state.get(row.target)
    targets.push({
      target: row.target,
      stage: row.temp,
      sha: row.replacementSha,
      size: row.streaming?.sealed?.size,
      pending: entry?.sha !== row.replacementSha,
      usableIdentityReceipt: host.scanInstallation(pathKey(row.target)) !== undefined,
    })
  }
  return targets
}

exports.captureBoundary = async function ({ id, device, app, emit, now = Date.now }) {
  const at = now()
  const receipt = {
    event: 'interruption-receipts',
    id,
    device,
    at,
    complete: false,
    targets: [],
    uploads: [],
  }
  try {
    const host = globalThis.__scaleReceiptHost?.(app)
    const runtimes = [...app.plugins.plugins.abele.tokenEngines.live.values()]
    if (!runtimes.length) throw new Error('Receipt runtime unavailable')
    for (const runtime of runtimes) {
      if (!runtime.options?.state?.db) throw new Error('Committed receipt port unavailable')
      const captured = await exports.captureRuntime(runtime, host)
      receipt.targets.push(...captured.targets)
      receipt.uploads.push(...captured.uploads)
      const stages = await exports.captureHostStages(
        host,
        runtime.options.state,
        runtime.options.id,
        runtime.options.fs.pathKey.bind(runtime.options.fs)
      )
      for (const row of stages) {
        const target = receipt.targets.find((x) => x.target === row.target && x.sha === row.sha)
        if (target) target.stage = row.stage
        else receipt.targets.push(row)
      }
    }
    receipt.complete = true
  } catch {
    receipt.category = 'receipt snapshot unavailable or transaction failed'
  }
  receipt.completedAt = now()
  emit(receipt)
  return receipt
}
