/**
 * The comment marker syntax, `%%c:k7d2ph%%`.
 *
 * The marker is the only record of a comment that lives in the user's note, so everything
 * here is about not corrupting their text: a marker inside a code fence is somebody's
 * example and not ours, a second comment on the same passage extends the marker it finds
 * rather than writing another beside it, and deleting the last id takes the marker with it.
 */
import { describe, it, expect } from 'vitest'
import {
  COMMENT_ID_RE,
  COMMENT_MARKER_RE,
  insertMarker,
  isCommentablePosition,
  markerText,
  newCommentId,
  parseMarkers,
  removeMarkerId,
  resolveQuote,
  stripMarkers,
} from '@/editor/commentMarkers'

/** `exec` on a global regex carries `lastIndex` between calls; tests must not inherit it. */
function matchAll(text: string): string[] {
  COMMENT_MARKER_RE.lastIndex = 0
  return [...text.matchAll(COMMENT_MARKER_RE)].map((match) => match[1])
}

describe('the marker regex', () => {
  it('reads one id and several', () => {
    expect(matchAll('a%%c:k7d2ph%%b')).toEqual(['k7d2ph'])
    expect(matchAll('a%%c:k7d2ph,3mq0xa%%b')).toEqual(['k7d2ph,3mq0xa'])
  })

  it('refuses anything that is not six lowercase alphanumerics', () => {
    expect(matchAll('%%c:k7d2p%%')).toEqual([])
    expect(matchAll('%%c:k7d2phh%%')).toEqual([])
    expect(matchAll('%%c:K7D2PH%%')).toEqual([])
    expect(matchAll('%%c:%%')).toEqual([])
    expect(matchAll('%%c:k7d2ph,%%')).toEqual([])
  })
})

describe('generating an id', () => {
  it('produces six characters of the marker alphabet', () => {
    expect(COMMENT_ID_RE.test(newCommentId())).toBe(true)
  })

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCommentId()))

    expect(ids.size).toBe(200)
  })
})

describe('writing a marker', () => {
  it('joins the ids with commas', () => {
    expect(markerText(['k7d2ph'])).toBe('%%c:k7d2ph%%')
    expect(markerText(['k7d2ph', '3mq0xa'])).toBe('%%c:k7d2ph,3mq0xa%%')
  })
})

describe('finding the markers in a note', () => {
  it('reports position and ids', () => {
    const text = 'The selected passage%%c:k7d2ph%% and more.'

    expect(parseMarkers(text)).toEqual([{ from: 20, to: 32, ids: ['k7d2ph'] }])
  })

  it('reads several ids at one marker', () => {
    expect(parseMarkers('x%%c:k7d2ph,3mq0xa%%')[0].ids).toEqual(['k7d2ph', '3mq0xa'])
  })

  it('finds every marker in document order', () => {
    const text = 'a%%c:aaaaaa%%b%%c:bbbbbb%%'

    expect(parseMarkers(text).map((marker) => marker.from)).toEqual([1, 14])
  })

  it('ignores a marker inside a fenced code block', () => {
    const text = [
      'before%%c:aaaaaa%%',
      '```js',
      'const x = 1 // %%c:bbbbbb%%',
      '```',
      'after',
    ].join('\n')

    expect(parseMarkers(text).map((marker) => marker.ids[0])).toEqual(['aaaaaa'])
  })

  it('ignores a marker inside inline code and keeps the one beside it', () => {
    const text = 'call `x %%c:aaaaaa%%` here%%c:bbbbbb%%'

    expect(parseMarkers(text).map((marker) => marker.ids[0])).toEqual(['bbbbbb'])
  })

  it('ignores a marker in the frontmatter', () => {
    const text = ['---', 'title: A %%c:aaaaaa%%', '---', 'Body%%c:bbbbbb%%'].join('\n')

    expect(parseMarkers(text).map((marker) => marker.ids[0])).toEqual(['bbbbbb'])
  })

  it('treats a fence that is never closed as running to the end', () => {
    const text = ['~~~', 'still code %%c:aaaaaa%%'].join('\n')

    expect(parseMarkers(text)).toEqual([])
  })
})

