import type { ParentState } from '../../api'
import { AccountButton } from '../../components/Account'
import { InfoButton, LiveFigure } from '../../components/ui'
import { two } from '../../lib/money'
import { shortAddress } from '../../lib/address'
import { Activity } from '../Activity'
import type { Note } from '../Parent'

/**
 * Aave's rate, said the way a rate is said.
 *
 * Compounded per second, because that is what a supplier actually receives —
 * though at testnet rates the difference from the simple figure is invisible.
 */
function apyText(apr: number): string {
  if (apr <= 0) return 'nothing yet'
  const apy = (1 + apr / 31_536_000) ** 31_536_000 - 1
  return `${(apy * 100).toFixed(apy < 0.001 ? 4 : 2)}% a year`
}
/* ── Home ────────────────────────────────────────────────────────────────── */

export function Home({
  st, onInfo, onFees, onSeeAll, onCopied, onAdd,
}: {
  st: ParentState
  onInfo: (n: Note) => void
  onFees: () => void
  onSeeAll: () => void
  onCopied: (m: string) => void
  onAdd: () => void
}) {


  const copy = async () => {
    try {
      await navigator.clipboard.writeText(st.wallet.address)
      onCopied('Address copied')
    } catch { onCopied("Couldn't copy") }
  }

  return (
    <div className="page">
      <div className="sec">
        <div className="kicker">{st.familyName} household</div>
        <AccountButton initial={st.you?.name?.[0] ?? 'K'} onOpen={onFees} />
      </div>

      <div className="balance">
        <div className="sec" style={{ padding: 0 }}>
          <div className="kicker">Balance</div>
          <InfoButton label="Where the money sits" onClick={() => onInfo('balance')} />
        </div>
        <div style={{ marginTop: 12 }}>
          <LiveFigure
            balance={st.wallet.pot}
            apr={st.wallet.apr ?? 0}
            readAt={st.wallet.potAt ?? Date.now()}
          />
        </div>
        <div className="note mt3">
          {(st.wallet.apr ?? 0) > 0 && <span className="livedot" aria-hidden="true" />}
          {st.symbol} · earning {apyText(st.wallet.apr ?? 0)} in Aave
        </div>
        <button className="chip tap mt4" onClick={copy} aria-label="Copy your account address">
          <span className="chip__addr">{shortAddress(st.wallet.address)}</span>
          <span className="chip__do">copy</span>
        </button>
      </div>

      <div className="pair mt2">
        <div className="tile">
          <div className="tile__label">Promised out</div>
          <div className="tile__figure">{two(st.promised)}</div>
          <div className="tile__note">in weekly limits</div>
        </div>
        <div className="tile tile--pale">
          <div className="tile__label">Ready to add</div>
          <div className="tile__figure">{two(st.wallet.addable)}</div>
          {Number(st.wallet.addable) > 0 ? (
            <button
              className="btn btn--sm tap mt3"
              style={{ background: 'var(--ink)', color: 'var(--pale)', minHeight: 44, fontSize: 13.5 }}
              onClick={onAdd}
            >
              Add money
            </button>
          ) : (
            <div className="tile__note">The faucet tops you up once a day</div>
          )}
        </div>
      </div>

      <div className="sec sec--top">
        <div className="kicker kicker--muted">Recent</div>
        {st.activity.length > 0 && (
          <button className="link tap" style={{ fontSize: 12.5 }} onClick={onSeeAll}>All of it</button>
        )}
      </div>

      {st.activity.length > 0
        ? <Activity items={st.activity.slice(0, 3)} />
        : (
          <p className="empty empty--bare">
            Money you add, limits you set and payments the family makes all show up here.
          </p>
        )}
    </div>
  )
}

