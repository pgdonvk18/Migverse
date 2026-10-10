import { NavLink, Outlet } from 'react-router-dom'
import { Hash, House, MessageCircle, Trophy, User } from 'lucide-react'
import { Wordmark } from './Logo'

const NAV = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/rooms', label: 'Rooms', icon: Hash },
  { to: '/messages', label: 'Messages', icon: MessageCircle },
  { to: '/events', label: 'Events', icon: Trophy },
  { to: '/profile', label: 'Profile', icon: User },
]

export default function Layout() {
  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface p-5 md:flex">
        <Wordmark />
        <nav className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold ${isActive ? 'bg-brand/15 text-brand' : 'text-muted hover:text-ink'}`}>
              <Icon size={20} /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto"><Outlet /></main>

      {/* Mobile bottom nav */}
      <nav className="pb-safe grid shrink-0 grid-cols-5 border-t border-line bg-surface md:hidden" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${isActive ? 'text-brand' : 'text-muted'}`}>
            <Icon size={22} /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
