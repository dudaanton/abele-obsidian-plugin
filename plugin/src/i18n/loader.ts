import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'
import type { Catalog, Language } from './core'

interface Storage {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  write(path: string, data: string): Promise<unknown>
  mkdir(path: string): Promise<unknown>
  list(path: string): Promise<{ files: string[] }>
  remove(path: string): Promise<unknown>
}

function isCatalog(value: unknown): value is Catalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const forms = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
  return Object.values(value).every((message) =>
    typeof message === 'string'
      ? message.trim().length > 0
      : message &&
        typeof message === 'object' &&
        !Array.isArray(message) &&
        typeof message.other === 'string' &&
        Object.entries(message).every(
          ([form, text]) => forms.has(form) && typeof text === 'string' && text.trim().length > 0
        )
  )
}

/** Transport and storage are injected so the loader works independently of the host. */
export async function loadCatalog(options: {
  storage: Storage
  request: (url: string) => Promise<string>
  directory: string
  version: string
  language: Exclude<Language, 'en'>
  hash: string
  releaseBase?: string
}): Promise<Catalog | undefined> {
  const { storage, request, directory, version, language, hash } = options
  const dir = `${directory}/i18n`
  const path = `${dir}/${language}-${version}.json`
  const validate = (text: string): Catalog => {
    if (bytesToHex(sha256(new TextEncoder().encode(text))) !== hash)
      throw new Error('Checksum mismatch')
    const value: unknown = JSON.parse(text)
    if (
      !value ||
      typeof value !== 'object' ||
      !('version' in value) ||
      value.version !== version ||
      !('language' in value) ||
      value.language !== language ||
      !('catalog' in value) ||
      !isCatalog(value.catalog)
    )
      throw new Error('Invalid translation asset')
    return value.catalog
  }
  try {
    if (await storage.exists(path)) {
      try {
        return validate(await storage.read(path))
      } catch {
        console.debug('[i18n] Invalid cached catalog; downloading again')
      }
    }
    const text = await request(
      `${options.releaseBase ?? 'https://github.com/dudaanton/abele-obsidian-plugin/releases/download'}/${encodeURIComponent(version)}/abele-i18n-${language}.json`
    )
    const catalog = validate(text)
    try {
      if (!(await storage.exists(dir))) await storage.mkdir(dir)
      await storage.write(path, text)
      for (const old of (await storage.list(dir)).files) {
        const name = old.slice(dir.length + 1)
        if (/^(ru|lv|es|de)-\d+\.\d+\.\d+\.json$/.test(name) && !name.endsWith(`-${version}.json`))
          await storage.remove(old)
      }
    } catch {
      console.debug('[i18n] Could not persist translation cache')
    }
    return catalog
  } catch {
    console.debug('[i18n] Translation unavailable; using English until next start')
    return undefined
  }
}
