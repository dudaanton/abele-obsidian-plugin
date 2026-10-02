/** Reviewed archive and lexical part operations shared by Word and workbooks. */
import type { ZipLoader } from '@/reader/zipLoader'
import { strToU8, Zip, ZipDeflate, AsyncZipDeflate } from 'fflate'
import { openOfficeZip } from './boundedZip'
import { parseXml } from './xml'
export const MAX_XML = 8 * 1024 * 1024
export const MAX_ARCHIVE = 32 * 1024 * 1024
export const MAX_EXPANDED = 96 * 1024 * 1024
export interface OfficePackage { original: Uint8Array; archive: ZipLoader }
export async function openOfficeArchive(original: Uint8Array, yieldTask?: () => Promise<void>): Promise<ZipLoader> {
  if (original.length > MAX_ARCHIVE) throw new Error('Document is too large (32 MB compressed limit)')
  return openOfficeZip(original, {compressed:MAX_ARCHIVE,expanded:MAX_EXPANDED,xml:MAX_XML,entries:4000}, yieldTask)
}
export const pack = (parts: Record<string, Uint8Array>): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    // Streaming retains arbitrary part names without a prototype-keyed flattening map.
    const chunks: Uint8Array[] = []
    let length = 0
    let failed = false
    const writer = new Zip((error, bytes, final) => {
      if (failed) return
      if (error || length + bytes.length > MAX_ARCHIVE) {
        failed = true
        writer.terminate()
        reject(error ?? new Error('Document is too large compressed'))
        return
      }
      chunks.push(bytes)
      length += bytes.length
      if (final) {
        const result = new Uint8Array(length)
        let at = 0
        for (const chunk of chunks) { result.set(chunk,at); at += chunk.length }
        resolve(result)
      }
    })
    try {
      for (const [name,bytes] of Object.entries(parts)) {
        if (failed) break
        const entry = bytes.length >= 160_000 ? new AsyncZipDeflate(name,{level:6}) : new ZipDeflate(name,{level:6})
        writer.add(entry)
        entry.push(bytes.slice(),true)
      }
      if (!failed) writer.end()
    } catch (error) {
      failed = true
      writer.terminate()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
export async function saveParts(doc: OfficePackage, changed: Map<string,Uint8Array|null>): Promise<Uint8Array> {
  if (!changed.size) return doc.original
  for (const [name,bytes] of changed) if (bytes && /\.(?:xml|rels)$/.test(name)) {
    if (bytes.length > MAX_XML) throw new Error('Document XML is too large')
    await parseXml(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes))
  }
  const parts: Record<string, Uint8Array> = Object.create(null)
  for (const entry of doc.archive.entries) {
    const bytes = changed.has(entry.filename) ? changed.get(entry.filename) : doc.archive.loadBytes(entry.filename)
    if (bytes) parts[entry.filename] = bytes
  }
  for (const [name,bytes] of changed) if (bytes) parts[name] = bytes
  return pack(parts)
}
export const xmlBytes = (source:string) => strToU8(source)
/** Strict UTF-8 decoding, retaining a BOM for lossless offset patches. */
export function xmlPart(archive:ZipLoader,name:string):string|null {
  const bytes=archive.loadBytes(name);if(!bytes)return null
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)}
  catch{throw new Error('Unsupported or invalid Office XML encoding')}
}
export function resolvePart(base:string,target:string):string {
  if(!target || /[\\?#]|^[a-z]+:/i.test(target))throw new Error('Invalid relationship path')
  const segments=target.startsWith('/')?[]:base.split('/').slice(0,-1)
  for(const segment of target.split('/')) {
    if(!segment || segment==='.')continue
    if(segment==='..'){if(!segments.length)throw new Error('Invalid relationship path');segments.pop()}
    else segments.push(segment)
  }
  return segments.join('/')
}
