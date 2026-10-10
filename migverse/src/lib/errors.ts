// Maps database exception keywords (raised in the SQL guards/RPCs) to user-facing text.
const MAP: Record<string, string> = {
  slow_mode: 'Slow mode is on. Wait a few seconds before sending again.',
  rate_limited: 'You are going too fast. Try again in a moment.',
  muted: 'You are muted in this room.',
  banned: 'You are banned from this room.',
  not_a_member: 'Join this room before sending messages.',
  room_closed: 'This room is closed.',
  room_full: 'This room is full.',
  wrong_password: 'That room password is incorrect.',
  invite_required: 'This room is invite-only.',
  suspended: 'Your account is suspended.',
  room_limit: 'You can own up to 3 open rooms.',
  password_required: 'Password rooms need a password of at least 4 characters.',
  unauthenticated: 'Sign in to continue.',
  owner_cannot_leave: 'Owners cannot leave. Transfer or close the room first.',
}

export function friendlyError(e: unknown): string {
  const err = e as { message?: string; code?: string } | null
  const msg = err?.message ?? ''
  for (const k of Object.keys(MAP)) if (msg.includes(k)) return MAP[k]
  if (err?.code === '23505') return 'That value is already taken.'
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No connection. Check your network and try again.'
  return msg || 'Something went wrong. Try again.'
}
