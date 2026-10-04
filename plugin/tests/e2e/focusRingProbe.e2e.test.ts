import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { outwardBoxShadowReach } from '../helpers/focusRingPaint'
import { evalJson } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

/** Execute each actual probe function, not a duplicate of its clipping algorithm. */
function probeSource(file: string): string {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = source.indexOf('  const ringClipped = (field) => {')
  const end = source.indexOf('\n  }\n', start)
  if (start < 0 || end < 0) throw new Error(`Missing focus probe in ${file}`)
  const fragment = source.slice(start, end + '\n  }'.length)
  // These declarations live inside template literals; decode the same escaping/interpolation.
  return new Function('outwardBoxShadowReach', 'return `' + fragment + '`')(
    outwardBoxShadowReach
  ) as string
}

interface PaintCase {
  cuts: string[]
  shadow: string
  outline: string
}

describe.each(['phoneLayout.e2e.test.ts', 'dialogRings.e2e.test.ts'])(
  'real browser focus clipping canary: %s',
  (file) => {
    it('ignores inward shading but still rejects actually clipped outward paint', () => {
      const report = evalJson<Record<string, PaintCase>>(`(() => {
        const name = el => el.className
        ${probeSource(file)}
        const host = document.createElement('div')
        host.className = 'sample-focus-clip'
        host.style.cssText = 'position:fixed;left:40px;top:40px;width:100px;height:48px;padding:2px;box-sizing:border-box;overflow:hidden;z-index:9999'
        const field = document.createElement('div')
        field.tabIndex = 0
        field.style.cssText = 'display:block;box-sizing:border-box;width:100%;height:24px;margin:0;border:0;border-radius:0;outline:none;box-shadow:none'
        host.appendChild(field); document.body.appendChild(host)
        const previous = document.activeElement
        const report = {}
        const measure = (label, shadow, outline = 'none', offset = '0px', padding = '2px') => {
          host.style.padding = padding
          field.style.boxShadow = shadow; field.style.outline = outline; field.style.outlineOffset = offset
          field.focus({preventScroll:true})
          const style = getComputedStyle(field)
          report[label] = {cuts:ringClipped(field),shadow:style.boxShadow,outline:style.outline}
        }
        try {
          measure('none', 'none')
          measure('inset', 'rgba(0,0,0,0.07) 0px 4px 10px 0px inset')
          measure('outer', 'rgba(1,2,3,0.5) 0px 0px 0px 4px')
          measure('blur', 'rgba(1,2,3,0.5) 0px 0px 3px 1px')
          measure('mixed', 'rgba(0,0,0,0.07) 0px 4px 10px 0px inset, rgba(1,2,3,0.5) 0px 0px 0px 4px')
          measure('mixedReverse', 'rgba(1,2,3,0.5) 0px 0px 0px 4px, rgba(0,0,0,0.07) 0px 4px 10px 0px inset')
          measure('outerFits', 'rgba(1,2,3,0.5) 0px 0px 0px 4px', 'none', '0px', '8px')
          measure('outline', 'none', '4px solid rgb(1,2,3)', '2px')
          measure('outlineFits', 'none', '4px solid rgb(1,2,3)', '2px', '8px')
          measure('outlineInward', 'none', '4px solid rgb(1,2,3)', '-4px')
          return report
        } finally {
          host.remove(); previous?.focus({preventScroll:true})
        }
      })()`)
      console.info('Focus ring canary', file, JSON.stringify(report))
      expect(report.none.cuts).toEqual([])
      expect(report.inset.shadow).toContain('inset')
      expect(report.inset.cuts).toEqual([])
      // With only 2px of clearance, a genuine 4px outer ring must remain a gate failure.
      for (const label of ['outer', 'blur', 'mixed', 'mixedReverse']) {
        expect(report[label].cuts, label).toEqual(['sample-focus-clip 2px'])
      }
      expect(report.outerFits.cuts).toEqual([])
      // Desktop checks outlines; phoneLayout's existing shadow-only semantics stay unchanged.
      expect(report.outline.cuts).toEqual(
        file === 'dialogRings.e2e.test.ts' ? ['sample-focus-clip 4px'] : []
      )
      expect(report.outlineFits.cuts).toEqual([])
      expect(report.outlineInward.cuts).toEqual([])
    })
  }
)
