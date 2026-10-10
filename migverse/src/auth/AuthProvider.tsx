import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, Settings } from '../lib/types'

type Ctx = {
  session: Session | null
  profile: Profile | null
  settings: Settings | null
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}
const AuthCtx = createContext<Ctx | null>(null)

export function applySettings(s: Settings | null) {
  const root = document.documentElement
  const theme = s?.theme ?? 'dark'
  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
  root.dataset.theme = resolved
  root.dataset.motion = s?.reduce_motion ? 'reduced' : 'full'
  root.style.setProperty('--text-scale', String(s?.text_scale ?? 1))
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (uid: string | null) => {
    if (!uid) { setProfile(null); setSettings(null); applySettings(null); return }
    const [p, s] = await Promise.all([
      supabase.from('profiles').select('id,username,display_name,avatar_url,bio,status_message,presence').eq('id', uid).maybeSingle(),
      supabase.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
    ])
    if (p.error) console.error('profile load failed', p.error)
    if (s.error) console.error('settings load failed', s.error)
    setProfile((p.data as Profile) ?? null)
    setSettings((s.data as Settings) ?? null)
    applySettings((s.data as Settings) ?? null)
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await load(data.session?.user.id ?? null)
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setSession(sess)
      // Defer: calling supabase inside this callback can deadlock the auth lock.
      setTimeout(() => { void load(sess?.user.id ?? null) }, 0)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [load])

  const refresh = useCallback(async () => { await load(session?.user.id ?? null) }, [load, session])
  const signOut = useCallback(async () => { await supabase.auth.signOut() }, [])

  return <AuthCtx.Provider value={{ session, profile, settings, loading, refresh, signOut }}>{children}</AuthCtx.Provider>
}

export function useAuth() {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
