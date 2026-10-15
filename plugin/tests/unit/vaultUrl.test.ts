import { describe, expect, it } from 'vitest'
import { TFile } from 'obsidian'
import { versionedUrl } from '@/helpers/vaultUrl'

describe('a vault file address', () => {
  const file = Object.assign(new TFile(), { path: 'sample-image.png', stat: { mtime: 5, size: 7, ctime: 1 } })
  it('carries the file version where the address has none', () => {
    expect(versionedUrl('app://local/sample-image.png', file)).toBe('app://local/sample-image.png?5-7')
    expect(versionedUrl('app://local/sample-image.png?1', file)).toBe('app://local/sample-image.png?1')
  })
  it('leaves a blob or data address as it is, which anything added to would break', () => {
    expect(versionedUrl('blob:http://sample.example/abc', file)).toBe('blob:http://sample.example/abc')
    expect(versionedUrl('data:image/png;base64,AAAA', file)).toBe('data:image/png;base64,AAAA')
  })
})
