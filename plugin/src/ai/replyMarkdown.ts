import { Component } from 'obsidian'
import { renderUntrustedMarkdown } from '@/markdown/renderUntrusted'
import { messageRenderedText } from './messageComments'

/** Thin renderer adapter for verified passage mapping. No mounted DOM survives this call. */
export async function replyMarkdownText(source: string): Promise<string> {
  const root = createDiv()
  const owner = new Component()
  owner.load()
  try {
    await renderUntrustedMarkdown(root, source, owner)
    return messageRenderedText(root)
  } finally {
    owner.unload()
    root.remove()
  }
}
