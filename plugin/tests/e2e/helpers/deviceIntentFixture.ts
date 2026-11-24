/** Snapshot/reset only the selected durable intent; leave retained migration evidence alone. */
export const DEVICE_INTENT_FIXTURE = String.raw`
  async function deviceIntentFixture(key, action = 'read', snapshot) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('abele-device-intent:' + app.appId, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('values');request.result.createObjectStore('legacy')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const raw = await new Promise((resolve, reject) => {
        const tx = db.transaction('values', action === 'read' ? 'readonly' : 'readwrite')
        const store = tx.objectStore('values'), request = store.get(key)
        request.onsuccess = () => {
          if(action === 'reset') store.delete(key)
          if(action === 'restore') {
            if(snapshot.raw === undefined) store.delete(key)
            else store.put(snapshot.raw, key)
          }
        }
        tx.oncomplete = () => resolve(request.result)
        tx.onerror = tx.onabort = () => reject(tx.error || new Error('Fixture intent transaction failed'))
      })
      const legacy = app.loadLocalStorage(key)
      if(action === 'reset') app.saveLocalStorage(key, null)
      if(action === 'restore') app.saveLocalStorage(key, snapshot.legacy)
      return action === 'read' ? (raw === undefined ? legacy : JSON.parse(raw)) : {raw, legacy}
    } finally { db.close() }
  }
`
