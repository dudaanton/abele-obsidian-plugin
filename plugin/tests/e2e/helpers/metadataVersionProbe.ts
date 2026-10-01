/** Runs inside the native desktop window. No publication code or timer-based evidence. */
export const metadataVersionProbe = String.raw`(async () => {
  const root = 'CacheVersionProbe'
  const m = app.metadataCache
  const v = app.vault
  const crypto = require('crypto')
  const sha = data => crypto.createHash('sha256').update(data).digest('hex')
  const clone = data => JSON.parse(JSON.stringify(data))
  const events = []
  const waiters = []
  const originalRead = v.readBinary
  const originalWork = m.work
  const originalLayout = app.workspace.getLayout()
  let releaseWork = null
  let releaseStarted = null
  let armed = false
  let refs = []
  const versions = {}
  const capture = (file, data, cache) => {
    if (!file.path.startsWith(root + '/')) return
    // The supported changed event supplies the text parsed by this cache, not a later read.
    const captured = {
      path: file.path,
      sha: sha(Buffer.from(data, 'utf8')),
      generation: events.length + 1,
      cacheHash: sha(JSON.stringify(cache)),
      cache: clone(cache),
      links: [...(cache.links || []), ...(cache.embeds || [])].map(link => {
        const target = m.getFirstLinkpathDest(link.link.split('#')[0], file.path)
        return {
          spelling: link.link,
          original: link.original,
          path: target?.path ?? null,
          targetId: target?.path === root + '/sample.png' ? 'sample-target-id' : null,
        }
      }),
    }
    events.push(captured)
    for (const notify of [...waiters]) notify()
  }
  const matching = bytes => events.find(event => event.sha === sha(bytes))
  const wait = (predicate, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Missing evidence: ' + label)) }, 15000)
    const cleanup = () => { clearTimeout(timer); const i = waiters.indexOf(check); if (i >= 0) waiters.splice(i, 1) }
    const check = () => { if (predicate()) { cleanup(); resolve() } }
    waiters.push(check)
    check()
  })
  const bind = (bytes, versionId) => {
    const evidence = matching(bytes)
    // No matched complete event means unknown, even if getFileCache is populated.
    return { fileId: 'sample-note-id', versionId, sha: sha(bytes), evidence: evidence ? clone(evidence) : null }
  }
  try {
    if (v.getAbstractFileByPath(root)) throw new Error('Probe folder already exists')
    await v.createFolder(root)
    await v.createBinary(root + '/sample.png', new Uint8Array([1,2,3]).buffer)
    refs.push(m.on('changed', capture))
    const nonce = crypto.randomBytes(8).toString('hex')
    const first = nonce + '\nRemote baseline\n![[sample.png]]\n[[not-yet-present]]\n'
    const note = await v.create(root + '/sample.md', first)
    await wait(() => matching(first), 'remote baseline cache')
    versions.remote = bind(first, 'remote-version')
    // Pause the real worker after readBinary captured the remote-applied bytes.
    const remote = nonce + '\nRemote apply\n![[sample.png]]\n[[not-yet-present]]\n'
    const local = nonce + '\nImmediate local edit\n[[different-missing]]\n'
    const started = new Promise(resolve => { releaseStarted = resolve })
    m.work = async function(bytes) {
      if (armed && sha(Buffer.from(bytes)) === sha(remote)) {
        armed = false
        releaseStarted()
        await new Promise(resolve => { releaseWork = resolve })
      }
      return originalWork.call(this, bytes)
    }
    armed = true
    await v.modify(note, remote)
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('Worker was not intercepted')), 15000))])
    await v.modify(note, local)
    const pending = bind(remote, 'applied-version')
    const advanced = await v.read(note)
    if (advanced !== local) throw new Error('Immediate edit did not advance bytes')
    releaseWork()
    releaseWork = null
    await wait(() => matching(remote) && matching(local), 'delayed remote and local generations')
    versions.applied = bind(remote, 'applied-version')
    versions.local = bind(local, 'local-version')
    const preserved = clone(versions.applied)
    // A settled merge result becomes a new baseline, not a local-authorship assertion.
    const merged = remote + 'Merged paragraph\n[[merged-missing]]\n'
    await v.modify(note, merged)
    await wait(() => matching(merged), 'settled merge cache')
    versions.merged = bind(merged, 'merged-version')
    await v.rename(note, root + '/renamed.md')
    const immutableAfterRename = JSON.stringify(versions.applied) === JSON.stringify(preserved)
    const afterRename = m.getFileCache(note)
    // Exercise the real paste handler with a synthetic PNG on the clipboard event.
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(note)
    const editor = leaf.view.editor
    editor.setCursor({ line: editor.lineCount() - 1, ch: 0 })
    const pasteOrder = []
    refs.push(v.on('create', f => { if (f.path.startsWith(root + '/')) pasteOrder.push({ kind: 'create', path: f.path }) }))
    refs.push(v.on('modify', f => { if (f.path === note.path) pasteOrder.push({ kind: 'note-save', path: f.path }) }))
    const oldAttachment = v.getConfig('attachmentFolderPath')
    v.setConfig('attachmentFolderPath', './')
    try {
      const transfer = new DataTransfer()
      transfer.items.add(new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')], 'pasted-sample.png', { type: 'image/png' }))
      const ev = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      leaf.view.containerEl.querySelector('.cm-content').dispatchEvent(ev)
      await wait(() => events.some(e => e.path === note.path && e.cache.embeds?.some(x => !merged.includes(x.original))), 'native paste cache')
      const paste = events.find(e => e.path === note.path && e.cache.embeds?.some(x => !merged.includes(x.original)))
      versions.pasted = { fileId: 'sample-note-id', versionId: 'pending-paste', sha: paste.sha, evidence: clone(paste) }
      versions.pasteBufferMatches = sha(editor.getValue()) === paste.sha
    } finally {
      v.setConfig('attachmentFolderPath', oldAttachment)
    }
    return {
      versions,
      pendingWasUnknown: pending.evidence === null,
      currentFileAdvancedDuringParse: advanced === local,
      immutableAfterRename,
      currentCacheIsNotOldVersion: sha(JSON.stringify(afterRename)) !== versions.applied.evidence.cacheHash,
      pasteOrder,
      // Diagnostic only: never use mtime or this private hash as publication evidence.
      privateCacheHash: m.fileCache[note.path]?.hash ?? null,
      runtime: { electron: process.versions.electron, os: require('os').release() },
    }
  } finally {
    if (releaseWork) releaseWork()
    m.work = originalWork
    v.readBinary = originalRead
    for (const ref of refs) { m.offref(ref); v.offref(ref) }
    await app.workspace.changeLayout(originalLayout)
    const folder = v.getAbstractFileByPath(root)
    if (folder) await v.delete(folder, true)
  }
})()`
