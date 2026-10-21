import { expect, it } from 'vitest'
import { chatMarkdown } from '@/ai/chatMarkdown'

it('keeps shell variable and substitution dollars out of inline math', () => {
  expect(chatMarkdown(`Run 'c$SAMPLE' "$(echo sample)"`)).toBe(
    `Run 'c\\$SAMPLE' "\\$(echo sample)"`
  )
})
it('preserves mathematical expressions and code verbatim', () => {
  const text = 'Compute $x$ and $x + y$. Use `$SAMPLE` or:\n```sh\necho "$SAMPLE"\n```'
  expect(chatMarkdown(text)).toBe(text)
  expect(chatMarkdown('Already \\$SAMPLE')).toBe('Already \\$SAMPLE')
})
