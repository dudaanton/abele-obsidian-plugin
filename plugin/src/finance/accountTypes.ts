/** Account roles and transaction classification, independent of the vault and UI. */
export type AccountType = 'asset' | 'expense' | 'revenue' | 'liability' | 'computed' | 'mixed'
export type TransactionKind = 'income' | 'expense' | 'transfer'

export function isWalletType(type: string | null | undefined): boolean {
  return type === 'asset' || type === 'liability'
}

export function isCategoryType(type: string | null | undefined): boolean {
  return type === 'expense' || type === 'revenue' || type === 'mixed'
}

/** Mixed categories act as income sources or expense destinations only against wallets. */
export function financeDirections(from: string | null | undefined, to: string | null | undefined) {
  return {
    income: from === 'revenue' || (from === 'mixed' && isWalletType(to)),
    expense: to === 'expense' || (to === 'mixed' && isWalletType(from)),
  }
}

export function transactionKind(
  from: string | null | undefined,
  to: string | null | undefined
): TransactionKind {
  const { income, expense } = financeDirections(from, to)
  // Preserve the existing precedence for a revenue-to-expense transaction.
  return expense ? 'expense' : income ? 'income' : 'transfer'
}
