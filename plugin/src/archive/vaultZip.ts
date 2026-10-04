import { TFile, TFolder, type App, type EventRef } from 'obsidian'
import type { ScopeResolver } from '@/ai/ScopeResolver'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { guardChatWrite } from '@/ai/tools/chatWriteGuard'
import { toSafeVaultPath } from '@/helpers/pathsHelpers'
import { buildZip, validateZipEntries, ZIP_LIMITS } from './zip'

export interface ZipRequest {
  path: string
  files: { path: string; name?: string }[]
}
export interface VaultZipContext {
  app: App
  scope: ScopeResolver
  agentId: string
  validateWrite(): void
  signal?: AbortSignal
}
export interface SavedZip {
  path: string
  count: number
  size: number
  warning?: string
}

function exactPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 65535 ||
    /[\\\0\r\n]/.test(value) ||
    value.startsWith('/') ||
    /^[a-z]:/i.test(value) ||
    value.split('/').some((p) => !p || p === '.' || p === '..' || p.trim() !== p)
  )
    throw new Error('ZIP requires exact relative vault file paths without traversal')
  return value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid ZIP request')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error('Unknown ZIP parameter')
}

/** Copies only values, synchronously; no caller-owned array or mapping crosses an await. */
export function snapshotZipRequest(value: unknown): ZipRequest {
  const args = object(value)
  keys(args, ['path', 'files'])
  const path = exactPath(args.path)
  if (!/\.zip$/i.test(path) || toSafeVaultPath(path) !== path)
    throw new Error('ZIP destination must be an exact safe .zip path; no automatic renaming')
  guardChatWrite(path)
  if (!Array.isArray(args.files) || !args.files.length || args.files.length > ZIP_LIMITS.entries)
    throw new Error('ZIP requires 1 to 5000 explicit selected files')
  const files = args.files.map((value) => {
    const file = object(value)
    keys(file, ['path', 'name'])
    const sourcePath = exactPath(file.path)
    if (sourcePath === path) throw new Error('ZIP destination cannot be a source')
    if (file.name !== undefined && typeof file.name !== 'string')
      throw new Error('Invalid ZIP entry name')
    return { path: sourcePath, ...(file.name === undefined ? {} : { name: file.name as string }) }
  })
  // Layout preflight precedes ALL metadata reads, including a malformed later mapping.
  const layout = validateZipEntries(
    files.map((file) => ({ name: file.name ?? file.path, source: file, size: 0 }))
  )
  return { path, files: layout.map((entry) => ({ path: entry.source.path, name: entry.name })) }
}

