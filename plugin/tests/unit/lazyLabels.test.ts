import { expect, it, vi } from 'vitest'

it('does not enumerate the English catalog until metadata labels are requested', async () => {
  const enumerate = vi.fn(() => ['sample.label'])
  vi.doMock('@/i18n/catalogs', () => ({
    english: new Proxy({ 'sample.label': 'Sample' }, { ownKeys: enumerate }),
  }))
  try {
    const { streamCUI } = await import('@/i18n/streamCLabels')
    expect(enumerate).not.toHaveBeenCalled()
    expect(streamCUI('Sample')).toBe('Sample')
    expect(streamCUI('Other')).toBe('Other')
    expect(enumerate).toHaveBeenCalledTimes(1)
  } finally {
    vi.doUnmock('@/i18n/catalogs')
  }
})
