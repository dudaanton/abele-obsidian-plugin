import { expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { strToU8, zipSync } from 'fflate'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { applyWorkbookFormat } from '@/spreadsheet/format'
import { recalculateWorkbook } from '@/spreadsheet/calculation'
import { featureWorkbook } from '../fixtures/xlsx/featureWorkbook'
import { sampleParts, sheetXml } from '../fixtures/xlsx/sampleXlsx'
const executable = [
  process.env.ABELE_SOFFICE,
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
].find((p) => p && existsSync(p))

/** Optional independent consumer, never silently described as verified if absent. */
async function reopenThroughLibreOffice(bytes: Uint8Array) {
  const dir = mkdtempSync(join(resolve('.'), '.xlsx-reopen-'))
  try {
    const input = join(dir, 'sample.xlsx')
    writeFileSync(input, bytes)
    const ods = join(dir, 'ods')
    const output = join(dir, 'output')
    mkdirSync(ods)
    mkdirSync(output)
    const profile = '-env:UserInstallation=' + pathToFileURL(join(dir, 'profile')).href
    const convert = (format: string, out: string, path: string) =>
      execFileSync(
        executable!,
        [profile, '--headless', '--convert-to', format, '--outdir', out, path],
        {
          timeout: 60000,
          encoding: 'utf8',
        }
      )
    const first = convert('ods', ods, input)
    expect(first).not.toMatch(/error|repair/i)
    expect(existsSync(join(ods, 'sample.ods'))).toBe(true)
    const second = convert('xlsx', output, join(ods, 'sample.ods'))
    expect(second).not.toMatch(/error|repair/i)
    return openXlsx(new Uint8Array(readFileSync(join(output, 'sample.xlsx'))))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

it.skipIf(!executable)(
  'independently reopens patched values/styles and features in LibreOffice headless',
  async () => {
    const book = await openXlsx(featureWorkbook())
    const edited = await applyWorkbookEdit(book, { sheet: 'Sample', range: 'B2', values: [[25]] })
    const formatted = await applyWorkbookFormat(await openXlsx(edited), {
      sheet: 'Sample',
      range: 'B2',
      format: { bold: true, fill: '#33AA77' },
    })
    const reopened = await reopenThroughLibreOffice(formatted)
    const sheet = await reopened.sheet('Sample')
    expect(sheet.cells.get('B2')?.value).toBe(25)
    expect(sheet.cells.get('B2')?.style.bold).toBe(true)
  },
  150000
)

it.skipIf(!executable)(
  'independently reopens escaped calculated XML control characters',
  async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml('<row r="1"><c r="A1"><f>CHAR(1)</f></c></row>')
    )
    const calculated = await recalculateWorkbook(await openXlsx(zipSync(parts)))
    expect(calculated.complete).toBe(true)
    const reopened = await reopenThroughLibreOffice(calculated.bytes)
    const cell = (await reopened.sheet('Sample')).cells.get('A1')
    expect(cell?.formula).toBe('CHAR(1)')
    expect(cell?.value).toBe('\u0001')
  },
  150000
)

it.skipIf(!executable)(
  'independently reopens and recalculates remaining formulas after unsharing a follower',
  async () => {
    const parts = sampleParts()
    parts['xl/worksheets/sheet1.xml'] = strToU8(
      sheetXml(
        '<row r="1"><c r="A1"><v>10</v></c><c r="B1"><f t="shared" si="0" ref="B1:B3">A1+1</f><v>11</v></c></row>' +
          '<row r="2"><c r="A2"><v>20</v></c><c r="B2"><f t="shared" si="0"/><v>21</v></c></row>' +
          '<row r="3"><c r="A3"><v>30</v></c><c r="B3"><f t="shared" si="0"/><v>31</v></c></row>'
      )
    )
    const edited = await applyWorkbookEdit(await openXlsx(zipSync(parts)), {
      sheet: 'Sample',
      range: 'B2',
      values: [[25]],
    })
    const reopened = await reopenThroughLibreOffice(edited)
    const sheet = await reopened.sheet('Sample')
    expect(sheet.cells.get('B1')?.value).toBe(11)
    expect(sheet.cells.get('B2')?.value).toBe(25)
    expect(sheet.cells.get('B3')?.value).toBe(31)
  },
  150000
)
