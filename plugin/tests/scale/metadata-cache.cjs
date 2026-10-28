function createMetadataCacheCapture(app, receipt, save, now = Date.now) {
  let stopped = false
  let latest = null
  const read = () => {
    try {
      return typeof app.metadataCache?.isCacheClean === 'function'
        ? Boolean(app.metadataCache.isCacheClean())
        : null
    } catch {
      return null
    }
  }
  const observe = (at) => {
    latest = read()
    if (latest === true && receipt.metadataCacheFirstCleanAt === undefined) {
      receipt.metadataCacheFirstCleanAt = at
      save()
    }
    return latest
  }
  app.workspace.onLayoutReady(() => {
    if (stopped) return
    const at = now()
    const clean = observe(at)
    receipt.metadataCacheAtLayoutReady = { at, clean }
    save()
  })
  return {
    poll() {
      if (!stopped) observe(now())
    },
    finish(at = now()) {
      if (stopped) return
      stopped = true
      receipt.metadataCacheAtIdle = { at, clean: latest }
      save()
    },
  }
}

module.exports = { createMetadataCacheCapture }
