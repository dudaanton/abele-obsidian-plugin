// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it } from 'vitest'
import { promises as disk } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ignoreFor } from '@/sync/scope'
import { buildFakeVault } from '../helpers/fakeVault'

it('profiles first payload and multipart restart before hashing a 33000-file native tree', async () => {
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-first-upload-')))
  // A root file precedes the recursive directory walk, making the interruption
  // occur before the rest of the tree independently of filesystem folder ordering.
  const target = 'Shared/Sample.bin'
  const paths = [
    target,
    ...Array.from(
      { length: 32999 },
      (_, i) => `Shared/Notes/Section ${i % 31}/层 ${i % 7}/Nested ${i % 13}/Sample ${i}.md`
    ),
  ]
  const state = new MemoryStateStore()
  let runtime: TokenEngineRuntime | undefined
  try {
    for (const folder of new Set(paths.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    const handle = await disk.open(join(root, target), 'wx')
    await handle.truncate(192 * 1024 * 1024)
    await handle.close()
    for (let offset = 1; offset < paths.length; offset += 64)
      await Promise.all(
        paths
          .slice(offset, offset + 64)
          .map((path) => disk.writeFile(join(root, path), 'sample ' + path))
      )
    const app = buildFakeVault(
      paths.map((path) => ({ path, content: 'sample', mtime: 1000 })),
      { sensitiveNames: true }
    )
    Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: disk,
      stat: async (path: string) => {
        try {
          const info = await disk.stat(join(root, path))
          return {
            type: info.isDirectory() ? 'folder' : 'file',
            size: info.size,
            mtime: info.mtimeMs,
            ctime: info.birthtimeMs,
          }
        } catch (error) {
          if ((error as { code: string }).code === 'ENOENT') return null
          throw error
        }
      },
      list: async (path: string) => {
        const rows = await disk.readdir(join(root, path), { withFileTypes: true })
        return {
          files: rows
            .filter((one) => one.isFile())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
          folders: rows
            .filter((one) => one.isDirectory())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
        }
      },
    })
    const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Shared' }
    let fresh = 0,
      firstPayloadMs = Infinity,
      hashesAtPayload = Infinity,
      started = 0
    let offline = false,
      resumed = false,
      parts = 0,
      firstResumeMs = Infinity,
      cursor = 1
    const transport: typeof fetch = async (input, init) => {
      if (offline) throw new TypeError('sample interrupted multipart')
      const path = new URL(String(input)).pathname
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 200 * 1024 * 1024, quota_bytes: null },
        })
      if (path === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body))
        return Response.json({
          cursor: ++cursor,
          results: ops.map((op: { path: string; sha?: string; size?: number; mtime?: number }) => ({
            status: 'applied',
            file_id: crypto.randomUUID(),
            version_id: crypto.randomUUID(),
            seq: cursor,
            path: op.path,
            sha: op.sha ?? null,
            size: op.size ?? 0,
            mtime: op.mtime ?? 0,
          })),
        })
      }
      if (path.startsWith('/v2/uploads/') && init?.method === 'HEAD')
        return new Response(null, { status: 404 })
      if (path.endsWith('/begin')) {
        const { size, max_part_bytes } = JSON.parse(String(init?.body))
        return Response.json({
          upload_id: 'sample-upload',
          part_size: max_part_bytes,
          parts: Math.ceil(size / max_part_bytes),
          received: resumed ? [0] : [],
        })
      }
      if (path.startsWith('/v2/uploads/') && init?.method === 'PUT') {
        if (!Number.isFinite(firstPayloadMs)) {
          firstPayloadMs = performance.now() - started
          hashesAtPayload = fresh
          console.log('native first payload', {
            firstPayloadMs,
            hashesAtPayload,
            active: Reflect.get(runtime!, 'scanUploads').size,
          })
        }
        if (resumed && path.endsWith('/sample-upload/1')) {
          firstResumeMs = performance.now() - started
          throw new TypeError('sample resumed upload boundary')
        }
        if (path.includes('/sample-upload/')) parts++
        if (!resumed && path.endsWith('/sample-upload/1')) {
          offline = true
          throw new TypeError('sample interrupted multipart')
        }
        return new Response(null, { status: 204 })
      }
      return Response.json({ items: [], cursor, next: null })
    }
    const open = () => {
      const fs = new ObsidianFileSystem(app as never, {
        ledger: state,
        connectionId: 'sample-connection',
        fileScope: 'Shared',
      })
      const fingerprint = Reflect.get(fs, 'fingerprintFresh').bind(fs)
      Object.assign(fs, {
        fingerprintFresh: async (...args: unknown[]) => {
          fresh++
          return fingerprint(...args)
        },
      })
      const metadata = new MemoryStateStore()
      return new TokenEngineRuntime({
        id: 'sample-connection',
        state,
        fs,
        encoded: encodeAccessToken({
          v: 1,
          address: 'https://sync.example.invalid',
          key: 'a'.repeat(43),
          scope,
        }),
        fetch: transport,
        changed: () => {},
        failed: () => {},
        covers: async () => false,
        scopeInput: async () => ({ key: 'sample-scope', ignore: ignoreFor('.obsidian', null) }),
        reviews: {
          executables: new ExecutableReview(metadata),
          attachments: new AttachmentConsent(metadata),
          close: () => {},
        },
      })
    }
    runtime = open()
    started = performance.now()
    await expect(runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    console.log('native interruption', { fresh, parts })
    expect(parts).toBeGreaterThan(1)
    expect(hashesAtPayload).toBeLessThanOrEqual(2)
    expect(fresh).toBeLessThan(33000)
    const initialFresh = fresh
    await runtime.close()
    offline = false
    resumed = true
    runtime = open()
    started = performance.now()
    await expect(runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    expect(firstResumeMs).toBeLessThan(30000)
    expect(fresh).toBe(initialFresh)
    console.log('native first-upload 33k', {
      firstPayloadMs,
      hashesAtPayload,
      fresh,
      firstResumeMs,
    })
    expect((await disk.stat(join(root, target))).size).toBe(192 * 1024 * 1024)
  } finally {
    await runtime?.close()
    await disk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
  }
}, 180000)

