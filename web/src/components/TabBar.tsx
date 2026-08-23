import { Icon, type IconName } from './ui'

/**
 * The floating navigation pill.
 *
 * Only the current tab is labelled — the rest are recognised by shape — so the
 * labelled one takes its own width and the icon-only ones share what is left.
 * Equal quarters cannot work: "Activity" needs more room than a quarter of the
 * bar, so the longest label was always the one that clipped.
 */
export type Tab<Id extends string> = {
  id: Id
  label: string
  icon: IconName
  /** A count worth interrupting for. Zero and undefined both mean nothing. */
  badge?: number
}

export function TabBar<Id extends string>({
  tabs, value, onChange,
}: {
  tabs: ReadonlyArray<Tab<Id>>
  value: Id
  onChange: (id: Id) => void
}) {
  return (
    <nav className="tabbar" role="tablist" aria-label="Sections">
      {tabs.map(({ id, label, icon, badge }) => {
        const on = id === value
        return (
          <button
            key={id}
            role="tab"
            aria-selected={on}
            aria-label={badge ? `${label}, ${badge} waiting` : label}
            className={`tab tap${on ? ' tab--on' : ''}`}
            onClick={() => onChange(id)}
          >
            <Icon name={icon} size={19} />
            {on && <span>{label}</span>}
            {Boolean(badge) && <span className="tab__badge" aria-hidden="true">{badge}</span>}
          </button>
        )
      })}
    </nav>
  )
}
