/** Read-only diagnostic stream for an explicitly named existing ledger. */
async function exportDatabase(factory, name, emit) {
  if (!(await factory.databases()).some((entry) => entry.name === name))
    throw new Error('Diagnostic database does not exist')
  const db = await new Promise((resolve, reject) => {
    const request = factory.open(name)
    request.onupgradeneeded = () => request.transaction.abort()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
  try {
    const stores = [...db.objectStoreNames]
    const counts = Object.fromEntries(stores.map((store) => [store, 0]))
    if (!stores.length) return { name, version: db.version, counts }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readonly')
      let failure
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Diagnostic export aborted'))
      for (const store of stores) {
        const request = tx.objectStore(store).openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          try {
            emit({ store, key: cursor.key, value: cursor.value })
            counts[store]++
            cursor.continue()
          } catch (error) {
            failure = error
            tx.abort()
          }
        }
      }
    })
    return { name, version: db.version, counts }
  } finally {
    db.close()
  }
}

module.exports = { exportDatabase }
