import { TFile } from 'obsidian'
import type { AgentTool } from '../client'
import { scopeOf, type ToolContext } from '../toolContext'
import { GlobalStore } from '@/stores/GlobalStore'
import { contentHash } from '../readGuard'
import { STORE_OVER } from '../resultStore'
import { deckReadPage } from './deckReadPage'
import { parseDeck } from '@/slides/core/markdown'
import { presentationDeck } from '@/slides/core/sources'
import { prepareDeckCreate, prepareSlideEdit, type SlideEdit } from '@/slides/core/edit'
import { inspectDeckSlide } from '@/slides/inspection'
import { DECK_VIEW_TYPE } from '@/slides/opening'
import { createCreateFileTool } from './CreateFileTool'
import { createWriteFileTool } from './WriteFileTool'

export function namedDeck(path: unknown, ctx?: ToolContext): TFile {
  if (typeof path !== 'string' || !path) throw new Error('Missing required parameter: path')
  if (!scopeOf(ctx).isInScope(path))
    throw new Error(`Access denied: ${path} is not in workspace scope`)
  const file = GlobalStore.getInstance().app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile) || file.extension !== 'md')
    throw new Error(`Presentation note not found: ${path}`)
  return file
}

export function deckSlide(value: unknown, count: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > count)
    throw new Error(`Invalid slide number; use 1–${count}`)
  return value - 1
}

const authoringRules =
  ' One idea/slide; at most ~40 body words, 5 bullets, tables 5 data rows × 3 columns with short cells. Long explanations go in > [!notes] or another slide. No body links/URLs: put source links in > [!notes] (automatic Sources slide). Use section for one-line statements and other built-in layouts; no deck CSS, colours or fonts unless requested.'

const pathProperty = {
  type: 'string',
  description: 'Presentation Markdown note path relative to vault root',
}
const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

