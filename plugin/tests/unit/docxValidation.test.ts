import { expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { openDocx, saveParts } from '@/word/package'
import { writeWordChange } from '@/word/vaultAdapter'
import { sampleDocx, sampleParts } from '../fixtures/docx/sampleDocx'
import { useVault } from '../helpers/testEnv'

it('validates edited XML parts before returning a replacement archive', async () => {
  const original = await openDocx(sampleDocx())
  const invalid = strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><z:r/></w:p></w:body></w:document>'
  )
  await expect(
    saveParts(original, new Map([['word/document.xml', invalid]])).then(() => 'returned')
  ).rejects.toThrow(/namespace/)
})
it('validates edited relationship parts even when no body text changed', async () => {
  const original = await openDocx(sampleDocx())
  const invalid = strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sample" r:Target="sample"/></Relationships>'
  )
  await expect(
    saveParts(original, new Map([['word/_rels/document.xml.rels', invalid]])).then(() => 'returned')
  ).rejects.toThrow(/namespace/)
})
it('never writes an unreadable edit result over the source document', async () => {
  const app = useVault([])
  const original = sampleDocx()
  const file = await app.vault.createBinary('sample.docx', original.buffer as ArrayBuffer)
  const parts = sampleParts()
  parts['word/document.xml'] = strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><z:r/></w:p></w:body></w:document>'
  )
  await expect(writeWordChange(app as never, file, original, zipSync(parts))).rejects.toThrow(
    /namespace/
  )
  expect(app.stats.modify).toBe(0)
  expect(new Uint8Array(await app.vault.readBinary(file))).toEqual(original)
})
