import { expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { openXlsx } from '@/spreadsheet/package'
import { applyWorkbookEdit } from '@/spreadsheet/edit'
import { applyWorkbookFormat } from '@/spreadsheet/format'
import { featureWorkbook } from '../fixtures/xlsx/featureWorkbook'
const executable = [
  process.env.ABELE_SOFFICE,
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
].find((p) => p && existsSync(p))
/** Optional independent consumer, never silently described as verified if absent. */
it.skipIf(!executable)(
  'independently reopens patched values/styles and features in LibreOffice headless',
  async () => {
    const dir = mkdtempSync(join(resolve('.'), '.xlsx-reopen-'))
    try {
      const book = await openXlsx(featureWorkbook())
      const edited = await applyWorkbookEdit(book, { sheet: 'Sample', range: 'B2', values: [[25]] })
      const formatted = await applyWorkbookFormat(await openXlsx(edited), {
        sheet: 'Sample',
        range: 'B2',
        format: { bold: true, fill: '#33AA77' },
      })
      const input = join(dir, 'sample.xlsx')
      writeFileSync(input, formatted)
      const ods = join(dir, 'ods')
      const output = join(dir, 'output')
      mkdirSync(ods)
      mkdirSync(output)
      const profile = '-env:UserInstallation=' + pathToFileURL(join(dir, 'profile')).href
      const convert = (format: string, out: string, path: string) =>
        execFileSync(
          executable!,
          [profile, '--headless', '--convert-to', format, '--outdir', out, path],
          { timeout: 60000, encoding: 'utf8' }
        )
      const first = convert('ods', ods, input)
      expect(first).not.toMatch(/error|repair/i)
      expect(existsSync(join(ods, 'sample.ods'))).toBe(true)
      const second = convert('xlsx', output, join(ods, 'sample.ods'))
      expect(second).not.toMatch(/error|repair/i)
      const reopened = await openXlsx(new Uint8Array(readFileSync(join(output, 'sample.xlsx'))))
      const sheet = await reopened.sheet('Sample')
      expect(sheet.cells.get('B2')?.value).toBe(25)
      expect(sheet.cells.get('B2')?.style.bold).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
  150000
)
