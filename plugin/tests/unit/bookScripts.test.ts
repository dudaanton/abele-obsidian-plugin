/**
 * Scripts run on words selected in a book: the `@book` header, the parameters the words fill,
 * `book` in the script's scope, and the sentence read off the page.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import { bookParams, bookScripts } from '@/scripting/runFromBook'
import { sentenceOf } from '@/reader/bookScriptTarget'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { BookScriptContext } from '@/scripting/bookContext'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const CARD = `// @name Word card
// @description Translate and make a card
// @icon languages
// @book
// @param word string "Word" selection
// @param deck string "Deck" = "Cards"
// @param level number? "Level"
return 1`

const BOOK: BookScriptContext = {
  text: 'melange',
  link: '[[Books/Dune.epub#cfi=/6/8!/4/2,/1:0,/1:7|Chapter 3]]',
  path: 'Books/Dune.epub',
  title: 'Dune',
  chapter: 'Chapter 3',
  sentence: 'The spice melange is everywhere.',
  cfi: 'epubcfi(/6/8!/4/2,/1:0,/1:7)',
}

const parsed = (source: string, path = 'Scripts/x.js'): ParsedScript => ({
  path,
  code: '',
  commandId: '',
  meta: parseScriptHeader(source)!,
})

describe('a script for words in a book', () => {
  it('says so in its header with @book', () => {
    expect(parseScriptHeader(CARD)?.book).toBe(true)
    expect(parseScriptHeader('// @name Plain\nreturn 1')?.book).toBeUndefined()
    const all = [parsed('// @name Zed\n// @book'), parsed('// @name Plain'), parsed(CARD)]
    expect(bookScripts(all).map((s) => s.meta.name)).toEqual(['Word card', 'Zed'])
  })

  it('gets the words in its selection parameter and its defaults, with no form to fill', () => {
    expect(bookParams(parsed(CARD), 'melange')).toEqual({
      params: { word: 'melange', deck: 'Cards' },
      missing: false,
    })
  })

  it('asks when a required parameter is still empty', () => {
    const script = parsed(
      '// @name Ask\n// @param lang string "Language"\n// @param w string "W" selection'
    )
    expect(bookParams(script, 'melange')).toEqual({ params: { w: 'melange' }, missing: true })
  })
})

describe('book in a script', () => {
  let service: ScriptService
  const register = (code: string): string => {
    const path = 'Scripts/Book.js'
    const scripts = (service as unknown as { scripts: Map<string, unknown> }).scripts
    scripts.set(path, {
      path,
      code,
      commandId: '',
      meta: { name: 'Book', description: '', params: [] },
    })
    return path
  }

  beforeEach(() => {
    useVault([])
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    ScriptRuns.destroy()
    ScriptService.destroy()
    service = ScriptService.getInstance()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('is what the reader passed, and the run remembers it for running again', async () => {
    const path = register('return [book.text, book.sentence, book.link, book.title].join(" | ")')
    const out = await service.execute(path, {}, { source: 'book', book: BOOK })
    expect(out).toBe(`melange | The spice melange is everywhere. | ${BOOK.link} | Dune`)
    const run = ScriptRuns.getInstance().runs.value[0]
    expect(run.source).toBe('book')
    expect(run.book?.cfi).toBe(BOOK.cfi)
  })

  it('is null for any other run, and a script may declare its own', async () => {
    expect(await service.execute(register('return String(book)'), {}, { source: 'command' })).toBe(
      'null'
    )
    expect(
      await service.execute(
        register('const book = 2\nreturn book'),
        {},
        { source: 'book', book: BOOK }
      )
    ).toBe('2')
  })
})

describe('the sentence around the words', () => {
  it('is the whole sentence, and every sentence the words run into', () => {
    const p = document.body.appendChild(document.createElement('p'))
    const em = document.createElement('em')
    em.textContent = 'melange'
    p.append('It was hot. The spice ', em, ' is everywhere. Nobody saw it. End.')
    const text = p.firstChild as Text
    const word = em.firstChild as Text
    const range = document.createRange()
    range.setStart(word, 0)
    range.setEnd(word, 7)
    expect(sentenceOf(range, 'en')).toBe('The spice melange is everywhere.')

    const across = document.createRange()
    across.setStart(word, 0)
    across.setEnd(p.lastChild as Text, 22)
    expect(sentenceOf(across, 'en')).toBe('The spice melange is everywhere. Nobody saw it.')
    expect(text.nodeValue).toBe('It was hot. The spice ')
  })
})
