import { expect, it } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([false, true])(
  'invalidates destination absence after a move, streamed=%s',
  async (streamed) => {
    const app = buildFakeVault([{ path: 'source.md', content: 'original', mtime: 1000 }])
    const disk = new ObsidianFileSystem(app as never)
    expect(await disk.stat('target.md')).toBeNull()
    const operation = {
      path: 'source.md',
      expected: await disk.fingerprint('source.md'),
      effect: { kind: 'move' as const, to: 'target.md' },
    }
    expect(
      await (streamed
        ? Reflect.get(disk, Symbol.for('abele.sync.stream-move-source-v1')).call(disk, operation)
        : disk.conditionalFile(operation))
    ).toBe(true)
    await disk.writeAtomic('target.md', new TextEncoder().encode('edited'), 2000)
    expect(await app.vault.adapter.read('target.md')).toBe('edited')
    expect(await app.vault.adapter.exists('source.md')).toBe(false)
  }
)