/** Scoped public-vault client of the portable constructor, never a script/eval capability. */
export async function createVaultZip(value: unknown, context: VaultZipContext): Promise<SavedZip> {
  const request = snapshotZipRequest(value)
  const { app, scope, signal } = context
  const validateWrite = () => context.validateWrite()
  const vault = app.vault
  const checkOwner = () => {
    signal?.throwIfAborted()
    if (app.vault !== vault || !context.agentId)
      throw new Error('ZIP invocation is no longer bound')
    validateWrite()
  }
  const checkScope = () => {
    checkOwner()
    // Whole selection checked BEFORE resolving metadata; ancestor-listing never grants bytes.
    if (request.files.some((file) => !scope.isInScope(file.path)))
      throw new Error('Selected files are not available in this scope')
  }
  checkScope()
  const selected = request.files.map((item) => {
    const file = vault.getAbstractFileByPath(item.path)
    if (!(file instanceof TFile) || file.path !== item.path)
      throw new Error('Selected files are not available as indexed files')
    return {
      file,
      path: item.path,
      name: item.name!,
      size: file.stat.size,
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
    }
  })
  const dirty = new Set<TFile>()
  const refs: EventRef[] = []
  const watched = new Set(selected.map((source) => source.file))
  let destinationChanged = false
  const changedParents = new Set<string>()
  const changed = (file: TFile, oldPath?: string) => {
    if (file.path === request.path || oldPath === request.path) destinationChanged = true
    for (const path of parents.keys()) {
      if (file.path === path || oldPath === path) changedParents.add(path)
    }
    if (
      watched.has(file) ||
      selected.some((source) => source.path === file.path || source.path === oldPath)
    ) {
      for (const source of selected)
        if (source.file === file || source.path === file.path || source.path === oldPath)
          dirty.add(source.file)
    }
  }
  const checkSources = () => {
    checkScope()
    for (const source of selected) {
      if (
        dirty.has(source.file) ||
        source.file.path !== source.path ||
        vault.getAbstractFileByPath(source.path) !== source.file ||
        source.file.stat.size !== source.size ||
        source.file.stat.mtime !== source.mtime ||
        source.file.stat.ctime !== source.ctime
      )
        throw new Error('Selected files changed during ZIP creation')
    }
  }
  const parents = new Map<string, TFolder | null>()
  const parts = request.path.split('/').slice(0, -1)
  let parentPath = ''
  for (const part of parts) {
    parentPath = parentPath ? `${parentPath}/${part}` : part
    const parent = vault.getAbstractFileByPath(parentPath)
    if (parent && !(parent instanceof TFolder)) throw new Error('ZIP parent is not a folder')
    parents.set(parentPath, parent instanceof TFolder ? parent : null)
  }
  const checkDestination = () => {
    checkSources()
    guardChatWrite(request.path)
    if (vault.getAbstractFileByPath(request.path) || destinationChanged)
      throw new Error('ZIP destination already exists or changed')
    for (const [path, parent] of parents) {
      if (
        changedParents.has(path) ||
        vault.getAbstractFileByPath(path) !== parent ||
        (parent && parent.path !== path)
      )
        throw new Error('ZIP parent changed during creation')
    }
  }
  const preparedCreate = <T>(
    path: string,
    kind: 'binary' | 'folder',
    validate: () => void,
    run: () => Promise<T>
  ): Promise<T> => {
    const tracker = ChangeTracker.get(app)
    if (tracker) return tracker.prepareCreate(path, kind, validate)(run)
    validate()
    return run()
  }
  let parentCreationIssued = false
  try {
    refs.push(vault.on('modify', changed), vault.on('rename', changed), vault.on('delete', changed))
    checkDestination()
    // Public APIs cannot compare-and-create atomically against external writers. Check the
    // adapter for unindexed collisions too, then recheck indexed identity before issuance.
    if (await vault.adapter.exists(request.path)) throw new Error('ZIP destination already exists')
    checkDestination()
    const entries = selected.map((source) => ({ name: source.name, source, size: source.size }))
    return await buildZip(entries, {
      checkpoint: checkSources,
      yieldTask: () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)),
      read: async (source) => {
        checkSources()
        const bytes = await vault.readBinary(source.file)
        checkSources()
        if (bytes.byteLength !== source.size)
          throw new Error('Selected file size changed during ZIP creation')
        return new Uint8Array(bytes)
      },
      publish: async (bytes) => {
        checkDestination()
        if (await vault.adapter.exists(request.path))
          throw new Error('ZIP destination already exists')
        checkDestination()
        for (const [path, parent] of parents) {
          if (parent) continue
          if (await vault.adapter.exists(path))
            throw new Error('ZIP parent changed during creation')
          const folder = await preparedCreate(path, 'folder', checkDestination, () => {
            parentCreationIssued = true
            return vault.createFolder(path)
          })
          // Issued folders cannot be recalled; if stopped afterwards they may remain.
          if (
            !(folder instanceof TFolder) ||
            vault.getAbstractFileByPath(path) !== folder ||
            folder.path !== path
          )
            throw new Error('ZIP parent creation outcome changed; created folders may remain')
          parents.set(path, folder)
          checkDestination()
        }
        let issued = false
        let file: TFile
        try {
          file = await preparedCreate(request.path, 'binary', checkDestination, () => {
            issued = true
            // One final payload allocation is already owned by the constructor.
            return vault.createBinary(request.path, bytes.buffer as ArrayBuffer)
          })
        } catch (error) {
          if (issued)
            throw new Error(
              'ZIP creation was issued but did not confirm a save; no scope grant was made',
              { cause: error }
            )
          throw error
        }
        // Stop after native issuance is not a recall. Await settlement and report an actual save.
        if (
          destinationChanged ||
          !(file instanceof TFile) ||
          file.path !== request.path ||
          vault.getAbstractFileByPath(request.path) !== file
        )
          throw new Error(
            'ZIP creation was issued but its outcome changed; no scope grant was made'
          )
        let warning: string | undefined
        try {
          validateWrite()
          scope.addFile(request.path)
        } catch {
          warning = 'Saved, but the invocation is no longer authorized; no scope grant was made'
        }
        return {
          path: request.path,
          count: selected.length,
          size: bytes.byteLength,
          ...(warning ? { warning } : {}),
        }
      },
    })
  } catch (error) {
    // Never roll back folders or delete a path that may now belong to an external writer.
    if (parentCreationIssued)
      throw new Error(
        `${error instanceof Error ? error.message : 'ZIP creation failed'}; parent folder creation was issued; parent folders may remain`,
        { cause: error }
      )
    throw error
  } finally {
    for (const ref of refs) vault.offref(ref)
  }
}
