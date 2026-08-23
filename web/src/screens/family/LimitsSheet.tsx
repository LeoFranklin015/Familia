import { useState } from 'react'
import { Sheet } from '../../components/Sheet'
import { two } from '../../lib/money'
import type { ParentState } from '../../api'

type Member = ParentState['members'][number]

/* ── limits ──────────────────────────────────────────────────────────────── */

export function LimitsSheet({
  open, member, symbol, onBack, onSave,
}: {
  open: boolean
  member: Member
  symbol: string
  onBack: () => void
  onSave: (perTx: string, period: string) => void
}) {
  const [perTx, setPerTx] = useState(() => two(member.caps?.perTx ?? '5'))
  const [period, setPeriod] = useState(() => two(member.caps?.period ?? '25'))

  // Plain money, at most two decimals. Anything else reaches parseUnits on the
  // server and comes back as an untranslated 500.
  const clean = (v: string) => /^\d{1,7}(\.\d{1,2})?$/.test(v.trim())
  const wellFormed = clean(perTx) && clean(period)
  const ok = wellFormed && Number(perTx) > 0 && Number(period) >= Number(perTx)

  return (
    <Sheet open={open} title={`${member.name}'s limits`} onClose={onBack} back>
      <label className="field">
        <span>Most per purchase</span>
        <input
          className="input num" inputMode="decimal" value={perTx}
          onChange={(e) => setPerTx(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Most per week</span>
        <input
          className="input num" inputMode="decimal" value={period}
          onChange={(e) => setPeriod(e.target.value)}
        />
      </label>

      <p className="hint mt3">
        The contract holds these, not the app. Anything over them turns into a
        request for you. It doesn&rsquo;t fail.
      </p>
      {!wellFormed && (perTx.trim() || period.trim()) && (
        <p className="warn mt2">Amounts only, up to two decimal places.</p>
      )}
      {wellFormed && !ok && Number(perTx) > 0 && (
        <p className="warn mt2">A week has to allow at least one purchase.</p>
      )}

      <button className="btn tap mt4" disabled={!ok} onClick={() => onSave(perTx, period)}>
        Save limits
      </button>
      <p className="note mt2" style={{ textAlign: 'center' }}>{symbol}, per person</p>
    </Sheet>
  )
}
