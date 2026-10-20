import type { FileSystem, StateStore } from '@abele/sync-sdk/core'
import { EXTERNAL_STATE_KEY } from './external/state'
import { ExternalDocumentSchema } from './external/records'
import { parseProjection, MAX_PROJECTION_BYTES } from './external/projection'
import { LocalPlacementError } from './localFolderPlacement'
import { sha256 } from './external/hash'
import { assertVaultPath, guardedVaultAdapter } from './vaultPathLinks'
import type { DataAdapter } from 'obsidian'

export interface FolderEntries {
  files: string[]
  folders: string[]
}

export async function inspectFolder(adapter: DataAdapter, root: string): Promise<FolderEntries> {
  adapter = guardedVaultAdapter(adapter)
  await assertVaultPath(adapter, root)
  const files: string[] = [],
    folders: string[] = [],
    pending = [root],
    seen = new Set<string>()
  while (pending.length) {
    const path = pending.pop()
    if (
      seen.has(path) ||
      !(path === root || path.startsWith(root + '/')) ||
      path.split('/').some((part) => part === '..')
    )
      throw new LocalPlacementError(
        'The folder contents could not be verified; sync remains stopped'
      )
    seen.add(path)
    await assertVaultPath(adapter, path)
    if ((await adapter.stat(path))?.type !== 'folder') continue
    folders.push(path)
    const children = await adapter.list(path)
    for (const file of children.files) {
      if (!file.startsWith(root + '/'))
        throw new LocalPlacementError(
          'The folder contents could not be verified; sync remains stopped'
        )
      await assertVaultPath(adapter, file)
      files.push(file)
    }
    pending.push(...children.folders)
  }
  return { files, folders }
}

/** No unknown local entry may acquire publication authority through Follow. */
export async function verifyFolderSet(
  state: StateStore,
  fs: FileSystem,
  server: string,
  destination: string,
  inspect?: (path: string) => Promise<FolderEntries>
): Promise<void> {
  const under = (path: string, root: string) => path === root || path.startsWith(root + '/')
  const local = (path: string) => destination + path.slice(server.length)
  const known = []
  for await (const entry of state.all()) if (under(entry.wirePath, server)) known.push(entry)
  const directories = JSON.parse(
    (await state.getMeta('v2-directories')) ?? '{"directories":[]}'
  ) as { directories?: { path: string }[] }
  const knownDirectories = new Set((directories.directories ?? []).map((dir) => dir.path))
  const expectedFolders = new Set<string>([destination])
  for (const path of [
    ...known.map((entry) => entry.path),
    ...(directories.directories ?? []).map((dir) => dir.path),
  ]) {
    if (!under(path, server)) continue
    const parts = local(path).split('/')
    if (knownDirectories.has(path)) expectedFolders.add(local(path))
    for (let n = destination.split('/').length; n < parts.length; n++)
      expectedFolders.add(parts.slice(0, n).join('/'))
  }
  let actual: FolderEntries
  if (inspect) actual = await inspect(destination)
  else {
    const files = []
    for await (const file of fs.list()) if (under(file.path, destination)) files.push(file.path)
    const folders = []
    if (fs.listDirectories)
      for await (const dir of fs.listDirectories())
        if (under(dir.path, destination)) folders.push(dir.path)
    actual = { files, folders }
  }
  const files = new Set(actual.files),
    accepted = new Set<string>()
  const raw = await state.getMeta(EXTERNAL_STATE_KEY)
  const external = raw ? ExternalDocumentSchema.parse(JSON.parse(raw)) : null
  let missing = 0
  for (const entry of known) {
    const path = local(entry.path)
    if (files.has(path)) accepted.add(path)
    const record = external?.files.find((file) => file.fileId === entry.fileId)
    const sidecar = record?.projectionPath
    let projected = false
    if (sidecar && record.projectionSha && under(sidecar, server) && files.has(local(sidecar))) {
      try {
        const disk = local(sidecar),
          stat = await fs.stat(disk)
        if (!stat || stat.size > MAX_PROJECTION_BYTES) throw new Error('invalid sidecar')
        let bytes: Uint8Array
        if (fs.openRead) {
          const source = await fs.openRead(disk)
          try {
            if (source.size > MAX_PROJECTION_BYTES) throw new Error('invalid sidecar')
            bytes = await source.read(0, source.size)
            await source.assertUnchanged()
          } finally {
            await source.close()
          }
        } else bytes = await fs.read(disk)
        if (bytes.length > MAX_PROJECTION_BYTES) throw new Error('invalid sidecar')
        const projection = parseProjection(bytes)
        projected =
          projection.fileId === entry.fileId &&
          projection.observedVersionId === entry.versionId &&
          projection.path === entry.wirePath &&
          projection.sha256 === entry.sha &&
          projection.size === entry.size &&
          projection.vaultId === external.binding.vaultId &&
          (await sha256(bytes)) === record.projectionSha
        if (projected) accepted.add(disk)
      } catch {
        /* Unproven sidecars remain unknown entries. */
      }
    }
    if (!files.has(path) && !projected) missing++
  }
  const extra =
    actual.files.filter((path) => !accepted.has(path)).length +
    actual.folders.filter((path) => !expectedFolders.has(path)).length
  if (extra)
    throw new LocalPlacementError(
      `${extra} files or folders here aren't part of this connection; move them out or use Restore from the server`
    )
  if (inspect || fs.listDirectories)
    missing += [...expectedFolders].filter((path) => !actual.folders.includes(path)).length
  if (
    missing ||
    (!known.length && !(directories.directories ?? []).some((dir) => under(dir.path, server)))
  )
    throw new LocalPlacementError(
      `${missing || 1} known files or folders are missing; sync remains stopped. Use Restore from the server`
    )
}
