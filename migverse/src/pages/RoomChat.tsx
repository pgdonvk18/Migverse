import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, LogOut, RotateCw, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import Avatar from '../components/Avatar'
import { friendlyError } from '../lib/errors'
import type { Msg, Profile, Room } from '../lib/types'

const PAGE = 50
const SELECT = '*, sender:profiles!sender_id(id,display_name,avatar_url)'
type Sender = NonNullable<Msg['sender']>

// Merge by client_id so optimistic rows, realtime events, and refetches never duplicate.
function merge(prev: Msg[], incoming: Msg[]): Msg[] {
  const map = new Map<string, Msg>()
  for (const m of prev) map.set(m.client_id, m)
  for (const m of incoming) map.set(m.client_id, { ...m, status: undefined })
  return [...map.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

export default function RoomChat() {
  const { id: roomId } = useParams<{ id: string }>()
  const { session, profile, settings } = useAuth()
  const nav = useNavigate()
  const me = session!.user.id

  const [room, setRoom] = useState<Room | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [online, setOnline] = useState(0)
  const [conn, setConn] = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [typers, setTypers] = useState<Record<string, number>>({})

  const senders = useRef(new Map<string, Sender>())
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const lastTyping = useRef(0)
  const wasDown = useRef(false)

  const remember = (list: Msg[]) => list.forEach((m) => { if (m.sender) senders.current.set(m.sender_id, m.sender) })

  const loadLatest = useCallback(async () => {
    const { data, error } = await supabase.from('room_messages').select(SELECT)
      .eq('room_id', roomId!).is('deleted_at', null).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE)
    if (error) { setErr(friendlyError(error)); return }
    const list = (data as unknown as Msg[]).reverse()
    remember(list)
    setMsgs((p) => merge(p, list))
    setHasMore((data?.length ?? 0) === PAGE)
  }, [roomId])

  // Room + membership gate (RLS also enforces this server-side).
  useEffect(() => {
    let active = true
    ;(async () => {
      const [r, m] = await Promise.all([
        supabase.from('chat_rooms').select('id,slug,name,description,category,visibility,capacity,slow_mode_seconds,announcement').eq('id', roomId!).maybeSingle(),
        supabase.from('room_members').select('role').eq('room_id', roomId!).eq('user_id', me).maybeSingle(),
      ])
      if (!active) return
      if (!r.data || !m.data) { nav('/rooms', { replace: true }); return }
      setRoom(r.data as Room)
      await loadLatest()
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [roomId, me, nav, loadLatest])

  // Realtime: messages, deletions, presence, typing. Cleaned up when leaving the screen.
  useEffect(() => {
    if (!room) return
    const ch = supabase.channel(`room:${room.id}`, { config: { presence: { key: me }, broadcast: { self: false } } })
    chRef.current = ch

    const onInsert = async (row: Msg) => {
      let sender = senders.current.get(row.sender_id)
      if (!sender) {
        const { data } = await supabase.from('profiles').select('id,display_name,avatar_url').eq('id', row.sender_id).maybeSingle()
        if (data) { sender = data as Sender; senders.current.set(row.sender_id, sender) }
      }
      if (row.deleted_at) return
      setMsgs((p) => merge(p, [{ ...row, sender }]))
    }

    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${room.id}` },
        (p) => { void onInsert(p.new as Msg) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'room_messages', filter: `room_id=eq.${room.id}` },
        (p) => { const row = p.new as Msg; if (row.deleted_at) setMsgs((prev) => prev.filter((m) => m.id !== row.id)) })
      .on('presence', { event: 'sync' }, () => setOnline(Object.keys(ch.presenceState()).length))
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const p = payload as { id: string; name: string }
        setTypers((t) => ({ ...t, [p.name]: Date.now() }))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({ at: Date.now() })
          if (wasDown.current) { wasDown.current = false; void loadLatest() } // catch up on anything missed
          setConn('live')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          wasDown.current = true; setConn('reconnecting')
        }
      })

    const onVisible = () => { if (document.visibilityState === 'visible') void loadLatest() }
    document.addEventListener('visibilitychange', onVisible)
    const tick = setInterval(() => setTypers((t) => {
      const now = Date.now(); const n = Object.fromEntries(Object.entries(t).filter(([, v]) => now - v < 3500))
      return Object.keys(n).length === Object.keys(t).length ? t : n
    }), 1000)

    return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(tick); void supabase.removeChannel(ch); chRef.current = null }
  }, [room, me, loadLatest])

  // Keep pinned to bottom only if the user is already near it.
  useEffect(() => { const el = listRef.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [msgs])

  async function loadEarlier() {
    const oldest = msgs.find((m) => !m.status)
    if (!oldest) return
    const { data, error } = await supabase.from('room_messages').select(SELECT)
      .eq('room_id', roomId!).is('deleted_at', null).lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false }).limit(PAGE)
    if (error) { setErr(friendlyError(error)); return }
    const list = (data as unknown as Msg[]).reverse()
    remember(list); stick.current = false
    setMsgs((p) => merge(p, list)); setHasMore((data?.length ?? 0) === PAGE)
  }

  async function send(body: string, clientId: string = crypto.randomUUID()) {
    const trimmed = body.trim()
    if (!trimmed || !room) return
    setErr(null); stick.current = true
    const optimistic: Msg = {
      id: clientId, room_id: room.id, sender_id: me, body: trimmed, client_id: clientId,
      created_at: new Date().toISOString(), deleted_at: null, status: 'sending',
      sender: { id: me, display_name: profile?.display_name ?? 'You', avatar_url: profile?.avatar_url ?? null },
    }
    setMsgs((p) => { const rest = p.filter((m) => m.client_id !== clientId); return [...rest, optimistic].sort((a, b) => a.created_at.localeCompare(b.created_at)) })
    const { error } = await supabase.from('room_messages').insert({ room_id: room.id, sender_id: me, body: trimmed, client_id: clientId })
    if (error && error.code !== '23505') { // 23505 = already stored by an earlier attempt: success
      setMsgs((p) => p.map((m) => (m.client_id === clientId ? { ...m, status: 'failed' } : m)))
      setErr(friendlyError(error))
    } else if (error) { void loadLatest() }
  }

  function submit() { const t = text; if (!t.trim()) return; setText(''); void send(t) }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }

  function onType(v: string) {
    setText(v)
    if (settings?.show_typing === false || !chRef.current) return
    const now = Date.now()
    if (now - lastTyping.current > 2000) {
      lastTyping.current = now
      void chRef.current.send({ type: 'broadcast', event: 'typing', payload: { id: me, name: profile?.display_name ?? 'Someone' } })
    }
  }

  async function leave() {
    const { error } = await supabase.rpc('leave_room', { p_room: roomId! })
    if (error) setErr(friendlyError(error)); else nav('/rooms', { replace: true })
  }

  const typing = Object.keys(typers)
  if (loading || !room) return <div className="p-5"><div className="h-12 animate-pulse rounded-2xl bg-surface" /></div>

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <button className="rounded-full p-2 text-muted hover:text-ink" onClick={() => nav('/rooms')} aria-label="Back to rooms"><ChevronLeft size={22} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold">{room.name}</h1>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`inline-block h-2 w-2 rounded-full ${conn === 'live' ? 'bg-ok' : 'bg-gold'}`} />
            {conn === 'live' ? `${online} online` : conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            {room.slow_mode_seconds > 0 && <span> · Slow mode {room.slow_mode_seconds}s</span>}
          </p>
        </div>
        <button className="rounded-full p-2 text-muted hover:text-danger" onClick={() => void leave()} aria-label="Leave room"><LogOut size={20} /></button>
      </header>

      {room.announcement && <p className="border-b border-line bg-brand/10 px-4 py-2 text-sm">{room.announcement}</p>}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }}>
        {hasMore && <button className="btn btn-ghost mx-auto mb-3 flex !min-h-[36px] !py-1.5 text-xs" onClick={() => void loadEarlier()}>Load earlier messages</button>}
        {msgs.length === 0 && <p className="mt-10 text-center text-sm text-muted">No messages yet. Say hello.</p>}
        <ul className="flex flex-col gap-2">
          {msgs.map((m, i) => {
            const mine = m.sender_id === me
            const showName = !mine && msgs[i - 1]?.sender_id !== m.sender_id
            return (
              <li key={m.client_id} className={`flex items-end gap-2 ${mine ? 'justify-end' : ''}`}>
                {!mine && (showName ? <Avatar id={m.sender_id} name={m.sender?.display_name ?? '?'} url={m.sender?.avatar_url} size={32} /> : <span className="w-8 shrink-0" />)}
                <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 ${mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-surface2'} ${m.status === 'sending' ? 'opacity-60' : ''}`}>
                  {showName && <p className="mb-0.5 text-xs font-semibold text-brand">{m.sender?.display_name ?? 'Member'}</p>}
                  <p className="whitespace-pre-wrap break-words text-sm">{m.body}</p>
                  <p className={`mt-0.5 text-right text-[10px] ${mine ? 'text-white/70' : 'text-muted'}`}>
                    {m.status === 'failed'
                      ? <button className="inline-flex items-center gap-1 font-semibold text-gold" onClick={() => void send(m.body, m.client_id)}><RotateCw size={10} /> Failed — retry</button>
                      : m.status === 'sending' ? 'Sending…' : new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="pb-safe border-t border-line bg-surface px-3 pt-2">
        <p className="h-5 px-1 text-xs text-muted" aria-live="polite">{typing.length ? `${typing.slice(0, 2).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…` : ''}</p>
        {err && <p role="alert" className="mb-2 rounded-xl bg-danger/15 px-3 py-2 text-xs text-danger">{err}</p>}
        <div className="flex items-end gap-2 pb-2">
          <textarea className="input max-h-32 resize-none" rows={1} maxLength={2000} placeholder="Message the room" aria-label="Message"
            value={text} onChange={(e) => onType(e.target.value)} onKeyDown={onKey} />
          <button className="btn btn-primary !px-3.5" onClick={submit} disabled={!text.trim()} aria-label="Send message"><Send size={18} /></button>
        </div>
      </div>
    </div>
  )
}

export type { Profile }
