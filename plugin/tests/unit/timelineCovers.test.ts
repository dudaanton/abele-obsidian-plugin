/**
 * The pictures the timeline has loaded: kept while they are drawn, the oldest let go past a
 * limit, and whatever is no longer in the base's notes dropped when the notes change.
 */
import { describe, it, expect } from 'vitest'
import { CoverCache } from '@/components/timelineBase/timelineCovers'

/** Pictures that are made but never load: the cache is about what it keeps. */
const made: string[] = []
const make = (url: string) => {
  made.push(url)
  return { src: url, complete: false, naturalWidth: 0 } as unknown as HTMLImageElement
}

describe('the cache of covers', () => {
  it('loads a picture once, however often it is asked for', () => {
    made.length = 0
    const cache = new CoverCache(make, () => {}, 10)
    cache.get('a')
    cache.get('a')
    expect(made).toEqual(['a'])
  })

  it('lets go of the least recently drawn past its limit', () => {
    const cache = new CoverCache(make, () => {}, 2)
    cache.get('a')
    cache.get('b')
    cache.get('a')
    cache.get('c')
    expect(cache.urls().sort()).toEqual(['a', 'c'])
  })

  it('drops what the base no longer holds', () => {
    const cache = new CoverCache(make, () => {}, 10)
    for (const u of ['a', 'b', 'c']) cache.get(u)
    cache.keepOnly(new Set(['b']))
    expect(cache.urls()).toEqual(['b'])
  })
})
