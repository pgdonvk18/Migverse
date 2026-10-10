import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Wordmark } from '../components/Logo'

export default function ResetPassword() {
  const { session, loading } = useAuth()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) { setErr('Use a password with at least 8 characters.'); return }
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setErr(error.message)
    else nav('/', { replace: true })
  }

  if (loading) return null
  if (!session) {
    return (
      <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted">This reset link is invalid or has expired. Request a new one from the log in page.</p>
        <a href="/login" className="btn btn-primary">Go to log in</a>
      </div>
    )
  }
  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <Wordmark />
      <h1 className="text-2xl font-extrabold">Choose a new password</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="npw">New password</label>
          <input id="npw" className="input" type="password" autoComplete="new-password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        {err && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{err}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </div>
  )
}
