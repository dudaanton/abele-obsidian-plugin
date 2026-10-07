/** Sequential native writes; metadata readiness belongs to the complete bounded batch. */
export const TIMELINE_FIXTURE_PROBE = `
  const createTask = async (path, text) => {
    const file = await app.vault.create(path, text)
    return file
  }
  const writeBatch = async writes => {
    const files = []
    for (const write of writes) files.push(await write())
    await until(() => files.every(file =>
      app.metadataCache.getFileCache(file)?.frontmatter?.type === 'task' &&
      window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks.get(file.path)?.dates.length),
      'created task batch metadata')
  }
`
