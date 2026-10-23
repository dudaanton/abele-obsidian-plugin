/* eslint-disable @typescript-eslint/no-require-imports -- Disposable host observer. */
const fs = require('node:fs')
const path = require('node:path')
/* eslint-enable @typescript-eslint/no-require-imports -- Native observer imports end here. */

// Drive only the visible host setting. Never clear caches or reload via an internal API.
exports.clickRebuild = async function (app, document, receipt, pendingFile) {
  await app.setting.open()
  await app.setting.openTabById('file')
  const root = app.setting.modalEl ?? document
  for (
    let attempt = 0;
    attempt < 100 && root.querySelectorAll('.setting-item-name').length === 0;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 50))
  const rows = [...root.querySelectorAll('.setting-item')].filter((row) =>
    /^Rebuild vault cache$/i.test(
      row.querySelector('.setting-item-name')?.textContent?.trim() ?? ''
    )
  )
  const buttons = rows.flatMap((row) => [...row.querySelectorAll('button')])
  if (rows.length !== 1 || buttons.length !== 1) {
    const evidence = pendingFile.slice(
      0,
      pendingFile.lastIndexOf('.' + receipt.device + '.reindex.json')
    )
    fs.appendFileSync(
      evidence,
      JSON.stringify({
        event: 'reindex-setting-unavailable',
        id: receipt.id,
        device: receipt.device,
        at: Date.now(),
        rowCount: rows.length,
        buttonCount: buttons.length,
        settingKeys: Object.keys(app.setting),
        rootClass: root.className,
        documentClass: document.body?.className,
        labels: [...root.querySelectorAll('.setting-item-name')].map((row) =>
          row.textContent?.trim()
        ),
      }) + '\n'
    )
    throw new Error('Rebuild setting unavailable or ambiguous')
  }
  if (typeof globalThis.__scaleReindexCoverage?.begin === 'function')
    await globalThis.__scaleReindexCoverage.begin(receipt.id)
  const operation = { ...receipt, scheduledAt: Date.now() }
  // Delay so the CLI can return the receipt before the real button reloads the window.
  setTimeout(() => {
    const clicked = { ...operation, at: Date.now() }
    fs.writeFileSync(pendingFile, JSON.stringify(clicked))
    fs.appendFileSync(
      pendingFile.slice(0, pendingFile.lastIndexOf('.' + receipt.device + '.reindex.json')),
      JSON.stringify({ ...clicked, event: 'reindex-click' }) + '\n'
    )
    buttons[0].click()
  }, 100)
  return operation
}

exports.observeRebuild = function (app, config, emit, register) {
  const pendingFile = config.evidence + '.' + config.device + '.reindex.json'
  const deletion = app.vault.on('delete', (file) =>
    emit({ event: 'vault-delete', path: file.path })
  )
  register(() => app.vault.offref(deletion))
  if (!fs.existsSync(pendingFile)) return
  const operation = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
  emit({ event: 'reindex-reloaded', id: operation.id })
  // Observation only: wait for the host's own metadata + link resolution completion.
  // The public "finished" event alone also fires while queued work is still pending.
  app.workspace.onLayoutReady(() => {
    if (typeof app.metadataCache.onCleanCache !== 'function') {
      emit({ event: 'reindex-completion-unavailable', id: operation.id })
      return
    }
    app.metadataCache.onCleanCache(() => {
      const completedAt = Date.now()
      fs.writeFileSync(
        pendingFile + '.complete.json',
        JSON.stringify({ ...operation, completedAt })
      )
      emit({ event: 'reindex-complete', id: operation.id, at: completedAt })
      fs.unlinkSync(pendingFile)
    })
  })
}
exports.pendingFile = (evidence, device) => path.resolve(evidence + '.' + device + '.reindex.json')

exports.observeHashes = function (crypto, subtle, emit, classify) {
  const restore = []
  const source = (stack) => exports.classifyHashOrigin(stack, classify)
  const bytes = (value) =>
    typeof value === 'string' ? Buffer.byteLength(value) : (value?.byteLength ?? 0)
  const install = (object, key, wrap) => {
    const original = object?.[key]
    if (typeof original !== 'function') throw new Error('Hash observation port unavailable')
    const patched = wrap(original)
    object[key] = patched
    if (object[key] !== patched) throw new Error('Hash observation port read-only')
    restore.push(() => {
      if (object[key] === patched) object[key] = original
    })
  }
  try {
    install(
      crypto,
      'createHash',
      (original) =>
        function (...args) {
          const hash = original.apply(this, args)
          const stack = new Error().stack
          const algorithm = args[0]
          let size = 0
          const update = hash.update,
            digest = hash.digest
          hash.update = function (value, ...rest) {
            size += bytes(value)
            return update.call(this, value, ...rest)
          }
          hash.digest = function (...args) {
            const result = digest.apply(this, args)
            const sha =
              typeof result === 'string' && args[0] === 'hex'
                ? result
                : Buffer.isBuffer(result)
                  ? result.toString('hex')
                  : null
            emit({
              event: 'renderer-hash',
              source: source(stack),
              algorithm,
              sha,
              bytes: size,
              stack,
            })
            return result
          }
          return hash
        }
    )
    install(
      subtle,
      'digest',
      (original) =>
        function (algorithm, data) {
          const stack = new Error().stack
          const at = Date.now()
          return original.call(this, algorithm, data).then((result) => {
            emit({
              event: 'renderer-hash',
              at,
              source: source(stack),
              algorithm,
              sha: Buffer.from(result).toString('hex'),
              bytes: bytes(data),
              stack,
            })
            return result
          })
        }
    )
    emit({ event: 'hash-observer-ready', ports: ['node.createHash', 'webcrypto.digest'] })
  } catch {
    for (const undo of restore.reverse()) undo()
    emit({ event: 'hash-observer-unavailable' })
    return () => {}
  }
  return () => {
    for (const undo of restore.reverse()) undo()
  }
}

const observedHashes = new WeakSet()
exports.observeIncrementalHash = function (hash, emit) {
  if (
    !hash ||
    typeof hash.update !== 'function' ||
    typeof hash.digest !== 'function' ||
    observedHashes.has(hash)
  )
    return
  observedHashes.add(hash)
  let bytes = 0,
    depth = 0
  const update = hash.update
  hash.update = function (data, ...args) {
    bytes += typeof data === 'string' ? Buffer.byteLength(data) : (data?.byteLength ?? 0)
    return update.call(this, data, ...args)
  }
  for (const key of ['digest', 'digestInto']) {
    const original = hash[key]
    if (typeof original !== 'function') continue
    hash[key] = function (...args) {
      const size = Number.isFinite(this.length) ? this.length : bytes
      const stack = new Error().stack
      depth++
      let result
      try {
        result = original.apply(this, args)
        return result
      } finally {
        depth--
        const output = key === 'digestInto' ? args[0] : result
        if (depth === 0 && output?.byteLength)
          emit({
            event: 'renderer-hash',
            implementation: 'javascript',
            source: 'abele',
            sha: Buffer.from(output).toString('hex'),
            bytes: size,
            stack,
          })
      }
    }
  }
}

exports.classifyHashOrigin = (stack, classify) =>
  classify
    ? classify(stack.replace(/^\s+at new Promise \(<anonymous>\)\s*$/gm, ''))
    : /plugin:abele(?::|\/)/.test(stack)
      ? 'abele'
      : 'unknown'
