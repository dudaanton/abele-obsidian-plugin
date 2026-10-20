import { expect, it, vi } from 'vitest'
import { externalPreview, saveExternalPreview } from '@/sync/external/preview'
import { buildFakeVault } from '../helpers/fakeVault'
import { sha256 } from '@abele/sync-sdk/core'

it('bounds the browser-generated image to 512 pixels and releases its object URL', async () => {
  const app = buildFakeVault([{ path: 'Media/sample.png', content: 'sample image' }])
  const sha = await sha256(new TextEncoder().encode('sample image'))
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 2048
      naturalHeight = 1024
      src = ''
      async decode() {}
    }
  )
  const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample-preview')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const draw = vi.fn()
  const context = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ drawImage: draw } as never)
  const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement
  ) {
    expect([this.width, this.height]).toEqual([512, 256])
    return 'data:image/jpeg;base64,c2FtcGxl'
  })
  try {
    expect(await saveExternalPreview(app as never, 'Media/sample.png', sha)).toBe(sha)
    expect(draw).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:sample-preview')
  } finally {
    url.mockRestore()
    revoke.mockRestore()
    context.mockRestore()
    encode.mockRestore()
    vi.unstubAllGlobals()
  }
})

it('keeps a bounded preview locally by content hash without creating a vault file', async () => {
  const app = buildFakeVault([{ path: 'Media/sample.png', content: 'sample image' }])
  const sha = await sha256(new TextEncoder().encode('sample image'))
  const render = vi.fn(async () => 'data:image/jpeg;base64,c2FtcGxl')
  const before = app.vault.getFiles().map((file) => file.path)
  expect(await saveExternalPreview(app as never, 'Media/sample.png', sha, render)).toBe(sha)
  expect(externalPreview(app as never, sha)).toBe('data:image/jpeg;base64,c2FtcGxl')
  expect(app.vault.getFiles().map((file) => file.path)).toEqual(before)
  expect(
    await saveExternalPreview(app as never, 'Media/sample.png', 'a'.repeat(64), render)
  ).toBeUndefined()
  app.saveLocalStorage('abele-external-previews-v1', {})
  expect(
    await saveExternalPreview(
      app as never,
      'Media/sample.png',
      sha,
      async () => 'data:image/jpeg;base64,' + 'A'.repeat(70000)
    )
  ).toBeUndefined()
})
