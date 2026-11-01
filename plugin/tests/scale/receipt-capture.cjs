// Read-only, allowlisted diagnostic export. Never export credentials or unrelated metadata.
exports.instrumentReceiptAccess = function (source) {
  for (const name of ['durableHostOf', 'storageOf', 'BoundedVaultIo'])
    if (!new RegExp(`\\b(?:function|const|let|var|class) ${name}\\b`).test(source))
      throw new Error('Receipt diagnostic binding unavailable')
  return (
    source +
    `\nglobalThis.__scaleReceiptHost = application => durableHostOf(storageOf(application));
globalThis.__scaleWrapFingerprints?.(BoundedVaultIo);
${/\b(?:var|class) ObsidianFileSystem\b/.test(source) ? 'globalThis.__scaleWrapFingerprints?.(ObsidianFileSystem);' : ''}\n`
  )
}

exports.captureRuntime = async function (runtime, host) {
  const state = runtime.options?.state
  const fs = runtime.options?.fs
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

exports.captureHostStages = async function (host, state, owner, pathKey) {
  if (!host?.db || !host.namespace) throw new Error('Host receipt database unavailable')
  const rows = await new Promise((resolve, reject) => {
    const values = []
    const tx = host.db.transaction(['host-records-v3'], 'readonly')
    tx.oncomplete = () => resolve(values)
    tx.onabort = () => reject(new Error('Host receipt transaction aborted'))
    const request = tx.objectStore('host-records-v3').openCursor()
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
