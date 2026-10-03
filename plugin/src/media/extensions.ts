/** Shared basic image formats. Rendering/transcoding restrictions belong to the consumer. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']
export const GALLERY_IMAGE_EXTENSIONS = [...IMAGE_EXTENSIONS, 'heic', 'heif']
export const SCAN_IMAGE_EXTENSIONS = [...IMAGE_EXTENSIONS, 'ico']
export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'ogv']
export const SCAN_VIDEO_EXTENSIONS = VIDEO_EXTENSIONS.filter((extension) => extension !== 'avi')
export const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'flac', 'aac', 'm4a']
export const SCAN_MEDIA_EXTENSIONS = [
  ...SCAN_IMAGE_EXTENSIONS,
  ...SCAN_VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  'pdf',
]

/** Expects an extension, not a path or MIME type; unknown remains other. */
export function scanMediaType(extension: string): 'image' | 'video' | 'audio' | 'other' {
  if (SCAN_IMAGE_EXTENSIONS.includes(extension)) return 'image'
  if (SCAN_VIDEO_EXTENSIONS.includes(extension)) return 'video'
  if (AUDIO_EXTENSIONS.includes(extension)) return 'audio'
  return 'other'
}
