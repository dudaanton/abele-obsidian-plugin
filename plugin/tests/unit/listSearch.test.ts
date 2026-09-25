/**
 * The matching under the search in the task and log lists: what counts as a hit, and where the
 * words sit in what is on screen so they can be marked.
 */
import { describe, it, expect } from 'vitest'
import { findTextRanges, matchesTerms, searchTerms } from '@/helpers/listSearch'

describe('searchTerms', () => {
  it('splits a query into lowercased words', () => {
    expect(searchTerms('  Buy   MILK ')).toEqual(['buy', 'milk'])
  })

  it('has no words for a blank query', () => {
    expect(searchTerms('   ')).toEqual([])
  })

  it('lowercases Cyrillic too', () => {
    expect(searchTerms('Купить Молоко')).toEqual(['купить', 'молоко'])
  })
})

describe('matchesTerms', () => {
  it('needs every word, in any order', () => {
    const text = 'buy milk on the way home'
    expect(matchesTerms(text, ['home', 'milk'])).toBe(true)
    expect(matchesTerms(text, ['milk', 'bread'])).toBe(false)
  })

  it('matches inside a word', () => {
    expect(matchesTerms('groceries', ['cer'])).toBe(true)
  })

  it('matches everything when there is nothing to look for', () => {
    expect(matchesTerms('anything', [])).toBe(true)
  })
})

describe('findTextRanges', () => {
  function rootOf(html: string): HTMLElement {
    const root = document.createElement('div')
    root.append(...Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes))
    return root
  }

  it('finds every occurrence of every word, whatever its case', () => {
    const root = rootOf('<p>Milk and more milk</p><p>No <b>MILK</b> here, only bread</p>')
    const ranges = findTextRanges(root, ['milk', 'bread'])

    expect(ranges.map((r) => r.toString())).toEqual(['Milk', 'milk', 'MILK', 'bread'])
  })

  it('finds nothing for no words', () => {
    expect(findTextRanges(rootOf('<p>milk</p>'), [])).toEqual([])
  })

  it('leaves out what is not shown text, such as a style block', () => {
    const root = rootOf('<style>.milk { color: red }</style><p>milk</p>')
    expect(findTextRanges(root, ['milk'])).toHaveLength(1)
  })
})
