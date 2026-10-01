import { strToU8, zipSync } from 'fflate'
import { samplePng } from './samplePng'

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const SAMPLE_IMAGE = samplePng()
export const wrap = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/></w:sectPr></w:body></w:document>`
export const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
export const sampleBody =
  '<w:p w:rsidR="00112233"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Sample </w:t></w:r><w:proofErr w:type="spellStart"/><w:r><w:t>report</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>' +
  '<w:tbl><w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>Cell sample</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
  '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Annotated sample</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
  '<w:p><w:ins w:id="1" w:author="Sample Reviewer"><w:r><w:t>Inserted words</w:t></w:r></w:ins><w:del w:id="2" w:author="Sample Reviewer"><w:r><w:delText>Deleted words</w:delText></w:r></w:del></w:p>' +
  '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>' +
  '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:extent cx="952500" cy="952500"/><wp:docPr id="1" name="Sample image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="Sample image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId4"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'

export function sampleParts(body = sampleBody): Record<string, Uint8Array> {
  const xml: Record<string, string> = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
      ['document', 'styles', 'numbering', 'header1', 'footer1', 'comments', 'footnotes']
        .map(
          (name) =>
            `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${name === 'document' ? 'document.main' : name.replace(/[0-9]/g, '')}+xml"/>`
        )
        .join('') +
      '</Types>',
    '_rels/.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/document.xml': wrap(body),
    'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
    'word/numbering.xml': `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="6"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="6"/></w:num></w:numbering>`,
    'word/header1.xml': `<w:hdr xmlns:w="${W}">${paragraph('Sample header')}</w:hdr>`,
    'word/footer1.xml': `<w:ftr xmlns:w="${W}">${paragraph('Sample footer')}</w:ftr>`,
    'word/comments.xml': `<w:comments xmlns:w="${W}"><w:comment w:id="0" w:author="Sample Reviewer">${paragraph('Sample comment')}</w:comment></w:comments>`,
    'word/footnotes.xml': `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1">${paragraph('Sample footnote')}</w:footnote></w:footnotes>`,
    'word/_rels/document.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${R}/header" Target="header1.xml"/><Relationship Id="rId3" Type="${R}/footer" Target="footer1.xml"/><Relationship Id="rId4" Type="${R}/image" Target="media/sample.png"/><Relationship Id="rId5" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId6" Type="${R}/numbering" Target="numbering.xml"/></Relationships>`,
    'customXml/item1.xml': '<sample attr="unchanged">Opaque sample data</sample>',
  }
  return {
    ...Object.fromEntries(Object.entries(xml).map(([k, v]) => [k, strToU8(v)])),
    'word/media/sample.png': SAMPLE_IMAGE,
  }
}
export const sampleDocx = (body?: string) => zipSync(sampleParts(body))
