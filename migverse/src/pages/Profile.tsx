import { useEffect, useState, type FormEvent } from 'react'
import { LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { applySettings, useAuth } from '../auth/AuthProvider'
import Avatar from '../components/Avatar'
import { friendlyError } from '../lib/errors'
import type { Presence, Settings } from '../lib/types'

export default function ProfilePage() {
  const { profile, settings, session, refresh, signOut } = useAuth()
  const [form, setForm] = useState({ display_name: '', username: '', bio: '', status_message: '', presence: 'online' as Presence })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (profile) setForm({
      display_name: profile.display_name, username: profile.username, bio: profile.bio ?? '',
      status_message: profile.status_message ?? '', presence: profile.presence,
    })
  }, [profile])

  if (!profile || !session) return null

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(form.username)) { setMsg({ ok: false, text: 'Username: 3–20 letters, numbers, or underscores.' }); return }
    setBusy(true); setMsg(null)
    const { error } = await supabase.from('profiles').update({
      display_name: form.display_name.trim(), username: form.username,
      bio: form.bio.trim() || null, status_message: form.status_message.trim() || null, presence: form.presence,
    }).eq('id', session!.user.id)
    setBusy(false)
    if (error) setMsg({ ok: false, text: error.code === '23505' ? 'That username is taken.' : friendlyError(error) })
    else { setMsg({ ok: true, text: 'Profile saved.' }); await refresh() }
  }

  async function patchSettings(patch: Partial<Settings>) {
    const { error } = await supabase.from('user_settings').update(patch).eq('user_id', session!.user.id)
    if (error) { setMsg({ ok: false, text: friendlyError(error) }); return }
    applySettings({ ...(settings as Settings), ...patch })
    await refresh()
  }

  return (
    <div className="pt-safe mx-auto max-w-lg p-5">
      <div className="mb-6 flex items-center gap-4">
        <Avatar id={profile.id} name={profile.display_name} url={profile.avatar_url} size={64} />
        <div className="min-w-0"><p className="truncate text-xl font-extrabold">{profile.display_name}</p><p className="truncate text-sm text-muted">@{profile.username}</p></div>
      </div>

      <form onSubmit={save} className="flex flex-col gap-4">
        <div><label className="label" htmlFor="p-dn">Display name</label>
          <input id="p-dn" className="input" required maxLength={40} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
        <div><label className="label" htmlFor="p-un">Username</label>
          <input id="p-un" className="input" required maxLength={20} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        <div><label className="label" htmlFor="p-bio">Bio</label>
          <textarea id="p-bio" className="input" rows={3} maxLength={300} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></div>
        <div><label className="label" htmlFor="p-st">Status message</label>
          <input id="p-st" className="input" maxLength={80} value={form.status_message} onChange={(e) => setForm({ ...form, status_message: e.target.value })} /></div>
        <div><label className="label" htmlFor="p-pr">Presence</label>
          <select id="p-pr" className="input" value={form.presence} onChange={(e) => setForm({ ...form, presence: e.target.value as Presence })}>
            <option value="online">Online</option><option value="busy">Busy</option><option value="invisible">Invisible</option><option value="offline">Offline</option>
          </select></div>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`rounded-xl px-3 py-2 text-sm ${msg.ok ? 'bg-ok/15 text-ok' : 'bg-danger/15 text-danger'}`}>{msg.text}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>

      {settings && (
        <section className="mt-8 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-muted">Appearance and privacy</h2>
          <div><label className="label" htmlFor="s-th">Theme</label>
            <select id="s-th" className="input" value={settings.theme} onChange={(e) => patchSettings({ theme: e.target.value as Settings['theme'] })}>
              <option value="dark">Dark</option><option value="light">Light</option><option value="system">Match device</option>
            </select></div>
          <div><label className="label" htmlFor="s-ts">Text size</label>
            <select id="s-ts" className="input" value={String(settings.text_scale)} onChange={(e) => patchSettings({ text_scale: Number(e.target.value) })}>
              <option value="0.9">Small</option><option value="1">Default</option><option value="1.2">Large</option><option value="1.4">Extra large</option>
            </select></div>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Reduce motion</span>
            <input type="checkbox" className="h-5 w-5" checked={settings.reduce_motion} onChange={(e) => patchSettings({ reduce_motion: e.target.checked })} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><span>Show when I am typing in rooms</span>
            <input type="checkbox" className="h-5 w-5" checked={settings.show_typing} onChange={(e) => patchSettings({ show_typing: e.target.checked })} /></label>
          <div><label className="label" htmlFor="s-dm">Who can message me</label>
            <select id="s-dm" className="input" value={settings.who_can_dm} onChange={(e) => patchSettings({ who_can_dm: e.target.value as Settings['who_can_dm'] })}>
              <option value="everyone">Everyone</option><option value="friends">Friends only</option><option value="nobody">Nobody</option>
            </select></div>
        </section>
      )}

      <button className="btn btn-danger mt-8 w-full" onClick={() => void signOut()}><LogOut size={18} /> Log out</button>
    </div>
  )
}
