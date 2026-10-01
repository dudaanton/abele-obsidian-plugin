import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { openDocx } from '@/word/package'
import { applyWordEdit } from '@/word/edit'
import { commitWordWrite } from '@/word/write'
import { paragraph, sampleDocx } from '../fixtures/docx/sampleDocx'

describe('lossless Word text writes', () => {
  it('returns the exact archive on an untouched save', async () => {
    const doc = await openDocx(sampleDocx())
    expect(
      await applyWordEdit(doc, {
        operation: 'replace',
        paragraph: 1,
        old_text: 'Sample',
        new_text: 'Sample',
      })
    ).toEqual(doc.original)
  })
  it('changes only the edited text node, preserving lexical XML and every other part', async () => {
    const doc = await openDocx(sampleDocx())
    const updated = await applyWordEdit(doc, {
      operation: 'replace',
      paragraph: 1,
      old_text: 'report',
      new_text: 'summary & details',
    })
    const before = unzipSync(doc.original)
    const after = unzipSync(updated)
    expect(Object.keys(after)).toEqual(Object.keys(before))
    for (const name of Object.keys(before)) {
      if (name === 'word/document.xml')
        expect(strFromU8(after[name])).toBe(
          strFromU8(before[name]).replace('<w:t>report</w:t>', '<w:t>summary &amp; details</w:t>')
        )
      else expect(after[name], name).toEqual(before[name])
    }
  })
  it('matches text across arbitrarily split runs while keeping run properties', async () => {
    const doc = await openDocx(sampleDocx())
    const bytes = await applyWordEdit(doc, {
      operation: 'replace',
      paragraph: 1,
      old_text: 'Sample report',
      new_text: 'New text',
    })
    const xml = strFromU8(unzipSync(bytes)['word/document.xml'])
    expect(xml).toContain('<w:rPr><w:b/></w:rPr><w:t>New text</w:t>')
    expect(xml).toContain('<w:r><w:t></w:t></w:r>')
    expect((await openDocx(bytes)).paragraphs[0].text).toBe('New text')
  })
  it('inserts escaped text and preserves leading/trailing spaces', async () => {
    const doc = await openDocx(sampleDocx(paragraph('plain')))
    const bytes = await applyWordEdit(doc, {
      operation: 'insert',
      paragraph: 1,
      offset: 0,
      text: ' <sample> ',
    })
    expect((await openDocx(bytes)).paragraphs[0].text).toBe(' <sample> plain')
    expect(strFromU8(unzipSync(bytes)['word/document.xml'])).toContain('xml:space="preserve"')
  })
  it('refuses edits in revisions, fields, supplementary parts and ambiguous matches', async () => {
    const doc = await openDocx(sampleDocx())
    const revision = doc.paragraphs.find((p) => p.text === 'Inserted words')!
    const field = doc.paragraphs.find((p) => p.text === '1')!
    const header = doc.paragraphs.find((p) => p.text === 'Sample header')!
    for (const p of [revision, field, header])
      await expect(
        applyWordEdit(doc, {
          operation: 'replace',
          paragraph: p.number,
          old_text: p.text,
          new_text: 'different',
        })
      ).rejects.toThrow(/read-only|protected/)
    const duplicate = await openDocx(sampleDocx(paragraph('same same')))
    await expect(
      applyWordEdit(duplicate, {
        operation: 'replace',
        paragraph: 1,
        old_text: 'same',
        new_text: 'other',
      })
    ).rejects.toThrow(/unique/)
  })
  it('does not overwrite bytes that changed while an edit was prepared', async () => {
    const before = sampleDocx()
    let written = false
    await expect(
      commitWordWrite(
        {
          read: async () => sampleDocx(paragraph('changed')),
          write: async () => {
            written = true
          },
        },
        before,
        new Uint8Array([1])
      )
    ).rejects.toThrow(/changed/)
    expect(written).toBe(false)
  })
})
