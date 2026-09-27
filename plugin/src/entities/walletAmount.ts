/**
 * How much of a transaction an account sees, signed: what the balance of `role`'s side moves by.
 *
 * Shared by `BalanceIndex` (the balances on screen) and the analytics tools, so the two can never
 * disagree about a cross-currency transfer. The rule, as it always was in `BalanceIndex`:
 * - an account with no currency of its own (a category, a revenue source) sees `amount`;
 * - a wallet sees `foreignAmount` when that is in its currency;
 * - in a move between two wallets in different currencies the amount is in one of them and the
 *   other side is only known through `foreignAmount`. Without it that side has received (or
 *   sent) nothing that can be counted — reusing the sum in the other currency would credit
 *   dollars as if they were euros — so it sees 0.
 */
export interface WalletTransaction {
  amount: number
  currency: string | null
  foreignAmount: number | null
  foreignCurrency: string | null
}

export function walletAmount(
  tx: WalletTransaction,
  walletCurrency: string | null,
  otherWalletCurrency: string | null,
  role: 'from' | 'to'
): number {
  const sign = role === 'from' ? -1 : 1
  if (!walletCurrency) return sign * tx.amount

  if (tx.foreignAmount != null && tx.foreignCurrency === walletCurrency) {
    return sign * tx.foreignAmount
  }

  if (otherWalletCurrency && otherWalletCurrency !== walletCurrency) {
    const holdsAmount = tx.currency ? tx.currency === walletCurrency : role === 'from'
    if (holdsAmount) return sign * tx.amount
    if (tx.foreignAmount != null && !tx.foreignCurrency) return sign * tx.foreignAmount
    return 0
  }

  return sign * tx.amount
}
