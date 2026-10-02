import { afterEach, expect, it, vi } from 'vitest'
import { importClipboardImage } from '@/ai/attachments'
import { useVault } from '../helpers/testEnv'

afterEach(() => vi.unstubAllGlobals())

it('keeps a pasted SVG as an SVG attachment rather than a svg+xml file', async () => {
  const app = useVault([])
  const markup = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>'
  vi.stubGlobal('navigator', {
    clipboard: {
      read: async () => [
        {
          types: ['image/svg+xml'],
          getType: async () => new Blob([markup], { type: 'image/svg+xml' }),
        },
      ],
    },
  })
  const path = await importClipboardImage()
  expect(path).toMatch(/\.svg$/)
  const file = app.vault.getFileByPath(path!)!
  expect(new TextDecoder().decode(await app.vault.readBinary(file))).toBe(markup)
})
