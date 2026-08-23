import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { Keypad } from '../../components/Pay'
import { figureSize, floor2, two } from '../../lib/money'

/**
 * How much to move into Aave.
 *
 * It used to take the whole spare balance without asking, which is a strange
 * thing for a wallet to do — so it asks, with the ceiling one tap away for
 * the common case of moving all of it.
 *
 * The ceiling is not the loose balance: the account keeps a few operations'
 * worth of USDT back, because it pays its own network fees in USDT and an
 * account that supplies every last token cannot afford its next transaction.
 */
export function AddMoneySheet({
  max, symbol, onClose, onAdd,
}: {
  max: string
  symbol: string
  onClose: () => void
  onAdd: (amount: string) => void
}) {
  const [amount, setAmount] = useState('')
  const value = Number(amount || '0')
  const ceiling = Number(max)
  const over = value > ceiling
  const ok = value > 0 && !over

  const close = () => { setAmount(''); onClose() }

  return (
    <Sheet open title="Add money" onClose={close}>
      <div
        className={`amount-screen__big${amount === '' ? ' amount-screen__big--empty' : over ? ' amount-screen__big--over' : ''}`}
        style={{ justifyContent: 'center', margin: '4px 0 8px' }}
        role="status"
        aria-live="polite"
        aria-label={`${amount || '0'} ${symbol}`}
      >
        <span className="amount-screen__unit">{symbol}</span>
        <span className="amount-screen__value" style={{ fontSize: figureSize(amount || '0') }}>
          {amount === '' ? '0' : amount}
        </span>
      </div>

      <p className="amount-screen__under">
        {over
          ? `Only ${floor2(max)} can be moved. The rest covers network fees.`
          : `${floor2(max)} ${symbol} ready · earns in Aave straight away`}
      </p>

      {ceiling > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
          <button className="maxchip tap" onClick={() => setAmount(floor2(max))}>Use the lot</button>
        </div>
      )}

      <div className="mt3">
        <Keypad value={amount} onChange={setAmount} />
      </div>

      <button className="btn tap mt4" disabled={!ok} onClick={() => onAdd(amount)}>
        {value <= 0 ? 'Enter an amount' : over ? 'Too much' : `Add ${two(amount)}`}
      </button>
    </Sheet>
  )
}
