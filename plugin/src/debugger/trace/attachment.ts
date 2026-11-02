import { z } from 'zod'

export const attachmentSchema = z.object({
  name: z.string(),
  pid: z.number().optional(),
  folder: z.string(),
  loaded_scripts: z.number().optional(),
  source_maps: z.boolean().optional(),
  files: z.array(
    z.object({
      path: z.string(),
      loaded: z.boolean().optional(),
      mapped: z.boolean().optional(),
    })
  ),
})
export type Attachment = z.infer<typeof attachmentSchema>

export function describeAttachment(attachment: Attachment, file: string, pending = false) {
  const prefix = `Attached here: ${attachment.name}${attachment.pid === undefined ? '' : ` (pid ${attachment.pid})`} · ${attachment.folder}`
  const evidence = attachment.files.find((entry) => entry.path === file)
  const maps =
    attachment.source_maps === undefined ? 'unknown' : attachment.source_maps ? 'yes' : 'no'
  if (evidence?.loaded === false)
    return `${prefix} — it has not loaded ${file} yet${pending ? '; the point will apply when it does' : ''}.${evidence.mapped === false && attachment.loaded_scripts !== undefined ? ` It loads ${attachment.loaded_scripts} scripts, none maps to ${file} (source maps: ${maps}).` : ''}`
  if (evidence?.mapped === false && attachment.loaded_scripts !== undefined)
    return `${prefix} — loads ${attachment.loaded_scripts} scripts, none maps to ${file} (source maps: ${maps}).`
  return `${prefix} — source binding for ${file}: ${evidence?.loaded === true ? 'loaded' : 'unknown'} (source maps: ${maps}).`
}
