import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { holdsBalance, walletBalance, type WalletSource } from '@/properties/wallet'
import { formatAmount } from '@/helpers/moneyFormat'
import type { AccountType } from '@/entities/Account'

beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Moscow')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2024-03-01T00:15:00+03:00'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
function source(
  accountType: AccountType | null = 'asset',
  currency: string | null = 'EUR',
  amount = 0
): WalletSource {
  return {
    resolve: vi.fn(() => 'Home/Wallet.md'),
    account: vi.fn(() => ({ accountType, currency })),
    balance: vi.fn(() => amount),
  }
}

describe('wallet property balance', () => {
  it.each(['asset', 'liability', 'expense', 'revenue', 'computed', null] as const)(
    'only holds money for asset/liability, not %s categories or computed accounts',
    (type) => {
      const wallet = type === 'asset' || type === 'liability'
      expect(holdsBalance(type)).toBe(wallet)
      const s = source(type)
      expect(walletBalance('[[Wallet]]', 'Home/Receipt.md', s) !== null).toBe(wallet)
      expect(s.balance).toHaveBeenCalledTimes(wallet ? 1 : 0)
    }
  )

  it('passes the source note and alias-free target to resolution and reads today, not the transaction date', () => {
    const s = source()
    const result = walletBalance('[[Home/Wallet|Card]]', 'Home/Receipt.md', s)
    expect(s.resolve).toHaveBeenCalledWith('Home/Wallet', 'Home/Receipt.md')
    expect(s.account).toHaveBeenCalledWith('Home/Wallet.md')
    expect(s.balance).toHaveBeenCalledWith('Home/Wallet.md', expect.anything())
    const date = vi.mocked(s.balance).mock.calls[0][1]
    expect(date.format('YYYY-MM-DD HH:mm Z')).toBe('2024-03-01 00:15 +03:00')
    expect(result).toEqual({
      path: 'Home/Wallet.md',
      text: `${formatAmount(0)} EUR`,
      negative: false,
    })
    const explicit = dayjs('2024-02-29')
    walletBalance('[[Wallet]]', 'Receipt.md', s, explicit)
    expect(s.balance).toHaveBeenLastCalledWith('Home/Wallet.md', explicit)
  })

  it.each([null, undefined, 12, true, [], {}, 'words', 'Wallet', ''])(
    'does not read a balance for non-link %j',
    (value) => {
      const s = source()
      expect(walletBalance(value, 'Receipt.md', s)).toBeNull()
      expect(s.resolve).not.toHaveBeenCalled()
      expect(s.balance).not.toHaveBeenCalled()
    }
  )

  it('stops before balance lookup for unresolved links and resolved non-account notes', () => {
    const s = source()
    vi.mocked(s.resolve).mockReturnValueOnce(null)
    expect(walletBalance('[[Missing]]', 'Receipt.md', s)).toBeNull()
    expect(s.account).not.toHaveBeenCalled()
    vi.mocked(s.account).mockReturnValueOnce(null)
    expect(walletBalance('[[Plain note]]', 'Receipt.md', s)).toBeNull()
    expect(s.balance).not.toHaveBeenCalled()
  })

  it.each([
    { amount: -0.001, negative: false },
    { amount: -0, negative: false },
    { amount: 0, negative: false },
    { amount: 0.01, negative: false },
    { amount: -0.01, negative: true },
    { amount: 12.5, negative: false },
  ])(
    'tints the displayed rounded balance $amount, including positive debts',
    ({ amount, negative }) => {
      expect(walletBalance('[[Wallet]]', 'Receipt.md', source('liability', 'USD', amount))).toEqual(
        {
          path: 'Home/Wallet.md',
          text: `${formatAmount(amount)} USD`,
          negative,
        }
      )
    }
  )

  it('omits the currency separator when no currency is set', () => {
    expect(walletBalance('[[Wallet]]', 'Receipt.md', source('asset', null, 123.45))?.text).toBe(
      formatAmount(123.45)
    )
  })
})
