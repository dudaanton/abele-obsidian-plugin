import { describe, expect, it, vi } from 'vitest'
import { saveImageToVault } from '@/ai/tools/imageUtils'
import { useVault } from '../helpers/testEnv'

describe('images saved to the configured attachment folder', () => {
  it('saves in the vault root for the same-folder setting when there is no note', async () => {
    const app = useVault([])
    Object.assign(app.vault, { getConfig: () => './' })
    const createFolder = vi
      .spyOn(app.vault, 'createFolder')
      .mockRejectedValue(new Error('Folder already exists.'))
    const path = await saveImageToVault('data:image/png;base64,c2FtcGxl', 'sample-image')
    expect(path).toBe('sample-image.png')
    expect(createFolder).not.toHaveBeenCalled()
  })
})
