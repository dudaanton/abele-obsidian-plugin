import { describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExternalFileHost } from '@/sync/external/ObsidianExternalFileHost'
import { ExternalFilePortError } from '@/sync/external/filesystem'
import { SerialQueue } from '@/sync/queue'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

const bytes = (text: string) => new TextEncoder().encode(text)
const source = 'Media/sample.bin'
const staging = 'Media/.abele-external-sample.incoming'
const sidecar = source + '.abele-ref'
const base = bytes('sample verified bytes')
const request = {
  operationId: 'sample-operation',
  fileId: 'sample-file',
  paths: [source, staging, sidecar],
  assertIntent: () => {},
}
const queue = () => new SerialQueue()
const barrier = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function setup(platform: 'mobile' | 'desktop' = 'mobile') {
  const fake = buildFakeVault([{ path: source, content: 'sample verified bytes' }])
  if (platform === 'desktop') withDesktopFs(fake)
  let leaves: string[] = []
  const workspace = fake.workspace as unknown as {
    iterateAllLeaves: (fn: (leaf: unknown) => void) => void
  }
  workspace.iterateAllLeaves = (fn) => leaves.forEach((path) => fn({ view: { file: { path } } }))
  const app = fake as unknown as App
  const assertOwned = vi.fn()
  const host = new ExternalFileHost(app, { platform, assertOwned })
  const fs = new ObsidianFileSystem(app)
  const artifact = async (
    path = staging,
    data = base,
    role: 'incoming' | 'projection' = 'incoming'
  ) => ({
    operationId: request.operationId,
    path,
    sha: await sha256(data),
    size: data.length,
    role,
  })
  const run = <T>(work: Parameters<typeof host.run<T>>[2]) => host.run(queue(), request, work)
  return {
    fake,
    host,
    fs,
    artifact,
    run,
    assertOwned,
    leaves: (paths: string[]) => {
      leaves = paths
    },
  }
}

async function reason(work: Promise<unknown>) {
  try {
    await work
    return 'completed'
  } catch (error) {
    return error instanceof ExternalFilePortError ? error.reason : (error as { code?: string }).code
  }
}

