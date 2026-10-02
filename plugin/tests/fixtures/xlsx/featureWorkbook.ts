import { strFromU8, strToU8, zipSync } from 'fflate'
import { R, REL, S, sampleParts, sampleRows, sheetXml } from './sampleXlsx'
import { samplePng } from '../docx/samplePng'
/** Invented workbook with independent charts/pivot caches/annotations and worksheet features. */
export function featureParts(): Record<string, Uint8Array> {
  const parts = sampleParts()
  const rows = sampleRows.replace(
    '<c r="B1"><v>10</v></c>',
    '<c r="B1" t="inlineStr"><is><t>Amount</t></is></c>'
  )
  parts['xl/worksheets/sheet1.xml'] = strToU8(
    sheetXml(
      rows,
      '<mergeCells count="1"><mergeCell ref="A4:B4"/></mergeCells><conditionalFormatting sqref="B2"><cfRule type="cellIs" priority="1" operator="greaterThan"><formula>10</formula></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="whole" operator="between" sqref="B2" allowBlank="1"><formula1>0</formula1><formula2>1000</formula2></dataValidation></dataValidations><drawing xmlns:r="' +
        R +
        '" r:id="drawing"/><tableParts count="1"><tablePart xmlns:r="' +
        R +
        '" r:id="table"/></tableParts><extLst><ext uri="sample-extension"><sample:opaque xmlns:sample="urn:sample">keep verbatim</sample:opaque></ext></extLst>'
    )
  )
  const xml: Record<string, string> = {
    'xl/worksheets/_rels/sheet1.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="drawing" Type="${R}/drawing" Target="../drawings/drawing1.xml"/><Relationship Id="comments" Type="${R}/comments" Target="../comments1.xml"/><Relationship Id="table" Type="${R}/table" Target="../tables/table1.xml"/></Relationships>`,
    'xl/comments1.xml': `<comments xmlns="${S}"><authors><author>Sample Reviewer</author></authors><commentList><comment ref="B2" authorId="0"><text><t>Sample annotation</t></text></comment></commentList></comments>`,
    'xl/tables/table1.xml': `<table xmlns="${S}" id="1" name="SampleTable" displayName="SampleTable" ref="A1:B2" totalsRowShown="0"><autoFilter ref="A1:B2"/><tableColumns count="2"><tableColumn id="1" name="Sample heading"/><tableColumn id="2" name="Amount"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`,
    'xl/drawings/drawing1.xml': `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>6</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>12</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="1" name="Sample chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R}" r:id="chart"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`,
    'xl/drawings/_rels/drawing1.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="chart" Type="${R}/chart" Target="../charts/chart1.xml"/></Relationships>`,
    'xl/charts/chart1.xml': `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Sample amounts</c:v></c:tx><c:cat><c:strRef><c:f>Sample!$A$2</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Sample item</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>Sample!$B$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="1"/><c:pt idx="0"><c:v>20</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser><c:axId val="1"/><c:axId val="2"/></c:barChart><c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="2"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`,
    'xl/pivotCache/pivotCacheDefinition1.xml': `<pivotCacheDefinition xmlns="${S}" xmlns:r="${R}" r:id="records" refreshOnLoad="1" recordCount="1"><cacheSource type="worksheet"><worksheetSource ref="A1:B2" sheet="Sample"/></cacheSource><cacheFields count="2"><cacheField name="Sample heading" numFmtId="0"><sharedItems count="1"><s v="Sample item"/></sharedItems></cacheField><cacheField name="Amount" numFmtId="0"><sharedItems containsString="0" containsNumber="1" count="1"><n v="20"/></sharedItems></cacheField></cacheFields></pivotCacheDefinition>`,
    'xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="records" Type="${R}/pivotCacheRecords" Target="pivotCacheRecords1.xml"/></Relationships>`,
    'xl/pivotCache/pivotCacheRecords1.xml': `<pivotCacheRecords xmlns="${S}" count="1"><r><x v="0"/><x v="0"/></r></pivotCacheRecords>`,
    'xl/pivotTables/pivotTable1.xml': `<pivotTableDefinition xmlns="${S}" name="SamplePivot" cacheId="1" dataCaption="Values" grandTotalCaption="Total" updatedVersion="3" minRefreshableVersion="3" createdVersion="3"><location ref="F1:G3" firstHeaderRow="1" firstDataRow="1" firstDataCol="1"/><pivotFields count="2"><pivotField axis="axisRow" showAll="0"><items count="2"><item x="0"/><item t="default"/></items></pivotField><pivotField dataField="1" showAll="0"/></pivotFields><rowFields count="1"><field x="0"/></rowFields><rowItems count="2"><i><x/></i><i t="grand"><x/></i></rowItems><dataFields count="1"><dataField name="Total amount" fld="1" baseField="0" baseItem="0"/></dataFields><pivotTableStyleInfo name="PivotStyleLight16" showRowHeaders="1" showColHeaders="1" showRowStripes="0" showColStripes="0" showLastColumn="1"/></pivotTableDefinition>`,
    'xl/pivotTables/_rels/pivotTable1.xml.rels': `<Relationships xmlns="${REL}"><Relationship Id="cache" Type="${R}/pivotCacheDefinition" Target="../pivotCache/pivotCacheDefinition1.xml"/></Relationships>`,
  }
  parts['xl/workbook.xml'] = strToU8(
    strFromU8(parts['xl/workbook.xml']).replace(
      '</workbook>',
      `<pivotCaches><pivotCache cacheId="1" xmlns:r="${R}" r:id="pivot"/></pivotCaches></workbook>`
    )
  )
  parts['xl/_rels/workbook.xml.rels'] = strToU8(
    strFromU8(parts['xl/_rels/workbook.xml.rels']).replace(
      '</Relationships>',
      `<Relationship Id="pivot" Type="${R}/pivotCacheDefinition" Target="pivotCache/pivotCacheDefinition1.xml"/></Relationships>`
    )
  )
  xml['xl/worksheets/_rels/sheet2.xml.rels'] =
    `<Relationships xmlns="${REL}"><Relationship Id="pivotTable" Type="${R}/pivotTable" Target="../pivotTables/pivotTable1.xml"/></Relationships>`
  const types: Record<string, string> = {
    'comments1.xml': 'comments',
    'tables/table1.xml': 'table',
    'drawings/drawing1.xml': 'drawing',
    'charts/chart1.xml': 'chart',
    'pivotCache/pivotCacheDefinition1.xml': 'pivotCacheDefinition',
    'pivotCache/pivotCacheRecords1.xml': 'pivotCacheRecords',
    'pivotTables/pivotTable1.xml': 'pivotTable',
  }
  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']).replace(
      '</Types>',
      Object.entries(types)
        .map(
          ([part, type]) =>
            `<Override PartName="/xl/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type === 'drawing' ? 'drawing' : type === 'chart' ? 'drawingml.chart' : 'spreadsheetml.' + type}+xml"/>`
        )
        .join('') + '</Types>'
    )
  )
  for (const [name, source] of Object.entries(xml)) parts[name] = strToU8(source)
  parts['xl/media/sample.png'] = samplePng()
  parts['[Content_Types].xml'] = strToU8(
    strFromU8(parts['[Content_Types].xml']).replace(
      '<Override',
      '<Default Extension="png" ContentType="image/png"/><Override'
    )
  )
  return parts
}
export const featureWorkbook = () => zipSync(featureParts())
