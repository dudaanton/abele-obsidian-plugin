/** Deliberately wider than either a phone pane or a desktop reading column. */
export const wideGithubReadme = (origin: string) => {
  const cells = Array.from({ length: 16 }, (_, i) => `Sample column ${i + 1}`)
  return `# Sample wide README

${'sample-unbroken-word-'.repeat(100)}

| ${cells.join(' | ')} |
| ${cells.map(() => '---').join(' | ')} |
| ${cells.map(() => 'sample-cell-value-'.repeat(8)).join(' | ')} |

\`\`\`text
${'sample-code-token '.repeat(160)}
\`\`\`

![Sample wide image](${origin}/avatars/u/sample-wide.png)

${Array.from({ length: 80 }, (_, i) => `## Sample section ${i + 1}\n\nSample paragraph for scrolling through the document.\n`).join('\n')}
`
}