export function createDeckTools(): AgentTool[] {
  return [
    {
      name: 'deck_read',
      label: 'Read deck',
      category: 'Presentations',
      description:
        'Read a presentation note as numbered slides with original Markdown source. Replies are bounded: small decks include full settings, layouts, regions, blocks and notes; large decks return a structural summary and an exact source character window. Continue with offset: nextOffset until null before deck_edit; the read guard marks only the source characters actually returned. limit optionally asks for a smaller source window (the total reply still stays within its budget). Learn the format and workflow with query_docs section slides.',
      parameters: {
        type: 'object',
        properties: {
          path: pathProperty,
          offset: {
            type: 'integer',
            description: 'Zero-based source character offset; use nextOffset to continue',
          },
          limit: {
            type: 'integer',
            description:
              'Optional maximum source characters; large requests are capped to the response budget',
          },
        },
        required: ['path'],
      },
      execute: async (_id, params, signal, ctx) => {
        signal?.throwIfAborted()
        const file = namedDeck(params.path, ctx)
        const source = await GlobalStore.getInstance().app.vault.read(file)
        signal?.throwIfAborted()
        const deck = parseDeck(source)
        const page = deckReadPage(file.path, source, deck, params, STORE_OVER)
        const whole = page.from === 0 && page.to === source.length
        return {
          content: [{ type: 'text', text: page.text }],
          ...(whole || page.to > page.from
            ? {
                seen: {
                  path: file.path,
                  hash: contentHash(source),
                  ...(!whole
                    ? {
                        chars: [page.from + 1, page.to] as [number, number],
                        totalChars: source.length,
                      }
                    : {}),
                },
              }
            : {}),
        }
      },
    },
    {
      name: 'deck_create',
      label: 'Create deck',
      category: 'Presentations',
      description:
        'Create a presentation Markdown note. Content must include frontmatter type: presentation and slides separated by standalone ---. Uses the ordinary file-write confirmation and preview. Does not grant script trust or HTML network consent. See query_docs section slides for a template.' +
        authoringRules,
      parameters: {
        type: 'object',
        properties: {
          path: pathProperty,
          content: {
            type: 'string',
            description: 'Complete deck Markdown, including frontmatter, layouts and notes',
          },
        },
        required: ['path', 'content'],
      },
      execute: async (id, params, signal, ctx) => {
        const content = prepareDeckCreate(params)
        if (typeof params.path !== 'string' || !params.path.endsWith('.md'))
          throw new Error('Deck path must end in .md')
        return createCreateFileTool().execute(id, { path: params.path, content }, signal, ctx)
      },
    },
    {
      name: 'deck_edit',
      label: 'Edit slide',
      category: 'Presentations',
      description:
        'Replace, insert or remove one numbered slide in a presentation note, retaining every untouched slide and deck property. Content is one slide of Markdown, optionally with a ::slide marker and speaker-notes callout, without frontmatter or a slide separator. Insert before slide N; count + 1 appends. Read the complete current deck first with deck_read or read. Uses the ordinary write diff/confirmation. Never grants script trust or HTML network consent.' +
        authoringRules,
      parameters: {
        type: 'object',
        properties: {
          path: pathProperty,
          slide: {
            type: 'integer',
            description: 'One-based slide number; count + 1 appends with insert',
          },
          operation: {
            type: 'string',
            enum: ['replace', 'insert', 'remove'],
            description: 'Default replace',
          },
          content: {
            type: 'string',
            description: 'One slide source, including its layout and notes; omit for remove',
          },
        },
        required: ['path', 'slide'],
      },
      execute: async (id, params, signal, ctx) => {
        signal?.throwIfAborted()
        const file = namedDeck(params.path, ctx)
        const old = await GlobalStore.getInstance().app.vault.read(file)
        const content = prepareSlideEdit(old, params as unknown as SlideEdit)
        return createWriteFileTool({ expectedContent: old }).execute(
          id,
          { path: file.path, content },
          signal,
          ctx
        )
      },
    },
    {
      name: 'deck_check',
      label: 'Check deck fit',
      category: 'Presentations',
      description:
        'Measure a deck at its logical canvas size in the current theme: per-slide text overflow, clipped or missing images/video, intentional cover cropping and separate warnings for >40 body words, >5 bullets, tables >5 data rows or >3 columns, >2 body links, raw URL text and deck CSS fonts/literal colours. Optional slide checks just that one (numbered from 1). Speaker notes are excluded; steps are fully revealed. Agent previews never run named scripts, interactive HTML, autoplay, or network-consent prompts, and report live content as unverified. Other plugins’ executable Markdown blocks are inert. Use screenshot with path and slide to inspect composition, then revise and check again. Fix warnings or explain why you kept them. Includes the automatic final Sources slide; deck_read/edit number authored slides only.',
      parameters: {
        type: 'object',
        properties: {
          path: pathProperty,
          slide: {
            type: 'integer',
            description: 'Optional one-based slide number; absent checks all slides sequentially',
          },
        },
        required: ['path'],
      },
      execute: async (_id, params, signal, ctx) => {
        const file = namedDeck(params.path, ctx)
        const app = GlobalStore.getInstance().app
        const deck = presentationDeck(parseDeck(await app.vault.read(file)))
        const indexes =
          params.slide === undefined
            ? deck.slides.map((_, i) => i)
            : [deckSlide(params.slide, deck.slides.length)]
        const slides = []
        for (const index of indexes)
          slides.push(
            await inspectDeckSlide(
              app,
              file.path,
              deck,
              index,
              async (_root, report) => report,
              signal
            )
          )
        return text({
          path: file.path,
          aspect: deck.settings.aspect,
          instruction:
            'Fix authoring warnings or explain why you kept them. Sources appendix is exempt from body-density rules, but check its fit.',
          slides,
        })
      },
    },
    {
      name: 'present',
      label: 'Open presentation',
      category: 'Presentations',
      description:
        'Open a presentation note in its deck tab at a numbered slide (default 1). Does not start fullscreen or a speaker show. Opening a normal deck activates its live blocks under the usual script trust and user-controlled HTML network consent; this tool cannot approve either. For a nonexecuting preview use screenshot with path and slide instead.',
      parameters: {
        type: 'object',
        properties: {
          path: pathProperty,
          slide: { type: 'integer', description: 'One-based slide number, default 1' },
        },
        required: ['path'],
      },
      execute: async (_id, params, signal, ctx) => {
        const file = namedDeck(params.path, ctx)
        const app = GlobalStore.getInstance().app
        const deck = presentationDeck(parseDeck(await app.vault.read(file)))
        const index = deckSlide(params.slide ?? 1, deck.slides.length)
        signal?.throwIfAborted()
        const leaf = app.workspace.getLeaf('tab')
        await leaf.setViewState({
          type: DECK_VIEW_TYPE,
          state: { file: file.path, slide: index },
          active: true,
        })
        return text({ path: file.path, slide: index + 1, opened: true })
      },
    },
  ]
}