describe('deciding whether a comment can go here', () => {
  const fenced = ['prose', '```', 'code', '```', 'more'].join('\n')

  it('allows a position in prose', () => {
    expect(isCommentablePosition(fenced, 5)).toBe(true)
  })

  it('refuses a position inside a fence, including its own lines', () => {
    expect(isCommentablePosition(fenced, fenced.indexOf('code') + 2)).toBe(false)
    expect(isCommentablePosition(fenced, fenced.indexOf('```'))).toBe(false)
  })

  it('refuses a position in the frontmatter', () => {
    const text = ['---', 'title: A', '---', 'Body'].join('\n')

    expect(isCommentablePosition(text, 0)).toBe(false)
    expect(isCommentablePosition(text, text.indexOf('title') + 3)).toBe(false)
    expect(isCommentablePosition(text, text.indexOf('Body') + 4)).toBe(true)
  })

  it('refuses inside inline code but allows the position right after it', () => {
    const text = 'call `here` now'

    expect(isCommentablePosition(text, text.indexOf('here') + 1)).toBe(false)
    expect(isCommentablePosition(text, text.indexOf('` now') + 1)).toBe(true)
  })

  /**
   * A position inside a marker used to be refused, because writing a marker there would have
   * nested one inside the other. It merges now — `insertMarker` appends the id to whatever it
   * lands on — and a phone is where this matters: the widget is atomic, so a selection dragged
   * onto the icon ends on the marker rather than beside it.
   */
  it('allows a position inside an existing marker, which merges into it', () => {
    const text = 'x%%c:k7d2ph%%y'

    expect(isCommentablePosition(text, 5)).toBe(true)
    expect(isCommentablePosition(text, 1)).toBe(true)
    expect(isCommentablePosition(text, 13)).toBe(true)
  })
})

describe('inserting a marker', () => {
  it('writes a new marker at the position', () => {
    const result = insertMarker('Passage and more.', 7, 'k7d2ph')

    expect(result.text).toBe('Passage%%c:k7d2ph%% and more.')
    expect(result.marker).toEqual({ from: 7, to: 19, ids: ['k7d2ph'] })
  })

  it('appends the id to the marker that already starts there', () => {
    const result = insertMarker('Passage%%c:k7d2ph%% and more.', 7, '3mq0xa')

    expect(result.text).toBe('Passage%%c:k7d2ph,3mq0xa%% and more.')
    expect(result.marker).toEqual({ from: 7, to: 26, ids: ['k7d2ph', '3mq0xa'] })
  })

  it('writes a separate marker when the position is not a marker start', () => {
    const result = insertMarker('Passage%%c:k7d2ph%% and more.', 23, '3mq0xa')

    expect(result.text).toBe('Passage%%c:k7d2ph%% and%%c:3mq0xa%% more.')
  })

  /**
   * The phone's cases, which is where a second comment on the same passage was ending up as a
   * second icon beside the first — two markers, one comment each, and no count on either.
   *
   * The widget is atomic, so a selection dragged as far as the icon does not stop politely at
   * the marker's start: it ends on the marker's far side, or somewhere in the middle of it.
   * Each of these is the same act as the exact hit and merges the same way.
   */
  describe('near an existing marker', () => {
    const DOC = 'Passage%%c:k7d2ph%% and more.'

    it('appends when the selection ended on the far side of the marker', () => {
      const result = insertMarker(DOC, 19, '3mq0xa')

      expect(result.text).toBe('Passage%%c:k7d2ph,3mq0xa%% and more.')
      expect(result.marker.ids).toEqual(['k7d2ph', '3mq0xa'])
    })

    it('appends when the position fell inside the marker', () => {
      expect(insertMarker(DOC, 18, '3mq0xa').text).toBe('Passage%%c:k7d2ph,3mq0xa%% and more.')
      expect(insertMarker(DOC, 12, '3mq0xa').text).toBe('Passage%%c:k7d2ph,3mq0xa%% and more.')
    })

    it('appends across the space that follows the marker', () => {
      expect(insertMarker(DOC, 20, '3mq0xa').text).toBe('Passage%%c:k7d2ph,3mq0xa%% and more.')
    })

    it('appends across the space that precedes the marker', () => {
      const spaced = 'Passage %%c:k7d2ph%% and more.'

      expect(insertMarker(spaced, 7, '3mq0xa').text).toBe('Passage %%c:k7d2ph,3mq0xa%% and more.')
    })

    it('appends when the selection swallowed the marker whole', () => {
      // "passage%%c:k7d2ph%% and", selected from 0: the marker is inside what was chosen.
      const result = insertMarker(DOC, 23, '3mq0xa', 0)

      expect(result.text).toBe('Passage%%c:k7d2ph,3mq0xa%% and more.')
    })

    it('leaves a marker on another line alone', () => {
      const lines = 'Passage%%c:k7d2ph%%\nA second paragraph.'

      expect(insertMarker(lines, 20, '3mq0xa').text).toBe(
        'Passage%%c:k7d2ph%%\n%%c:3mq0xa%%A second paragraph.'
      )
    })

    it('takes the nearer marker when two of them are in reach', () => {
      const two = 'a%%c:aaaaaa%%   %%c:bbbbbb%%b'

      expect(insertMarker(two, 15, 'cccccc').text).toBe('a%%c:aaaaaa%%   %%c:bbbbbb,cccccc%%b')
    })
  })
})

