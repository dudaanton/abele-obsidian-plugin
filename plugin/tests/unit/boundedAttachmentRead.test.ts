import { expect, it, vi } from 'vitest'
import { verifyBoundedAttachmentRead } from '../e2e/helpers/boundedAttachmentRead'

it('verifies a 200 MiB default-size fixture through bounded version reads with no whole download', async () => {
  const size = 200 * 1024 * 1024
  const source = {
    size,
    read: vi.fn(async (_offset: number, length: number) => new Uint8Array(length).fill(90)),
    assertUnchanged: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  const probe = {
    verify: vi.fn(async () => ({ verified: true })),
    openVersion: vi.fn(async () => source),
    download: vi.fn(() => {
      throw new Error('whole download')
    }),
  }
  expect(
    await verifyBoundedAttachmentRead(
      probe,
      {
        fileId: 'sample-file',
        versionId: 'sample-version',
        path: 'sample.bin',
        sha: 'a'.repeat(64),
        size,
      },
      90
    )
  ).toBe(true)
  expect(source.read).toHaveBeenCalledTimes(200)
  expect(source.read.mock.calls.every(([, length]) => length <= 1024 * 1024)).toBe(true)
  expect(source.close).toHaveBeenCalledOnce()
  expect(probe.download).not.toHaveBeenCalled()
})
it('rejects corrupt bytes and releases its source', async () => {
  const source = {
    size: 4,
    read: async () => new Uint8Array(4),
    assertUnchanged: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
  const probe = { verify: async () => ({ verified: true }), openVersion: async () => source }
  expect(
    await verifyBoundedAttachmentRead(
      probe,
      {
        fileId: 'sample-file',
        versionId: 'sample-version',
        path: 'sample.bin',
        sha: 'a'.repeat(64),
        size: 4,
      },
      90
    )
  ).toBe(false)
  expect(source.close).toHaveBeenCalledOnce()
})
