import type { App, DataAdapter } from 'obsidian'
import { FolderScopeError } from './scopedFileSystem'
import { IGNORE_FILE } from './scope'

import {
  withinRoot,
  CONNECTION_HOST,
  CONNECTION_ROOT,
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
const READ_ONLY_SETTINGS = new Set([IGNORE_FILE])
export function connectionSetting(path: string): boolean {
  return READ_ONLY_SETTINGS.has(path)
}
const SETTINGS_READS = new Set(['exists', 'stat', 'read', 'readBinary', 'readBinaryPrefix'])

/** One adapter capability for startup, inspection and runtime; no vault-wide fallback. */
export function connectionAdapter(
  adapter: DataAdapter,
  root: string,
  privateRoot: string
): DataAdapter {
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
    physicalRoot = root,
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
                  full.call(adapter, root),
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
      if (key === 'fsPromises') return nativePort
      if (key === 'fs') return undefined
      const value = overrides.has(key) ? overrides.get(key) : Reflect.get(adapter, key)
      if (typeof value !== 'function') return value
      if (key === 'getName' || key === 'getBasePath' || key === 'queue') return value.bind(adapter)
      return (...args: unknown[]) => {
        const method = String(key)
        if (!singles.has(method) && !pairs.has(method))
          throw new FolderScopeError('Adapter operation has no scope policy: ' + method)
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
  root: string,
  privateRoot?: string
): App {
  const vault = new Proxy(app.vault, {
    get(target, key) {
      if (key === CONNECTION_HOST) return target
      if (key === 'adapter') return adapter
      const value = Reflect.get(target, key)
      if (key === 'getFiles')
        return () => target.getFiles().filter((file) => withinRoot(file.path, root))
      if (key === 'getFileByPath' || key === 'getAbstractFileByPath')
        return (path: string) => (withinRoot(path, root) ? value.call(target, path) : null)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return new Proxy(app, {
    get(target, key) {
      if (key === CONNECTION_ROOT) return root
      if (key === CONNECTION_PRIVATE) return privateRoot
      if (key === 'vault') return vault
      const value = Reflect.get(target, key)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
