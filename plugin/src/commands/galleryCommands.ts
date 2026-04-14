import { Editor, Notice } from 'obsidian'
import { parseImageLine, parseGalleryHeader, isImageEmbed } from '@/helpers/galleryUtils'

const GALLERY_HEADER = '::abele-gallery::'

export function insertGallery(editor: Editor) {
  const cursor = editor.getCursor()
  editor.replaceRange(GALLERY_HEADER + '\n', { line: cursor.line, ch: 0 })
  editor.setCursor({ line: cursor.line + 1, ch: 0 })
}

export function convertImagesToGalleries(editor: Editor) {
  const content = editor.getValue()
  const lines = content.split('\n')
  const result: string[] = []
  let converted = 0

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Skip lines already inside a gallery block
    if (parseGalleryHeader(line)) {
      result.push(line)
      i++
      // Copy all image lines and blanks that belong to this gallery
      while (i < lines.length) {
        const trimmed = lines[i].trim()
        if (trimmed === '' || parseImageLine(trimmed)) {
          result.push(lines[i])
          i++
        } else {
          break
        }
      }
      continue
    }

    // Check if this line is a standalone image embed
    if (!isImageEmbed(line)) {
      result.push(line)
      i++
      continue
    }

    // Found an image — collect consecutive images
    const imageLines: string[] = [line]
    let j = i + 1
    while (j < lines.length) {
      const nextTrimmed = lines[j].trim()
      if (nextTrimmed === '') {
        // Peek ahead: if next non-empty line is also an image, include the blank
        let k = j + 1
        while (k < lines.length && lines[k].trim() === '') k++
        if (k < lines.length && isImageEmbed(lines[k])) {
          imageLines.push(lines[j])
          j++
          continue
        }
        break
      }
      if (isImageEmbed(nextTrimmed)) {
        imageLines.push(lines[j])
        j++
      } else {
        break
      }
    }

    // Wrap in gallery
    result.push(GALLERY_HEADER)
    result.push(...imageLines)
    converted++
    i = j
  }

  if (converted === 0) {
    new Notice('No images found to convert')
    return
  }

  editor.setValue(result.join('\n'))
  new Notice(`Created ${converted} gallery${converted > 1 ? ' blocks' : ''}`)
}
