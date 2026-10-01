import { Component, MarkdownRenderer, TFile, type App } from 'obsidian'
import { parseDeck } from './core/markdown'
import type { BlockRenderer, DeckSource, MediaResolver } from './core/model'
import { noteCssImporter } from './cssImportAdapter'

export function noteRenderer(app: App, sourcePath: () => string): BlockRenderer {
  return {
    async render(block, target) {
      const owner = new Component()
      owner.load()
      try {
        // A presentation is a note. Its ordinary markdown processors remain live, not the
        // inert rendering policy used for chat output. The owner releases charts/maps/embeds.
        await MarkdownRenderer.render(app, block.source, target, sourcePath(), owner)
      } catch (error) {
        owner.unload()
        throw error
      }
      return () => owner.unload()
    },
  }
}

function linkPath(reference: string): string {
  return reference
    .trim()
    .replace(/^!?\[\[/, '')
    .replace(/\]\]$/, '')
    .split('|')[0]
}

export function noteMedia(app: App, sourcePath: () => string): MediaResolver {
  const fileOf = (reference: string) => {
    const path = linkPath(reference)
    return app.metadataCache.getFirstLinkpathDest(path.split('#')[0], sourcePath())
  }
  return {
    cssImport: noteCssImporter(app, sourcePath),
    resolve(reference) {
      if (!reference.trim()) return null
      const path = linkPath(reference)
      if (/^https?:\/\//i.test(path))
        return { url: path, video: /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i.test(path) }
      const file = fileOf(reference)
      if (!(file instanceof TFile)) return null
      return {
        url: app.vault.getResourcePath(file),
        video: /^(mp4|webm|mov|m4v)$/i.test(file.extension),
      }
    },
    async readCss(reference) {
      const file = fileOf(reference)
      return file instanceof TFile && file.extension === 'css' ? app.vault.read(file) : ''
    },
  }
}

export function noteDeckSource(app: App, file: () => TFile | null): DeckSource {
  return {
    async read() {
      const current = file()
      return parseDeck(current ? await app.vault.read(current) : '')
    },
    watch(changed) {
      const ref = app.vault.on('modify', (modified) => {
        if (modified === file() || modified.name.endsWith('.css')) changed()
      })
      return () => app.vault.offref(ref)
    },
  }
}
