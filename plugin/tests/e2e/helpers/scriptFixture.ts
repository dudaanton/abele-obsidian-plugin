/**
 * Script fixtures own feature flags and exact-source decisions, including managed vaults.
 * Keep the serializable snapshot in the test process across reloads. The vault must be
 * exclusively held with no running sync session: the fixture temporarily owns a disconnected
 * registry because a running sync host could mutate the same trust store.
 * These functions run inside the app, also in probes that have a single try/finally.
 */
export const SCRIPT_FIXTURE = String.raw`
  const fixtureKeys = ['abele-script-trust', 'abele-script-local-upgrade', 'abele-script-provenance', 'abele-script-toolbar-offered']
  const fixtureMarker = '.abele-script-managed'
  const fixtureSyncKeys = ['abele-sync-connections-v2', 'abele-sync-connection']
  const fixtureSyncOwner = Symbol.for('abele.test.script-fixture-sync')
  const fixtureClone = value => JSON.parse(JSON.stringify(value ?? null))
  const fixtureDisconnected = () => {
    const registry = app.loadLocalStorage(fixtureSyncKeys[0])
    return registry?.version === 2 && registry.selectedId === '' &&
      Array.isArray(registry.records) && registry.records.length === 0 &&
      (!registry.cleanup || Array.isArray(registry.cleanup) && registry.cleanup.length === 0) &&
      app.loadLocalStorage(fixtureSyncKeys[1]) == null
  }
  const fixtureHostSettled = async () => { await app.plugins?.plugins?.abele?.tokenEngines?.rebuilding }
  const fixtureSyncActive = () => {
    const host = app.plugins?.plugins?.abele?.tokenEngines
    const registry = app.loadLocalStorage(fixtureSyncKeys[0])
    // A freshly attached connection can be active before a host is exposed or starts.
    const activeRecord = registry?.records?.some(record => record.pending ||
      ['idle', 'syncing', 'joining', 'paused', 'scope_unavailable', 'scope_updating'].includes(record.status))
    // Even idle/offline runtimes own watchers and may resume. Include queued startup
    // and draining hosts, not saved metadata or the status label alone.
    return !!(activeRecord || host?.live?.size || host?.pending?.size || host?.startupCancels?.size ||
      host?.engines?.runtimes?.size || host?.ui?.runtimes?.size)
  }
  function restoreFixtureConnections(sync) {
    const errors = []
    for (const key of fixtureSyncKeys) {
      try {
        app.saveLocalStorage(key, sync[key])
        if (JSON.stringify(fixtureClone(app.loadLocalStorage(key))) !== JSON.stringify(sync[key]))
          throw new Error('Script fixture connection state was not restored')
      } catch (error) { errors.push(error) }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length) throw new AggregateError(errors, 'Script fixture connection restoration failed')
  }
  const fixtureDatabase = async (id, work) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('abele-script-provenance-' + id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Fixture cannot adopt a missing provenance database')) }
    })
    try { return await work(db) } finally { db.close() }
  }
  const fixtureMeta = (db, rows) => new Promise((resolve, reject) => {
    const tx = db.transaction('meta', rows === undefined ? 'readonly' : 'readwrite')
    const store = tx.objectStore('meta')
    let result
    if (rows === undefined) {
      const request = store.getAll()
      request.onsuccess = () => { result = request.result }
    } else {
      store.clear()
      for (const row of rows) store.put(row)
    }
    tx.oncomplete = () => resolve(result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Fixture provenance transaction failed'))
  })
  async function readScriptFixture() {
    const local = Object.fromEntries(fixtureKeys.map(key => [key, fixtureClone(app.loadLocalStorage(key))]))
    const id = local['abele-script-provenance']?.id
    const snapshot = {
      ai: fixtureClone(window.__abeleTest.AbeleConfig.getInstance().ai), local,
      marker: await app.vault.adapter.exists(fixtureMarker) ? [...new Uint8Array(await app.vault.adapter.readBinary(fixtureMarker))] : null,
      meta: id ? await fixtureDatabase(id, db => fixtureMeta(db)) : null,
      phone: fixtureClone(app.vault.getConfig('mobileToolbarCommands')),
      sync: Object.fromEntries(fixtureSyncKeys.map(key => [key, fixtureClone(app.loadLocalStorage(key))])),
    }
    console.info('[script fixture baseline]', JSON.stringify({
      ai: snapshot.ai.enabled, scripts: snapshot.ai.scriptsEnabled, folder: snapshot.ai.scriptsFolder,
      managed: !!id, facet: local['abele-script-provenance']?.binding?.facet,
      localContext: local['abele-script-provenance']?.binding?.endpoint === 'local:',
      marker: snapshot.marker !== null,
    }))
    return snapshot
  }
  async function saveScriptFixture() {
    await fixtureHostSettled()
    if (fixtureSyncActive()) throw new Error('Script fixture needs a disconnected, exclusively held vault')
    const snapshot = await readScriptFixture()
    // Snapshot reads can await IndexedDB; recheck before taking the disconnected context.
    await fixtureHostSettled()
    if (fixtureSyncActive()) throw new Error('Script fixture needs a disconnected, exclusively held vault')
    // Repeated saves within one fixture must retain the pre-isolation values, including
    // absent keys. Never adopt the temporary empty registry as the restoration baseline.
    if (app[fixtureSyncOwner]) {
      if (!fixtureDisconnected()) throw new Error('Script fixture disconnected context changed')
      snapshot.sync = fixtureClone(app[fixtureSyncOwner])
      return snapshot
    }
    try {
      app.saveLocalStorage(fixtureSyncKeys[0], { version: 2, selectedId: '', records: [] })
      app.saveLocalStorage(fixtureSyncKeys[1], null)
      if (JSON.stringify(app.loadLocalStorage(fixtureSyncKeys[0])) !== JSON.stringify({ version: 2, selectedId: '', records: [] }) ||
          app.loadLocalStorage(fixtureSyncKeys[1]) != null)
        throw new Error('Script fixture disconnected context was not saved')
    } catch (error) {
      try { restoreFixtureConnections(snapshot.sync); delete app[fixtureSyncOwner] }
      catch (restoreError) { throw new AggregateError([error, restoreError], 'Script fixture setup and rollback failed') }
      throw error
    }
    app[fixtureSyncOwner] = fixtureClone(snapshot.sync)
    return snapshot
  }
  async function enableScriptFixture(folder) {
    const T = window.__abeleTest, config = T.AbeleConfig.getInstance()
    // Arming against an empty list prevents discovery from implicitly approving a folder.
    T.ScriptTrust.getInstance().arm([])
    config.ai = { ...config.ai, enabled: true, scriptsEnabled: true, scriptsFolder: folder,
      confirmForeignScripts: true, startupScripts: [], startupScriptsPaused: true, toolbarScripts: [] }
    config.version.value++
    await config.saveSettings()
    await T.ScriptService.getInstance().discover()
  }
  async function approveScriptFixture(path, source, confirmLegacy = true) {
    const T = window.__abeleTest
    const script = T.ScriptService.getInstance().get(path)
    if (!script || script.source !== source) throw new Error('Fixture source was not discovered: ' + path)
    // Review-only loading checks full disk bytes, identity, binding and policy without executing.
    // An unknown personal source is enrolled by the real recovery/approval path, not a raw IDB write.
    await T.scriptTrust.load(app, path, async request => {
      if (request.path !== path || request.source !== source)
        throw new Error('Fixture source changed during approval: ' + path)
      return true
    })
    // A review-flow fixture can enroll managed provenance while leaving the optional
    // device-local review pending, so its first launch still exercises the real dialog.
    if (confirmLegacy) T.ScriptService.getInstance().confirm(script)
    await T.scriptTrust.load(app, path)
  }
  async function restoreScriptFixture(snapshot) {
    if (!snapshot) return
    const errors = []
    try {
    const T = window.__abeleTest, config = T.AbeleConfig.getInstance()
    // Stop fixture watchers before restoring durable authority or rediscovering the old folder.
    config.ai = { ...config.ai, scriptsEnabled: false, startupScriptsPaused: true }
    await config.saveSettings()
    const created = fixtureClone(app.loadLocalStorage('abele-script-provenance'))
    const old = snapshot.local['abele-script-provenance']
    if (old?.id) await fixtureDatabase(old.id, db => fixtureMeta(db, snapshot.meta))
    for (const key of fixtureKeys) app.saveLocalStorage(key, snapshot.local[key])
    if (snapshot.marker !== null) await app.vault.adapter.writeBinary(fixtureMarker, new Uint8Array(snapshot.marker).buffer)
    else if (await app.vault.adapter.exists(fixtureMarker)) await app.vault.adapter.remove(fixtureMarker)
    if (created?.id && created.id !== old?.id) {
      app.saveLocalStorage('abele-script-provenance-retired:' + created.id, null)
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('abele-script-provenance-' + created.id)
        request.onsuccess = resolve; request.onerror = () => reject(request.error)
        request.onblocked = () => reject(new Error('Fixture provenance database remained open'))
      })
    }
    T.ScriptTrust.reset()
    config.ai = fixtureClone(snapshot.ai)
    config.version.value++
    await config.saveSettings()
    await T.ScriptService.getInstance().discover()
    // Discovery reconciles its index; restore the saved optional source policy afterwards too.
    for (const key of fixtureKeys) app.saveLocalStorage(key, snapshot.local[key])
    T.ScriptTrust.reset()
    app.vault.setConfig('mobileToolbarCommands', snapshot.phone ?? undefined)
    await app.vault.saveConfig()
    } catch (error) { errors.push(error) }
    // Restore both keys even when script cleanup fails, and only after discovery
    // has finished in the disconnected context. Verification is read-only.
    try { await fixtureHostSettled() } catch (error) { errors.push(error) }
    try {
      restoreFixtureConnections(snapshot.sync)
      delete app[fixtureSyncOwner]
    } catch (error) { errors.push(error) }
    if (errors.length === 1) throw errors[0]
    if (errors.length) throw new AggregateError(errors, 'Script fixture cleanup and connection restoration failed')
    const restored = await readScriptFixture()
    if (JSON.stringify(restored) !== JSON.stringify(snapshot))
      throw new Error('Script fixture did not restore its feature flags and approval state')
  }
`

export interface ScriptFixtureSnapshot {
  ai: Record<string, unknown>
  local: Record<string, unknown>
  marker: number[] | null
  meta: unknown[] | null
  phone: unknown
  sync: Record<string, unknown>
}
