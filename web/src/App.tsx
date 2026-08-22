import { useEffect, useState } from 'react'
import { api, type Whoami } from './api'
import Join from './screens/Join'
import Onboarding from './screens/Onboarding'
import Member from './screens/Member'
import Parent from './screens/Parent'

export default function App() {
  const [who, setWho] = useState<Whoami | null>(null)
  const joinToken = location.pathname.startsWith('/join/') ? location.pathname.split('/')[2] : null

  useEffect(() => {
    api.get<Whoami>('/api/whoami').then(setWho).catch(() => setWho({ role: null }))
  }, [])

  const refresh = () => api.get<Whoami>('/api/whoami').then(setWho)

  if (joinToken) {
    return <Join token={joinToken} onJoined={() => { history.replaceState(null, '', '/'); refresh() }} />
  }
  if (!who) {
    return (
      <div className="app" aria-busy="true">
        <span className="sr-only">Loading</span>
      </div>
    )
  }
  if (who.role === 'parent') return <Parent onLogout={refresh} />
  if (who.role === 'member') return <Member onLogout={refresh} />
  return <Onboarding onReady={refresh} />
}

export function TopBar({ who, onLogout }: { who: string; onLogout: () => void }) {
  const logout = async () => {
    await api.post('/api/logout')
    onLogout()
  }
  return (
    <header className="topbar">
      <span className="brand">kin<i>.</i></span>
      {who && (
        <span className="meta">
          {who} · <button className="link" style={{ minHeight: 'auto', padding: 0, fontSize: '0.85rem' }} onClick={logout}>lock</button>
        </span>
      )}
    </header>
  )
}
