import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { expect, it } from 'vitest'

function css(component: string): string {
  const source = readFileSync(`src/components/${component}.vue`, 'utf8')
  return compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]).css
}

it('lets repository actions shrink and wrap inside a narrow header', () => {
  const actions = css('github/GithubHeader').match(
    /\.abele-github-header__actions\s*\{([^}]+)\}/
  )![1]
  expect(actions).toContain('min-width: 0')
  expect(actions).toContain('flex-wrap: wrap')
  expect(actions).toContain('flex-shrink: 1')
})
