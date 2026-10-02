import { strToU8, zipSync } from 'fflate'
export const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
export const sheetXml = (rows: string, tail = '') =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${S}"><dimension ref="A1:D6"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="24" customWidth="1"/></cols><sheetData>${rows}</sheetData>${tail}</worksheet>`
export const sampleRows =
  '<row r="1"><c r="A1" t="s" s="1"><v>0</v></c><c r="B1"><v>10</v></c><c r="C1"><f>SUM(B1:B2)</f><v>30</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Sample item</t></is></c><c r="B2"><v>20</v></c><c r="D2" s="2"><v>45292</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Merged sample</t></is></c></row>'
export function sampleParts(
  rows = sampleRows,
  tail = '<mergeCells count="1"><mergeCell ref="A4:B4"/></mergeCells>'
): Record<string, Uint8Array> {
  const xml: Record<string, string> = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${S}" xmlns:r="${R}"><bookViews><workbookView/></bookViews><sheets><sheet name="Sample" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="0"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId4" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml(rows, tail),
    'xl/worksheets/sheet2.xml': sheetXml(
      '<row r="1"><c r="A1"><f>Sample!C1*2</f><v>60</v></c></row>'
    ),
    'xl/sharedStrings.xml': `<sst xmlns="${S}" count="1" uniqueCount="1"><si><r><t>Sample </t></r><r><t>heading</t></r></si></sst>`,
    'xl/styles.xml': `<styleSheet xmlns="${S}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><i/><sz val="11"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFCC00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'customXml/item1.xml': '<sample keep="yes">Opaque sample data</sample>',
  }
  return Object.fromEntries(Object.entries(xml).map(([k, v]) => [k, strToU8(v)]))
}
export const sampleXlsx = (rows?: string, tail?: string) => zipSync(sampleParts(rows, tail))
