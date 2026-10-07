/** Publish each native note to metadata and the task store before starting the next write. */
export const TIMELINE_FIXTURE_PROBE = `
  const createTask = async (path, text) => {
    const file = await app.vault.create(path, text)
    await until(() => app.metadataCache.getFileCache(file)?.frontmatter?.type === 'task' &&
      window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks.get(path)?.dates.length,
      'created task metadata ' + path)
    return file
  }
  const writeBatch = async writes => { for (const write of writes) await write() }
`
