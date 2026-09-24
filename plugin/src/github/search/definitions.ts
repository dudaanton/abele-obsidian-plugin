/**
 * Go to definition, by pattern rather than by understanding: for the name clicked, the lines in
 * the repository that look like they declare it — `function name`, `class name`, `def name`,
 * `func (r T) name` — in the syntax of each file's own language.
 *
 * It is a heuristic and says so. It finds a declaration the way a person skimming would, so it
 * misses what is generated or re-exported under another name, and it can offer a same-named
 * declaration from somewhere unrelated; the nearer candidates — the same file, the same folder —
 * come first for that reason.
 */
import type { IndexedFile } from './repoIndex'
import { searchText, type LineMatch } from './textSearch'

export type Lang =
  | 'ts'
  | 'python'
  | 'go'
  | 'java'
  | 'kotlin'
  | 'csharp'
  | 'swift'
  | 'rust'
  | 'ruby'
  | 'php'
  | 'c'
  | 'other'

const EXTENSIONS: Record<string, Lang> = {
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  vue: 'ts',
  svelte: 'ts',
  py: 'python',
  pyi: 'python',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'kotlin',
  cs: 'csharp',
  swift: 'swift',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cc: 'c',
  cpp: 'c',
  cxx: 'c',
  hpp: 'c',
  hh: 'c',
  hxx: 'c',
  m: 'c',
  mm: 'c',
}

export function languageOf(path: string): Lang {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return EXTENSIONS[ext] ?? 'other'
}

/** What can be looked up: an identifier, not an operator or a string. */
export const isIdentifier = (word: string) => /^[A-Za-z_$][\w$]*$/.test(word)

/** Words that start a statement, never a declaration's type or return type. */
const NOT_A_TYPE = '(?!(?:return|new|else|throw|await|yield|case|goto|delete|typeof|sizeof)\\b)'

const JAVA_MODIFIERS =
  '(?:(?:public|private|protected|internal|static|final|abstract|override|virtual|async|synchronized|native|sealed|partial|extern|unsafe|default|open|inline|suspend|operator|infix|tailrec|external|const|readonly|new)[ \\t]+)'

/**
 * The patterns that declare `name` in a language, each a whole line away from being a call.
 * `N` is the name, already escaped. Each keeps to one line — `[ \t]`, never `\s`, which under
 * the `m` flag lets `^\s*` start on the blank line before a declaration and name the wrong line;
 * and every negated class leaves out `\n`, or `\([^)]*` runs on to a later line's `)` and takes a
 * call for a declaration.
 */
