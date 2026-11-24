import { AuthProvider } from './auth/AuthContext'
import { Router, match, useLocation } from './router'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import AppShell from './pages/AppShell'
import Dashboard from './pages/Dashboard'
import Workspace from './pages/Workspace'
import ProjectPage from './pages/ProjectPage'
import UploadWizard from './pages/UploadWizard'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'
import VrHomes from './pages/VrHomes'
import VrViewer from './pages/VrViewer'

function Routes() {
  const { path } = useLocation()
  if (path === '/') return <Landing />
  if (path === '/login') return <Auth mode="login" />
  if (path === '/signup') return <Auth mode="signup" />
  if (path === '/app') return <AppShell><Dashboard /></AppShell>
  if (path === '/app/create') return <AppShell><Workspace /></AppShell>
  if (path === '/app/upload') return <AppShell><UploadWizard /></AppShell>
  if (path === '/app/settings') return <AppShell><Settings /></AppShell>
  if (path === '/app/vr') return <AppShell><VrHomes /></AppShell>
  const vr = match('/app/vr/:id', path)
  if (vr) return <AppShell><VrViewer key={vr.id} id={vr.id} /></AppShell>
  const proj = match('/app/project/:id', path)
  if (proj) return <AppShell><ProjectPage key={proj.id} id={proj.id} /></AppShell>
  return <NotFound />
}

export default function App() {
  return (
    <AuthProvider>
      <Router><Routes /></Router>
    </AuthProvider>
  )
}
