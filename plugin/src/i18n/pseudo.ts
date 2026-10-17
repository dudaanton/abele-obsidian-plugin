/** Only used by test builds; placeholders and supplied content stay byte-identical. */
export function pseudoMessage(text: string): string {
  const normal = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const accents = 'áƀçďéƒğħíĵķľḿñóṕɋŕšţúṽŵẋýžÁɃÇĎÉƑĞĦÍĴĶĽḾÑÓṔɊŔŠŢÚṼŴẊÝŽ'
  const parts = text.split(/(\{\w+\})/g)
  const prose = parts.filter((p) => !/^\{\w+\}$/.test(p)).join('')
  const transformed = parts
    .map((p) =>
      /^\{\w+\}$/.test(p)
        ? p
        : [...p].map((c) => (normal.includes(c) ? accents[normal.indexOf(c)] : c)).join('')
    )
    .join('')
  return `⟦${transformed}${'~'.repeat(Math.max(0, Math.round(prose.length * 0.35) - 2))}⟧`
}
