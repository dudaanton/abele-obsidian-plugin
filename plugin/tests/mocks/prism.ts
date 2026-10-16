/**
 * A stand-in for the Prism Obsidian ships, for tests: a handful of languages, each the same few
 * rules, returning tokens the way Prism does — plain strings between `{ type, content }` objects.
 * Enough to see that code is coloured with Prism's own token classes and where.
 */
import type { PrismEngine, PrismToken } from '@/editor/EditorSyntax'

const RULES: [string, RegExp][] = [
  ['comment', /\/\*[\s\S]*?\*\/|(?:^|(?<=\s))#(?!!).*$/my],
  ['shebang', /^#!.*$/my],
  ['string', /'[^'\n]*'|"[^"\n]*"/y],
  ['keyword', /\b(?:const|let|function|export|return|if|then|fi|echo|set|exit|cd|def|import)\b/y],
  ['number', /\b\d+\b/y],
  ['punctuation', /[{}()[\];,]/y],
]

const LANGUAGES = [
  'typescript',
  'javascript',
  'bash',
  'python',
  'markup',
  'css',
  'json',
  'yaml',
  'markdown',
  'diff',
]

export const fakePrism: PrismEngine & { calls: number } = {
  calls: 0,
  languages: Object.fromEntries(LANGUAGES.map((name) => [name, { name }])),
  tokenize(source: string): (string | PrismToken)[] {
    fakePrism.calls++
    const out: (string | PrismToken)[] = []
    let plain = ''
    let at = 0
    outer: while (at < source.length) {
      for (const [type, rule] of RULES) {
        rule.lastIndex = at
        const match = rule.exec(source)
        if (match && match[0].length > 0) {
          if (plain) out.push(plain)
          plain = ''
          out.push(
            type === 'shebang'
              ? { type: 'shebang', alias: 'important', content: match[0] }
              : { type, content: match[0] }
          )
          at += match[0].length
          continue outer
        }
      }
      plain += source[at++]
    }
    if (plain) out.push(plain)
    return out
  },
}
