/** Cache names include a vault installation identity. Never infer ownership of another
 * vault's or an older paired cache: those may still contain pending durable operations. */
export async function pruneNodeDatabases(
  factory: IDBFactory,
  installation: string,
  owned: () => ReadonlySet<string>
): Promise<void> {
  if (!factory.databases) return
  const prefix = `abele-node-${installation}-`
  for (const database of await factory.databases()) {
    const name = database.name
    if (!name?.startsWith(prefix) || owned().has(name)) continue
    await new Promise<void>((resolve, reject) => {
      if (owned().has(name)) return resolve()
      const request = factory.deleteDatabase(name)
      request.onsuccess = () => resolve()
      // An open handle owns its lifetime. Do not force another window to close.
      request.onblocked = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
