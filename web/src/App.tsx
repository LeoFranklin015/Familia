import { useEffect, useState } from 'react'
import { api, whenSessionEnds, type Whoami } from './api'
import { Device } from './components/Device'
import { ScreenSkeleton } from './components/ui'
import Join from './screens/Join'
import Onboarding from './screens/Onboarding'
import Member from './screens/Member'
import Parent from './screens/Parent'

export default function App() {
  const [who, setWho] = useState<Whoami | null>(null)
  const joinToken = location.pathname.startsWith('/join/') ? location.pathname.split('/')[2] : null

  useEffect(() => {
    api.get<Whoami>('/api/whoami').then(setWho).catch(() => setWho({ role: null }))
    // A session can end under the app — it expires, or the server restarts.
    // Returning to sign-in is the honest response; reporting the action the
    // person was mid-way through as "refused" is not.
    whenSessionEnds(() => setWho({ role: null }))
  }, [])

  const refresh = () => api.get<Whoami>('/api/whoami').then(setWho).catch(() => setWho({ role: null }))

  return <Device>{inside()}</Device>

  function inside() {
    if (joinToken) {
      return <Join token={joinToken} onJoined={() => { history.replaceState(null, '', '/'); void refresh() }} />
    }
    if (!who) {
      return (
        <div className="screen">
          <div className="scroll"><ScreenSkeleton label="Loading" /></div>
        </div>
      )
    }
    if (who.role === 'parent') return <Parent onLogout={() => { void refresh() }} />
    if (who.role === 'member') return <Member onLogout={() => { void refresh() }} />
    return <Onboarding onReady={() => { void refresh() }} />
  }
}
