import { readFileSync } from 'node:fs'
import { compileString } from 'sass-embedded'
import { expect, it } from 'vitest'

function css(component: string): string {
  const source = readFileSync(`src/components/${component}.vue`, 'utf8')
  return compileString(source.match(/<style lang="scss">([\s\S]*?)<\/style>/)![1]).css
}

it('pins file actions together with the breadcrumb over an opaque theme background', () => {
  const header = css('github/GithubHeader').match(
    /\.abele-github-header\.abele-github-header_file\s*\{([^}]+)\}/
  )?.[1]
  expect(header).toContain('position: sticky')
  expect(header).toContain('background: var(--background-primary)')
  expect(header).toContain('display: flex')
})

it('lets repository actions shrink and wrap inside a narrow header', () => {
  const actions = css('github/GithubHeader').match(
    /\.abele-github-header__actions\s*\{([^}]+)\}/
  )![1]
  expect(actions).toContain('min-width: 0')
  expect(actions).toContain('flex-wrap: wrap')
  expect(actions).toContain('flex-shrink: 1')
})

it('keeps remote item phone navigation inline while giving the repository label the remaining width', () => {
  const compiled = css('github/GithubHeader')
  const actions = compiled.match(
    /body\.is-phone \.abele-github:not\(\.abele-github_node\) \.abele-github-header__actions\s*\{([^}]+)\}/
  )?.[1]
  expect(actions).toContain('flex-wrap: nowrap')
  expect(actions).toContain('flex-shrink: 0')
  expect(actions).toContain('gap: 0')
  const repo = compiled.match(
    /body\.is-phone \.abele-github:not\(\.abele-github_node\) \.abele-github-header__repo\s*\{([^}]+)\}/
  )?.[1]
  expect(repo).toContain('flex-basis: 0')
})
