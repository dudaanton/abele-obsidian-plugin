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

import { collectHeap } from '../helpers/collectHeap'

it('releases content buffers after settling a 33000-file native upload', async () => {
  const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
  const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
  for (const key of timers)
    Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-first-upload-')))
  // Generate distinct sparse content without retaining a copy of the vault in the fixture.
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
    const size = 4096
    for (let offset = 0; offset < paths.length; offset += 64)
      await Promise.all(
        paths.slice(offset, offset + 64).map(async (path, i) => {
          const handle = await disk.open(join(root, path), 'wx')
          try {
            await handle.truncate(size)
            const id = Buffer.alloc(4)
            id.writeUInt32LE(offset + i)
            await handle.write(id, 0, 4, 0)
          } finally {
            await handle.close()
          }
        })
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
    let acknowledged = 0
    let cursor = 1
    const present = new Set<string>()
    const send: typeof fetch = async (input, init) => {
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
          received: [],
        })
      }
      if (path.startsWith('/v2/uploads/') && init?.method === 'PUT') {
        if (!path.includes('/sample-upload/')) {
          acknowledged++
          present.add(path.split('/')[3]!)
        }
        return new Response(null, { status: 204 })
      }
      return Response.json({ items: [], cursor, next: null })
    }
    const transport = send
    const open = () => {
      const fs = new ObsidianFileSystem(app as never, {
        ledger: state,
        connectionId: 'sample-connection',
        fileScope: 'Shared',
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
    await runtime.sync()
    expect(runtime.engine.status.state).toBe('idle')
    expect(acknowledged).toBe(33000)
    // Status inspection is part of the settled runtime's working set too.
    expect(await runtime.notSynced()).toEqual([])
    await collectHeap()
    console.log('native settled upload memory', process.memoryUsage())
    expect(process.memoryUsage().heapUsed).toBeLessThan(512 * 1024 * 1024)
    expect(process.memoryUsage().arrayBuffers).toBeLessThan(64 * 1024 * 1024)
  } finally {
    await runtime?.close()
    await disk.rm(root, { recursive: true, force: true })
    timers.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(window, key, previous[i]!)
      else Reflect.deleteProperty(window, key)
    })
  }
}, 600000)
