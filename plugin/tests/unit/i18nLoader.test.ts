import { expect, it, vi } from 'vitest'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import { loadCatalog } from '@/i18n/loader'
import * as obsidian from 'obsidian'
import { initializePluginLocale } from '@/i18n/initialize'
import { hashes } from '../mocks/i18nAssets'
import { t } from '@/i18n'
const payload = JSON.stringify({
  version: '1.0.0',
  language: 'ru',
  catalog: { greeting: 'Привет' },
})
const hash = bytesToHex(sha256(new TextEncoder().encode(payload)))
function host(initial: Record<string, string> = {}) {
  const files = { ...initial }
  return {
    files,
    exists: async (p: string) => p === 'plugin/i18n' || p in files,
    read: async (p: string) => files[p],
    write: async (p: string, text: string) => {
      files[p] = text
    },
    mkdir: async () => {},
    list: async () => ({ files: Object.keys(files), folders: [] }),
    remove: async (p: string) => {
      delete files[p]
    },
  }
}
function options(storage = host(), request = vi.fn(async () => payload)) {
  return { storage, request, directory: 'plugin', version: '1.0.0', language: 'ru' as const, hash }
}
it('uses a validated cache without a request', async () => {
  const args = options(host({ 'plugin/i18n/ru-1.0.0.json': payload }))
  expect(await loadCatalog(args)).toEqual({ greeting: 'Привет' })
  expect(args.request).not.toHaveBeenCalled()
})
it('downloads the exact release and removes old versions after success', async () => {
  const args = options(host({ 'plugin/i18n/ru-0.9.0.json': payload }))
  expect(await loadCatalog(args)).toEqual({ greeting: 'Привет' })
  expect(args.request).toHaveBeenCalledWith(expect.stringContaining('/1.0.0/abele-i18n-ru.json'))
  expect(Object.keys(args.storage.files)).toEqual(['plugin/i18n/ru-1.0.0.json'])
})
it('rejects a bad hash and falls back offline', async () => {
  expect(await loadCatalog({ ...options(), hash: '0'.repeat(64) })).toBeUndefined()
  expect(
    await loadCatalog(
      options(
        host(),
        vi.fn(async () => {
          throw new Error('offline')
        })
      )
    )
  ).toBeUndefined()
})
it('rejects a version mismatch even with matching bytes', async () => {
  expect(await loadCatalog({ ...options(), version: '2.0.0' })).toBeUndefined()
})

it('replaces a corrupt cache with validated downloaded bytes', async () => {
  const args = options(host({ 'plugin/i18n/ru-1.0.0.json': 'corrupt' }))
  expect(await loadCatalog(args)).toEqual({ greeting: 'Привет' })
  expect(args.storage.files['plugin/i18n/ru-1.0.0.json']).toBe(payload)
  expect(args.request).toHaveBeenCalledOnce()
})

it('still translates when the cache cannot be written', async () => {
  const args = options()
  args.storage.write = async () => {
    throw new Error('read only')
  }
  expect(await loadCatalog(args)).toEqual({ greeting: 'Привет' })
})

it('bounds a stalled host download and retries on the next start', async () => {
  vi.useFakeTimers()
  const request = vi.spyOn(obsidian, 'requestUrl').mockImplementation(() => new Promise(() => {}))
  try {
    const plugin = {
      manifest: { id: 'sample', version: '1.0.0', dir: 'plugin' },
      app: { vault: { adapter: host() } },
    } as unknown as obsidian.Plugin
    const pending = initializePluginLocale(plugin, 'ru')
    await vi.advanceTimersByTimeAsync(8000)
    await pending
    expect(t('kit.cancel')).toBe('Cancel')
    request.mockRejectedValue(new Error('offline'))
    await initializePluginLocale(plugin, 'ru')
    expect(request).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    request.mockRestore()
    vi.useRealTimers()
  }
})

it('uses the host requestUrl and falls back to English without a dialog', async () => {
  const text = JSON.stringify({
    version: '1.0.0',
    language: 'ru',
    catalog: { 'kit.cancel': 'Отмена' },
  })
  hashes.ru = bytesToHex(sha256(new TextEncoder().encode(text)))
  const request = vi.spyOn(obsidian, 'requestUrl').mockResolvedValue({
    status: 200,
    text,
    headers: {},
    json: {},
    arrayBuffer: new ArrayBuffer(0),
  })
  const plugin = {
    manifest: { id: 'sample', version: '1.0.0', dir: 'plugin' },
    app: { vault: { adapter: host() } },
  } as unknown as obsidian.Plugin
  await initializePluginLocale(plugin, 'ru')
  expect(t('kit.cancel')).toBe('Отмена')
  request.mockRejectedValue(new Error('offline'))
  await initializePluginLocale(plugin, 'ru')
  // A validated copy is available offline after the first successful request.
  expect(t('kit.cancel')).toBe('Отмена')
  plugin.manifest.version = '2.0.0'
  await initializePluginLocale(plugin, 'ru')
  expect(t('kit.cancel')).toBe('Cancel')
  const count = request.mock.calls.length
  await initializePluginLocale(plugin, 'fr')
  expect(request).toHaveBeenCalledTimes(count)
  request.mockRestore()
})

it.each([[], { greeting: [] }, { greeting: { one: 'one' } }, { greeting: { other: 5 } }])(
  'rejects malformed JSON catalogs %#',
  async (catalog) => {
    const text = JSON.stringify({ version: '1.0.0', language: 'ru', catalog })
    expect(
      await loadCatalog({
        ...options(),
        request: async () => text,
        hash: bytesToHex(sha256(new TextEncoder().encode(text))),
      })
    ).toBeUndefined()
  }
)