describe('removing an id from a marker', () => {
  it('takes one id out and leaves the marker', () => {
    expect(removeMarkerId('x%%c:k7d2ph,3mq0xa%%y', 'k7d2ph')).toBe('x%%c:3mq0xa%%y')
  })

  it('takes the whole marker out when the id was the last', () => {
    expect(removeMarkerId('x%%c:k7d2ph%%y', 'k7d2ph')).toBe('xy')
  })

  it('leaves the note alone when the id is not in it', () => {
    expect(removeMarkerId('x%%c:k7d2ph%%y', '3mq0xa')).toBe('x%%c:k7d2ph%%y')
  })
})

describe('stripping markers for the agent', () => {
  it('removes every marker and leaves the prose', () => {
    expect(stripMarkers('One%%c:aaaaaa%% two%%c:bbbbbb,cccccc%% three.')).toBe('One two three.')
  })

  it('can be called twice with the same result', () => {
    expect(stripMarkers(stripMarkers('One%%c:aaaaaa%%.'))).toBe('One.')
  })

  it('leaves a marker inside a fenced code block alone', () => {
    // Documentation of this very syntax is the case: the fenced example is the user's prose
    // about markers, not a marker, and stripping it would edit what they wrote.
    const text = ['Real%%c:aaaaaa%%', '```', 'Example: %%c:bbbbbb%%', '```'].join('\n')

    expect(stripMarkers(text)).toBe(['Real', '```', 'Example: %%c:bbbbbb%%', '```'].join('\n'))
  })
})

describe('resolving the quoted range', () => {
  it('takes the text ending at the marker when it still matches', () => {
    const text = 'The selected passage%%c:k7d2ph%% and more.'
    const marker = parseMarkers(text)[0]

    expect(resolveQuote(text, marker, 'selected passage')).toEqual({ from: 4, to: 20 })
  })

  it('falls back to the nearest occurrence elsewhere', () => {
    const text = 'A moved passage sits here.\n\nEdited%%c:k7d2ph%%'
    const marker = parseMarkers(text)[0]

    expect(resolveQuote(text, marker, 'moved passage')).toEqual({ from: 2, to: 15 })
  })

  it('picks the occurrence closest to the marker when there are several', () => {
    // The text ending at the marker is ' here', so rule one misses and both occurrences of
    // "quote" are candidates; the one ten characters back beats the one at the top.
    const text = 'quote at the top.\n\nedited quote sits here%%c:k7d2ph%% now'
    const marker = parseMarkers(text)[0]

    expect(resolveQuote(text, marker, 'quote')).toEqual({ from: 26, to: 31 })
  })

  it('gives nothing when the quote is gone', () => {
    const text = 'Nothing like it here%%c:k7d2ph%%'
    const marker = parseMarkers(text)[0]

    expect(resolveQuote(text, marker, 'a passage that was deleted')).toBeNull()
  })

  it('gives nothing for a cursor comment, which has no quote', () => {
    const text = 'A cursor comment:%%c:v9s1bn%% here'
    const marker = parseMarkers(text)[0]

    expect(resolveQuote(text, marker, undefined)).toBeNull()
  })
})
