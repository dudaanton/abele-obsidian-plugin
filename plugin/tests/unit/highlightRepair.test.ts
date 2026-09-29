import { describe, expect, it } from 'vitest'
import { patchHighlightLinks } from '@/reader/highlights'

const old = 'epubcfi(/6/2!/4/2:1)'
const next = 'epubcfi(/6/2!/4/4:1[id]^%)'
const request = { cfi: old, text: 'A fabricated sentence.', suggested: next }
const line = '> [!quote|yellow]- [[Books/sample.epub#cfi=/6/2!/4/2:1|Part]] [[Chats/sample.abchat|Discussion]]\r\n> A fabricated sentence.\r\n>\r\n> Keep  two spaces.  '
const ofBook = (path: string) => path === 'Books/sample.epub'

describe('surgical highlight link repair', () => {
  it('changes only the encoded destination, preserving CRLF and every other character', () => {
    const input = `---\r\nfile: sample\r\n---\r\n${line}\r\nend without newline`
    const output = input.replace('#cfi=/6/2!/4/2:1|Part', '#cfi=/6/2!/4/4:1%5Bid%5D%5E%25|Part')
    expect(patchHighlightLinks(input, [request], ofBook)).toEqual({ markdown: output, applied: [old], skipped: [] })
    expect(patchHighlightLinks(output, [request], ofBook).markdown).toBe(output)
  })
  it('selects the book link, not discussion, prose, fenced examples, frontmatter or a different book', () => {
    const input = `---\nexample: '> [!quote] [[Books/sample.epub#cfi=/6/2!/4/2:1]]'\n---\n\`\`\`md\n${line.replaceAll('\r\n', '\n')}\n\`\`\`\n> [!quote] [[Books/decoy.epub#cfi=/6/2!/4/2:1]]\n> A fabricated sentence.\n> [!quote] [[Chats/sample.abchat|Discussion]] [Part](<Books/sample.epub#cfi=/6/2!/4/2:1>)\n> A fabricated sentence.\nProse #cfi=/6/2!/4/2:1`
    const result = patchHighlightLinks(input, [request], ofBook)
    expect(result.applied).toEqual([old])
    expect(result.markdown).toBe(input.replace('(<Books/sample.epub#cfi=/6/2!/4/2:1>)', '(<Books/sample.epub#cfi=/6/2!/4/4:1%5Bid%5D%5E%25>)'))
  })
  it('preserves a BOM, mixed endings, aliases and template text while patching disjoint links', () => {
    const second = 'epubcfi(/6/2!/4/10:1)'
    const third = 'epubcfi(/6/2!/4/12:1)'
    const input = `\uFEFF${line}\n\n> [!quote]+ [[Books/sample.epub#cfi=/6/2!/4/10:1|alias cfi=/6/2!/4/2:1]]\r> More fabricated words.\n\n{{ link }} #cfi=/6/2!/4/2:1`
    const result = patchHighlightLinks(input, [request, { cfi: second, text: 'More fabricated words.', suggested: third }], ofBook)
    expect(result.applied).toHaveLength(2)
    expect(result.markdown).toBe(input.replace('#cfi=/6/2!/4/2:1|Part', '#cfi=/6/2!/4/4:1%5Bid%5D%5E%25|Part').replace('#cfi=/6/2!/4/10:1|alias', '#cfi=/6/2!/4/12:1|alias'))
  })
  it('skips changed quotes, duplicates, destination collisions and converging requests', () => {
    expect(patchHighlightLinks(line.replace('A fabricated sentence.', 'Changed words.'), [request], ofBook).applied).toEqual([])
    expect(patchHighlightLinks(`${line}\n\n${line}`, [request], ofBook).applied).toEqual([])
    const collision = `${line}\n\n> [!quote] [[Books/sample.epub#cfi=/6/2!/4/4:1%5Bid%5D%5E%25]]\n> Different text.`
    expect(patchHighlightLinks(collision, [request], ofBook).applied).toEqual([])
    const other = { cfi: 'epubcfi(/6/2!/4/8:1)', text: 'Different text.', suggested: next }
    expect(patchHighlightLinks(collision.replace('/4/4:1%5Bid%5D%5E%25', '/4/8:1'), [request, other], ofBook).applied).toEqual([])
  })
})
