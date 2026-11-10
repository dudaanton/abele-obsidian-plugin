import { afterEach, expect, it, vi } from 'vitest'
import { Platform } from 'obsidian'
import { hostTransport } from '@/sync/environment'

const original = { ...Platform }
afterEach(() => {
  Object.assign(Platform, original)
  vi.unstubAllGlobals()
})

it('starts a host without mobile networking and refuses requests without a fallback', async () => {
  Object.assign(Platform, { isMobile: true, isDesktop: false })
  const fallback = vi.fn()
  vi.stubGlobal('window', { fetch: fallback })
  const transport = hostTransport({})
  expect(typeof transport).toBe('function')
  await expect(transport('https://sync.example/v2/connection')).rejects.toThrow(/unsupported/)
  await expect(transport('https://sync.example/v2/connection')).rejects.toThrow(/unsupported/)
  expect(fallback).not.toHaveBeenCalled()
})

it('uses an explicit emulation dependency without opening mobile networking', async () => {
  Object.assign(Platform, { isMobile: true, isDesktop: false })
  vi.stubGlobal('window', {})
  const response = new Response('sample')
  const fetch = vi.fn().mockResolvedValue(response)
  const transport = hostTransport({ fetch })
  const controller = new AbortController()
  const init = { signal: controller.signal }
  expect(await transport('https://sync.example/v2/connection', init)).toBe(response)
  expect(fetch).toHaveBeenCalledWith('https://sync.example/v2/connection', init)
})
