import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Wordmark } from '../components/Logo'
import { MIN_AGE } from '../brand'

export default function Register() {
  const { session } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [age, setAge] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    if (password.length < 8) { setErr('Use a password with at least 8 characters.'); return }
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: location.origin },
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    if (!data.session) setSent(true) // email confirmation required
  }

  if (sent) {
    return (
      <div className="mx-auto flex min-h-full max-w-sm flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="rounded-2xl bg-ok/15 p-4 text-ok"><MailCheck size={32} /></div>
        <h1 className="text-xl font-bold">Check your email</h1>
        <p className="text-sm text-muted">We sent a confirmation link to {email}. Open it, then log in.</p>
        <Link to="/login" className="btn btn-primary mt-2">Go to log in</Link>
      </div>
    )
  }

  return (
    <div className="pt-safe pb-safe mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-6 p-6">
      <Wordmark />
      <h1 className="text-2xl font-extrabold">Create your account</h1>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="dn">Display name</label>
          <input id="dn" className="input" required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="em">Email</label>
          <input id="em" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <label className="flex items-start gap-3 text-sm text-muted">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={age} onChange={(e) => setAge(e.target.checked)} required />
          I am at least {MIN_AGE} years old.
        </label>
        {err && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{err}</p>}
        <button className="btn btn-primary" disabled={busy || !age}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="text-center text-sm text-muted">Already have an account? <Link to="/login" className="font-semibold text-brand">Log in</Link></p>
    </div>
  )
}
