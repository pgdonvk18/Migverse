import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Wordmark } from '../components/Logo'
import { BRAND } from '../brand'

export default function Login() {
  const { session } = useAuth()
  const [mode, setMode] = useState<'login' | 'forgot'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null); setInfo(null)
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) setErr(error.message)
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/reset` })
      if (error) setErr(error.message)
      else setInfo('If that email has an account, a reset link is on its way.')
    }
    setBusy(false)
  }

  async function google() {
    setErr(null)
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin } })
    if (error) setErr(error.message)
  }

  return (
    <div className="pt-safe pb-safe mx-auto flex min-h-full w-full max-w-sm flex-col justify-center gap-6 p-6">
      <Wordmark />
      <div>
        <h1 className="text-2xl font-extrabold">{mode === 'login' ? 'Welcome back' : 'Reset your password'}</h1>
        <p className="mt-1 text-sm text-muted">{mode === 'login' ? BRAND.tagline : 'Enter your email and we will send a reset link.'}</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {mode === 'login' && (
          <div>
            <label className="label" htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        {err && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger">{err}</p>}
        {info && <p role="status" className="rounded-xl bg-ok/15 px-3 py-2 text-sm text-ok">{info}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Send reset link'}</button>
      </form>
      {mode === 'login' && (
        <>
          <button className="btn btn-ghost" onClick={google}>Continue with Google</button>
          <button className="text-sm text-muted underline" onClick={() => { setMode('forgot'); setErr(null) }}>Forgot password?</button>
        </>
      )}
      {mode === 'forgot' && <button className="text-sm text-muted underline" onClick={() => { setMode('login'); setErr(null); setInfo(null) }}>Back to log in</button>}
      <p className="text-center text-sm text-muted">New here? <Link to="/register" className="font-semibold text-brand">Create an account</Link></p>
    </div>
  )
}
