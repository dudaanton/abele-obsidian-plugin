import { crossesSymlink } from './symlinkChain'
import { diagnosticOrigin } from './nativeDiagnostics'
import { TFolder } from 'obsidian'
import { Platform } from 'obsidian'
import { sha256 } from '@noble/hashes/sha2'
import type { Vault } from 'obsidian'
import type { DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-sdk/core'

/** Probe from the vault boundary: lstat of a leaf alone follows linked parents. */
export async function assertNoLinkedAncestors(
  path: string,
  isLink: (path: string) => Promise<boolean>
): Promise<void> {
  const parts = path.split('/').filter(Boolean)
  if (parts.some((part) => part === '..' || part === '.'))
    throw new EngineError('io', 'Invalid vault path')
  for (let n = 1; n <= parts.length; n++)
    if (await isLink(parts.slice(0, n).join('/')))
      throw new EngineError('io', 'Vault path contains a symbolic link; sync remains stopped')
}

interface LinkAdapter {
  getFullPath?(path: string): string
  fsPromises?: { lstat?(path: string): Promise<{ isSymbolicLink(): boolean }> }
}

export async function vaultPathIsLink(
  adapter: DataAdapter & LinkAdapter,
  path: string
): Promise<boolean> {
  if (Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1'))) {
    const native = adapter.fsPromises
    if (!adapter.getFullPath || !native?.lstat) return false
    try {
      return (await native.lstat(adapter.getFullPath(path))).isSymbolicLink()
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return false
      throw error
    }
  }
  const access = rootAccess(adapter),
    pinned = await access.pin?.verify()
  if (!access.full || !access.native?.lstat) return false
  try {
    return (
      await access.native.lstat(pinned ? physicalPath(pinned.path, path) : access.full(path))
    ).isSymbolicLink()
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

export async function assertVaultPath(
  adapter: DataAdapter & LinkAdapter,
  path: string
): Promise<void> {
  if (Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1'))) {
    // The outer connection port authorizes first; its underlying vault guard checks the chain.
    await Reflect.get(adapter, Symbol.for('abele.sync.scoped-path-guard-v1'))(path)
    return
  }
  const access = rootAccess(adapter),
    pinned = await access.pin?.verify()
  await assertNoLinkedAncestors(path, async (component) => {
    if (!access.full || !access.native?.lstat) return false
    try {
      return (
        await access.native.lstat(
          pinned ? physicalPath(pinned.path, component) : access.full(component)
        )
      ).isSymbolicLink()
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return false
      throw error
    }
  })
}

function rootAccess(adapter: DataAdapter & LinkAdapter) {
  const origin = (adapterOrigins.get(adapter) ?? adapter) as DataAdapter & LinkAdapter
  const port = origin.fsPromises && diagnosticOrigin(origin.fsPromises)
  const native = (port && (nativeOrigins.get(port) ?? port)) as LinkAdapter['fsPromises']
  const full = origin.getFullPath?.bind(origin)
  return { native, full, pin: native && full ? pinnedRoot(native, full('')) : undefined }
}
function physicalPath(root: string, path: string): string {
  return root.replace(/\/+$/, '') + (path ? '/' + path.replace(/^\//, '') : '')
}

/** Native calls used by sync must declare which arguments name vault paths. */
export const nativePathMethods = {
  open: 1,
  utimes: 1,
  mkdir: 1,
  unlink: 1,
  rmdir: 1,
  rename: 2,
  link: 2,
  readFile: 1,
  stat: 1,
} as const

function pathArgument(value: unknown): string {
  if (typeof value !== 'string') throw new EngineError('io', 'Invalid vault path argument')
  return value
}

const GUARDED = Symbol('sync guarded filesystem')
const adapterOrigins = new WeakMap<DataAdapter, DataAdapter>()
const nativeOrigins = new WeakMap<object, object>()
const adapters = new WeakMap<DataAdapter, DataAdapter>()
/** Share the boundary with inspection, streaming and attachment effects. */
export function guardedVaultAdapter(adapter: DataAdapter): DataAdapter {
  if (
    Reflect.get(adapter, GUARDED) ||
    Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1'))
  )
    return adapter
  const cached = adapters.get(adapter)
  if (cached) return cached
  const native = (adapter as DataAdapter & LinkAdapter).fsPromises
  const full = (adapter as DataAdapter & LinkAdapter).getFullPath?.bind(adapter)
  if (!full || !native) {
    const proxy = mobileGuard(adapter)
    adapterOrigins.set(proxy, adapterOrigins.get(adapter) ?? adapter)
    adapters.set(adapter, proxy)
    return proxy
  }
  const virtual = full('') === ''
  const rootPin = virtual ? undefined : pinnedRoot(nativeOrigins.get(native) ?? native, full(''))
  const guardedNative =
    native &&
    new Proxy(native, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        // Internal lstat probes do not follow the final component.
        if (key === 'lstat') return value.bind(target)
        const count = nativePathMethods[key as keyof typeof nativePathMethods]
        if (!count)
          throw new EngineError('io', `Native operation has no path policy: ${String(key)}`)
        return async (...args: unknown[]) => {
          const root = full('').replace(/\\/g, '/').replace(/\/+$/, '')
          for (const arg of args.slice(0, count)) {
            const path = pathArgument(arg).replace(/\\/g, '/')
            if (
              virtual
                ? path.startsWith('/') ||
                  path.split('/').some((part) => !part || part === '.' || part === '..')
                : path !== root && !path.startsWith(root + '/')
            )
              throw new EngineError('io', 'Native path is outside the vault')
            await assertVaultPath(adapter, path.slice(root.length).replace(/^\//, ''))
          }
          if (key === 'open' && typeof args[1] === 'string' && /[wa+]/.test(args[1])) {
            const local = pathArgument(args[0])
              .replace(/\\/g, '/')
              .slice(root.length)
              .replace(/^\//, '')
            const cut = local.lastIndexOf('/')
            if (cut > 0) await ensureVaultDirectory(adapter, local.slice(0, cut))
          }
          // Recheck after awaited parent preparation, immediately before the operation.
          for (const arg of args.slice(0, count))
            await assertVaultPath(
              adapter,
              pathArgument(arg).replace(/\\/g, '/').slice(root.length).replace(/^\//, '')
            )
          const pinned = await rootPin?.verify()
          const physical = args.slice()
          if (pinned)
            for (let n = 0; n < count; n++)
              physical[n] =
                pinned.path + pathArgument(args[n]).replace(/\\/g, '/').slice(root.length)
          const rawNative = nativeOrigins.get(native) ?? native
          if (virtual) return Reflect.get(rawNative, key).apply(rawNative, physical)
          if (key === 'open')
            return openNoFollow(
              rawNative,
              pathArgument(physical[0]),
              physical[1],
              pinned?.path ?? root,
              pinned
            )
          if (key === 'readFile') {
            const handle = await openNoFollow(
              rawNative,
              pathArgument(physical[0]),
              'r',
              pinned?.path ?? root,
              pinned
            )
            try {
              return await handle.readFile()
            } finally {
              await handle.close()
            }
          }
          const invoke = () => Reflect.get(rawNative, key).apply(rawNative, physical)
          if (['unlink', 'rmdir', 'rename', 'link'].includes(String(key)) && pinned)
            return guardedNativeMutation(
              rawNative as typeof import('node:fs/promises'),
              pinned.path,
              physical.slice(0, count).map(pathArgument),
              invoke,
              (error) => rootPin?.stop(error)
            )
          return invoke()
        }
      },
    })
  if (guardedNative) nativeOrigins.set(guardedNative, nativeOrigins.get(native) ?? native)
  const paths: Record<string, number> = {
    read: 1,
    readBinary: 1,
    readBinaryPrefix: 1,
    list: 1,
    stat: 1,
    exists: 1,
    write: 1,
    writeBinary: 1,
    append: 1,
    appendBinary: 1,
    process: 1,
    mkdir: 1,
    remove: 1,
    rmdir: 1,
    rename: 2,
    copy: 2,
  }
  const guarded = new Proxy(adapter, {
    get(target, key) {
      if (key === GUARDED) return true
      if (key === 'fsPromises') {
        if (Reflect.get(target, key) !== native) {
          adapters.delete(target)
          return Reflect.get(guardedVaultAdapter(target), key)
        }
        return guardedNative
      }
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      if (!paths[String(key)]) return value.bind(target)
      return async (...args: unknown[]) => {
        for (const path of args.slice(0, paths[String(key)]))
          await assertVaultPath(adapter, pathArgument(path))
        const pinned = await rootPin?.verify()
        if (pinned) {
          const work = async () => {
            const changed = [
              'write',
              'writeBinary',
              'append',
              'appendBinary',
              'process',
              'mkdir',
              'rename',
              'copy',
              'remove',
              'rmdir',
            ].includes(String(key))
              ? args.slice(0, paths[String(key)]).map(pathArgument)
              : []
            bumpConfigRevision(adapter, changed)
            try {
              return await desktopOperation(
                String(key),
                args,
                adapter,
                nativeOrigins.get(native) ?? native,
                full,
                rootPin
              )
            } finally {
              bumpConfigRevision(adapter, changed)
            }
          }
          const queue = Reflect.get(target, 'queue')
          return typeof queue === 'function' ? queue.call(target, work) : work()
        }
        if (key === 'mkdir') return ensureVaultDirectory(adapter, pathArgument(args[0]))
        // Without native filesystem capabilities the adapter owns the syscall. This
        // immediate recheck cannot close an on-device attacker racing its async queue.
        for (const path of args.slice(0, paths[String(key)]))
          await assertVaultPath(adapter, pathArgument(path))
        return value.apply(target, args)
      }
    },
  })
  adapterOrigins.set(guarded, adapterOrigins.get(adapter) ?? adapter)
  adapters.set(adapter, guarded)
  adapters.set(guarded, guarded)
  return guarded
}

/** Create one component at a time, never recursive mkdir through an unchecked parent. */
export async function ensureVaultDirectory(adapter: DataAdapter, path: string): Promise<void> {
  if (Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1'))) {
    const parts = path.split('/')
    for (let n = 1; n <= parts.length; n++) {
      const part = parts.slice(0, n).join('/')
      if (part && !(await adapter.exists(part))) await adapter.mkdir(part)
    }
    return
  }
  const access = rootAccess(adapter),
    pinned = await access.pin?.verify()
  const raw = adapter as DataAdapter & {
    getFullPath?(path: string): string
    fsPromises?: {
      lstat?(path: string): Promise<{ isSymbolicLink(): boolean; isDirectory?(): boolean }>
      mkdir?(path: string): Promise<unknown>
    }
  }
  const direct = access.native as typeof raw.fsPromises
  const parts = path.split('/')
  for (let n = 1; n <= parts.length; n++) {
    const component = parts.slice(0, n).join('/')
    if (!component) continue
    await assertVaultPath(adapter, component)
    if (raw.getFullPath && direct?.lstat) {
      const check = async () => {
        const stat = await direct.lstat(
          pinned ? physicalPath(pinned.path, component) : raw.getFullPath(component)
        )
        if (stat.isSymbolicLink() || stat.isDirectory?.() !== true)
          throw new EngineError('io', 'Staging ancestor is not a real directory')
      }
      try {
        await check()
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error
        try {
          if (direct.mkdir)
            await direct.mkdir(
              pinned ? physicalPath(pinned.path, component) : raw.getFullPath(component)
            )
          else await adapter.mkdir(component)
        } catch (occupied) {
          if ((occupied as { code?: string }).code !== 'EEXIST') throw occupied
        }
        await check()
      }
    } else if (!(await adapter.exists(component))) await adapter.mkdir(component)
  }
}

export function vaultDisk(vault: Pick<Vault, 'adapter'>): DataAdapter {
  return guardedVaultAdapter(vault.adapter)
}

/** Only after the final connection has explicitly disconnected and its work has drained.
 * Old wrappers retain their original pins; releasing a cache never revives them. */
export function releaseVaultPathGuard(vault: Pick<Vault, 'adapter'>): void {
  const origin = adapterOrigins.get(vault.adapter) ?? vault.adapter
  const access = rootAccess(origin)
  if (access.native && access.full) rootPins.get(access.native)?.delete(access.full(''))
  adapters.delete(origin)
}

/** Use the renderer's real Node module; a dynamic import becomes a browser shim. */
export function desktopNodeFs(): typeof import('node:fs') {
  const unavailable = (missing: string[]) =>
    new EngineError(
      'io',
      `Native no-follow opens are unavailable (accessor: window.require('fs'); missing: ${missing.join(', ')})`
    )
  // isDesktop/isMobile describe the UI and change under desktop phone emulation.
  if (!Platform.isDesktopApp) throw unavailable(['desktop runtime'])
  if (typeof window === 'undefined' || typeof window.require !== 'function')
    throw unavailable(['window.require'])
  let module: typeof import('node:fs')
  try {
    module = window.require('fs') as typeof import('node:fs')
  } catch {
    throw unavailable(['fs module (require failed)'])
  }
  const missing: string[] = []
  for (const key of [
    'O_RDONLY',
    'O_RDWR',
    'O_WRONLY',
    'O_CREAT',
    'O_TRUNC',
    'O_EXCL',
    'O_APPEND',
    'O_NOFOLLOW',
  ])
    if (
      !Number.isSafeInteger(module?.constants?.[key as keyof typeof module.constants]) ||
      (key === 'O_NOFOLLOW' && !module?.constants?.O_NOFOLLOW)
    )
      missing.push('constants.' + key)
  for (const key of ['open', 'lstat'])
    if (typeof module?.promises?.[key as keyof typeof module.promises] !== 'function')
      missing.push('promises.' + key)
  if (typeof module?.lstatSync !== 'function') missing.push('lstatSync')
  if (missing.length) throw unavailable(missing)
  return module
}

async function openNoFollow(
  raw: object,
  path: string,
  flags: unknown,
  root: string,
  expectedRoot?: RootIdentity
) {
  const fs = raw as typeof import('node:fs/promises')
  const desktop = desktopNodeFs()
  const constants = desktop.constants
  // Fail closed if the runtime cannot supply the native no-follow flag. Do not
  // substitute zero or guessed platform values: post-open identity checks remain
  // additional protection, rather than a replacement for O_NOFOLLOW.
  if (typeof fs.lstat !== 'function')
    throw new EngineError(
      'io',
      'Native no-follow opens are unavailable (accessor: adapter.fsPromises; missing: lstat)'
    )
  const modes: Record<string, number> = {
    r: constants.O_RDONLY,
    'r+': constants.O_RDWR,
    w: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
    wx: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL,
    a: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
    ax: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_EXCL,
  }
  const mode = typeof flags === 'number' ? flags : modes[pathArgument(flags)]
  if (mode === undefined) throw new EngineError('io', 'Unsupported native open mode')
  const parents: { path: string; dev: number; ino: number }[] = []
  const normalized = path.replace(/\\/g, '/')
  for (let at = root.length; at >= 0; at = normalized.indexOf('/', at + 1)) {
    const parent = normalized.slice(0, at)
    const stat = await fs.lstat(parent)
    if (
      expectedRoot &&
      parent === root &&
      (stat.dev !== expectedRoot.dev || stat.ino !== expectedRoot.ino)
    )
      throw new VaultRootChangedError()
    if (stat.isSymbolicLink()) throw new EngineError('io', 'Native parent contains a symbolic link')
    parents.push({ path: parent, dev: stat.dev, ino: stat.ino })
  }
  const handle = await desktop.promises.open(
    path,
    (mode & ~constants.O_TRUNC) | constants.O_NOFOLLOW
  )
  try {
    const opened = await handle.stat()
    const linked = await fs.lstat(path)
    if (
      !Number.isSafeInteger(opened.dev) ||
      !Number.isSafeInteger(opened.ino) ||
      linked.isSymbolicLink() ||
      opened.dev !== linked.dev ||
      opened.ino !== linked.ino
    )
      throw new EngineError('io', 'Native file identity changed during open')
    for (const parent of parents) {
      const current = await fs.lstat(parent.path)
      if (current.isSymbolicLink() || current.dev !== parent.dev || current.ino !== parent.ino)
        throw new EngineError('io', 'Native parent identity changed during open')
    }
    if (mode & constants.O_TRUNC) await handle.truncate(0)
    return handle
  } catch (error) {
    await handle.close()
    throw error
  }
}

interface NodeFsPromises {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean }>
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>
  unlink(path: string): Promise<void>
  stat(path: string): Promise<{ dev: number; ino: number }>
  rename(from: string, to: string): Promise<void>
  rmdir(path: string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  link(from: string, to: string): Promise<void>
  open(
    path: string,
    flags: string
  ): Promise<{
    read(
      bytes: Uint8Array,
      offset: number,
      length: number,
      position: number
    ): Promise<{ bytesRead: number }>
    close(): Promise<void>
    sync?(): Promise<void>
  }>
}
export interface NativeFs {
  restoreDirectoryExclusive?(from: string, to: string): Promise<void>
  sameObject?(a: string, b: string): Promise<boolean>
  syncPath?(path: string, parentsOnly?: boolean): Promise<void>
  /** Retain the displaced inode outside the vault, including late writes through open handles. */
  archiveBackup?(path: string): Promise<string>
  rename(from: string, to: string): Promise<void>
  rmdirEmpty(folder: string): Promise<void>
  /** Final comparison and replacement share Obsidian's local-save queue. */
  replaceFenced?: (temp: string, target: string, before: ArrayBuffer | null) => Promise<void>
  /** Atomic create-if-unoccupied, never overwrite a locally recreated target. */
  installExclusive?: (from: string, to: string) => Promise<void>
  replaceFencedIdentity?: (
    temp: string,
    target: string,
    before: { size: number; sha: string }
  ) => Promise<void>
}

/** Optional native capabilities; mobile remains adapter-only, never a Node import. */
export function nativeOf(
  adapter: DataAdapter,
  assertEffect: (paths?: readonly string[]) => void = () => {},
  recoveryRoot?: string
): NativeFs | null {
  adapter = guardedVaultAdapter(adapter)
  const raw = adapter as unknown as {
    fsPromises?: Partial<NodeFsPromises>
    getFullPath?: (path: string) => string
    reconcileInternalFile?: (path: string) => Promise<void>
    queue?: <T>(operation: () => Promise<T>) => Promise<T>
  }
  const fsp = raw.fsPromises,
    full = raw.getFullPath
  if (
    typeof full !== 'function' ||
    !fsp ||
    typeof fsp.rename !== 'function' ||
    typeof fsp.rmdir !== 'function'
  )
    return null
  const rename = fsp.rename.bind(fsp),
    rmdir = fsp.rmdir.bind(fsp)
  const at = (path: string) => full.call(adapter, path)
  const reconcile = async (...paths: string[]) => {
    if (!raw.reconcileInternalFile) return
    for (const path of paths) {
      try {
        await raw.reconcileInternalFile.call(adapter, path)
      } catch (error) {
        console.debug(`[abele-sync] Obsidian did not look at ${path} again`, error)
      }
    }
  }
  const native: NativeFs = {
    async rename(from, to) {
      await assertVaultPath(adapter, from)
      await assertVaultPath(adapter, to)
      assertEffect([from, to])
      await rename(at(from), at(to))
      await reconcile(from, to)
    },
    async rmdirEmpty(path) {
      await assertVaultPath(adapter, path)
      assertEffect([path])
      await rmdir(at(path))
      await reconcile(path)
    },
  }
  if (fsp.stat)
    native.sameObject = async (a, b) => {
      await assertVaultPath(adapter, a)
      await assertVaultPath(adapter, b)
      const [left, right] = await Promise.all([fsp.stat(at(a)), fsp.stat(at(b))])
      return left.dev === right.dev && left.ino === right.ino
    }
  if (fsp.open)
    native.syncPath = async (path, parentsOnly = false) => {
      const paths: string[] = []
      if (!parentsOnly) paths.push(path)
      for (
        let parent = path.slice(0, Math.max(0, path.lastIndexOf('/')));
        ;
        parent = parent.slice(0, Math.max(0, parent.lastIndexOf('/')))
      ) {
        paths.push(parent)
        if (!parent) break
      }
      for (const part of new Set(paths)) {
        await assertVaultPath(adapter, part)
        assertEffect([part])
        const handle = await fsp.open(at(part), 'r')
        try {
          if (!handle.sync) throw new EngineError('io', 'native durability is unavailable')
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
    }
  if (fsp.mkdir && fsp.stat && fsp.link && fsp.unlink) {
    const hex = (value: string) =>
      Array.from(sha256(new TextEncoder().encode(value)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('')
    const root = recoveryRoot ? at(recoveryRoot) : at('').replace(/\\/g, '/').replace(/\/+$/, '')
    const folder = recoveryRoot
      ? root
      : root.slice(0, root.lastIndexOf('/')) + '/.abele-sync-recovery/' + hex(root)
    const archiveFs = (
      recoveryRoot ? fsp : (nativeOrigins.get(fsp) ?? fsp)
    ) as Partial<NodeFsPromises>
    const checkArchive = async () => {
      if (recoveryRoot) {
        await fsp.mkdir(folder, { recursive: true })
        return
      }
      const parent = root.slice(0, root.lastIndexOf('/'))
      for (const directory of [parent + '/.abele-sync-recovery', folder]) {
        try {
          const entry = await archiveFs.lstat(directory)
          if (
            entry.isSymbolicLink() ||
            (entry as { isDirectory?(): boolean }).isDirectory?.() !== true
          )
            throw new EngineError('io', 'Private recovery path is not a real directory')
        } catch (error) {
          if ((error as { code?: string }).code !== 'ENOENT') throw error
          await archiveFs.mkdir(directory, undefined)
          const created = await archiveFs.lstat(directory)
          if (
            created.isSymbolicLink() ||
            (created as { isDirectory?(): boolean }).isDirectory?.() !== true
          )
            throw new EngineError('io', 'Private recovery path is not a real directory')
        }
      }
    }
    native.archiveBackup = async (path) => {
      await assertVaultPath(adapter, path)
      assertEffect([path])
      const pinned = recoveryRoot ? undefined : await rootAccess(adapter).pin?.verify()
      const source = pinned ? physicalPath(pinned.path, path) : at(path),
        destination = folder + '/' + hex(source) + '.old'
      await checkArchive()
      await assertVaultPath(adapter, path)
      assertEffect([path])
      try {
        await archiveFs.link(source, destination)
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'EEXIST' && code !== 'ENOENT') throw error
        const retained = (await archiveFs.lstat(destination)) as Awaited<
          ReturnType<NodeFsPromises['stat']>
        > & { isSymbolicLink(): boolean }
        if (retained.isSymbolicLink())
          throw new EngineError('io', 'Private recovery file is a symbolic link')
        try {
          const current = await archiveFs.stat(source)
          if (current.dev !== retained.dev || current.ino !== retained.ino)
            throw new EngineError('conflict', 'Recovery destination is occupied by another inode')
        } catch (missing) {
          if ((missing as { code?: string }).code !== 'ENOENT') throw missing
        }
      }
      await assertVaultPath(adapter, path)
      assertEffect([path])
      try {
        await archiveFs.unlink(source)
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error
      }
      await reconcile(path)
      return destination
    }
  }
  if (typeof raw.queue === 'function' && typeof fsp.open === 'function') {
    const queue = raw.queue.bind(adapter),
      open = fsp.open.bind(fsp)
    native.replaceFencedIdentity = async (temp, target, before) => {
      await queue(async () => {
        await assertVaultPath(adapter, temp)
        await assertVaultPath(adapter, target)
        const handle = await open(at(target), 'r')
        try {
          const bytes = new Uint8Array(1024 * 1024),
            hash = sha256.create()
          let size = 0
          for (;;) {
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, size)
            if (!bytesRead) break
            size += bytesRead
            hash.update(bytes.subarray(0, bytesRead))
          }
          const digest = Array.from(hash.digest(), (value) =>
            value.toString(16).padStart(2, '0')
          ).join('')
          if (size !== before.size || digest !== before.sha)
            throw new EngineError('conflict', `${target} changed before queued replacement`)
          await assertVaultPath(adapter, temp)
          await assertVaultPath(adapter, target)
          assertEffect([temp, target])
          await rename(at(temp), at(target))
          await reconcile(temp, target)
        } finally {
          await handle.close()
        }
      })
    }
  }
  if (typeof raw.queue === 'function' && typeof fsp.readFile === 'function') {
    const queue = raw.queue.bind(adapter),
      read = fsp.readFile.bind(fsp)
    native.replaceFenced = async (temp, target, before) => {
      try {
        await queue(async () => {
          await assertVaultPath(adapter, temp)
          await assertVaultPath(adapter, target)
          // Use raw native reads inside the queue: adapter.readBinary would re-enter it.
          if (before !== null) {
            const current = new Uint8Array(await read(at(target))),
              expected = new Uint8Array(before)
            if (
              current.length !== expected.length ||
              current.some((value, i) => value !== expected[i])
            ) {
              throw new EngineError('conflict', `${target} changed before queued replacement`)
            }
          }
          await assertVaultPath(adapter, temp)
          await assertVaultPath(adapter, target)
          assertEffect([temp, target])
          await rename(at(temp), at(target))
          await reconcile(temp, target)
        })
      } catch (cause) {
        if (cause instanceof EngineError) throw cause
        throw new EngineError('io', `cannot replace ${target} in the local-save queue`, cause)
      }
    }
  }
  if (typeof fsp.mkdir === 'function') {
    const mkdir = fsp.mkdir.bind(fsp)
    native.restoreDirectoryExclusive = async (from, to) => {
      await assertVaultPath(adapter, from)
      await assertVaultPath(adapter, to)
      assertEffect([from, to])
      // Reserve only an absent name. Rename may replace our empty reservation,
      // but refuses it if a local save has populated the directory meanwhile.
      await mkdir(at(to), { recursive: false })
      await assertVaultPath(adapter, from)
      await assertVaultPath(adapter, to)
      assertEffect([from, to])
      await rename(at(from), at(to))
      await reconcile(from, to)
    }
  }
  if (typeof fsp.link === 'function') {
    const link = fsp.link.bind(fsp)
    native.installExclusive = async (from, to) => {
      await assertVaultPath(adapter, from)
      await assertVaultPath(adapter, to)
      assertEffect([from, to])
      await link(at(from), at(to))
      // The source name remains journal-owned until completion; never weaken exclusive
      // installation by replacing an occupied destination with a rename.
      await reconcile(to)
    }
  }
  return native
}

/** The only native I/O capability exported to streaming and prefix readers. */
export function nativeChunkPort(adapter: DataAdapter) {
  const disk = guardedVaultAdapter(adapter) as DataAdapter & {
    getFullPath?(path: string): string
    fsPromises?: {
      open?(
        path: string,
        flags: string
      ): Promise<{
        read(
          bytes: Uint8Array,
          offset: number,
          length: number,
          position: number
        ): Promise<{ bytesRead: number }>
        write(
          bytes: Uint8Array,
          offset: number,
          length: number,
          position: number
        ): Promise<{ bytesWritten: number }>
        sync(): Promise<void>
        close(): Promise<void>
      }>
      utimes?(path: string, atime: number, mtime: number): Promise<void>
    }
  }
  return {
    available: typeof disk.fsPromises === 'object',
    fullPath: disk.getFullPath?.bind(disk),
    open: disk.fsPromises?.open?.bind(disk.fsPromises),
    utimes: disk.fsPromises?.utimes?.bind(disk.fsPromises),
  }
}

export function guardedVaultPort<T extends object>(port: T): T {
  return guardedVaultAdapter(port as unknown as DataAdapter) as unknown as T
}

const REVISIONS = Symbol.for('abele.sync.adapter-config-revisions-v1')

/** Config writes have no vault-index event. Track adapter mutations without stat/list calls.
 * One wrapper per adapter, shared by all connections; no runtime or callbacks are retained.
 * Changes outside the adapter are still discovered by the existing config poll. */
export function adapterConfigRevision(adapter: DataAdapter, root: string): () => number {
  adapter = adapterOrigins.get(adapter) ?? adapter
  const shared = adapter as DataAdapter & { [REVISIONS]?: Map<string, number> }
  let roots = shared[REVISIONS]
  if (!roots) {
    roots = new Map()
    Object.defineProperty(adapter, REVISIONS, { value: roots })
    const held = roots
    for (const key of [
      'write',
      'writeBinary',
      'append',
      'appendBinary',
      'process',
      'mkdir',
      'rename',
      'copy',
      'remove',
      'rmdir',
    ] as const) {
      const original: unknown = Reflect.get(adapter, key)
      if (typeof original !== 'function') continue
      const change = (paths: unknown[]) => {
        for (const [root, revision] of held) {
          if (
            paths.some(
              (path) =>
                typeof path === 'string' &&
                (path === root || path.startsWith(root + '/') || root.startsWith(path + '/'))
            )
          )
            held.set(root, revision + 1)
        }
      }
      Object.defineProperty(adapter, key, {
        configurable: true,
        writable: true,
        value: function (this: DataAdapter, ...args: unknown[]) {
          const paths = args.slice(0, key === 'rename' || key === 'copy' ? 2 : 1)
          change(paths)
          try {
            return Promise.resolve(
              (original as (...args: unknown[]) => unknown).apply(this, args)
            ).finally(() => change(paths))
          } catch (error) {
            change(paths)
            throw error
          }
        },
      })
    }
  }
  if (!roots.has(root)) roots.set(root, 0)
  const held = roots
  return () => held.get(root) ?? 0
}

export class VaultRootChangedError extends Error {
  readonly code = 'vault-root-changed'
  constructor() {
    super('Vault root changed; sync stopped. Restore its original location before reconnecting.')
  }
}
export function vaultRootFailure(error: unknown): Error | undefined {
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    if (Reflect.get(error, 'code') === 'vault-root-changed' && error instanceof Error) return error
    error = Reflect.get(error, 'cause')
  }
}
function bumpConfigRevision(adapter: DataAdapter, paths: readonly string[]): void {
  const roots = Reflect.get(adapterOrigins.get(adapter) ?? adapter, REVISIONS) as
    | Map<string, number>
    | undefined
  if (!roots) return
  for (const [root, revision] of roots)
    if (
      paths.some(
        (path) => path === root || path.startsWith(root + '/') || root.startsWith(path + '/')
      )
    )
      roots.set(root, revision + 1)
}
interface RootIdentity {
  path: string
  dev: number
  ino: number
}
interface RootPin {
  verify(): Promise<RootIdentity>
  stop(error: Error): void
}

/** Node has no *at syscalls. A local filesystem attacker can still race the syscall
 * itself; synchronous prechecks narrow that window and postchecks stop further sync. */
export async function guardedNativeMutation<T>(
  io: Pick<typeof import('node:fs/promises'), 'lstat'>,
  root: string,
  paths: string[],
  operation: () => Promise<T>,
  stop: (error: Error) => void
): Promise<T> {
  const sync = desktopNodeFs()
  const parents = new Set([root])
  for (const path of paths) {
    if (!path.startsWith(root + '/')) throw new Error('Native path is outside the vault')
    let parent = path.slice(0, path.lastIndexOf('/'))
    while (parent.length > root.length) {
      parents.add(parent)
      parent = parent.slice(0, parent.lastIndexOf('/'))
    }
  }
  const identities = await Promise.all(
    [...parents].map(async (path) => ({ path, stat: await io.lstat(path) }))
  )
  const verify = () => {
    try {
      for (const { path, stat } of identities) {
        const current = sync.lstatSync(path)
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          !current.isDirectory() ||
          current.isSymbolicLink() ||
          stat.dev !== current.dev ||
          stat.ino !== current.ino
        )
          throw new Error('Parent changed')
      }
    } catch {
      const error = Object.assign(
        new Error(
          'Vault parent identity changed; sync stopped. Reconnect after checking the folder.'
        ),
        { code: 'vault-root-changed' }
      )
      stop(error)
      console.error('[abele-sync] filesystem parent identity changed; sync stopped', error)
      throw error
    }
  }
  verify()
  try {
    // No await between the synchronous identity check and invoking the syscall.
    return await operation()
  } finally {
    verify()
  }
}
const rootPins = new WeakMap<object, Map<string, RootPin>>()
function pinnedRoot(native: object, logical: string): RootPin | undefined {
  const io = native as typeof import('node:fs/promises')
  if (!io.realpath || !io.lstat || !io.open) return undefined
  let roots = rootPins.get(native)
  if (!roots) rootPins.set(native, (roots = new Map()))
  const prior = roots.get(logical)
  if (prior) return prior
  const capture = async (): Promise<RootIdentity> => {
    const path = await io.realpath(logical),
      stat = await io.lstat(path)
    if (!stat.isDirectory() || !Number.isSafeInteger(stat.dev) || !Number.isSafeInteger(stat.ino))
      throw new VaultRootChangedError()
    return { path: path.replace(/\\/g, '/').replace(/\/+$/, ''), dev: stat.dev, ino: stat.ino }
  }
  const initial = capture()
  let stopped: Error | undefined
  void initial.catch(() => {})
  const pin = {
    stop: (error: Error) => {
      stopped = error
    },
    verify: async () => {
      if (stopped) throw stopped
      try {
        const pinned = await initial,
          current = await capture()
        if (
          pinned.path !== current.path ||
          pinned.dev !== current.dev ||
          pinned.ino !== current.ino
        )
          throw new VaultRootChangedError()
        return pinned
      } catch {
        throw new VaultRootChangedError()
      }
    },
  }
  roots.set(logical, pin)
  return pin
}
async function desktopOperation(
  key: string,
  args: unknown[],
  adapter: DataAdapter,
  native: object,
  full: (path: string) => string,
  pin: RootPin
) {
  const io = native as typeof import('node:fs/promises')
  const root = await pin.verify()
  const local = pathArgument(args[0]),
    at = (path: string) => root.path + (path ? '/' + path.replace(/^\//, '') : '')
  const check = async (...paths: string[]) => {
    await pin.verify()
    for (const path of paths)
      await assertNoLinkedAncestors(path, async (part) => {
        try {
          return (await io.lstat(at(part))).isSymbolicLink()
        } catch (e) {
          if ((e as { code?: string }).code === 'ENOENT') return false
          throw e
        }
      })
  }
  const mutate = <T>(paths: string[], operation: () => Promise<T>) =>
    guardedNativeMutation(io, root.path, paths.map(at), operation, (error) => pin.stop(error))
  await check(local)
  if (['read', 'readBinary', 'readBinaryPrefix'].includes(key)) {
    const handle = await openNoFollow(io, at(local), 'r', root.path, root)
    try {
      await pin.verify()
      if (key === 'readBinaryPrefix') {
        const bytes = new Uint8Array(Number(args[1]))
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        return bytes.subarray(0, bytesRead)
      }
      const bytes = await handle.readFile()
      return key === 'read' ? new TextDecoder().decode(bytes) : Uint8Array.from(bytes).buffer
    } finally {
      await handle.close()
    }
  }
  if (key === 'stat' || key === 'exists') {
    try {
      const stat = await io.lstat(at(local))
      if (stat.isSymbolicLink()) throw new Error('Vault path contains a symbolic link')
      return key === 'exists'
        ? true
        : {
            type: stat.isDirectory() ? 'folder' : 'file',
            ctime: stat.birthtimeMs,
            mtime: stat.mtimeMs,
            size: stat.size,
          }
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return key === 'exists' ? false : null
      throw e
    }
  }
  if (key === 'list') {
    const handle = await openNoFollow(io, at(local), 'r', root.path, root)
    try {
      const before = await handle.stat(),
        entries = await io.readdir(at(local), { withFileTypes: true })
      await check(local)
      const after = await io.lstat(at(local))
      if (before.dev !== after.dev || before.ino !== after.ino)
        throw new Error('Directory identity changed')
      const path = (name: string) =>
        local.replace(/\/+$/, '') + (local && local !== '/' ? '/' : '') + name
      return {
        files: entries.filter((e) => e.isFile()).map((e) => path(e.name)),
        folders: entries.filter((e) => e.isDirectory()).map((e) => path(e.name)),
      }
    } finally {
      await handle.close()
    }
  }
  if (key === 'mkdir') {
    await ensureVaultDirectory(adapter, local)
    return
  }
  if (['write', 'writeBinary', 'append', 'appendBinary', 'process'].includes(key)) {
    const cut = local.lastIndexOf('/')
    if (cut > 0) await ensureVaultDirectory(adapter, local.slice(0, cut))
    await check(local)
    const append = key.startsWith('append')
    const handle = await openNoFollow(
      io,
      at(local),
      append ? 'a' : key === 'process' ? 'r+' : 'w',
      root.path,
      root
    )
    try {
      await pin.verify()
      let input = args[1]
      if (key === 'process')
        input = (input as (s: string) => string)(await handle.readFile({ encoding: 'utf8' }))
      const bytes =
        typeof input === 'string'
          ? new TextEncoder().encode(input)
          : new Uint8Array(input as ArrayBuffer)
      if (!append) await handle.truncate(0)
      let written = 0
      while (written < bytes.length) {
        const result = await handle.write(
          bytes,
          written,
          bytes.length - written,
          append ? null : written
        )
        if (!result.bytesWritten) throw new Error('Short native write')
        written += result.bytesWritten
      }
      const options = args[2] as { mtime?: number; ctime?: number } | undefined
      if (options?.mtime !== undefined)
        await handle.utimes((options.ctime ?? options.mtime) / 1000, options.mtime / 1000)
      return key === 'process' ? input : undefined
    } finally {
      await handle.close()
    }
  }
  if (key === 'rename' || key === 'copy') {
    const to = pathArgument(args[1])
    await check(local, to)
    if (key === 'rename') {
      const source = await io.lstat(at(local))
      if (source.isDirectory()) {
        try {
          const dest = await io.lstat(at(to))
          if (source.dev !== dest.dev || source.ino !== dest.ino)
            throw Object.assign(new Error('Destination exists'), { code: 'EEXIST' })
        } catch (error) {
          if ((error as { code?: string }).code !== 'ENOENT') throw error
        }
        await check(local, to)
        await mutate([local, to], () => io.rename(at(local), at(to)))
      } else {
        // Adapter rename is a no-clobber install. Native rename would replace a
        // local file recreated after the caller's earlier absence check.
        await check(local, to)
        await mutate([local, to], () => io.link(at(local), at(to)))
        await check(local, to)
        const retained = await io.lstat(at(to)),
          current = await io.lstat(at(local))
        if (
          retained.isSymbolicLink() ||
          retained.dev !== source.dev ||
          retained.ino !== source.ino ||
          current.dev !== source.dev ||
          current.ino !== source.ino
        )
          throw new Error('Rename identity changed; both names were retained')
        await mutate([local, to], () => io.unlink(at(local)))
      }
    } else {
      const bytes = await desktopOperation('readBinary', [local], adapter, native, full, pin)
      await desktopOperation('writeBinary', [to, bytes], adapter, native, full, pin)
    }
  } else if (key === 'remove') {
    await check(local)
    await mutate([local], () => io.unlink(at(local)))
  } else if (key === 'rmdir') {
    if (args[1]) throw new Error('Recursive sync removal is unavailable')
    await check(local)
    await mutate([local], () => io.rmdir(at(local)))
  } else throw new Error('Filesystem operation has no native policy: ' + key)
  const reconcile = Reflect.get(adapter, 'reconcileInternalFile')
  if (typeof reconcile === 'function')
    for (const path of [local, ...(key === 'rename' ? [pathArgument(args[1])] : [])])
      await reconcile.call(adapter, path)
}
function mobileGuard(adapter: DataAdapter): DataAdapter {
  // The filesystem and runtime fence cache their instrumentation by method identity.
  // Returning a fresh closure for every stat rebuilt those layers on every file scan.
  const methods = new Map<PropertyKey, { source: unknown; wrapped: unknown }>()
  // Mobile adapters provide no native filesystem capability. An immediate chain recheck
  // still leaves an on-device filesystem attacker a race inside the adapter async queue.
  return new Proxy(adapter, {
    get(target, key) {
      if (key === GUARDED) return true
      const value = Reflect.get(target, key)
      const cached = methods.get(key)
      if (cached && cached.source === value) return cached.wrapped
      if (
        typeof value !== 'function' ||
        ![
          'read',
          'readBinary',
          'readBinaryPrefix',
          'write',
          'writeBinary',
          'append',
          'appendBinary',
          'process',
          'rename',
          'copy',
          'remove',
          'rmdir',
          'mkdir',
          'stat',
          'exists',
          'list',
        ].includes(String(key))
      )
        return typeof value === 'function' ? value.bind(target) : value
      const wrapped = async (...args: unknown[]) => {
        for (const path of args.slice(0, key === 'rename' || key === 'copy' ? 2 : 1))
          await assertVaultPath(target, pathArgument(path))
        return value.apply(target, args)
      }
      methods.set(key, { source: value, wrapped })
      return wrapped
    },
  })
}

/**
 * Obsidian deletes a folder as one promise but can publish its child events along the way.
 * A scan halfway through that operation would send a small prefix below the bulk-delete
 * guard's threshold. Wait for the operation, not for a guessed debounce duration.
 *
 * Shared by filesystems on the same vault: finishing a join can replace the engine while
 * an operation is still running. Only the thin Obsidian adapter knows this lifecycle.
 */
class FolderMutations {
  private readonly pending = new Set<Promise<void>>()
  private users = 0
  /** Changes when an operation starts, including one that finishes before a scan ends. */
  revision = 0
  private restore: (() => void) | null = null
  private readonly listeners = new Set<(path: string, to?: string) => void>()

  constructor(private readonly vault: Vault) {}

  watch(listener?: (path: string, to?: string) => void): () => void {
    if (listener) this.listeners.add(listener)
    if (this.users++ === 0) {
      const restores: (() => void)[] = []
      for (const method of ['delete', 'trash'] as const) {
        // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with apply and restored by identity
        const original = this.vault[method]
        const begin = (): (() => void) => this.begin()
        const notify = (path: string) => {
          for (const listener of this.listeners) listener(path)
        }
        const wrapped: typeof original = function (
          this: Vault,
          ...args: Parameters<typeof original>
        ) {
          if (!(args[0] instanceof TFolder)) return original.apply(this, args)
          // Enter before calling the original: even synchronous child events see the barrier.
          const finish = begin()
          return (async () => {
            try {
              notify(args[0].path)
              return await original.apply(this, args)
            } finally {
              finish()
            }
          })()
        }
        this.vault[method] = wrapped
        restores.push(() => {
          if (this.vault[method] === wrapped) this.vault[method] = original
        })
      }
      // A folder rename may also publish child events before its own event.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- invoked with apply and restored by identity
      const rename = this.vault.rename
      const beginRename = () => this.begin()
      const notifyRename = (path: string, to: string) => {
        for (const listener of this.listeners) listener(path, to)
      }
      const wrappedRename: typeof rename = async function (this: Vault, ...args) {
        if (!(args[0] instanceof TFolder)) return rename.apply(this, args)
        const finish = beginRename()
        try {
          notifyRename(args[0].path, args[1])
          return await rename.apply(this, args)
        } finally {
          finish()
        }
      }
      this.vault.rename = wrappedRename
      restores.push(() => {
        if (this.vault.rename === wrappedRename) this.vault.rename = rename
      })
      this.restore = () => restores.forEach((restore) => restore())
    }
    let stopped = false
    return () => {
      if (stopped) return
      stopped = true
      if (listener) this.listeners.delete(listener)
      if (--this.users === 0) {
        this.restore?.()
        this.restore = null
      }
    }
  }

  private begin(): () => void {
    this.revision++
    let resolve!: () => void
    const pending = new Promise<void>((finish) => {
      resolve = finish
    })
    this.pending.add(pending)
    return () => {
      this.pending.delete(pending)
      resolve()
    }
  }

  async settled(): Promise<void> {
    while (this.pending.size > 0) await Promise.all(this.pending)
  }
}

const byVault = new WeakMap<Vault, FolderMutations>()

export function folderMutations(vault: Vault): FolderMutations {
  let mutations = byVault.get(vault)
  if (mutations === undefined) {
    mutations = new FolderMutations(vault)
    byVault.set(vault, mutations)
  }
  return mutations
}

import type { App } from 'obsidian'
import { FolderScopeError } from './scopedFileSystem'
import { IGNORE_FILE } from './scope'

import {
  withinRoot,
  CONNECTION_HOST,
  CONNECTION_ROOT,
  CONNECTION_ROOT_SYMLINK,
  CONNECTION_PRIVATE,
  CONNECTION_JOURNAL_OWNER,
} from './connectionPaths'

/** Lifecycle checks and filesystem recovery select the same connection's durable intents. */
export function connectionJournalApp(app: App, owner: string): App {
  return new Proxy(app, {
    get(target, key) {
      if (key === CONNECTION_JOURNAL_OWNER) return owner
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/** Control inputs only: no directory discovery or filesystem mutation capability. */
export function connectionSetting(path: string): boolean {
  return path === IGNORE_FILE
}
const SETTINGS_READS = new Set(['exists', 'stat', 'read', 'readBinary', 'readBinaryPrefix'])

/** One adapter capability for startup, inspection and runtime; no vault-wide fallback. */
export function connectionAdapter(
  adapter: DataAdapter,
  rootInput: string | (() => string),
  privateRoot: string
): DataAdapter {
  adapter = guardedVaultAdapter(adapter)
  const currentRoot = () => (typeof rootInput === 'function' ? rootInput() : rootInput)
  const pathArgument = (value: unknown): string => {
    if (typeof value !== 'string')
      throw new FolderScopeError('Invalid connection path; sync stopped')
    return value
  }
  const metadata = new Set(['stat', 'exists', 'mkdir', 'access', 'lstat'])
  const singles = new Set([
    'list',
    'stat',
    'exists',
    'read',
    'readBinary',
    'readBinaryPrefix',
    'write',
    'writeBinary',
    'append',
    'appendBinary',
    'process',
    'mkdir',
    'remove',
    'rmdir',
    'trashSystem',
    'trashLocal',
    'getFullPath',
    'getResourcePath',
    'readFile',
    'writeFile',
    'appendFile',
    'unlink',
    'open',
    'access',
    'lstat',
    'realpath',
    'readlink',
    'queue',
    'reconcileInternalFile',
    'chmod',
    'utimes',
    'readdir',
  ])
  const pairs = new Set(['rename', 'copy', 'copyFile', 'link'])
  const ancestor = (path: string, target: string) => target.startsWith(path + '/')
  const check = (
    path: string,
    method: string,
    physicalRoot = currentRoot(),
    privateArea = privateRoot,
    native = false
  ) => {
    if (native) {
      path = path.replace(/\\/g, '/')
      physicalRoot = physicalRoot.replace(/\\/g, '/')
      privateArea = privateArea.replace(/\\/g, '/')
    } else if (path.includes('\\'))
      throw new FolderScopeError('Invalid connection path; sync stopped')
    const scaffolding = privateArea.includes('/connections/')
      ? privateArea.slice(0, privateArea.indexOf('/connections/'))
      : privateArea
    const parts = path.split('/')
    if (
      parts.some(
        (part, index) => part.trim() === '..' || part.trim() === '.' || (part === '' && index !== 0)
      )
    )
      throw new FolderScopeError('Invalid connection path; sync stopped')
    if (
      (!native && connectionSetting(path) && SETTINGS_READS.has(method)) ||
      withinRoot(path, physicalRoot) ||
      withinRoot(path, privateArea) ||
      (metadata.has(method) && withinRoot(path, scaffolding) && ancestor(path, privateArea))
    )
      return
    throw new FolderScopeError('The local path is outside this connection; sync stopped: ' + path)
  }
  const native = Reflect.get(adapter, 'fsPromises')
  const full = Reflect.get(adapter, 'getFullPath')
  // This bound probe grants no general access to ancestors of the connection root.
  const rootSymlink = async (): Promise<boolean> => {
    const root = currentRoot()
    check(root, 'lstat')
    return native?.lstat && typeof full === 'function'
      ? crossesSymlink(root, async (path) =>
          (await native.lstat(full.call(adapter, path))).isSymbolicLink()
        )
      : false
  }
  const nativePort =
    native && typeof full === 'function'
      ? new Proxy(native, {
          get(target, key) {
            const value = Reflect.get(target, key)
            if (typeof value !== 'function') return value
            return (...args: unknown[]) => {
              const method = String(key)
              if (!singles.has(method) && !pairs.has(method))
                throw new FolderScopeError('Native operation has no scope policy: ' + method)
              for (const path of args.slice(0, pairs.has(method) ? 2 : 1))
                check(
                  pathArgument(path),
                  method,
                  full.call(adapter, currentRoot()),
                  full.call(adapter, privateRoot),
                  true
                )
              return value.apply(target, args)
            }
          },
        })
      : undefined
  const overrides = new Map<PropertyKey, unknown>()
  return new Proxy(Object.create(null) as DataAdapter, {
    set(_target, key, value) {
      overrides.set(key, value)
      return true
    },
    defineProperty(_target, key, descriptor) {
      if ('value' in descriptor) overrides.set(key, descriptor.value)
      return true
    },
    get(_target, key) {
      if (key === CONNECTION_ROOT_SYMLINK) return rootSymlink
      if (key === Symbol.for('abele.sync.scoped-path-guard-v1'))
        return (path: string) => {
          check(path, 'stat')
          return assertVaultPath(adapter, path)
        }
      if (key === Symbol.for('abele.sync.scoped-adapter-v1')) return true
      if (key === 'fsPromises') return nativePort
      if (key === 'fs') return undefined
      const value = overrides.has(key) ? overrides.get(key) : Reflect.get(adapter, key)
      if (typeof value !== 'function') return value
      if (key === 'getName' || key === 'getBasePath' || key === 'queue') return value.bind(adapter)
      return (...args: unknown[]) => {
        const method = String(key)
        if (!singles.has(method) && !pairs.has(method))
          throw new FolderScopeError('Adapter operation has no scope policy: ' + method)
        const root = currentRoot()
        const path = pathArgument(args[0])
        // Existing ancestors are scaffolding, never discovery or content access.
        if (metadata.has(method) && ancestor(path, root)) {
          if (method === 'stat')
            return Promise.resolve({ type: 'folder', ctime: 0, mtime: 0, size: 0 })
          return Promise.resolve(method === 'exists' ? true : undefined)
        }
        for (const input of args.slice(0, pairs.has(method) ? 2 : 1))
          check(pathArgument(input), method)
        return value.apply(adapter, args)
      }
    },
  })
}

/** Inspections keep storage on the original host and receive only the scoped file port. */
export function connectionInspectionApp(
  app: App,
  adapter: DataAdapter,
  rootInput: string | (() => string),
  privateRoot?: string
): App {
  const currentRoot = () => (typeof rootInput === 'function' ? rootInput() : rootInput)
  const vault = new Proxy(app.vault, {
    get(target, key) {
      if (key === CONNECTION_HOST) return target
      if (key === 'adapter') return adapter
      const value = Reflect.get(target, key)
      if (key === 'getFiles')
        return () => target.getFiles().filter((file) => withinRoot(file.path, currentRoot()))
      if (key === 'getFileByPath' || key === 'getAbstractFileByPath')
        return (path: string) => (withinRoot(path, currentRoot()) ? value.call(target, path) : null)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return new Proxy(app, {
    get(target, key) {
      if (key === CONNECTION_ROOT) return currentRoot()
      if (key === CONNECTION_PRIVATE) return privateRoot
      if (key === 'vault') return vault
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

export function connectionFilePort(
  vault: Pick<Vault, 'adapter'>,
  options: { adapter?: DataAdapter }
): DataAdapter {
  return options.adapter ?? vaultDisk(vault)
}
