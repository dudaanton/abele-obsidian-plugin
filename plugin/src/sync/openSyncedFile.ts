export async function openSyncedFile(
  path: string,
  hydrate: (path: string) => Promise<void>,
  open: (path: string) => Promise<void>,
  notice: (message: string) => void
): Promise<void> {
  try {
    await hydrate(path)
  } catch (error) {
    notice('Cannot get this file yet: ' + path + '. Try again when a source is reachable.')
    throw error
  }
  await open(path)
}
