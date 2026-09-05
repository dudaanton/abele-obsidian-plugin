/**
 * A script's name as its command id and tool name.
 *
 * A Cyrillic name used to come out empty, so every such script registered the same command
 * and the same tool and only the last one read was ever on screen.
 */
import { describe, it, expect } from 'vitest'
import { scriptSlug } from '@/scripting/scriptSlug'

describe('the handle a script name becomes', () => {
  it('leaves a Latin name exactly as it always was', () => {
    expect(scriptSlug('Tag films')).toBe('tag-films')
    expect(scriptSlug('  Import from TMDB! ')).toBe('import-from-tmdb')
  })

  it('transliterates Cyrillic instead of dropping it', () => {
    expect(scriptSlug('Сортировать задачи под курсором')).toBe('sortirovat-zadachi-pod-kursorom')
    expect(scriptSlug('Ёжик в тумане')).toBe('yozhik-v-tumane')
  })

  it('gives two Cyrillic names two different handles', () => {
    expect(scriptSlug('Сортировать задачи')).not.toBe(scriptSlug('Закрыть задачи'))
  })

  it('falls back to a stable hash when nothing Latin is left', () => {
    const one = scriptSlug('日本語')
    expect(one).toMatch(/^x[0-9a-f]{8}$/)
    expect(scriptSlug('日本語')).toBe(one)
    expect(scriptSlug('中文')).not.toBe(one)
  })
})
