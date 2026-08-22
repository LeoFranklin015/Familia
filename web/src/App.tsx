import { useEffect, useState } from 'react'
import { api, type Whoami } from './api'
import Join from './screens/Join'
import Landing from './screens/Landing'
import Member from './screens/Member'
import Parent from './screens/Parent'

export default function App() {
  const [who, setWho] = useState<Whoami | null>(null)
  const joinToken = location.pathname.startsWith('/join/') ? location.pathname.split('/')[2] : null

  useEffect(() => {
    api.get<Whoami>('/api/whoami').then(setWho).catch(() => setWho({ role: null }))
  }, [])

  const refresh = () => api.get<Whoami>('/api/whoami').then(setWho)

  if (joinToken) return <Join token={joinToken} onJoined={() => { history.replaceState(null, '', '/'); refresh() }} />
  if (!who) return <div className="center" style={{ paddingTop: 80 }}><span className="spinner" /></div>
  if (who.role === 'parent') return <Parent onLogout={refresh} />
  if (who.role === 'member') return <Member onLogout={refresh} />
  return <Landing onUnlocked={refresh} />
}

export function TopBar({ who, onLogout }: { who: string; onLogout: () => void }) {
  const logout = async () => {
    await api.post('/api/logout')
    onLogout()
  }
  return (
    <div className="topbar">
      <span className="brand">kin<span className="dot">.</span></span>
      <span className="who">{who} · <button onClick={logout}>lock</button></span>
    </div>
  )
}
