/**
 * The address a picture from the vault is loaded from. On an iPhone or an iPad Obsidian gives a
 * file one address for every version of it, and the browser, handed that address again, shows
 * the picture it already has — so a picture changed in place (rotated, made smaller, drawn on)
 * showed its old self until Obsidian was restarted. Each version gets its own address now.
 */
import { describe, it, expect } from 'vitest'
import { TFile, type App } from 'obsidian'
import { vaultUrl } from '@/helpers/vaultUrl'
import { Gallery } from '@/entities/Gallery'
import { GlobalStore } from '@/stores/GlobalStore'

const picture = () =>
  Object.assign(new TFile(), {
    path: 'Media/a.jpg',
    name: 'a.jpg',
    extension: 'jpg',
    stat: { ctime: 1, mtime: 1000, size: 500 },
  })

/** A phone's vault: the same address whatever the file holds. */
const phone = (file: TFile) =>
  ({
    vault: { getResourcePath: () => 'capacitor://localhost/_capacitor_file_/vault/Media/a.jpg' },
    metadataCache: { getFirstLinkpathDest: () => file },
  }) as unknown as App

/** A desktop's: Obsidian's own address already says which version it is. */
const desktop = (file: TFile) =>
  ({
    vault: { getResourcePath: (f: TFile) => `app://x/vault/Media/a.jpg?${f.stat.mtime}` },
    metadataCache: { getFirstLinkpathDest: () => file },
  }) as unknown as App

describe('a picture from the vault', () => {
  it('gets another address on a phone once the file changes', () => {
    const file = picture()
    const before = vaultUrl(phone(file), file)
    file.stat = { ...file.stat, mtime: 2000 }
    expect(vaultUrl(phone(file), file)).not.toBe(before)
    expect(before.startsWith('capacitor://localhost/_capacitor_file_/vault/Media/a.jpg?')).toBe(true)
  })

  it('keeps the desktop’s own address as it is', () => {
    const file = picture()
    expect(vaultUrl(desktop(file), file)).toBe('app://x/vault/Media/a.jpg?1000')
  })

  it('in a gallery follows the file on a phone', () => {
    const file = picture()
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = phone(file)
    const gallery = new Gallery({
      file: null,
      sourcePath: 'Notes/A.md',
      images: [{ type: 'local', path: 'a.jpg', raw: '![[a.jpg]]' } as never],
      layout: 'grid',
      height: 200,
      bg: false,
    })
    const before = gallery.resolveImageUrl(gallery.images[0])
    file.stat = { ...file.stat, mtime: 2000, size: 400 }
    const after = gallery.resolveImageUrl(gallery.images[0])
    expect(after).not.toBe(before)
    // What the address differs in reaches the browser's cache: not a `#fragment`, which it drops.
    expect(after!.split('#')[0]).not.toBe(before!.split('#')[0])
  })
})
