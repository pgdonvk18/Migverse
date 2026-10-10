import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Hash } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { friendlyError } from '../lib/errors'

type MyRoom = { id: string; name: string; category: string }

export default function Home() {
  const { profile, session } = useAuth()
  const [rooms, setRooms] = useState<MyRoom[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    supabase.from('room_members')
      .select('joined_at, room:chat_rooms(id,name,category)')
      .eq('user_id', session.user.id)
      .order('last_active_at', { ascending: false, nullsFirst: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) { setErr(friendlyError(error)); setRooms([]); return }
        const list = (data ?? []).map((r) => (r as unknown as { room: MyRoom | null }).room).filter((r): r is MyRoom => !!r)
        setRooms(list)
      })
  }, [session])

  return (
    <div className="pt-safe mx-auto max-w-2xl p-5">
      <h1 className="text-2xl font-extrabold">Hi, {profile?.display_name ?? 'there'}</h1>
      <p className="mt-1 text-sm text-muted">Pick up where you left off.</p>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted">Your rooms</h2>
      {err && <p role="alert" className="mb-3 rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{err}</p>}
      {rooms === null && <div className="h-16 animate-pulse rounded-2xl bg-surface" />}
      {rooms?.length === 0 && !err && (
        <div className="card flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted">You have not joined any rooms yet.</p>
          <Link to="/rooms" className="btn btn-primary">Browse rooms</Link>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {rooms?.map((r) => (
          <li key={r.id}>
            <Link to={`/rooms/${r.id}`} className="card flex items-center gap-3 p-4 hover:border-brand">
              <Hash className="text-brand" size={20} />
              <div className="min-w-0"><p className="truncate font-semibold">{r.name}</p><p className="text-xs capitalize text-muted">{r.category}</p></div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
