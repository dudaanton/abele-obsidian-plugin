import { describe, it, expect, afterEach } from 'vitest'
import { claimVueSetters, VUE_SETTER_KEYS } from '@/helpers/vueGlobals'

type Setter = (v: unknown) => void
const g = globalThis as unknown as Record<string, Setter[] | undefined>
const saved = VUE_SETTER_KEYS.map((k) => [k, g[k]] as const)

describe("Vue's global setters", () => {
  afterEach(() => {
    for (const [k, v] of saved) g[k] = v
  })

  it('takes back only the setters this bundle registered, leaving another copy of Vue its own', () => {
    const theirs: Setter = () => {}
    const ours: Setter = () => {}
    for (const k of VUE_SETTER_KEYS) g[k] = [theirs, ours]

    const release = claimVueSetters()
    // Another plugin's Vue loads after ours.
    const later: Setter = () => {}
    for (const k of VUE_SETTER_KEYS) g[k]!.push(later)
    release()

    for (const k of VUE_SETTER_KEYS) expect(g[k]).toEqual([theirs, later])
  })

  it('keeps the list itself, which the next copy of Vue pushes into', () => {
    const ours: Setter = () => {}
    for (const k of VUE_SETTER_KEYS) g[k] = [ours]
    const lists = VUE_SETTER_KEYS.map((k) => g[k])
    claimVueSetters()()
    VUE_SETTER_KEYS.forEach((k, i) => {
      expect(g[k]).toBe(lists[i])
      expect(g[k]).toEqual([])
    })
  })

  it("takes back a development build's devtools formatter, and never another's in production", () => {
    const w = globalThis as unknown as { devtoolsFormatters?: object[] }
    const saved = w.devtoolsFormatters
    const theirs = {}
    const ours = {}
    try {
      w.devtoolsFormatters = [theirs, ours]
      claimVueSetters(true)()
      expect(w.devtoolsFormatters).toEqual([theirs])

      w.devtoolsFormatters = [theirs]
      claimVueSetters(false)()
      expect(w.devtoolsFormatters).toEqual([theirs])
    } finally {
      w.devtoolsFormatters = saved
    }
  })

  it('does nothing when Vue registered nothing', () => {
    for (const k of VUE_SETTER_KEYS) g[k] = undefined
    expect(() => claimVueSetters()()).not.toThrow()
  })
})