describe('external-file host coordination and filesystem effects', () => {
  it('rechecks intent before each mobile append and retains partial staging on refusal', async () => {
    const s = setup()
    const data = new Uint8Array(2 * 1024 * 1024 + 7)
    const artifact = await s.artifact(staging, data)
    let allowed = true
    const write = vi.spyOn(s.fake.vault.adapter, 'writeBinary')
    const append = vi.fn(async () => {
      allowed = false
    })
    Object.assign(s.fake.vault.adapter, { appendBinary: append })
    const read = vi.spyOn(s.fake.vault.adapter, 'readBinary')
    await s.host.run(
      queue(),
      {
        ...request,
        assertIntent: () => {
          if (!allowed) throw new ExternalFilePortError('recovery-required')
        },
      },
      async (effects) => {
        expect((await effects.stage(artifact, data)).status).toBe('outcome-unknown')
      }
    )
    expect(write).toHaveBeenCalledTimes(1)
    expect(append).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
    expect(await s.fake.vault.adapter.exists(staging)).toBe(true)
    s.host.close()
  })

  it('bounds mobile bridge writes before any full-size verification read', async () => {
    const s = setup()
    let data: Uint8Array | undefined = new Uint8Array(3 * 1024 * 1024 + 7)
    data.fill(91)
    const artifact = await s.artifact(staging, data)
    const chunks: Uint8Array[] = []
    const write = vi
      .spyOn(s.fake.vault.adapter, 'writeBinary')
      .mockImplementation(async (_path, buffer) => {
        expect(buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
        chunks.push(new Uint8Array(buffer))
      })
    const append = vi.fn(async (_path: string, buffer: ArrayBuffer) => {
      expect(buffer.byteLength).toBeLessThanOrEqual(1024 * 1024)
      chunks.push(new Uint8Array(buffer))
    })
    Object.assign(s.fake.vault.adapter, { appendBinary: append })
    const read = vi.spyOn(s.fake.vault.adapter, 'readBinary').mockImplementation(async () => {
      expect(data).toBeUndefined()
      expect(append).toHaveBeenCalledTimes(3)
      const result = new Uint8Array(artifact.size)
      let at = 0
      for (const chunk of chunks) {
        result.set(chunk, at)
        at += chunk.length
      }
      return result.buffer
    })
    await s.run(async (effects) => {
      const pending = effects.stage(artifact, data!)
      data = undefined
      expect(await pending).toEqual({ status: 'staged' })
    })
    expect(write).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledTimes(1)
    s.host.close()
  })

  it('passes the transferred backing buffer to staging without a full-size snapshot', async () => {
    const s = setup()
    const data = new Uint8Array(1024 * 1024)
    const artifact = await s.artifact(staging, data)
    const write = vi.spyOn(s.fake.vault.adapter, 'writeBinary')
    await s.run(async (effects) => {
      expect(await effects.stage(artifact, data)).toEqual({ status: 'staged' })
    })
    expect(write).toHaveBeenCalledWith(staging, data.buffer)
    expect(write.mock.calls[0][1]).toBe(data.buffer)
    s.host.close()
  })

  it('verifies desktop files with one reusable bounded buffer and closes the handle', async () => {
    const s = setup('desktop')
    const data = new Uint8Array(3 * 1024 * 1024 + 7)
    data.fill(123)
    const buffers = new Set<Uint8Array>()
    const close = vi.fn(async () => {})
    const read = vi.fn(
      async (buffer: Uint8Array, offset: number, length: number, position: number) => {
        buffers.add(buffer)
        expect(buffer.length).toBeLessThanOrEqual(1024 * 1024)
        const part = data.subarray(position, position + length)
        buffer.set(part, offset)
        return { bytesRead: part.length }
      }
    )
    const adapter = s.fake.vault.adapter as any
    adapter.fsPromises.open = vi.fn(async () => ({ read, close }))
    const wholeRead = vi.spyOn(adapter, 'readBinary')
    expect(await s.host.matches({ path: source, size: data.length, sha: await sha256(data) })).toBe(
      true
    )
    expect(buffers.size).toBe(1)
    expect(wholeRead).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    s.host.close()
  })
  it('refuses an attachment open in a nonactive relevant leaf', async () => {
    const s = setup()
    s.leaves(['Notes/sample.md', source])
    expect(await reason(s.run(async () => {}))).toBe('busy')
  })

  it('an attachment opened while pending invalidates deletion, even if closed again', async () => {
    const s = setup(),
      hold = barrier(),
      entered = barrier()
    const result = s.run(async (op) => {
      entered.release()
      await hold.promise
      return op.deleteOriginal({ path: source, sha: await sha256(base), size: base.length })
    })
    await entered.promise
    s.leaves([source])
    s.fake.emit('workspace', 'file-open', s.fake.vault.getAbstractFileByPath(source))
    s.leaves([])
    hold.release()
    expect(await reason(result)).toBe('busy')
    expect(await s.fake.vault.adapter.exists(source)).toBe(true)
    s.host.close()
  })

  it('serializes use leases and operation start; lease release is idempotent', async () => {
    const s = setup(),
      lease = s.host.acquireUse(request.fileId)
    expect(await reason(s.run(async () => {}))).toBe('busy')
    lease.release()
    lease.release()
    await s.run(async () => {
      expect(() => s.host.acquireUse(request.fileId)).toThrow('busy')
    })
    await s.run(async () => {})
  })

  it('teardown drops only this host’s consumer registrations; successors re-register their own', async () => {
    const s = setup(),
      oldLease = s.host.acquireUse(request.fileId)
    const successor = new ExternalFileHost(s.fake as unknown as App, {
      platform: 'mobile',
      assertOwned: () => {},
    })
    const newLease = successor.acquireUse(request.fileId)
    s.host.close()
    oldLease.release()
    expect(await reason(successor.run(queue(), request, async () => {}))).toBe('busy')
    newLease.release()
    await successor.run(queue(), request, async () => {})
    const orphan = successor.acquireUse(request.fileId)
    successor.close()
    const restarted = new ExternalFileHost(s.fake as unknown as App, {
      platform: 'mobile',
      assertOwned: () => {},
    })
    await restarted.run(queue(), request, async () => {})
    orphan.release()
    restarted.close()
  })

  it('uses the supplied engine exclusive queue, not a public sync call inside it', async () => {
    const s = setup(),
      engine = queue(),
      entered = barrier(),
      hold = barrier(),
      events: string[] = []
    const sync = engine.run(async () => {
      events.push('sync')
      entered.release()
      await hold.promise
    })
    await entered.promise
    const external = s.host.run(engine, request, async () => {
      events.push('external')
    })
    await Promise.resolve()
    expect(events).toEqual(['sync'])
    hold.release()
    await Promise.all([sync, external])
    expect(events).toEqual(['sync', 'external'])
  })

  it('captures reservation parameters before waiting for the engine queue', async () => {
    const s = setup(),
      engine = queue(),
      entered = barrier(),
      hold = barrier()
    const paths = [...request.paths],
      mutable = { ...request, paths }
    const predecessor = engine.run(async () => {
      entered.release()
      await hold.promise
    })
    await entered.promise
    const external = s.host.run(engine, mutable, async () => {
      expect(await reason(s.fs.remove(source))).toBe('busy')
    })
    paths.splice(0, paths.length, 'Elsewhere/sample.bin')
    hold.release()
    await Promise.all([predecessor, external])
    expect(await s.fake.vault.adapter.exists(source)).toBe(true)
  })

  it('blocks apply, rename and delete at either reserved path, including case aliases and ancestors', async () => {
    const s = setup()
    await s.run(async () => {
      expect(await reason(s.fs.writeAtomic(source, bytes('sample remote edit'), 1))).toBe('busy')
      expect(await reason(s.fs.move(source, 'Media/sample-moved.bin'))).toBe('busy')
      expect(await reason(s.fs.move('Other.bin', source.toUpperCase()))).toBe('busy')
      expect(await reason(s.fs.remove(source))).toBe('busy')
      expect(() => s.host.coordination.assertEnginePaths(['Media'])).toThrow('busy')
    })
    expect(new TextDecoder().decode(await s.fake.vault.adapter.readBinary(source))).toBe(
      'sample verified bytes'
    )
  })

  it('cannot reserve a path while an already-issued engine mutation is unfinished', async () => {
    const s = setup(),
      entered = barrier(),
      hold = barrier()
    const fs = new ObsidianFileSystem(s.fake as unknown as App, {
      beforeEngineMutation: async () => {
        entered.release()
        await hold.promise
      },
    })
    const apply = fs.writeAtomic(source, bytes('sample remote edit'), 1)
    await entered.promise
    expect(await reason(s.run(async () => {}))).toBe('busy')
    hold.release()
    await apply
  })

  it('rehashes immediately before deletion and preserves mismatching bytes and sizes', async () => {
    const s = setup()
    await s.fake.vault.adapter.writeBinary(
      source,
      bytes('sample independent edit').buffer as ArrayBuffer
    )
    expect(
      await reason(
        s.run((op) => op.deleteOriginal({ path: source, sha: '0'.repeat(64), size: base.length }))
      )
    ).toBe('local-changed')
    expect(await s.fake.vault.adapter.exists(source)).toBe(true)
  })

  it('has no journal/network await between the final hash and removal; rechecks host state at the effect', async () => {
    const s = setup(),
      artifact = await s.artifact(source)
    const remove = vi.spyOn(s.fake.vault.adapter, 'remove')
    await s.run((op) => op.deleteOriginal(artifact))
    expect(remove).toHaveBeenCalledExactlyOnceWith(source)
    expect(s.assertOwned).toHaveBeenCalled()
  })

  it('an ownership loss during a read cannot authorize deletion', async () => {
    const s = setup(),
      read = s.fake.vault.adapter.readBinary.bind(s.fake.vault.adapter)
    s.fake.vault.adapter.readBinary = async (path) => {
      const out = await read(path)
      s.assertOwned.mockImplementation(() => {
        throw new Error('sample lost ownership')
      })
      return out
    }
    expect(await reason(s.run(async (op) => op.deleteOriginal(await s.artifact(source))))).not.toBe(
      'completed'
    )
    expect(await s.fake.vault.adapter.exists(source)).toBe(true)
  })

  for (const platform of ['mobile', 'desktop'] as const) {
    describe(platform + ' installer', () => {
      it('installs only from verified owned staging and preserves even a matching occupied target', async () => {
        const s = setup(platform),
          artifact = await s.artifact()
        await s.run(async (op) => {
          await op.stage(artifact, base)
          expect(await reason(op.install(artifact, source))).toBe('collision')
        })
        expect(await s.fake.vault.adapter.exists(staging)).toBe(true)
        expect(new TextDecoder().decode(await s.fake.vault.adapter.readBinary(source))).toBe(
          'sample verified bytes'
        )
      })

      it('preserves a target created during staging, before the final installation check', async () => {
        const s = setup(platform),
          artifact = await s.artifact()
        await s.fake.vault.adapter.remove(source)
        const write = s.fake.vault.adapter.writeBinary.bind(s.fake.vault.adapter)
        s.fake.vault.adapter.writeBinary = async (path, data) => {
          await write(path, data)
          if (path === staging) await write(source, bytes('sample occupant').buffer as ArrayBuffer)
        }
        await s.run(async (op) => {
          await op.stage(artifact, base)
          expect(await reason(op.install(artifact, source))).toBe('collision')
        })
        expect(new TextDecoder().decode(await s.fake.vault.adapter.readBinary(source))).toBe(
          'sample occupant'
        )
        expect(await s.fake.vault.adapter.exists(staging)).toBe(true)
      })

      it('refuses changed staging, foreign artifacts and unreserved targets', async () => {
        const s = setup(platform),
          artifact = await s.artifact()
        await s.run(async (op) => {
          await op.stage(artifact, base)
          await s.fake.vault.adapter.writeBinary(
            staging,
            bytes('sample altered staging').buffer as ArrayBuffer
          )
          expect(await reason(op.install(artifact, source))).toBe('local-changed')
          expect(await reason(op.stage({ ...artifact, operationId: 'sample-foreign' }, base))).toBe(
            'recovery-required'
          )
          expect(await reason(op.install(artifact, 'Elsewhere/sample.bin'))).toBe(
            'recovery-required'
          )
        })
      })

      it('installs onto a free target, with no final-target write or copy fallback', async () => {
        const s = setup(platform),
          artifact = await s.artifact()
        await s.fake.vault.adapter.remove(source)
        const writes = vi.spyOn(s.fake.vault.adapter, 'writeBinary')
        const rename = vi.spyOn(s.fake.vault.adapter, 'rename')
        await s.run(async (op) => {
          await op.stage(artifact, base)
          const result = await op.install(artifact, source)
          expect(result).toEqual({
            status: 'installed',
            method: platform === 'mobile' ? 'adapter-rename' : 'native-link',
            sourceRetained: platform === 'desktop',
          })
        })
        // The fake native link models its effect using a write, unlike the production link.
        if (platform === 'mobile') {
          expect(writes.mock.calls.map(([path]) => path)).toEqual([staging])
          expect(rename).toHaveBeenCalledExactlyOnceWith(staging, source)
        }
        expect(new TextDecoder().decode(await s.fake.vault.adapter.readBinary(source))).toBe(
          'sample verified bytes'
        )
      })
    })
  }

  it('requires native link on desktop, never substitutes native rename or mobile fallback', async () => {
    const s = setup(),
      artifact = await s.artifact()
    s.host.close()
    const host = new ExternalFileHost(s.fake as unknown as App, {
      platform: 'desktop',
      assertOwned: () => {},
    })
    await host.run(queue(), request, async (op) => {
      await op.stage(artifact, base)
      expect(await reason(op.install(artifact, source))).toBe('unsupported-storage')
    })
  })

  it('retains durable artifact references on an ambiguous install outcome, without blind retries', async () => {
    const s = setup(),
      artifact = await s.artifact()
    const rename = s.fake.vault.adapter.rename.bind(s.fake.vault.adapter)
    await s.fake.vault.adapter.remove(source)
    s.fake.vault.adapter.rename = async (from, to) => {
      await rename(from, to)
      throw new Error('sample missing acknowledgement')
    }
    await s.run(async (op) => {
      await op.stage(artifact, base)
      const result = await op.install(artifact, source)
      expect(result).toEqual({
        status: 'outcome-unknown',
        artifacts: [artifact],
        paths: [staging, source],
      })
      expect(await reason(op.install(artifact, source))).toBe('recovery-required')
    })
    expect(await s.fake.vault.adapter.exists(source)).toBe(true)
  })

  it.each(['stage', 'delete'] as const)(
    'retains evidence when %s mutates but its acknowledgement is lost',
    async (kind) => {
      const s = setup(),
        artifact = await s.artifact()
      const write = s.fake.vault.adapter.writeBinary.bind(s.fake.vault.adapter)
      const remove = s.fake.vault.adapter.remove.bind(s.fake.vault.adapter)
      if (kind === 'stage')
        s.fake.vault.adapter.writeBinary = async (path, data) => {
          await write(path, data)
          throw new Error('sample lost write acknowledgement')
        }
      else
        s.fake.vault.adapter.remove = async (path) => {
          await remove(path)
          throw new Error('sample lost delete acknowledgement')
        }
      await s.run(async (op) => {
        const result =
          kind === 'stage'
            ? await op.stage(artifact, base)
            : await op.deleteOriginal({ ...artifact, path: source })
        expect(result).toEqual({
          status: 'outcome-unknown',
          artifacts: kind === 'stage' ? [artifact] : [],
          paths: [kind === 'stage' ? staging : source],
        })
        expect(await reason(op.deleteOriginal({ ...artifact, path: source }))).toBe(
          'recovery-required'
        )
      })
      expect(await s.fake.vault.adapter.exists(kind === 'stage' ? staging : source)).toBe(
        kind === 'stage'
      )
    }
  )

  it('the mobile final check preserves an occupant created after the earlier installation preflight', async () => {
    const s = setup(),
      artifact = await s.artifact()
    await s.fake.vault.adapter.remove(source)
    const exists = s.fake.vault.adapter.exists.bind(s.fake.vault.adapter)
    let armed = false,
      checks = 0
    s.fake.vault.adapter.exists = async (path) => {
      const out = await exists(path)
      if (armed && path === source && ++checks === 1)
        await s.fake.vault.adapter.writeBinary(
          source,
          bytes('sample late occupant').buffer as ArrayBuffer
        )
      return out
    }
    const rename = vi.spyOn(s.fake.vault.adapter, 'rename')
    await s.run(async (op) => {
      await op.stage(artifact, base)
      armed = true
      expect(await reason(op.install(artifact, source))).toBe('collision')
    })
    expect(checks).toBe(2)
    expect(rename).not.toHaveBeenCalled()
    expect(new TextDecoder().decode(await s.fake.vault.adapter.readBinary(source))).toBe(
      'sample late occupant'
    )
    expect(await exists(staging)).toBe(true)
  })

  it('native link preserves a target occupied at the syscall boundary', async () => {
    const s = setup('desktop'),
      artifact = await s.artifact()
    await s.fake.vault.adapter.remove(source)
    const raw = s.fake.vault.adapter as typeof s.fake.vault.adapter & {
      fsPromises: { link(from: string, to: string): Promise<void> }
    }
    const link = raw.fsPromises.link.bind(raw.fsPromises)
    raw.fsPromises.link = async (from, to) => {
      await s.fake.vault.adapter.writeBinary(
        source,
        bytes('sample late occupant').buffer as ArrayBuffer
      )
      await link(from, to)
    }
    await s.run(async (op) => {
      await op.stage(artifact, base)
      expect(await reason(op.install(artifact, source))).toBe('collision')
    })
    expect(await s.fake.vault.adapter.exists(staging)).toBe(true)
    expect(new TextDecoder().decode(await s.fake.vault.adapter.readBinary(source))).toBe(
      'sample late occupant'
    )
  })

  it('uncommitted intent is refused before parent creation, staging, install or deletion', async () => {
    const s = setup(),
      artifact = await s.artifact(),
      write = vi.spyOn(s.fake.vault.adapter, 'writeBinary'),
      mkdir = vi.spyOn(s.fake.vault.adapter, 'mkdir'),
      remove = vi.spyOn(s.fake.vault.adapter, 'remove')
    const held = {
      ...request,
      assertIntent: () => {
        throw new ExternalFilePortError('recovery-required')
      },
    }
    await s.host.run(queue(), held, async (op) => {
      expect(await reason(op.stage(artifact, base))).toBe('recovery-required')
      expect(await reason(op.deleteOriginal({ ...artifact, path: source }))).toBe(
        'recovery-required'
      )
    })
    expect(write).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('capabilities expire at operation end and closing a host prevents further effects', async () => {
    const s = setup(),
      artifact = await s.artifact()
    let retained: Parameters<Parameters<typeof s.run>[0]>[0] | undefined
    await s.run(async (op) => {
      retained = op
    })
    expect(await reason(retained!.stage(artifact, base))).toBe('recovery-required')
    s.host.close()
    expect(await reason(s.run(async () => {}))).toBe('recovery-required')
    expect(await s.fake.vault.adapter.exists(staging)).toBe(false)
  })

  it('preserves changed projections, refuses occupied sidecars and leaves cleanup pending rather than hash-then-delete', async () => {
    const s = setup(),
      data = bytes('{"format":"abele.external","sample":true}'),
      artifact = await s.artifact(staging, data, 'projection')
    await s.fake.vault.adapter.writeBinary(sidecar, bytes('sample user file').buffer as ArrayBuffer)
    await s.run(async (op) => {
      await op.stage(artifact, data)
      expect(await reason(op.install(artifact, sidecar))).toBe('collision')
      expect(await op.retire({ ...artifact, path: sidecar })).toEqual({
        status: 'cleanup-pending',
        artifact: { ...artifact, path: sidecar },
      })
    })
    expect(new TextDecoder().decode(await s.fake.vault.adapter.readBinary(sidecar))).toBe(
      'sample user file'
    )
  })
})
