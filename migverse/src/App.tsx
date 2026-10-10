import { Navigate, Route, Routes } from 'react-router-dom'
import { MessageCircle, Trophy } from 'lucide-react'
import { useAuth } from './auth/AuthProvider'
import { configError } from './lib/supabase'
import Layout from './components/Layout'
import ComingSoon from './components/ComingSoon'
import Login from './pages/Login'
import Register from './pages/Register'
import ResetPassword from './pages/ResetPassword'
import Home from './pages/Home'
import Rooms from './pages/Rooms'
import RoomChat from './pages/RoomChat'
import ProfilePage from './pages/Profile'

function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="flex h-full items-center justify-center text-sm text-muted">Loading…</div>
  return session ? children : <Navigate to="/login" replace />
}

export default function App() {
  if (configError) {
    return <div className="mx-auto flex h-full max-w-md items-center p-6"><p role="alert" className="rounded-2xl bg-danger/15 p-4 text-sm text-danger">{configError}</p></div>
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/reset" element={<ResetPassword />} />
      {/* Full-screen chat (no bottom nav) */}
      <Route path="/rooms/:id" element={<RequireAuth><div className="h-full"><RoomChat /></div></RequireAuth>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="/rooms" element={<Rooms />} />
        <Route path="/messages" element={<ComingSoon icon={MessageCircle} title="Private messages" body="Direct messages and friends are next. The database and security rules for them are already in the migration." />} />
        <Route path="/events" element={<ComingSoon icon={Trophy} title="Events and games" body="Battles, quizzes, and events arrive after the wallet and rewards system." />} />
        <Route path="/profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
