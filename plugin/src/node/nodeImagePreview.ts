import type { NodeImagePreview } from '@/components/nodeWork/types'
import { readNodeBytes } from './NodeFilesModel'

export const NODE_IMAGE_MAX_BYTES = 4 * 1024 * 1024
const mimes: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}
export const isNodeImagePath = (path: string) => !!mimes[path.split('.').pop()?.toLowerCase() ?? '']
const binaryRefusal = 'Binary file: no text preview.'
/** Only local raster content is embedded; a filename alone does not establish its type. */
export async function readNodeImage(
  path: string,
  blob: { content_id: string | null; size: number; too_large: boolean },
  read: (offset: number) => Promise<{ offset: number; total: number; base64: string }>
): Promise<NodeImagePreview> {
  const mime = mimes[path.split('.').pop()?.toLowerCase() ?? '']
  if (!mime) throw new Error(binaryRefusal)
  if (blob.too_large || blob.size > NODE_IMAGE_MAX_BYTES)
    throw new Error('Image preview is limited to 4 MiB.')
  if (!blob.content_id) throw new Error('Image content is unavailable for preview.')
  const bytes = await readNodeBytes(read, NODE_IMAGE_MAX_BYTES)
  const prefix = (...values: number[]) => values.every((value, i) => bytes[i] === value)
  const ascii = (start: number, text: string) =>
    [...text].every((c, i) => bytes[start + i] === c.charCodeAt(0))
  const valid =
    mime === 'image/png'
      ? prefix(137, 80, 78, 71, 13, 10, 26, 10)
      : mime === 'image/jpeg'
        ? prefix(255, 216, 255)
        : mime === 'image/gif'
          ? ascii(0, 'GIF87a') || ascii(0, 'GIF89a')
          : mime === 'image/webp'
            ? ascii(0, 'RIFF') && ascii(8, 'WEBP')
            : mime === 'image/bmp'
              ? ascii(0, 'BM')
              : prefix(0, 0, 1, 0)
  if (!valid) throw new Error(binaryRefusal)
  return { bytes, mime }
}
