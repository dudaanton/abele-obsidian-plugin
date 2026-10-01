import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { MarkdownRenderer } from 'obsidian'
import Markdown from '@/components/obsidian/Markdown.vue'
import { prepareGithubMarkdown } from '@/github/safeMarkdown'
import { useVault } from '../helpers/testEnv'

afterEach(() => vi.restoreAllMocks())

describe('plugin blocks in text from outside notes', () => {
  it.each(['- ', '* ', '+ ', '1. ', '1) ', '> - ', '> 2. > '])(
    'neutralises a fence after %s',
    (prefix) => {
      expect(prepareGithubMarkdown(`${prefix}\`\`\`dataviewjs\n  sample()\n  \`\`\``)).toContain(
        `${prefix}\`\`\`text`
      )
    }
  )

  it('guards model and script markdown before rendering, including streaming output', async () => {
    useVault([])
    const render = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue()
    const wrapper = mount(Markdown, {
      props: { text: '```dataviewjs\nsample()\n```', streaming: true },
    })
    await vi.waitFor(() => expect(render).toHaveBeenCalled())
    expect(render.mock.calls[0][1]).toBe('```text\nsample()\n```')
    wrapper.unmount()
  })

  it('does not restrict the note renderer or Abele visual blocks', async () => {
    useVault([])
    const render = vi.spyOn(MarkdownRenderer, 'render').mockResolvedValue()
    const wrapper = mount(Markdown, {
      props: { text: '```dataviewjs\nsample()\n```', trusted: true },
    })
    await vi.waitFor(() => expect(render).toHaveBeenCalled())
    expect(render.mock.calls[0][1]).toContain('```dataviewjs')
    wrapper.unmount()
    const chart = mount(Markdown, { props: { text: '```abele-chart\ntype: bar\n```' } })
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2))
    expect(render.mock.calls[1][1]).toContain('```abele-chart')
    chart.unmount()
  })

  it('leaves internet images in replies loading normally', async () => {
    useVault([])
    vi.spyOn(MarkdownRenderer, 'render').mockImplementation(async (_app, _md, el) => {
      el.innerHTML = '<img src="https://images.example.org/sample.png">'
    })
    const wrapper = mount(Markdown, {
      props: { text: '![](https://images.example.org/sample.png)' },
    })
    await vi.waitFor(() => expect(wrapper.find('img').exists()).toBe(true))
    expect(wrapper.find('img').attributes('src')).toBe('https://images.example.org/sample.png')
    wrapper.unmount()
  })
})
