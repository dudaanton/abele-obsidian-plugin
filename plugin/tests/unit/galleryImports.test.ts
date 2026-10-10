import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useGalleryImports } from '@/composables/useGalleryImports'
import type { Gallery } from '@/entities/Gallery'

describe('gallery drop ownership', () => {
  it('leaves readonly galleries out of system-file drag handling', async () => {
    const gallery = { readonly: true } as Gallery
    const imports = useGalleryImports({ gallery }, ref(null))
    const event = {
      dataTransfer: { types: ['Files'], files: [new File(['sample'], 'sample.png')] },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    }
    imports.onDragEnter(event as unknown as DragEvent)
    await imports.onDrop(event as unknown as DragEvent)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(event.stopPropagation).not.toHaveBeenCalled()
    expect(imports.draggingFiles.value).toBe(false)
  })
})
