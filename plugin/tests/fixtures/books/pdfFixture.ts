/**
 * PDFs written byte by byte for the tests: a few pages of text in a standard font, an outline, a
 * link to another page, a link to the web — and in the hostile one, everything a PDF can carry to
 * run code: JavaScript run on opening, JavaScript behind a link, a `javascript:` address, a form
 * field with a script, and a launch action.
 */

interface Page {
  text: string[]
  /** Link rectangles on this page: to a page (0-based), or with a raw action dictionary. */
  links?: { rect: [number, number, number, number]; page?: number; action?: string }[]
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

function writePdf(pages: Page[], extra: { outline?: boolean; hostile?: boolean }): Uint8Array {
  const objects: string[] = []
  const add = (body: string) => {
    objects.push(body)
    return objects.length
  }
  // Fixed numbers: 1 catalog, 2 pages, 3 font; pages follow.
  add('') // catalog, filled later
  add('') // pages, filled later
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageIds: number[] = []
  const annotLists: number[][] = []
  for (const page of pages) {
    const lines = page.text
      .map((line, i) => `BT /F1 18 Tf 72 ${720 - i * 28} Td (${esc(line)}) Tj ET`)
      .join('\n')
    const content = add(`<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`)
    const id = add('') // page, filled later
    pageIds.push(id)
    annotLists.push([])
    ;(page as Page & { content: number }).content = content
  }
  pages.forEach((page, i) => {
    for (const link of page.links ?? []) {
      const target =
        link.page !== undefined ? `/Dest [${pageIds[link.page]} 0 R /Fit]` : `/A ${link.action}`
      annotLists[i].push(
        add(
          `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(' ')}] /Border [0 0 0] ${target} >>`
        )
      )
    }
  })
  let formField = 0
  if (extra.hostile) {
    formField = add(
      `<< /Type /Annot /Subtype /Widget /FT /Tx /T (field) /V (x) /Rect [72 100 300 130] /P ${pageIds[0]} 0 R ` +
        `/AA << /K << /S /JavaScript /JS (app.alert\\('field'\\)) >> /Fo << /S /JavaScript /JS (app.alert\\('focus'\\)) >> >> >>`
    )
    annotLists[0].push(formField)
  }
  pages.forEach((page, i) => {
    const annots = annotLists[i].length
      ? ` /Annots [${annotLists[i].map((n) => `${n} 0 R`).join(' ')}]`
      : ''
    objects[pageIds[i] - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> ` +
      `/Contents ${(page as Page & { content: number }).content} 0 R${annots} >>`
  })
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`

  let outlines = ''
  if (extra.outline) {
    const root = objects.length + 1
    const a = root + 1
    const b = root + 2
    const c = root + 3
    add(`<< /Type /Outlines /First ${a} 0 R /Last ${b} 0 R /Count 2 >>`)
    add(
      `<< /Title (Part one) /Parent ${root} 0 R /Next ${b} 0 R /Dest [${pageIds[0]} 0 R /Fit] /First ${c} 0 R /Last ${c} 0 R /Count 1 >>`
    )
    add(`<< /Title (Part two) /Parent ${root} 0 R /Prev ${a} 0 R /Dest [${pageIds[3]} 0 R /Fit] >>`)
    add(`<< /Title (Page two) /Parent ${a} 0 R /Dest [${pageIds[1]} 0 R /Fit] >>`)
    outlines = ` /Outlines ${root} 0 R /PageMode /UseOutlines`
  }
  const hostile = extra.hostile
    ? ` /OpenAction << /S /JavaScript /JS (app.alert\\('open'\\); this.exportDataObject\\({cName: 'x', nLaunch: 2}\\)) >>` +
      ` /Names << /JavaScript << /Names [(doc) << /S /JavaScript /JS (app.alert\\('names'\\)) >>] >> >>` +
      ` /AcroForm << /Fields [${formField} 0 R] /NeedAppearances true >>`
    : ''
  objects[0] = `<< /Type /Catalog /Pages 2 0 R${outlines}${hostile} >>`

  let out = '%PDF-1.7\n%âãÏÓ\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Latin-1: every character is one byte, so the offsets above are byte offsets.
  return Uint8Array.from(out, (ch) => ch.charCodeAt(0) & 0xff)
}

const pageText = (n: number) => [
  `Page ${n} of the test document`,
  'Plain text in a standard font, for the text layer.',
  'The quick brown fox jumps over the lazy dog.',
]

/** Five pages, an outline, a link from page 1 to page 4 and one to the web. */
export function buildPlainPdf(): Uint8Array {
  const pages: Page[] = [1, 2, 3, 4, 5].map((n) => ({ text: pageText(n) }))
  pages[0].links = [
    { rect: [72, 600, 300, 624], page: 3 },
    { rect: [72, 560, 300, 584], action: '<< /S /URI /URI (https://example.com/) >>' },
  ]
  pages[0].text.push('', 'Go to page four', 'Visit example.com')
  return writePdf(pages, { outline: true })
}

/** Two pages carrying every kind of PDF script and dangerous action, all on page one. */
export function buildHostilePdf(): Uint8Array {
  const pages: Page[] = [1, 2].map((n) => ({ text: pageText(n) }))
  pages[0].links = [
    { rect: [72, 600, 300, 624], action: "<< /S /JavaScript /JS (app.alert\\('link'\\)) >>" },
    {
      rect: [72, 560, 300, 584],
      action: "<< /S /URI /URI (javascript:top.__abelePwned=['uri']) >>",
    },
    { rect: [72, 520, 300, 544], action: '<< /S /Launch /F (/bin/sh) >>' },
    { rect: [72, 480, 300, 504], action: '<< /S /URI /URI (file:///etc/passwd) >>' },
  ]
  return writePdf(pages, { hostile: true })
}