it('resumes acknowledged content in a 33000-file native tree without a vault-wide HEAD pass', async () => {
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-first-upload-')))
  // A root file precedes the recursive directory walk, making the interruption
  // occur before the rest of the tree independently of filesystem folder ordering.
  const target = 'Shared/Sample.bin'
  const paths = [
    target,
    ...Array.from(
      { length: 32999 },
      (_, i) => `Shared/Notes/Section ${i % 31}/层 ${i % 7}/Nested ${i % 13}/Sample ${i}.md`
    ),
  ]
  const state = new MemoryStateStore()
  let runtime: TokenEngineRuntime | undefined
  try {
    for (const folder of new Set(paths.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    const handle = await disk.open(join(root, target), 'wx')
    await handle.truncate(192 * 1024 * 1024)
    await handle.close()
    for (let offset = 1; offset < paths.length; offset += 64)
      await Promise.all(
        paths
          .slice(offset, offset + 64)
          .map((path) => disk.writeFile(join(root, path), 'sample ' + path))
      )
    const app = buildFakeVault(
      paths.map((path) => ({ path, content: 'sample', mtime: 1000 })),
      { sensitiveNames: true }
    )
    Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: disk,
      stat: async (path: string) => {
        try {
          const info = await disk.stat(join(root, path))
          return {
            type: info.isDirectory() ? 'folder' : 'file',
            size: info.size,
            mtime: info.mtimeMs,
            ctime: info.birthtimeMs,
          }
        } catch (error) {
          if ((error as { code: string }).code === 'ENOENT') return null
          throw error
        }
      },
      list: async (path: string) => {
        const rows = await disk.readdir(join(root, path), { withFileTypes: true })
        return {
          files: rows
            .filter((one) => one.isFile())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
          folders: rows
            .filter((one) => one.isDirectory())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
        }
      },
    })
    const scope = { kind: 'folder' as const, id: 'sample-root', path: 'Shared' }
    let fresh = 0,
      firstPayloadMs = Infinity,
      hashesAtPayload = Infinity,
      started = 0
    let offline = false,
      resumed = false,
      parts = 0,
      firstResumeMs = Infinity,
      cursor = 1
    let acknowledged = 0,
      resumedHeads = 0
    const present = new Set<string>()
    const transport: typeof fetch = async (input, init) => {
      if (offline) throw new TypeError('sample interrupted multipart')
      const path = new URL(String(input)).pathname
      if (path === '/v2/connection')
        return Response.json({
          protocol: 2,
          token_id: 'sample-token',
          space_id: 'sample-space',
          scope,
          status: 'active',
          limits: { max_file_bytes: 200 * 1024 * 1024, quota_bytes: null },
        })
      if (path === '/v2/commit') {
        const { ops } = JSON.parse(String(init?.body))
        return Response.json({
          cursor: ++cursor,
          results: ops.map((op: { path: string; sha?: string; size?: number; mtime?: number }) => ({
            status: 'applied',
            file_id: crypto.randomUUID(),
            version_id: crypto.randomUUID(),
            seq: cursor,
            path: op.path,
            sha: op.sha ?? null,
            size: op.size ?? 0,
            mtime: op.mtime ?? 0,
          })),
        })
      }
      if (path.startsWith('/v2/uploads/') && init?.method === 'HEAD') {
        if (resumed) resumedHeads++
        return new Response(null, { status: present.has(path.split('/')[3]!) ? 200 : 404 })
      }
      if (path.endsWith('/complete')) {
        const sha = path.split('/')[3]!
        present.add(sha)
        acknowledged++
        return Response.json({ sha, size: 192 * 1024 * 1024 })
      }
      if (path.endsWith('/begin')) {
        const { size, max_part_bytes } = JSON.parse(String(init?.body))
        return Response.json({
          upload_id: 'sample-upload',
          part_size: max_part_bytes,
          parts: Math.ceil(size / max_part_bytes),
          received: resumed ? [0] : [],
        })
      }
      if (path.startsWith('/v2/uploads/') && init?.method === 'PUT') {
        if (!Number.isFinite(firstPayloadMs)) {
          firstPayloadMs = performance.now() - started
          hashesAtPayload = fresh
          console.log('native first payload', {
            firstPayloadMs,
            hashesAtPayload,
            active: Reflect.get(runtime!, 'scanUploads').size,
          })
        }
        if (resumed) {
          firstResumeMs = performance.now() - started
          throw new TypeError('sample resumed upload boundary')
        }
        if (path.includes('/sample-upload/')) parts++
        if (!path.includes('/sample-upload/')) {
          if (acknowledged >= 32700) {
            offline = true
            throw new TypeError('sample process loss')
          }
          acknowledged++
          present.add(path.split('/')[3]!)
        }
        return new Response(null, { status: 204 })
      }
      return Response.json({ items: [], cursor, next: null })
    }
    const open = () => {
      const fs = new ObsidianFileSystem(app as never, {
        ledger: state,
        connectionId: 'sample-connection',
        fileScope: 'Shared',
      })
      const fingerprint = Reflect.get(fs, 'fingerprintFresh').bind(fs)
      Object.assign(fs, {
        fingerprintFresh: async (...args: unknown[]) => {
          fresh++
          return fingerprint(...args)
        },
      })
      const metadata = new MemoryStateStore()
      return new TokenEngineRuntime({
        id: 'sample-connection',
        state,
        fs,
        encoded: encodeAccessToken({
          v: 1,
          address: 'https://sync.example.invalid',
          key: 'a'.repeat(43),
          scope,
        }),
        fetch: transport,
        changed: () => {},
        failed: () => {},
        covers: async () => false,
        scopeInput: async () => ({ key: 'sample-scope', ignore: ignoreFor('.obsidian', null) }),
        reviews: {
          executables: new ExecutableReview(metadata),
          attachments: new AttachmentConsent(metadata),
          close: () => {},
        },
      })
    }
    runtime = open()
    started = performance.now()
    await expect(runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    console.log('native interruption', { fresh, parts })
    expect(parts).toBeGreaterThan(1)
    expect(hashesAtPayload).toBeLessThanOrEqual(2)
    expect(fresh).toBeLessThan(33000)
    const initialFresh = fresh
    await runtime.close()
    offline = false
    resumed = true
    runtime = open()
    started = performance.now()
    await expect(runtime.sync()).rejects.toMatchObject({ code: 'offline' })
    for (const sha of present) expect(await runtime.client.hasBlob(sha)).toBe(true)
    console.log('native acknowledged resume', {
      acknowledged,
      resumedHeads,
      firstResumeMs,
      fresh,
      initialFresh,
    })
    expect(acknowledged).toBeGreaterThanOrEqual(32700)
    expect(resumedHeads).toBeLessThanOrEqual(4)
    expect(firstResumeMs).toBeLessThan(5000)
    expect(fresh).toBe(initialFresh)
    console.log('native first-upload 33k', {
      firstPayloadMs,
      hashesAtPayload,
      fresh,
      firstResumeMs,
    })
    expect((await disk.stat(join(root, target))).size).toBe(192 * 1024 * 1024)
  } finally {
    await runtime?.close()
    await disk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
  }
}, 600000)
