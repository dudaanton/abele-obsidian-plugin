import { describe, expect, it } from 'vitest'
import { HyperFormula } from 'hyperformula'
import { emptyCatalogue, isHyperFormulaCatalogue } from '../../scripts/hyperformula-catalogue.mjs'

// The unit tier applies the same transform as the build (vitest.config.ts), so this runs the
// HyperFormula the plugin ships: no function descriptions, every function still evaluating.
describe('HyperFormula without its function catalogue', () => {
  it('runs the shipped engine here, with no authored descriptions', () => {
    const hf = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' })
    try {
      expect(hf.getFunctionDetails('AVEDEV')?.shortDescription).toBeUndefined()
    } finally {
      hf.destroy()
    }
  })

  it('evaluates formulas from every category the catalogue used to describe', () => {
    const hf = HyperFormula.buildFromArray(
      [
        [1, 2, 3, '=SUM(A1:C1)', '=AVEDEV(A1:C1)', '=AVERAGE(A1:C1)'],
        ['=IF(D1>5,"big","small")', '=VLOOKUP(2,A1:C1,2,FALSE())', '=UPPER("abc")'],
        ['=DATE(2020,2,29)', '=PMT(0.05/12,12,1000)', '=BIN2DEC("101")', '=ISNUMBER(A1)'],
        ['=ROUND(PI(),3)', '=MMULT(A1:C1,TRANSPOSE(A1:C1))', '=VERSION()', '=OFFSET(A1,0,1)'],
      ],
      { licenseKey: 'gpl-v3' }
    )
    try {
      const at = (row: number, col: number) => hf.getCellValue({ sheet: 0, row, col })
      expect(at(0, 3)).toBe(6)
      expect(at(0, 4)).toBeCloseTo(2 / 3)
      expect(at(0, 5)).toBe(2)
      expect(at(1, 0)).toBe('big')
      expect(at(1, 2)).toBe('ABC')
      expect(at(2, 0)).toBe(43890)
      expect(at(2, 1)).toBeCloseTo(-85.607, 3)
      expect(at(2, 2)).toBe(5)
      expect(at(2, 3)).toBe(true)
      expect(at(3, 0)).toBe(3.142)
      expect(at(3, 1)).toBe(14)
      expect(String(at(3, 2))).toMatch(/HyperFormula/)
      expect(at(3, 3)).toBe(2)
    } finally {
      hf.destroy()
    }
  })

  it('replaces only the catalogue module', () => {
    expect(
      isHyperFormulaCatalogue(
        '/x/node_modules/hyperformula/es/interpreter/functionMetadata/index.mjs?v=1'
      )
    ).toBe(true)
    expect(
      isHyperFormulaCatalogue(
        '/x/node_modules/hyperformula/es/interpreter/functionMetadata/FunctionDescription.mjs'
      )
    ).toBe(false)
    expect(emptyCatalogue).toContain('export const FUNCTION_DOCS = Object.create(null)')
  })
})
