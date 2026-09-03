/**
 * Starting a comment where the reader is.
 *
 * The marker goes after the end of the selection, or at the caret when there is none — the
 * first is what makes the quote resolvable, the second is what a comment with no quote is.
 * Both refuse code and frontmatter, because a marker there is not hidden, it is broken: inside
 * a fence it renders as text, and in frontmatter it breaks the YAML.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Editor, Notice, TFile } from 'obsidian'
import { commentHere } from '@/commands/commentCommands'
import { CommentService } from '@/ai/CommentService'
import { dispatchCommentsChanged } from '@/editor/CommentPlugin'
import { useVault } from '../helpers/testEnv'

// The real one walks the workspace's leaves for a live CodeMirror view; there is none here.
vi.mock('@/editor/CommentPlugin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/editor/CommentPlugin')>()),
  dispatchCommentsChanged: vi.fn(),
}))

const NOTE = 'Notes/Anchor.md'
const PROSE = 'The selected passage and more.'
const SELECTION = 'The selected passage'

const create = vi.fn()
const open = { value: null as string | null }

/**
 * A one-line document, so a character offset and a `ch` are the same number and the fake can
 * answer `posToOffset` without a document model.
 */
function fakeEditor(text: string, cursor: { ch: number; to?: number; selection?: string }): Editor {
  return {
    getValue: () => text,
    getSelection: () => cursor.selection ?? '',
    getCursor: (which?: string) => ({ line: 0, ch: which === 'to' ? (cursor.to ?? 0) : cursor.ch }),
    posToOffset: (pos: { ch: number }) => pos.ch,
  } as unknown as Editor
}

function noteFile(): TFile {
  const file = new TFile()
  file.path = NOTE
  file.basename = 'Anchor'
  file.extension = 'md'
  return file
}

beforeEach(() => {
  useVault([{ path: NOTE, content: PROSE }])
  Notice.shown.length = 0
  open.value = null
  create.mockReset().mockResolvedValue({ commentId: 'k7d2ph' })

  vi.spyOn(CommentService, 'getInstance').mockReturnValue({ create, open } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('commenting on a selection', () => {
  it('anchors at the end of the selection and quotes it', async () => {
    await commentHere(
      fakeEditor(PROSE, { ch: 0, to: SELECTION.length, selection: SELECTION }),
      noteFile()
    )

    expect(create).toHaveBeenCalledWith(expect.anything(), SELECTION.length, SELECTION)
  })

  it('leaves the new card open, with the marker repainted', async () => {
    await commentHere(
      fakeEditor(PROSE, { ch: 0, to: SELECTION.length, selection: SELECTION }),
      noteFile()
    )

    expect(open.value).toBe('k7d2ph')
    expect(vi.mocked(dispatchCommentsChanged)).toHaveBeenCalledWith(NOTE)
  })
})

describe('commenting at the caret', () => {
  it('anchors where the caret is and quotes nothing', async () => {
    await commentHere(fakeEditor(PROSE, { ch: 4 }), noteFile())

    expect(create).toHaveBeenCalledWith(expect.anything(), 4, undefined)
  })
})

describe('a place that cannot hold a marker', () => {
  it('refuses inside a fenced block and says why', async () => {
    const fenced = '```\nconst a = 1\n```'

    await commentHere(fakeEditor(fenced, { ch: 8 }), noteFile())

    expect(create).not.toHaveBeenCalled()
    expect(Notice.shown).toEqual(['A comment cannot be anchored inside code or frontmatter'])
  })

  it('refuses inside inline code', async () => {
    const inline = 'A value in `backticks` here.'

    await commentHere(fakeEditor(inline, { ch: 15 }), noteFile())

    expect(create).not.toHaveBeenCalled()
  })
})
