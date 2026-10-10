import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Hash, Lock, Plus, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import Sheet from '../components/Sheet'
import { friendlyError } from '../lib/errors'
import { CATEGORIES } from '../brand'
import type { Room } from '../lib/types'

const slugify = (s: string) => {
  const base = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
  return `${base.length >= 3 ? base : 'room'}-${Math.random().toString(36).slice(2, 6)}`
}

export default function Rooms() {
  const { session } = useAuth()
  const nav = useNavigate()
  const [rooms, setRooms] = useState<Room[] | null>(null)
  const [mine, setMine] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('all')
  const [err, setErr] = useState<string | null>(null)
  const [pwRoom, setPwRoom] = useState<Room | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    let query = supabase.from('chat_rooms')
      .select('id,slug,name,description,category,visibility,capacity,slow_mode_seconds,announcement')
      .eq('is_closed', false).in('visibility', ['public', 'password'])
      .order('created_at', { ascending: false }).limit(50)
    if (cat !== 'all') query = query.eq('category', cat)
    const term = q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)
    if (term) query = query.ilike('name', `%${term}%`)
    const { data, error } = await query
    if (error) { setErr(friendlyError(error)); setRooms([]); return }
    setErr(null); setRooms(data as Room[])
  }, [q, cat])

  useEffect(() => { const t = setTimeout(() => void load(), 300); return () => clearTimeout(t) }, [load])

  useEffect(() => {
    if (!session) return
    supabase.from('room_members').select('room_id').eq('user_id', session.user.id)
      .then(({ data }) => setMine(new Set((data ?? []).map((r) => r.room_id as string))))
  }, [session])

  async function join(room: Room, password?: string) {
    if (mine.has(room.id)) { nav(`/rooms/${room.id}`); return }
    if (room.visibility === 'password' && password === undefined) { setPwRoom(room); return }
    const { error } = await supabase.rpc('join_room', { p_room: room.id, p_password: password ?? null })
    if (error) { setErr(friendlyError(error)); return }
    nav(`/rooms/${room.id}`)
  }

  return (
    <div className="pt-safe mx-auto max-w-2xl p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Rooms</h1>
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={18} /> New room</button>
      </div>

      <div className="relative mt-4">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input pl-10" placeholder="Search rooms" aria-label="Search rooms" value={q} onChange={(e) => setQ(e.target.value)} maxLength={50} />
      </div>

      <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
        {['all', ...CATEGORIES].map((c) => (
          <button key={c} onClick={() => setCat(c)} aria-pressed={cat === c}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold capitalize ${cat === c ? 'bg-brand text-white' : 'bg-surface text-muted'}`}>{c}</button>
        ))}
      </div>

      {err && <p role="alert" className="mt-4 rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{err}</p>}
      {rooms === null && <div className="mt-4 flex flex-col gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-surface" />)}</div>}
      {rooms?.length === 0 && !err && (
        <div className="card mt-4 p-8 text-center text-sm text-muted">{q || cat !== 'all' ? 'No rooms match. Try another search or category.' : 'No rooms yet. Create the first one.'}</div>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {rooms?.map((r) => (
          <li key={r.id}>
            <button onClick={() => void join(r)} className="card flex w-full items-center gap-3 p-4 text-left hover:border-brand">
              <div className="rounded-xl bg-brand/15 p-2.5 text-brand">{r.visibility === 'password' ? <Lock size={20} /> : <Hash size={20} />}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="truncate text-xs text-muted"><span className="capitalize">{r.category}</span>{r.description ? ` — ${r.description}` : ''}</p>
              </div>
              <span className={`text-xs font-semibold ${mine.has(r.id) ? 'text-ok' : 'text-brand'}`}>{mine.has(r.id) ? 'Open' : 'Join'}</span>
            </button>
          </li>
        ))}
      </ul>

      {pwRoom && <PasswordSheet room={pwRoom} onClose={() => setPwRoom(null)} onSubmit={async (pw) => {
        const { error } = await supabase.rpc('join_room', { p_room: pwRoom.id, p_password: pw })
        if (error) return friendlyError(error)
        nav(`/rooms/${pwRoom.id}`); return null
      }} />}
      {creating && <CreateSheet onClose={() => setCreating(false)} onCreated={(id) => nav(`/rooms/${id}`)} />}
    </div>
  )
}

function PasswordSheet({ room, onClose, onSubmit }: { room: Room; onClose: () => void; onSubmit: (pw: string) => Promise<string | null> }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function go(e: FormEvent) { e.preventDefault(); setBusy(true); setErr(await onSubmit(pw)); setBusy(false) }
  return (
    <Sheet title={`Join ${room.name}`} onClose={onClose}>
      <form onSubmit={go} className="flex flex-col gap-4">
        <div><label className="label" htmlFor="rp">Room password</label>
          <input id="rp" className="input" type="password" required autoFocus value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        {err && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{err}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Joining…' : 'Join room'}</button>
      </form>
    </Sheet>
  )
}

function CreateSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ name: '', description: '', category: 'friendship', visibility: 'public', password: '' })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function go(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    const { data, error } = await supabase.rpc('create_room', {
      p_name: f.name.trim(), p_slug: slugify(f.name), p_description: f.description.trim() || null,
      p_category: f.category, p_visibility: f.visibility, p_password: f.visibility === 'password' ? f.password : null, p_capacity: 200,
    })
    setBusy(false)
    if (error) setErr(friendlyError(error)); else onCreated(data as string)
  }
  return (
    <Sheet title="Create a room" onClose={onClose}>
      <form onSubmit={go} className="flex flex-col gap-4">
        <div><label className="label" htmlFor="cn">Room name</label>
          <input id="cn" className="input" required minLength={3} maxLength={50} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="cd">Description</label>
          <textarea id="cd" className="input" rows={2} maxLength={500} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div><label className="label" htmlFor="cc">Category</label>
          <select id="cc" className="input capitalize" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className="label" htmlFor="cv">Access</label>
          <select id="cv" className="input" value={f.visibility} onChange={(e) => setF({ ...f, visibility: e.target.value })}>
            <option value="public">Public — anyone can join</option><option value="password">Password — members need the password</option></select>
          <p className="mt-1.5 text-xs text-muted">Private and invite-only rooms arrive with the invite system.</p></div>
        {f.visibility === 'password' && (
          <div><label className="label" htmlFor="cp">Password</label>
            <input id="cp" className="input" type="password" minLength={4} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
        )}
        {err && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{err}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create room'}</button>
      </form>
    </Sheet>
  )
}
