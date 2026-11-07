import { waitForSyncRead } from './syncTaskBudget'
import {
  boundedNativeOperations,
  boundedNativeRead,
  NativeReadTimeout,
  NATIVE_READ_DEADLINE_MS,
} from './nativeReadDeadline'
import { observePortableIo } from './portableIoDiagnostics'
import { directEntryDurability, entryEffect } from './directEntryDurability'
import { desktopFileIdentity } from './desktopFileIdentity'
import { inheritHostStorage } from './hostSyncStorage'
import { crossesSymlink } from './symlinkChain'
import {
  diagnosticOrigin,
  nativeDiagnostics,
  nativeSyscalls as recordNativeSyscalls,
  type NativeLstatSource,
} from './nativeDiagnostics'
import { TFile, TFolder } from 'obsidian'
import { Platform } from 'obsidian'
import { sha256 } from '@noble/hashes/sha2'
import type { Vault } from 'obsidian'
import type { DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-sdk/core'
import { PathCoordinator } from './pathCoordinator'
import { SyncTaskBudget } from './syncTaskBudget'
import { caseKey } from '@abele/sync-sdk/protocol'

/** Explicit test-pool maintenance calls this only after its identity/ownership proof. */
export async function eraseSyncPoolPrivateDirectory(vault: Vault): Promise<void> {
  if (await vault.adapter.exists('.abele-sync')) await vault.adapter.rmdir('.abele-sync', true)
}

const namePolicies = new WeakMap<DataAdapter, (path: string) => string>()

/** A name policy belongs to the vault volume, not the desktop operating system. */
export function vaultPathKey(vault: Vault): (path: string) => string {
  const adapter = vault.adapter
  const cached = namePolicies.get(adapter)
  if (cached) return cached
  let key: (path: string) => string
  if (Platform.isWin) {
    key = (path) =>
      path
        .normalize('NFC')
        .split('/')
        .map((part) => part.replace(/[. ]+$/, '').toLowerCase())
        .join('/')
  } else if (!Platform.isDesktopApp) {
    // iOS APFS distinguishes case, but canonical Unicode spellings alias. Android
    // app storage distinguishes both. No Node filesystem is loaded on mobile.
    key = Platform.isIosApp ? (path) => path.normalize('NFC') : (path) => path
  } else {
    const base = Reflect.get(adapter, 'getBasePath') as (() => string) | undefined
    if (!base)
      key = caseKey // Non-native hosts retain the core's conservative fallback.
    else {
      // Name policy is a synchronous volume probe. It does not open guarded
      // content handles and must not require the asynchronous I/O capability.
      const fs = desktopOriginalModule()
      // A private, exclusively allocated directory on this very volume avoids guessing
      // from OS defaults, pre-existing names, hard links or content identity.
      const directory = fs.mkdtempSync(
        base.call(adapter).replace(/[\\/]$/, '') + '/.abele-sync-policy-'
      )
      const sample = directory + '/Case-\u00e9'
      let created = false
      try {
        fs.writeFileSync(sample, '', { flag: 'wx' })
        created = true
        const foldsCase = fs.existsSync(directory + '/case-\u00e9')
        const foldsUnicode = fs.existsSync(directory + '/Case-e\u0301')
        key = (path) => {
          const normalized = foldsUnicode ? path.normalize('NFC') : path
          return foldsCase ? normalized.toLowerCase() : normalized
        }
        console.debug('[abele-sync] vault name policy', { foldsCase, foldsUnicode })
      } finally {
        try {
          if (created) fs.unlinkSync(sample)
        } finally {
          fs.rmdirSync(directory)
        }
      }
    }
  }
  namePolicies.set(adapter, key)
  return key
}

// Pure lexical values only: never retain a link/stat answer across operations.
const ancestorPrefixes = new Map<string, { values: readonly string[]; bytes: number }>()
let ancestorPrefixBytes = 0
function lexicalAncestors(path: string): readonly string[] {
  const cached = ancestorPrefixes.get(path)
  if (cached) {
    ancestorPrefixes.delete(path)
    ancestorPrefixes.set(path, cached)
    return cached.values
  }
  const parts = path.split('/').filter(Boolean)
  if (parts.some((part) => part === '..' || part === '.'))
    throw new EngineError('io', 'Invalid vault path')
  const values: string[] = []
  let prefix = '',
    bytes = path.length * 2
  for (const part of parts) {
    prefix = prefix ? prefix + '/' + part : part
    values.push(prefix)
    bytes += prefix.length * 2
  }
  if (bytes <= 256 * 1024) {
    while (ancestorPrefixes.size >= 512 || ancestorPrefixBytes + bytes > 256 * 1024) {
      const first = ancestorPrefixes.keys().next().value!
      ancestorPrefixBytes -= ancestorPrefixes.get(first).bytes
      ancestorPrefixes.delete(first)
    }
    ancestorPrefixes.set(path, { values, bytes })
    ancestorPrefixBytes += bytes
  }
  return values
}

/** Probe from the vault boundary: lstat of a leaf alone follows linked parents. */
export async function assertNoLinkedAncestors(
  path: string,
  isLink: (path: string) => Promise<boolean>
): Promise<void> {
  for (const ancestor of lexicalAncestors(path))
    if (await isLink(ancestor))
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
    inventory = access.pin && metadataInventories.get(access.pin),
    pinned = await (inventory?.root ?? access.pin?.verify())
  if (!access.full || !access.native?.lstat) return false
  try {
    const cached = inventory?.directories.get(path)
    const stat = (
      cached !== undefined
        ? await cached
        : await access.native.lstat(pinned ? physicalPath(pinned.path, path) : access.full(path))
    ) as import('node:fs').Stats | null
    if (stat?.isDirectory?.() && cached === undefined)
      inventory?.directories.set(path, Promise.resolve(stat))
    return stat?.isSymbolicLink() ?? false
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false
    throw error
  }
}

/** The link check for an advisory metadata read whose leaf is not followed, such as a file
 * identity's lstat. Inside a metadata inventory it reuses that inventory's root proof and
 * directory stats, which vault events retire, instead of a root realpath and an lstat per
 * ancestor on every call. Effects and content opens keep {@link assertVaultPath}. */
export async function assertVaultMetadataPath(
  adapter: DataAdapter & LinkAdapter,
  path: string
): Promise<void> {
  // A connection-scoped adapter authorizes first; its own guard checks the chain.
  if (Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1')))
    return Reflect.get(adapter, Symbol.for('abele.sync.scoped-metadata-path-guard-v1'))(path)
  const pin = rootAccess(adapter).pin
  if (!pin || !metadataInventories.has(pin)) return assertVaultPath(adapter, path)
  // The caller reads the leaf itself without following it, so only its folders are checked.
  const ancestors = lexicalAncestors(path)
  const leaf = ancestors[ancestors.length - 1] ?? ''
  await assertNoLinkedAncestors(path, async (component) =>
    component === leaf ? false : vaultPathIsLink(adapter, component)
  )
}

/** Candidate leaves are not followed; their ancestry is checked afresh, not from inventory. */
async function assertVaultCandidatePath(
  adapter: DataAdapter & LinkAdapter,
  path: string
): Promise<void> {
  if (Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1')))
    return Reflect.get(adapter, Symbol.for('abele.sync.scoped-candidate-path-guard-v1'))(path)
  const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')))
  await assertVaultPath(adapter, parent)
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

type RootAccess = {
  native: LinkAdapter['fsPromises']
  nativeOrigin: LinkAdapter['fsPromises']
  full: LinkAdapter['getFullPath']
  pin: RootPin | undefined
}
const rootAccessPorts = new WeakMap<
  object,
  {
    resolver: LinkAdapter['getFullPath']
    logical: string | undefined
    access: RootAccess
  }
>()
function rootAccess(adapter: DataAdapter & LinkAdapter): RootAccess {
  const origin = (adapterOrigins.get(adapter) ?? adapter) as DataAdapter & LinkAdapter
  const port = origin.fsPromises && diagnosticOrigin(origin.fsPromises)
  const native = (port &&
    originalNativeLeaf(nativeOrigins.get(port) ?? port)) as LinkAdapter['fsPromises']
  const resolver = origin.getFullPath
  // Re-resolve the logical root and method identity. Only callable scaffolding
  // is reused; callers still verify physical root and ancestor identities.
  const logical = resolver?.call(origin, '')
  const pin = native && logical !== undefined ? pinnedRoot(native, logical) : undefined
  const cached = rootAccessPorts.get(origin)
  if (
    cached &&
    cached.resolver === resolver &&
    cached.logical === logical &&
    cached.access.nativeOrigin === native &&
    cached.access.pin === pin
  )
    return cached.access
  const full = resolver?.bind(origin)
  const access: RootAccess = {
    native:
      native && boundedNativeOperations(nativeSyscalls(native, 'path-validation'), logical ?? ''),
    nativeOrigin: native,
    full,
    // Keep ownership/cache identity on the original port, not the diagnostic wrapper.
    pin,
  }
  rootAccessPorts.set(origin, { resolver, logical, access })
  return access
}
function physicalPath(root: string, path: string): string {
  return root.replace(/\/+$/, '') + (path ? '/' + path.replace(/^\//, '') : '')
}

/** Native calls used by sync must declare which arguments name vault paths. */
export const nativePathMethods = {
  mkdtempSync: 1,
  writeFileSync: 1,
  existsSync: 1,
  unlinkSync: 1,
  rmdirSync: 1,
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
const checkedNativePort = Symbol('checked-native-port')

/** Identity evidence belongs at the raw-module boundary, never in diagnostics. */
function nativeSource(host: object): NativeLstatSource {
  try {
    if (typeof window !== 'undefined') {
      if (window.require('fs').promises === host) return 'host-fs.promises'
      if (window.require('original-fs').promises === host) return 'host-original-fs.promises'
    }
  } catch {
    // Portable and synthetic ports have no desktop module.
  }
  return 'adapter'
}
function nativeSyscalls<T extends object>(host: T, site: string): T {
  return recordNativeSyscalls(host, site, nativeSource)
}

/** Substitute only an identified ambient module; decorated policy ports keep their checks. */
function originalNativeLeaf<T extends object>(port: T): T {
  if (typeof window === 'undefined' || typeof window.require !== 'function') return port
  const original = window.require('original-fs').promises
  const patched = window.require('fs').promises
  return (port === patched ? original : port) as T
}
const adapters = new WeakMap<DataAdapter, DataAdapter>()
const mutationRebuilders = new WeakMap<
  DataAdapter,
  (check: () => void, privateRoots: readonly string[]) => DataAdapter
>()

/** Check before host submission; a foreign callable's late acknowledgement requires repair. */
function issueMutation<T>(check: () => void, invoke: () => T, method: string): T {
  check()
  const result = invoke()
  if (result && typeof Reflect.get(Object(result), 'then') === 'function') {
    const settled = () => {
      try {
        check()
      } catch (error) {
        if (Reflect.get(Object(error), 'leaseExpired') === true)
          console.debug(
            '[abele-sync] mutation outlived checked lease; possible slow wrapper',
            method
          )
      }
    }
    // Preserve the underlying acknowledgement (including failures) for effect
    // tracking and repair. Expiry cannot cancel an already captured callable.
    return Promise.resolve(result).then(
      (answer) => {
        settled()
        return answer
      },
      (error: unknown) => {
        settled()
        throw error
      }
    ) as T
  }
  return result
}

/** Rebuild validation above a checked leaf; never share an ambient lease with user saves. */
export function mutationCheckedAdapter(
  adapter: DataAdapter,
  check: () => void,
  privateRoots: readonly string[] = []
): DataAdapter {
  const rebuild = mutationRebuilders.get(adapter)
  if (rebuild) return rebuild(check, privateRoots)
  const supplied = Reflect.get(adapter, 'fsPromises')
  const native =
    supplied &&
    boundedNativeOperations(
      originalNativeLeaf(supplied),
      Reflect.get(adapter, 'getFullPath')?.call(adapter, '') ?? ''
    )
  let writableMask: number | undefined
  const writableOpen = (flags: unknown) => {
    if (typeof flags !== 'number') return typeof flags === 'string' && /[wa+]/.test(flags)
    if (writableMask === undefined) {
      const constants = desktopNodeFs().constants
      writableMask = constants.O_WRONLY | constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC
    }
    return !!(flags & writableMask)
  }
  const full = Reflect.get(adapter, 'getFullPath')
  const roots = new Set<string>(
    typeof full === 'function'
      ? [full.call(adapter, '').replace(/\\/g, '/').replace(/\/+$/, '')]
      : []
  )
  const isPrivate = (value: unknown, nativePath = false) => {
    if (typeof value !== 'string') return false
    let path = value.replace(/\\/g, '/')
    if (path.split('/').some((part) => part === '..' || part === '.')) return false
    if (nativePath) {
      const root = [...roots].find((root) => path.startsWith(root + '/'))
      if (root === undefined) return false
      path = path.slice(root.length + 1)
    }
    return privateRoots.some((root) => path === root || path.startsWith(root + '/'))
  }
  const authorize = (method: string, args: unknown[], nativePath = false) => {
    if (method === 'mkdir' || method === 'sync' || method === 'datasync') return
    const sourcePrivate = isPrivate(args[0], nativePath)
    const targetPrivate = isPrivate(args[1], nativePath)
    if (method === 'rename') {
      // Capture to private evidence, or mobile no-overwrite publication from it.
      if (targetPrivate || (!nativePath && sourcePrivate)) return
    } else if (method === 'link') {
      // Native link is exclusive even when the public destination was recreated.
      if (sourcePrivate) return
    } else if (sourcePrivate && (!/^(copy.*|symlink)$/.test(method) || targetPrivate)) return
    throw Object.assign(
      new EngineError('conflict', 'Raw public mutation refused by checked port'),
      { rawPublicMutation: true }
    )
  }
  const methods = new Map<PropertyKey, unknown>()
  const handles = (handle: object, path: unknown) =>
    new Proxy(handle, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        return /^(?:write.*|append.*|truncate|utimes|chmod|chown|sync|datasync)$/.test(String(key))
          ? (...args: unknown[]) =>
              issueMutation(
                check,
                () => {
                  authorize(String(key), [path], true)
                  return value.apply(target, args)
                },
                String(key)
              )
          : value.bind(target)
      },
    })
  const checkedNative =
    native &&
    new Proxy(native, {
      get(target, key) {
        if (key === checkedNativePort) return true
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        if (key === 'realpath')
          return async (...args: unknown[]) => {
            const result = await value.apply(target, args)
            if (
              typeof args[0] === 'string' &&
              roots.has(args[0].replace(/\\/g, '/').replace(/\/+$/, '')) &&
              typeof result === 'string'
            )
              roots.add(result.replace(/\\/g, '/').replace(/\/+$/, ''))
            return result
          }
        if (key === 'open')
          return async (...args: unknown[]) => {
            // Numeric opens include no-follow flags; even a read handle can flush or mutate later.
            const writable = writableOpen(args[1])
            const handle = await (writable
              ? issueMutation(
                  check,
                  () => {
                    authorize('open', args, true)
                    return value.apply(target, args)
                  },
                  'open'
                )
              : value.apply(target, args))
            return handles(handle, args[0])
          }
        return /^(?:write.*|append.*|mkdir|rename|copy.*|unlink|rm|rmdir|link|symlink|truncate|utimes|chmod|chown)$/.test(
          String(key)
        )
          ? (...args: unknown[]) =>
              issueMutation(
                check,
                () => {
                  authorize(String(key), args, true)
                  return value.apply(target, args)
                },
                String(key)
              )
          : value.bind(target)
      },
    })
  return new Proxy(adapter, {
    get(target, key) {
      if (key === 'fsPromises') return checkedNative
      if (methods.has(key)) return methods.get(key)
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      const wrapped = mutator.test(String(key))
        ? (...args: unknown[]) =>
            issueMutation(
              check,
              () => {
                authorize(String(key), args)
                return engineAdapterMethod(target, key, value).apply(
                  adapterEngineReceiver(target),
                  args
                )
              },
              String(key)
            )
        : value.bind(target)
      methods.set(key, wrapped)
      return wrapped
    },
  })
}

/** Share the boundary with inspection, streaming and attachment effects. */
export function guardedVaultAdapter(adapter: DataAdapter): DataAdapter {
  if (
    Reflect.get(adapter, GUARDED) ||
    Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1'))
  )
    return adapter
  const cached = adapters.get(adapter)
  if (cached) return cached
  const suppliedNative = (adapter as DataAdapter & LinkAdapter).fsPromises
  const full = (adapter as DataAdapter & LinkAdapter).getFullPath?.bind(adapter)
  const leafNative = suppliedNative && originalNativeLeaf(suppliedNative)
  const native = leafNative && boundedNativeOperations(leafNative, full?.('') ?? '')
  if (native && leafNative) nativeOrigins.set(native, nativeOrigins.get(leafNative) ?? leafNative)
  if (!full || !native) {
    const proxy = mobileGuard(adapter)
    mutationRebuilders.set(proxy, (check, privateRoots) =>
      guardedVaultAdapter(mutationCheckedAdapter(adapter, check, privateRoots))
    )
    adapterOrigins.set(proxy, adapterOrigins.get(adapter) ?? adapter)
    adapters.set(adapter, proxy)
    return proxy
  }
  const durability = directEntryDurability(adapter)
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
          const rawNative = boundedNativeOperations(nativeOrigins.get(native) ?? native, full(''))
          const localPaths = args
            .slice(0, count)
            .map((path) =>
              pathArgument(path).replace(/\\/g, '/').slice(root.length).replace(/^\//, '')
            )
          const issue = (work: () => Promise<unknown>) =>
            ['mkdir', 'unlink', 'rmdir', 'rename', 'link'].includes(String(key))
              ? entryEffect(durability, key === 'link' ? localPaths.slice(1) : localPaths, work)
              : work()
          if (virtual) {
            const answer = await issue(() => Reflect.get(rawNative, key).apply(rawNative, physical))
            if (key === 'open' && typeof args[1] === 'string' && /[wa]/.test(args[1]))
              durability.changed(localPaths[0])
            return answer
          }
          if (key === 'open')
            return openNoFollow(
              rawNative,
              pathArgument(physical[0]),
              physical[1],
              pinned?.path ?? root,
              pinned,
              () => durability.changed(localPaths[0])
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
          const invoke = () => issue(() => Reflect.get(rawNative, key).apply(rawNative, physical))
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
        if (Reflect.get(target, key) !== suppliedNative) {
          adapters.delete(target)
          return Reflect.get(guardedVaultAdapter(target), key)
        }
        return guardedNative
      }
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      if (!paths[String(key)]) return value.bind(target)
      return async (...args: unknown[]) => {
        if (rootPin && (key === 'stat' || key === 'exists')) {
          // Metadata has no mutation effects. Check its complete path inside the
          // host queue once, instead of repeating the outer and inner preflights.
          const work = async () => {
            const stat = await nativeMetadata(
              nativeOrigins.get(native) ?? native,
              rootPin,
              pathArgument(args[0])
            )
            return key === 'exists' ? stat !== null : stat
          }
          const queue = Reflect.get(target, 'queue')
          return typeof queue === 'function' ? queue.call(target, work) : work()
        }
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
        const invoke = () =>
          engineAdapterMethod(target, key, value).apply(adapterEngineReceiver(target), args)
        return ['write', 'writeBinary', 'mkdir', 'rename', 'copy', 'remove', 'rmdir'].includes(
          String(key)
        )
          ? entryEffect(
              durability,
              args.slice(key === 'copy' ? 1 : 0, paths[String(key)]).map(pathArgument),
              invoke
            )
          : invoke()
      }
    },
  })
  mutationRebuilders.set(guarded, (check, privateRoots) =>
    guardedVaultAdapter(mutationCheckedAdapter(adapter, check, privateRoots))
  )
  adapterOrigins.set(guarded, adapterOrigins.get(adapter) ?? adapter)
  adapters.set(adapter, guarded)
  adapters.set(guarded, guarded)
  return guarded
}

/** Create one component at a time, never recursive mkdir through an unchecked parent. */
export async function ensureVaultDirectory(adapter: DataAdapter, path: string): Promise<void> {
  await assertVaultPath(adapter, path)
  const durability = directEntryDurability(adapter)
  if (durability.directoryKnown(path)) return
  if (Reflect.get(adapter, Symbol.for('abele.sync.scoped-adapter-v1'))) {
    const parts = path.split('/')
    for (let n = 1; n <= parts.length; n++) {
      const part = parts.slice(0, n).join('/')
      if (part && !(await adapter.exists(part))) await adapter.mkdir(part)
      if (part) durability.rememberDirectory(part)
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
    if (durability.directoryKnown(component)) continue
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
            await entryEffect(directEntryDurability(adapter), [component], () =>
              direct.mkdir(
                pinned ? physicalPath(pinned.path, component) : raw.getFullPath(component)
              )
            )
          else await adapter.mkdir(component)
        } catch (occupied) {
          if ((occupied as { code?: string }).code !== 'EEXIST') throw occupied
        }
        await check()
      }
    } else if (!(await adapter.exists(component))) await adapter.mkdir(component)
    durability.rememberDirectory(component)
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
  if (access.nativeOrigin && access.full) rootPins.get(access.nativeOrigin)?.delete(access.full(''))
  adapters.delete(origin)
}

const measuredDesktopModules = new WeakMap<object, typeof import('node:fs')>()

/** Use the renderer's real Node module; a dynamic import becomes a browser shim. */
function desktopOriginalModule(): typeof import('node:fs') {
  const unavailable = (missing: string[]) =>
    new EngineError(
      'io',
      `Native no-follow opens are unavailable (accessor: window.require('original-fs'); missing: ${missing.join(', ')})`
    )
  // isDesktop/isMobile describe the UI and change under desktop phone emulation.
  if (!Platform.isDesktopApp) throw unavailable(['desktop runtime'])
  if (typeof window === 'undefined' || typeof window.require !== 'function')
    throw unavailable(['window.require'])
  let module: typeof import('node:fs')
  try {
    module = window.require('original-fs') as typeof import('node:fs')
  } catch {
    throw unavailable(['original-fs module (require failed)'])
  }
  return module
}

export function desktopNodeFs(): typeof import('node:fs') {
  const module = desktopOriginalModule()
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
  if (missing.length)
    throw new EngineError(
      'io',
      `Native no-follow opens are unavailable (accessor: window.require('original-fs'); missing: ${missing.join(', ')})`
    )
  let measured = measuredDesktopModules.get(module)
  if (!measured) {
    measured = new Proxy(module, {
      get(target, key) {
        return key === 'promises'
          ? nativeSyscalls(target.promises, 'no-follow-open')
          : Reflect.get(target, key)
      },
    })
    measuredDesktopModules.set(module, measured)
  }
  return measured
}

async function openNoFollow(
  raw: object,
  path: string,
  flags: unknown,
  root: string,
  expectedRoot?: RootIdentity,
  created?: () => void
) {
  const desktop = desktopNodeFs()
  // A checked port carries the lease down to the native leaf. Ordinary adapters
  // still obtain native opens from the desktop module, never an adapter override.
  const fs = boundedNativeOperations(
    (Reflect.get(raw, checkedNativePort)
      ? raw
      : desktop.promises) as typeof import('node:fs/promises'),
    expectedRoot?.scope ?? root
  )
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
  const opening = (mode & ~constants.O_TRUNC) | constants.O_NOFOLLOW
  let handle: Awaited<ReturnType<typeof fs.open>>
  if (mode & constants.O_CREAT) {
    try {
      handle = await fs.open(path, opening | constants.O_EXCL)
      created?.()
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') {
        created?.()
        throw error
      }
      if (mode & constants.O_EXCL) throw error
      handle = await fs.open(path, opening & ~constants.O_CREAT)
    }
  } else handle = await fs.open(path, opening)
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
  lstat(
    path: string,
    options?: { bigint: boolean }
  ): Promise<{
    isSymbolicLink(): boolean
    isFile?(): boolean
    isDirectory?(): boolean
    birthtimeMs?: number
    dev?: unknown
    ino?: unknown
    birthtimeNs?: unknown
    ctimeNs?: unknown
    mtimeNs?: unknown
    size?: unknown
  }>
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
  pathCandidateStat?(
    path: string
  ): Promise<{ kind: 'file' | 'directory' | 'symlink' | 'other'; birth?: number } | null>
  fileIdentity?(path: string): Promise<string | null>
  fileContentRevision?(path: string): Promise<string | null>
  restoreDirectoryExclusive?(from: string, to: string): Promise<void>
  sameObject?(a: string, b: string): Promise<boolean>
  syncPath?(path: string, parentsOnly?: boolean): Promise<void>
  /** Data barrier; callers must separately flush namespace changes before ledger commit. */
  syncFile?(path: string): Promise<void>
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
  assertEffect: (paths?: readonly string[], mutation?: boolean) => void = () => {},
  recoveryRoot?: string,
  diagnostic?: Parameters<typeof nativeDiagnostics>[1]
): NativeFs | null {
  adapter = guardedVaultAdapter(adapter)
  const raw = adapter as unknown as {
    fsPromises?: Partial<NodeFsPromises>
    getFullPath?: (path: string) => string
    reconcileInternalFile?: (path: string) => Promise<void>
    queue?: <T>(operation: () => Promise<T>) => Promise<T>
  }
  const nativeSource = raw.fsPromises
  const fsp =
      nativeSource && diagnostic ? nativeDiagnostics(nativeSource, diagnostic) : nativeSource,
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
      const capture = async () => {
        await assertVaultPath(adapter, from)
        await assertVaultPath(adapter, to)
        assertEffect([from, to])
        await rename(at(from), at(to))
      }
      if (raw.queue) await raw.queue.call(adapter, capture)
      else await capture()
      await reconcile(from, to)
    },
    async rmdirEmpty(path) {
      await assertVaultPath(adapter, path)
      assertEffect([path])
      await rmdir(at(path))
      await reconcile(path)
    },
  }
  if (fsp.lstat)
    native.pathCandidateStat = async (path) => {
      await assertVaultCandidatePath(adapter, path)
      assertEffect([path], false)
      try {
        const stat = await fsp.lstat(at(path))
        assertEffect([path], false)
        return {
          kind: stat.isSymbolicLink()
            ? 'symlink'
            : stat.isDirectory?.()
              ? 'directory'
              : stat.isFile?.()
                ? 'file'
                : 'other',
          birth: stat.birthtimeMs,
        }
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes((error as { code?: string }).code ?? '')) return null
        throw error
      }
    }
  if (fsp.lstat)
    native.fileIdentity = async (path) => {
      await assertVaultMetadataPath(adapter, path)
      assertEffect([path], false)
      try {
        const stat = await fsp.lstat(at(path), { bigint: true })
        assertEffect([path], false)
        return stat.isFile?.() ? desktopFileIdentity(stat) : null
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null
        throw error
      }
    }
  if (fsp.lstat)
    native.fileContentRevision = async (path) => {
      await assertVaultMetadataPath(adapter, path)
      assertEffect([path], false)
      try {
        const stat = await fsp.lstat(at(path), { bigint: true })
        assertEffect([path], false)
        const identity = desktopFileIdentity(stat)
        return stat.isFile?.() &&
          identity &&
          typeof stat.ctimeNs === 'bigint' &&
          typeof stat.mtimeNs === 'bigint' &&
          typeof stat.size === 'bigint'
          ? `${identity}:${stat.ctimeNs}:${stat.mtimeNs}:${stat.size}`
          : null
      } catch (error) {
        if ((error as { code?: string }).code === 'ENOENT') return null
        throw error
      }
    }
  if (fsp.stat)
    native.sameObject = async (a, b) => {
      await assertVaultPath(adapter, a)
      await assertVaultPath(adapter, b)
      const [left, right] = await Promise.all([fsp.stat(at(a)), fsp.stat(at(b))])
      return left.dev === right.dev && left.ino === right.ino
    }
  if (fsp.open) {
    native.syncFile = async (path) => {
      await assertVaultPath(adapter, path)
      assertEffect([path], false)
      const handle = await fsp.open(at(path), 'r')
      try {
        if (!handle.sync) throw new EngineError('io', 'native durability is unavailable')
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    native.syncPath = async (path, parentsOnly = false) => {
      const fs = diagnostic
        ? nativeDiagnostics(nativeSource, (operation, startedAt, outcome) =>
            diagnostic(operation, startedAt, outcome, [path])
          )
        : fsp
      const flush = async (part: string) => {
        await assertVaultPath(adapter, part)
        assertEffect([part], false)
        const handle = await fs.open(at(part), 'r')
        try {
          if (!handle.sync) throw new EngineError('io', 'native durability is unavailable')
          await handle.sync()
        } finally {
          await handle.close()
        }
      }
      if (!parentsOnly) await flush(path)
      await directEntryDurability(adapter).flushAncestors(path, flush)
    }
  }
  const scopedSync = Reflect.get(adapter, Symbol.for('abele.sync.scoped-sync-path-v1'))
  if (typeof scopedSync === 'function')
    native.syncPath = async (path, parentsOnly = false) => {
      assertEffect([path], false)
      await scopedSync(path, parentsOnly, diagnostic)
    }
  if (fsp.mkdir && fsp.stat && fsp.link && fsp.unlink) {
    const hex = (value: string) =>
      Array.from(sha256(new TextEncoder().encode(value)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('')
    const archiveFs = (
      recoveryRoot ? fsp : (nativeOrigins.get(fsp) ?? fsp)
    ) as Partial<NodeFsPromises>
    const checkArchive = async (root: string, folder: string) => {
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
      const root = recoveryRoot ? at(recoveryRoot) : at('').replace(/\\/g, '/').replace(/\/+$/, '')
      const folder = recoveryRoot
        ? root
        : root.slice(0, root.lastIndexOf('/')) + '/.abele-sync-recovery/' + hex(root)
      const pinned = recoveryRoot ? undefined : await rootAccess(adapter).pin?.verify()
      const source = pinned ? physicalPath(pinned.path, path) : at(path),
        destination = folder + '/' + hex(source) + '.old'
      await checkArchive(root, folder)
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
  native.restoreDirectoryExclusive = async (from, to) => {
    await assertVaultPath(adapter, from)
    await assertVaultPath(adapter, to)
    assertEffect([from, to])
    // No mkdir reservation: a crash must not leave an indistinguishable empty
    // occupant. Native directory rename refuses files and populated directories.
    // A concurrently created empty directory may be replaced, but no notes are lost.
    await rename(at(from), at(to))
    await reconcile(from, to)
  }
  if (typeof fsp.link === 'function') {
    const link = fsp.link.bind(fsp)
    native.installExclusive = async (from, to) => {
      const publish = async () => {
        await assertVaultPath(adapter, from)
        await assertVaultPath(adapter, to)
        assertEffect([from, to])
        await link(at(from), at(to))
      }
      if (raw.queue) await raw.queue.call(adapter, publish)
      else await publish()
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
  const fsp = disk.fsPromises && nativeDiagnostics(disk.fsPromises, () => {})
  return {
    available: typeof disk.fsPromises === 'object',
    fullPath: disk.getFullPath?.bind(disk),
    open: fsp?.open?.bind(fsp),
    utimes: fsp?.utimes?.bind(fsp),
  }
}

/** Retirement needs modification-of-metadata time, rather than the vault's creation time. */
export async function retainedFileStat(adapter: DataAdapter, path: string) {
  const disk = guardedVaultAdapter(adapter) as DataAdapter & {
    getFullPath?(path: string): string
    fsPromises?: { lstat(path: string): Promise<import('node:fs').Stats> }
  }
  await assertVaultPath(disk, path)
  if (!disk.getFullPath || !disk.fsPromises?.lstat) return disk.stat(path)
  try {
    const info = await disk.fsPromises.lstat(disk.getFullPath(path))
    if (info.isSymbolicLink()) throw new EngineError('io', 'Retained path is a symbolic link')
    return {
      type: info.isDirectory() ? 'folder' : 'file',
      size: info.size,
      mtime: info.mtimeMs,
      ctime: info.ctimeMs,
    }
  } catch (error) {
    if ((error as { code?: string })?.code === 'ENOENT') return null
    throw error
  }
}

export function guardedVaultPort<T extends object>(port: T): T {
  return guardedVaultAdapter(port as unknown as DataAdapter) as unknown as T
}

const REVISIONS = Symbol.for('abele.sync.adapter-config-revisions-v1')
const CONFIG_OBSERVERS = Symbol.for('abele.sync.adapter-config-observers-v1')
type ConfigObserver = (paths: readonly string[], directory: boolean) => void

/** Scoped observation only; the caller removes its callback at the end of the pass. */
export function observeAdapterConfig(
  adapter: DataAdapter,
  root: string,
  observe: ConfigObserver
): () => void {
  adapter = adapterOrigins.get(adapter) ?? adapter
  adapterConfigRevision(adapter, root)
  const shared = adapter as DataAdapter & { [CONFIG_OBSERVERS]?: Set<ConfigObserver> }
  if (!shared[CONFIG_OBSERVERS])
    Object.defineProperty(shared, CONFIG_OBSERVERS, { value: new Set<ConfigObserver>() })
  const callback: ConfigObserver = (paths, directory) => {
    const relevant = paths.filter(
      (path) =>
        root === '' || path === root || path.startsWith(root + '/') || root.startsWith(path + '/')
    )
    if (relevant.length) observe(relevant, directory)
  }
  const observers = shared[CONFIG_OBSERVERS]
  observers.add(callback)
  return () => {
    observers.delete(callback)
  }
}

/** Config writes have no vault-index event. Track adapter mutations without stat/list calls.
 * One wrapper per adapter, shared by all connections. Counters retain no runtime;
 * pass observers are explicitly released by their callers.
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
                (root === '' ||
                  path === root ||
                  path.startsWith(root + '/') ||
                  root.startsWith(path + '/'))
            )
          )
            held.set(root, revision + 1)
        }
        const observers = Reflect.get(adapter, CONFIG_OBSERVERS) as Set<ConfigObserver> | undefined
        for (const observe of observers ?? [])
          observe(
            paths.filter((path): path is string => typeof path === 'string'),
            key === 'mkdir' || key === 'rmdir' || key === 'rename'
          )
      }
      const wrap = (method: Method) =>
        function (this: DataAdapter, ...args: unknown[]) {
          const paths = args.slice(0, key === 'rename' || key === 'copy' ? 2 : 1)
          change(paths)
          try {
            return Promise.resolve(method.apply(this, args)).finally(() => change(paths))
          } catch (error) {
            change(paths)
            throw error
          }
        }
      const wrapped = wrap(original as Method)
      // Preserve the receiver-scoped entry when instrumentation precedes the path gate.
      if (Reflect.get(original, UNGATED_ADAPTER))
        Reflect.set(wrapped, UNGATED_ADAPTER, wrap(ungatedAdapterMethod(original as Method)))
      Object.defineProperty(adapter, key, { configurable: true, writable: true, value: wrapped })
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
        (path) =>
          root === '' || path === root || path.startsWith(root + '/') || root.startsWith(path + '/')
      )
    )
      roots.set(root, revision + 1)
}
interface RootIdentity {
  path: string
  scope?: string
  dev: number
  ino: number
}
interface RootPin {
  scope: string
  verify(): Promise<RootIdentity>
  stop(error: Error): void
}
interface MetadataInventory {
  root: Promise<RootIdentity>
  directories: Map<string, Promise<import('node:fs').Stats | null>>
  users: number
}
const metadataInventories = new WeakMap<RootPin, MetadataInventory>()
/** Advisory inventory metadata only. Effects and content opens keep fresh path checks. */
export async function withMetadataInventory<T>(
  vault: Pick<Vault, 'adapter'>,
  work: () => Promise<T>
): Promise<T> {
  const pin = rootAccess(vault.adapter).pin
  if (!pin) return work()
  let inventory = metadataInventories.get(pin)
  if (!inventory) {
    inventory = { root: pin.verify(), directories: new Map(), users: 0 }
    metadataInventories.set(pin, inventory)
  }
  inventory.users++
  try {
    await inventory.root
    return await work()
  } finally {
    if (--inventory.users === 0) metadataInventories.delete(pin)
    await pin.verify()
  }
}
export function invalidateMetadataInventory(vault: Pick<Vault, 'adapter'>): void {
  const pin = rootAccess(vault.adapter).pin
  if (pin) metadataInventories.get(pin)?.directories.clear()
}
/** Revalidate advisory directory proofs before namespace effects; never a byte receipt. */
export async function verifyMetadataInventory(vault: Pick<Vault, 'adapter'>): Promise<void> {
  const access = rootAccess(vault.adapter),
    pin = access.pin
  if (!pin || !access.native?.lstat) return
  const root = await pin.verify(),
    inventory = metadataInventories.get(pin)
  const rows = [...(inventory?.directories ?? [])]
  const budget = new SyncTaskBudget()
  for (let offset = 0; offset < rows.length; offset += 32) {
    await Promise.all(
      rows.slice(offset, offset + 32).map(async ([path, prior]) => {
        const before = await prior
        let after: import('node:fs').Stats | null = null
        try {
          after = await (access.native as Pick<typeof import('node:fs/promises'), 'lstat'>).lstat(
            physicalPath(root.path, path)
          )
        } catch (error) {
          if ((error as { code?: string }).code !== 'ENOENT') throw error
        }
        // A namespace change can retire an advisory ancestor during the pass.
        // The vault pin is unchanged; later effects still check their own paths.
        if (after === null) {
          inventory?.directories.delete(path)
          return
        }
        if (before === null && after.isDirectory() && !after.isSymbolicLink()) {
          inventory?.directories.set(path, Promise.resolve(after))
          return
        }
        if (before?.dev !== after.dev || before?.ino !== after.ino || after.isSymbolicLink()) {
          const error = new VaultRootChangedError()
          error.cause = new Error(`Advisory ancestor identity changed: ${path}`)
          pin.stop(error)
          throw error
        }
      })
    )
    await budget.account(32 * 4096)
  }
  await pin.verify()
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
  const io = boundedNativeOperations(
    nativeSyscalls(originalNativeLeaf(native) as typeof import('node:fs/promises'), 'root-pin'),
    logical
  )
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
    return {
      path: path.replace(/\\/g, '/').replace(/\/+$/, ''),
      scope: logical,
      dev: stat.dev,
      ino: stat.ino,
    }
  }
  let initial: Promise<RootIdentity> | undefined
  const first = () => {
    if (initial === undefined) {
      const work = capture()
      initial = work
      void work.catch((error) => {
        if (error instanceof NativeReadTimeout && initial === work) initial = undefined
      })
    }
    return initial
  }
  void first()
  let stopped: Error | undefined
  const pin = {
    scope: logical,
    stop: (error: Error) => {
      stopped = error
    },
    verify: async () => {
      if (stopped) throw stopped
      try {
        const pinned = await first(),
          current = await capture()
        if (
          pinned.path !== current.path ||
          pinned.dev !== current.dev ||
          pinned.ino !== current.ino
        )
          throw new VaultRootChangedError()
        return pinned
      } catch (error) {
        if (error instanceof NativeReadTimeout) throw error
        throw new VaultRootChangedError()
      }
    },
  }
  roots.set(logical, pin)
  return pin
}
/** Fresh read-only metadata: one no-link walk, with the root pinned at both ends. */
async function nativeMetadata(native: object, pin: RootPin, path: string) {
  const io = boundedNativeOperations(
    nativeSyscalls(originalNativeLeaf(native), 'metadata-leaf'),
    pin.scope
  ) as typeof import('node:fs/promises')
  const inventory = metadataInventories.get(pin)
  const root = await (inventory?.root ?? pin.verify())
  let leaf: import('node:fs').Stats | null = null
  await assertNoLinkedAncestors(path, async (part) => {
    try {
      let pending = part !== path ? inventory?.directories.get(part) : undefined
      if (pending === undefined) {
        pending = io.lstat(physicalPath(root.path, part)).catch((error): null => {
          if ((error as { code?: string }).code === 'ENOENT') return null
          throw error
        })
        if (part !== path) inventory?.directories.set(part, pending)
      }
      leaf = await pending
      if (!leaf) return false
      return leaf.isSymbolicLink()
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error
      leaf = null
      return false
    }
  })
  if (!path.split('/').filter(Boolean).length) leaf = await io.lstat(root.path)
  if (!inventory) await pin.verify()
  const stat = leaf
  return stat === null
    ? null
    : {
        type: stat.isDirectory() ? ('folder' as const) : ('file' as const),
        ctime: stat.birthtimeMs,
        mtime: stat.mtimeMs,
        size: stat.size,
      }
}

async function desktopOperation(
  key: string,
  args: unknown[],
  adapter: DataAdapter,
  native: object,
  full: (path: string) => string,
  pin: RootPin
) {
  const io = boundedNativeOperations(
    nativeSyscalls(originalNativeLeaf(native), 'desktop-operation'),
    pin.scope
  ) as typeof import('node:fs/promises')
  const durability = directEntryDurability(adapter)
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
    entryEffect(durability, paths, () =>
      guardedNativeMutation(io, root.path, paths.map(at), operation, (error) => pin.stop(error))
    )
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
      root,
      () => durability.changed(local)
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
        const invoke = () =>
          observePortableIo(String(key), pathArgument(args[0]), () =>
            engineAdapterMethod(target, key, value).apply(adapterEngineReceiver(target), args)
          )
        return ['write', 'writeBinary', 'mkdir', 'rename', 'copy', 'remove', 'rmdir'].includes(
          String(key)
        )
          ? entryEffect(
              directEntryDurability(target),
              args
                .slice(key === 'copy' ? 1 : 0, key === 'rename' || key === 'copy' ? 2 : 1)
                .map(pathArgument),
              invoke
            )
          : ['read', 'readBinary', 'readBinaryPrefix', 'stat', 'exists', 'list'].includes(
                String(key)
              )
            ? boundedNativeRead(Promise.resolve(invoke()), 'mobile adapter ' + String(key))
            : invoke()
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
  /** Changes when a namespace operation starts, before its index event can arrive. */
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
        const touch = () => {
          this.revision++
        }
        const notify = (path: string) => {
          for (const listener of this.listeners) listener(path)
        }
        const wrapped: typeof original = function (
          this: Vault,
          ...args: Parameters<typeof original>
        ) {
          if (!(args[0] instanceof TFolder)) {
            touch()
            return original.apply(this, args)
          }
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
      const touchRename = () => {
        this.revision++
      }
      const notifyRename = (path: string, to: string) => {
        for (const listener of this.listeners) listener(path, to)
      }
      const wrappedRename: typeof rename = async function (this: Vault, ...args) {
        if (!(args[0] instanceof TFolder)) {
          touchRename()
          return rename.apply(this, args)
        }
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

  async settled(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    while (this.pending.size > 0) await waitForSyncRead(Promise.all(this.pending), signal)
    signal?.throwIfAborted()
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
  return inheritHostStorage(
    new Proxy(app, {
      get(target, key) {
        if (key === CONNECTION_JOURNAL_OWNER) return owner
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
    app
  )
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
  directEntryDurability(adapter)
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
  const port = new Proxy(Object.create(null) as DataAdapter, {
    set(_target, key, value) {
      overrides.set(key, value)
      return true
    },
    defineProperty(_target, key, descriptor) {
      if ('value' in descriptor) overrides.set(key, descriptor.value)
      return true
    },
    get(_target, key) {
      if (key === Symbol.for('abele.sync.scoped-sync-path-v1')) {
        if (!native?.open || typeof full !== 'function') return undefined
        // This capability only flushes an authorized path and its directory ancestry.
        // It never returns handles or grants the scoped port general ancestor access.
        return async (
          path: string,
          parentsOnly: boolean,
          diagnostic?: Parameters<typeof nativeDiagnostics>[1]
        ) => {
          check(path, 'stat')
          await assertVaultPath(adapter, path)
          const parentSync = Reflect.get(adapter, Symbol.for('abele.sync.scoped-sync-path-v1'))
          if (typeof parentSync === 'function') return parentSync(path, parentsOnly, diagnostic)
          // Ancestor barriers belong to the file whose namespace mutation requires
          // them. Retain that attribution through delayed shared-folder flushes.
          const fs = diagnostic
            ? nativeDiagnostics(native, (operation, startedAt, outcome) =>
                diagnostic(operation, startedAt, outcome, [path])
              )
            : native
          const flush = async (part: string) => {
            const handle = await fs.open(full.call(adapter, part), 'r')
            try {
              if (!handle.sync) throw new EngineError('io', 'native durability is unavailable')
              await handle.sync()
            } finally {
              await handle.close()
            }
          }
          if (!parentsOnly) await flush(path)
          await directEntryDurability(adapter).flushAncestors(path, flush)
        }
      }
      if (key === CONNECTION_ROOT_SYMLINK) return rootSymlink
      if (key === Symbol.for('abele.sync.scoped-candidate-path-guard-v1'))
        return (path: string) => {
          check(path, 'stat')
          return assertVaultCandidatePath(adapter, path)
        }
      if (key === Symbol.for('abele.sync.scoped-metadata-path-guard-v1'))
        return (path: string) => {
          check(path, 'stat')
          return assertVaultMetadataPath(adapter, path)
        }
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
  mutationRebuilders.set(port, (check, privateRoots) =>
    connectionAdapter(mutationCheckedAdapter(adapter, check, privateRoots), rootInput, privateRoot)
  )
  return port
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
  return inheritHostStorage(
    new Proxy(app, {
      get(target, key) {
        if (key === CONNECTION_ROOT) return currentRoot()
        if (key === CONNECTION_PRIVATE) return privateRoot
        if (key === 'vault') return vault
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }),
    app
  )
}

export function connectionFilePort(
  vault: Pick<Vault, 'adapter'>,
  options: { adapter?: DataAdapter }
): DataAdapter {
  return options.adapter ?? vaultDisk(vault)
}

export const CHECKED_LEASE_MS = 2000

/** Narrow checked-publication port; raw queue and vault writes stay at the guarded boundary. */
export function checkedVaultPort(
  vault: Vault,
  adapter: DataAdapter,
  options: {
    ready(): void
    effect(work: () => Promise<void>): Promise<void>
    diagnostic?(
      operation: string,
      started: number,
      outcome: string,
      paths?: readonly string[]
    ): void
  }
) {
  // Lease clocks also run in headless hosts, independently of any UI window.
  const timers =
    typeof window !== 'undefined' && typeof window.setTimeout === 'function'
      ? {
          setTimeout: window.setTimeout.bind(window),
          clearTimeout: window.clearTimeout.bind(window),
        }
      : { setTimeout: setTimeout.bind(undefined), clearTimeout: clearTimeout.bind(undefined) }
  return {
    async acquire(paths: string[]) {
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered!: () => void
      const entering = new Promise<void>((resolve) => {
        entered = resolve
      })
      const host = (Reflect.get(vault, CONNECTION_HOST) ?? vault) as Vault
      // Count queued acquisition too: older checked requests cannot multiply a save deadline.
      const abort = new AbortController()
      const expired = Object.assign(
        new EngineError('conflict', 'checked file lease expired; retry later'),
        { leaseExpired: true }
      )
      let rejectExpired!: (error: Error) => void
      const revoked = new Promise<never>((_, reject) => {
        rejectExpired = reject
      })
      void revoked.catch(() => {})
      const timer = timers.setTimeout(() => {
        abort.abort()
        rejectExpired(expired)
        console.error(
          '[abele-sync] BUG: checked file lease exceeded its time limit; releasing waiting saves',
          CHECKED_LEASE_MS
        )
        release()
      }, CHECKED_LEASE_MS)
      const operation = adapterPathGate(host.adapter).run(paths, async () => {
        entered()
        await held
      })
      try {
        await Promise.race([entering, revoked])
        if (abort.signal.aborted) throw expired
        options.ready()
      } catch (error) {
        timers.clearTimeout(timer)
        release()
        throw error
      }
      return Object.assign(
        () => {
          timers.clearTimeout(timer)
          release()
          void operation
        },
        {
          check() {
            if (abort.signal.aborted) throw expired
          },
          wait<T>(work: Promise<T>): Promise<T> {
            return Promise.race([work, revoked])
          },
        }
      )
    },
    async wait(path: string): Promise<void> {
      await assertVaultPath(adapter, path)
      const host = (Reflect.get(vault, CONNECTION_HOST) ?? vault) as Vault
      const raw = host.adapter as DataAdapter & { promise?: PromiseLike<unknown> }
      // Install before draining: a new writer must either finish before our lease,
      // or queue behind it, including writers starting between drainage and acquire.
      adapterPathGate(raw)
      const started = Date.now()
      for (;;) {
        options.ready()
        if (Date.now() - started >= NATIVE_READ_DEADLINE_MS)
          throw new NativeReadTimeout('checked publication save settlement')
        const file = vault.getAbstractFileByPath(path) as
          | (TFile & { saving?: PromiseLike<unknown> | boolean })
          | null
        const queue = raw.promise,
          saving = file?.saving
        // Waiting before publication is read-only. Abandon this waiter, never the
        // host's queue or its pending writer, when the host loses an acknowledgement.
        await boundedNativeRead(
          observePortableIo('publication host queue', path, () => queue),
          'checked publication host queue'
        )
        if (saving === true) await new Promise<void>((resolve) => timers.setTimeout(resolve, 10))
        else if (saving)
          await boundedNativeRead(
            observePortableIo('publication editor save', path, () => saving),
            'checked publication editor save'
          )
        options.ready()
        if (saving !== true && raw.promise === queue && file?.saving === saving) return
      }
    },
    publicationCheck(path: string, capturedAt?: string): () => boolean {
      const file = vault.getAbstractFileByPath(path)
      // The host can apply our capture notification before rename acknowledges.
      // That exact private destination is this operation's move, not a user
      // rename. An unrelated destination must still refuse publication.
      return () =>
        !(file instanceof TFile) ||
        file.path === path ||
        (capturedAt !== undefined && file.path === capturedAt)
    },
  }
}

type Method = (...args: unknown[]) => unknown
export const UNGATED_ADAPTER = Symbol.for('abele.adapter.ungated-v1')
export const TRACKER_ORIGINAL = Symbol.for('abele.adapter.tracker-original-v1')
const gates = new WeakMap<
  object,
  { locks: PathCoordinator; methods: Map<string, Method>; view: object }
>()
const mutator = /^(?:write.*|append.*|process|mkdir|rename|copy|remove|rmdir|trash.*)$/
const receivers = new WeakMap<object, object>()
function inheritedGate(adapter: object) {
  for (let at: object | null = adapter; at; at = Object.getPrototypeOf(at)) {
    const gate = gates.get(at)
    if (gate) return gate
  }
}

/** Cooperating wrappers keep exclusion installed while replacing or restoring their layer. */
export function setGatedAdapterMethod(adapter: object, name: string, value: unknown): void {
  const gate = inheritedGate(adapter)
  if (!gate || typeof value !== 'function' || !mutator.test(name)) {
    Reflect.set(adapter, name, value)
    return
  }
  const raw = ungatedAdapterMethod(value as Method)
  if (gates.has(adapter)) gate.methods.set(name, raw)
  const run = (...args: unknown[]) => raw.apply(adapterEngineReceiver(adapter), args)
  const wrapped = (...args: unknown[]) => {
    const trace = Reflect.get(adapter, Symbol.for('abele.sync.adapter-mutation-debug-v1')) === true
    if (trace) console.debug('[abele-sync] adapter mutation waiting', name, args[0])
    return gate.locks.run(
      args.slice(0, name === 'rename' || name === 'copy' ? 2 : 1).map(String),
      async () => {
        if (trace) console.debug('[abele-sync] adapter mutation entered', name, args[0])
        try {
          return await run(...args)
        } finally {
          if (trace) console.debug('[abele-sync] adapter mutation finished', name, args[0])
        }
      }
    )
  }
  Reflect.set(wrapped, UNGATED_ADAPTER, run)
  const original = Reflect.get(value, TRACKER_ORIGINAL) ?? raw
  Reflect.set(wrapped, TRACKER_ORIGINAL, original)
  Reflect.set(adapter, name, wrapped)
}

/** Explicit receiver-scoped bypass, never an ambient flag shared with concurrent saves. */
export function ungatedAdapterMethod(method: Method): Method {
  return Reflect.get(method, UNGATED_ADAPTER) ?? method
}

function engineAdapterMethod(adapter: object, key: PropertyKey, fallback: Method): Method {
  return gates.get(adapter)?.methods.get(String(key)) ?? ungatedAdapterMethod(fallback)
}

export function adapterEngineReceiver(adapter: object): object {
  const own = gates.get(adapter)
  if (own) return own.view
  if (!inheritedGate(adapter)) return adapter
  let view = receivers.get(adapter)
  if (!view) {
    view = new Proxy(adapter, {
      get(target, key) {
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? ungatedAdapterMethod(value).bind(view) : value
      },
    })
    receivers.set(adapter, view)
  }
  return view
}

/** One vault-wide gate; directory operations exclude descendants and moves acquire both paths. */
export function adapterPathGate(adapter: object): PathCoordinator {
  const existing = gates.get(adapter)
  if (existing) return existing.locks
  const locks = new PathCoordinator('adapter'),
    methods = new Map<string, Method>()
  const view = new Proxy(adapter, {
    get(target, key) {
      const value = methods.get(String(key)) ?? Reflect.get(target, key)
      return typeof value === 'function' ? ungatedAdapterMethod(value).bind(view) : value
    },
  })
  gates.set(adapter, { locks, methods, view })
  const names = new Set<string>()
  for (let at: object | null = adapter; at; at = Object.getPrototypeOf(at))
    for (const key of Object.getOwnPropertyNames(at)) if (mutator.test(key)) names.add(key)
  for (const name of names) {
    const original = Reflect.get(adapter, name)
    if (typeof original !== 'function') continue
    setGatedAdapterMethod(adapter, name, original)
  }
  return locks
}
