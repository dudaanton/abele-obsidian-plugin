/**
 * Script fixtures own feature flags and exact-source decisions, including managed vaults.
 * Keep the serializable snapshot in the test process across reloads. The vault must be
 * exclusively held and disconnected: a running sync host could mutate the same trust store.
 * These functions run inside the app, also in probes that have a single try/finally.
 */
export const SCRIPT_FIXTURE = String.raw`
  const fixtureKeys = ['abele-script-trust', 'abele-script-local-upgrade', 'abele-script-provenance', 'abele-script-toolbar-offered']
  const fixtureMarker = '.abele-script-managed'
  const fixtureClone = value => JSON.parse(JSON.stringify(value ?? null))
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
  async function saveScriptFixture() {
    const connection = app.loadLocalStorage('abele-sync-connection')
    if (connection && (connection.serverUrl || connection.enrolledUrl || connection.vaultId || connection.deviceId))
      throw new Error('Script fixture needs a disconnected, exclusively held vault')
    const local = Object.fromEntries(fixtureKeys.map(key => [key, fixtureClone(app.loadLocalStorage(key))]))
    const id = local['abele-script-provenance']?.id
    const snapshot = {
      ai: fixtureClone(window.__abeleTest.AbeleConfig.getInstance().ai), local,
      marker: await app.vault.adapter.exists(fixtureMarker) ? [...new Uint8Array(await app.vault.adapter.readBinary(fixtureMarker))] : null,
      meta: id ? await fixtureDatabase(id, db => fixtureMeta(db)) : null,
      phone: fixtureClone(app.vault.getConfig('mobileToolbarCommands')),
    }
    console.info('[script fixture baseline]', JSON.stringify({
      ai: snapshot.ai.enabled, scripts: snapshot.ai.scriptsEnabled, folder: snapshot.ai.scriptsFolder,
      managed: !!id, facet: local['abele-script-provenance']?.binding?.facet,
      localContext: local['abele-script-provenance']?.binding?.endpoint === 'local:',
      marker: snapshot.marker !== null,
    }))
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
  async function approveScriptFixture(path, source) {
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
    T.ScriptService.getInstance().confirm(script)
    await T.scriptTrust.load(app, path)
  }
  async function restoreScriptFixture(snapshot) {
    if (!snapshot) return
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
    const restored = await saveScriptFixture()
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
}
