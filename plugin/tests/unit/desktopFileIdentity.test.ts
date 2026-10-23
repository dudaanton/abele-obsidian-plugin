import { expect, it } from 'vitest'
import { desktopFileIdentity } from '@/sync/desktopFileIdentity'
import { nativeOf } from '@/sync/vaultPathLinks'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

it('models desktop bigint identity across rename and recreation', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'sample bytes' }])
  withDesktopFs(app)
  const port = nativeOf(app.vault.adapter)!
  const before = await port.fileIdentity!('sample.md')
  expect(before).toMatch(/^node-v1:/)
  await app.vault.adapter.rename('sample.md', 'moved.md')
  expect(await port.fileIdentity!('moved.md')).toBe(before)
  await app.vault.adapter.write('sample.md', 'sample bytes')
  expect(await port.fileIdentity!('sample.md')).not.toBe(before)
})

it('distinguishes recycled inodes by exact nanosecond birth time', () => {
  const first = { dev: 3n, ino: 9007199254740993n, birthtimeNs: 1700000000000000001n }
  expect(desktopFileIdentity(first)).toBe('node-v1:3:9007199254740993:1700000000000000001')
  expect(desktopFileIdentity({ ...first, birthtimeNs: first.birthtimeNs + 1n })).not.toBe(
    desktopFileIdentity(first)
  )
  expect(desktopFileIdentity({ ...first, dev: 4n })).not.toBe(desktopFileIdentity(first))
})

it.each([
  { dev: 3n, ino: 4n },
  { dev: 3n, ino: 4n, birthtimeNs: 0n },
  { dev: 3n, ino: 4n, birthtimeNs: -1n },
  { dev: 3, ino: 4, birthtimeNs: 1700000000000000001n },
  { dev: 3n, ino: 4n, birthtimeMs: 1700000000000 },
])('refuses identity authority without exact birth evidence: case %#', (stat) => {
  expect(desktopFileIdentity(stat)).toBeNull()
})
