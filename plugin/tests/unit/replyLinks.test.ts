import { describe, expect, it } from 'vitest'
import {
  agentReplyText,
  composerText,
  openingWords,
  readAgentReplyText,
  replyNumbers,
  replyToken,
  replyTokens,
  splitComposerText,
  splitMarkedText,
  wholeQuote,
} from '@/ai/replyLinks'

const lamp = { messageId: 'm1', quote: 'keep the lamp low', start: 12 }
const wait = { messageId: 'm2', quote: 'Wait for the light to turn and then go on.' }

describe('places in the composer', () => {
  it('keeps a place in the text as a token of plain letters, read back whole', () => {
    const token = replyToken({ ...lamp, quote: 'keep the\n lamp «low»' })
    expect(token.slice(1, -1)).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(replyTokens(`a ${token} b`)).toEqual([
      { from: 2, to: 2 + token.length, reply: { ...lamp, quote: 'keep the lamp «low»' } },
    ])
  })

  it('sends the words alone, each place where it stood in them', () => {
    const text = `${replyToken(lamp)} How low? ${replyToken(wait)}\nAnd then?`
    expect(splitComposerText(text)).toEqual({
      text: ' How low? \nAnd then?',
      replyTo: [
        { ...lamp, at: 0 },
        { ...wait, at: 10 },
      ],
    })
  })

  it('drops a token that cannot be read, leaving nothing of it', () => {
    expect(splitComposerText('a !!b zzc')).toEqual({
      text: 'a !!b c',
      replyTo: [],
    })
  })

  it('puts a sent question back into the composer with its places where they stood', () => {
    const text = `Before ${replyToken(lamp)} between ${replyToken(wait)} after`
    const sent = splitComposerText(text)
    expect(composerText(sent.text, sent.replyTo)).toBe(text)
  })

  it('numbers the same place once', () => {
    expect(replyNumbers([lamp, wait, { ...lamp }])).toEqual([1, 2, 1])
  })

  it('answers a whole message by its opening, cut at a word', () => {
    const quote = wholeQuote(`${'word '.repeat(100)}end`, 40)
    expect(quote.endsWith('…')).toBe(true)
    expect(quote.length).toBeLessThanOrEqual(41)
    expect(wholeQuote('Short\n answer.')).toBe('Short answer.')
  })
})

describe('what the agent is given', () => {
  it('gives the links over the words, a marker where each stands, never the words answered', () => {
    const long = {
      messageId: 'm3',
      quote: 'one two three four five six seven eight nine ten',
      start: 0,
    }
    const text = agentReplyText('How low?And then', [
      { ...lamp, at: 0 },
      { ...long, at: 8 },
    ])
    expect(text).toBe(
      [
        '<reply-links>',
        'The person replies to places in earlier messages of this chat. Each link names the message, the words in it and how they begin; [reply N] in the text stands where that link was put.',
        '[reply 1] message m1, characters 12-29, begins: keep the lamp low',
        '[reply 2] message m3, characters 0-48, begins: one two three four five six seven eight…',
        '</reply-links>',
        '',
        '[reply 1] How low? [reply 2] And then',
      ].join('\n')
    )
    expect(text).not.toContain('nine ten')
  })

  it('names a whole message as such, and the same place twice as one link', () => {
    const text = agentReplyText('a b', [
      { ...wait, at: 0 },
      { ...wait, at: 2 },
    ])
    expect(
      text.match(
        /^\[reply 1\] message m2, the whole message, begins: Wait for the light to turn and then…$/m
      )
    ).toBeTruthy()
    expect(text.match(/^\[reply \d+\] message/gm)).toHaveLength(1)
    expect(text.endsWith('[reply 1] a [reply 1] b')).toBe(true)
  })

  it('gives a question without places as it was written', () => {
    expect(agentReplyText('Plain words.')).toBe('Plain words.')
    expect(agentReplyText('Plain words.', [])).toBe('Plain words.')
  })

  it('reads a question back from what the agent was given', () => {
    const given = agentReplyText('How low? And then', [
      { ...lamp, at: 0 },
      { ...wait, at: 9 },
    ])
    expect(readAgentReplyText(given)).toEqual({
      content: 'How low? And then',
      replyTo: [
        { messageId: 'm1', quote: 'keep the lamp low', start: 12, at: 0 },
        { messageId: 'm2', quote: 'Wait for the light to turn and then', at: 9 },
      ],
    })
    expect(readAgentReplyText('Just words [reply 1].')).toBeNull()
  })

  it('shows at most eight opening words', () => {
    expect(openingWords('a b c d e f g h i')).toBe('a b c d e f g h…')
    expect(openingWords('a\n b')).toBe('a b')
  })
})

describe('places in a plain text box', () => {
  it('reads each marker of a kept place, and leaves any other as words', () => {
    const places = new Map([
      [1, lamp],
      [2, wait],
    ])
    expect(splitMarkedText('[↩2] Why? [↩1] and [↩7]', places)).toEqual({
      text: ' Why?  and [↩7]',
      replyTo: [
        { ...wait, at: 0 },
        { ...lamp, at: 6 },
      ],
    })
  })
})