function patterns(lang: Lang, N: string): string[] {
  switch (lang) {
    case 'ts':
      return [
        `^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:declare[ \\t]+)?(?:async[ \\t]+)?function[ \\t]*\\*?[ \\t]*${N}\\b`,
        `^[ \\t]*(?:export[ \\t]+)?(?:default[ \\t]+)?(?:declare[ \\t]+)?(?:abstract[ \\t]+)?(?:const[ \\t]+)?(?:class|interface|type|enum|namespace|module)[ \\t]+${N}\\b`,
        `^[ \\t]*(?:export[ \\t]+)?(?:declare[ \\t]+)?(?:const|let|var)[ \\t]+${N}\\b[ \\t]*[:=]`,
        // A method in a class or an object: `name(args) {`, with modifiers and a return type.
        `^[ \\t]*(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)[ \\t]+)*\\*?${N}[ \\t]*(?:<[^\\n>]*>)?[ \\t]*\\([^\\n)]*\\)[ \\t]*(?::[ \\t]*[^\\n={;]+)?\\{`,
        // A field holding a function: `name = (args) =>`, `name: async () =>`.
        `^[ \\t]*(?:(?:public|private|protected|static|readonly)[ \\t]+)*${N}[ \\t]*[:=][ \\t]*(?:async[ \\t]*)?(?:\\([^\\n)]*\\)|[\\w$]+)[ \\t]*(?::[ \\t]*[^\\n=]+)?=>`,
      ]
    case 'python':
      return [
        `^[ \\t]*(?:async[ \\t]+)?def[ \\t]+${N}\\b`,
        `^[ \\t]*class[ \\t]+${N}\\b`,
        // A module-level assignment, at the first column.
        `^${N}[ \\t]*(?::[^=\\n]+)?=(?!=)`,
      ]
    case 'go':
      return [
        `^func[ \\t]+${N}[ \\t]*[(\\[]`,
        `^func[ \\t]*\\([^\\n)]*\\)[ \\t]*${N}[ \\t]*[(\\[]`,
        `^[ \\t]*type[ \\t]+${N}\\b`,
        `^[ \\t]*(?:var|const)[ \\t]+${N}\\b`,
      ]
    case 'java':
    case 'csharp':
      return [
        `\\b(?:class|interface|enum|record|struct|@interface)[ \\t]+${N}\\b`,
        `^[ \\t]*${JAVA_MODIFIERS}*${NOT_A_TYPE}[\\w<>\\[\\],.?]+(?:<[^\\n>]*>)?[ \\t]+${N}[ \\t]*\\([^\\n;]*$`,
        `^[ \\t]*${JAVA_MODIFIERS}+${NOT_A_TYPE}[\\w<>\\[\\],.?]+[ \\t]+${N}[ \\t]*(?:=|;|\\{)`,
      ]
    case 'kotlin':
      return [
        `\\b(?:class|interface|object|typealias|trait)[ \\t]+${N}\\b`,
        `\\b(?:fun|def)[ \\t]+(?:<[^\\n>]*>[ \\t]*)?(?:[\\w.]+\\.)?${N}[ \\t]*[(<\\[:=]`,
        `^[ \\t]*${JAVA_MODIFIERS}*(?:val|var|lazy val)[ \\t]+${N}\\b`,
      ]
    case 'swift':
      return [
        `\\b(?:class|struct|enum|protocol|extension|typealias|actor)[ \\t]+${N}\\b`,
        `\\bfunc[ \\t]+${N}[ \\t]*[(<]`,
        `^[ \\t]*${JAVA_MODIFIERS}*(?:let|var)[ \\t]+${N}\\b`,
        `\\bcase[ \\t]+${N}\\b`,
      ]
    case 'rust':
      return [
        `\\bfn[ \\t]+${N}\\b`,
        `\\b(?:struct|enum|trait|type|union|mod)[ \\t]+${N}\\b`,
        `\\b(?:const|static)[ \\t]+(?:mut[ \\t]+)?${N}[ \\t]*:`,
        `\\bmacro_rules![ \\t]*${N}\\b`,
      ]
    case 'ruby':
      return [
        `^[ \\t]*def[ \\t]+(?:self\\.)?${N}\\b`,
        `^[ \\t]*(?:class|module)[ \\t]+(?:[\\w:]+::)?${N}\\b`,
        `^[ \\t]*${N}[ \\t]*=(?!=)`,
        `^[ \\t]*attr_(?:reader|writer|accessor)\\b.*:${N}\\b`,
      ]
    case 'php':
      return [
        `\\bfunction[ \\t]+&?${N}[ \\t]*\\(`,
        `\\b(?:class|interface|trait|enum)[ \\t]+${N}\\b`,
        `\\bconst[ \\t]+${N}\\b`,
      ]
    case 'c':
      return [
        `^[ \\t]*#[ \\t]*define[ \\t]+${N}\\b`,
        `\\b(?:struct|class|union|enum(?:[ \\t]+class)?|namespace)[ \\t]+${N}\\b[ \\t]*(?:[:{]|$)`,
        `\\btypedef\\b.*\\b${N}[ \\t]*;`,
        `^[ \\t]*using[ \\t]+${N}[ \\t]*=`,
        // A function's definition or prototype: a type before the name, no statement keyword.
        `^${NOT_A_TYPE}(?![ \\t]*(?:if|while|for|switch|else|do)\\b)[A-Za-z_][\\w \\t*&:<>,~]*[ \\t*&:]${N}[ \\t]*\\([^\\n;]*$`,
      ]
    case 'other':
      return [
        `\\b(?:function|def|fn|func|fun|sub|proc|class|struct|interface|enum|type|trait|module|macro)[ \\t]+${N}\\b`,
      ]
  }
}

const escape = (s: string) => s.replace(/[$]/g, '\\$')

/** The declaring patterns for a name in one language, as one regular expression. */
export function definitionPattern(lang: Lang, name: string): RegExp {
  return new RegExp(
    patterns(lang, escape(name))
      .map((p) => `(?:${p})`)
      .join('|'),
    'gm'
  )
}

export interface DefinitionHit extends LineMatch {
  path: string
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

/**
 * Where a name looks declared, nearest first: the file it was clicked in, then its folder, then
 * files in the same language, then the rest — each in path order.
 */
export function findDefinitions(
  files: Iterable<IndexedFile>,
  name: string,
  fromPath = '',
  limit = 50
): DefinitionHit[] {
  if (!isIdentifier(name)) return []
  const byLang = new Map<Lang, RegExp>()
  const hits: Array<DefinitionHit & { rank: number }> = []
  const fromDir = dirOf(fromPath)
  const fromLang = languageOf(fromPath)

  for (const file of files) {
    // A cheap pass first: most files never mention the name at all.
    if (!file.text.includes(name)) continue
    const lang = languageOf(file.path)
    let re = byLang.get(lang)
    if (!re) byLang.set(lang, (re = definitionPattern(lang, name)))
    const rank =
      file.path === fromPath
        ? 0
        : dirOf(file.path) === fromDir
          ? 1
          : lang === fromLang && lang !== 'other'
            ? 2
            : 3
    for (const m of searchText(file.text, re, 20)) hits.push({ ...m, path: file.path, rank })
  }

  return hits
    .sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path) || a.line - b.line)
    .slice(0, limit)
    .map(({ rank: _rank, ...hit }) => hit)
}
