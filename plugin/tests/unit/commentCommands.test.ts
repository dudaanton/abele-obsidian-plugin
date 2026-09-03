/**
 * Starting a comment where the reader is.
 *
 * The marker goes after the end of the selection, or at the caret when there is none — the
 * first is what makes the quote resolvable, the second is what a comment with no quote is.
 * Both refuse code and frontmatter, because a marker there is not hidden, it is broken: inside
 * a fence it renders as text, and in frontmatter it breaks the YAML.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Editor, MarkdownView, Notice, TFile } from 'obsidian'
import { commentHere, commentHereInView } from '@/commands/commentCommands'
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

    // The fourth argument is where the selection started: a marker inside it is one the
    // comment is about, and `insertMarker` merges into it rather than writing a neighbour.
    expect(create).toHaveBeenCalledWith(expect.anything(), SELECTION.length, SELECTION, 0)
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

    expect(create).toHaveBeenCalledWith(expect.anything(), 4, undefined, 4)
  })
})

/**
 * The phone's cases. A marker is drawn as an atomic widget, so a selection dragged as far as
 * the icon does not stop at the marker's start — it covers it, and what comes back from
 * `getSelection` has the raw `%%c:…%%` in the middle of it.
 */
describe('commenting on a passage that already carries a marker', () => {
  const MARKED = `${SELECTION}%%c:k7d2ph%% and more.`

  it('takes the marker out of the quote it saves', async () => {
    const covered = `${SELECTION}%%c:k7d2ph%%`

    await commentHere(
      fakeEditor(MARKED, { ch: 0, to: covered.length, selection: covered }),
      noteFile()
    )

    // The quote is the reader's prose, never our syntax: with the marker left in it, nothing
    // in the note would ever match it again and the passage would lose its underline.
    expect(create).toHaveBeenCalledWith(expect.anything(), covered.length, SELECTION, 0)
  })

  it('starts a comment from a caret inside the marker rather than refusing it', async () => {
    await commentHere(fakeEditor(MARKED, { ch: SELECTION.length + 4 }), noteFile())

    expect(Notice.shown).toEqual([])
    expect(create).toHaveBeenCalled()
  })

  it('quotes nothing when the selection was only a marker', async () => {
    const marker = '%%c:k7d2ph%%'

    await commentHere(
      fakeEditor(MARKED, {
        ch: SELECTION.length,
        to: SELECTION.length + marker.length,
        selection: marker,
      }),
      noteFile()
    )

    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      SELECTION.length + marker.length,
      undefined,
      SELECTION.length
    )
  })
})

/**
 * Selecting something that is not prose.
 *
 * The end of a selection is wherever a finger let go, and half of Markdown is a construct that
 * `%%c:…%%` dropped into its middle destroys. `anchorFor` carries the marker out to the end of
 * whatever it landed in; what is checked here is that the quote is carried with it, because a
 * quote that stops halfway through a link is a quote the note no longer contains.
 */
describe('commenting on a selection that ended inside a construct', () => {
  const LINKED = 'Go [[target|shown]] now.'

  it('anchors past the closing brackets and quotes the whole link', async () => {
    const cut = 'Go [[target|sho'

    await commentHere(fakeEditor(LINKED, { ch: 0, to: cut.length, selection: cut }), noteFile())

    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      'Go [[target|shown]]'.length,
      'Go [[target|shown]]',
      0
    )
  })

  it('leaves a selection that stopped cleanly where it stopped', async () => {
    const whole = 'Go [[target|shown]]'

    await commentHere(fakeEditor(LINKED, { ch: 0, to: whole.length, selection: whole }), noteFile())

    expect(create).toHaveBeenCalledWith(expect.anything(), whole.length, whole, 0)
  })

  /** No selection, so no quote — but the caret is still carried out of the embed. */
  it('carries a caret dropped inside an embed out of it', async () => {
    const embed = 'See ![[pic.png]] here.'

    await commentHere(fakeEditor(embed, { ch: 'See ![[pic.p'.length }), noteFile())

    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      'See ![[pic.png]]'.length,
      undefined,
      'See ![[pic.p'.length
    )
  })
})

describe('a place that cannot hold a marker', () => {
  it('refuses inside a fenced block and says why', async () => {
    const fenced = '```\nconst a = 1\n```'

    await commentHere(fakeEditor(fenced, { ch: 8 }), noteFile())

    expect(create).not.toHaveBeenCalled()
    expect(Notice.shown).toEqual([
      'A comment cannot be anchored inside code, frontmatter or a table divider',
    ])
  })

  /**
   * The row of dashes is the whole of what makes those lines a table: a marker anywhere on it
   * leaves the block rendering as raw pipes, and there is nothing on the line to move past.
   */
  it('refuses the row of dashes that shapes a table', async () => {
    const table = '| a | b |\n| --- | --- |\n| one | two |'

    await commentHere(fakeEditor(table, { ch: table.indexOf('| ---') + 5 }), noteFile())

    expect(create).not.toHaveBeenCalled()
    expect(Notice.shown).toEqual([
      'A comment cannot be anchored inside code, frontmatter or a table divider',
    ])
  })

  /** Inline code is no longer one of them: there is a backtick to move past. */
  it('carries a caret inside inline code out to the closing backtick', async () => {
    const inline = 'A value in `backticks` here.'

    await commentHere(fakeEditor(inline, { ch: 15 }), noteFile())

    expect(Notice.shown).toEqual([])
    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      'A value in `backticks`'.length,
      undefined,
      15
    )
  })
})

describe('the two entry points', () => {
  /**
   * The buffer runs ahead of the file. Obsidian writes an edited note out on a debounce, and
   * `CommentService.create` edits the *file* through `vault.process` — so a comment made on a
   * paragraph typed a second ago would put the marker at an offset the file does not have,
   * and the write would drop everything since the last save.
   */
  it('writes the note out before it asks for a marker', async () => {
    const order: string[] = []
    const save = vi.fn(async () => {
      order.push('save')
    })
    create.mockImplementation(async () => {
      order.push('create')
      return { commentId: 'k7d2ph' }
    })

    const view = {
      file: noteFile(),
      editor: fakeEditor(PROSE, { ch: 0, to: SELECTION.length, selection: SELECTION }),
      save,
    } as unknown as MarkdownView

    await commentHereInView(view)

    expect(order).toEqual(['save', 'create'])
  })

  it('does nothing in a pane with no file', async () => {
    const save = vi.fn(async () => {})
    const view = {
      file: null,
      editor: fakeEditor(PROSE, { ch: 0 }),
      save,
    } as unknown as MarkdownView

    await commentHereInView(view)

    expect(save).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })
})
