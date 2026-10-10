export type Presence = 'online' | 'offline' | 'busy' | 'invisible'

export type Profile = {
  id: string
  username: string
  display_name: string
  avatar_url: string | null
  bio: string | null
  status_message: string | null
  presence: Presence
}

export type Settings = {
  user_id: string
  theme: 'dark' | 'light' | 'system'
  reduce_motion: boolean
  text_scale: number
  show_typing: boolean
  who_can_dm: 'everyone' | 'friends' | 'nobody'
}

export type Visibility = 'public' | 'private' | 'password' | 'invite_only'

export type Room = {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  visibility: Visibility
  capacity: number
  slow_mode_seconds: number
  announcement: string | null
}

export type Msg = {
  id: string
  room_id: string
  sender_id: string
  body: string
  client_id: string
  created_at: string
  deleted_at: string | null
  sender?: Pick<Profile, 'id' | 'display_name' | 'avatar_url'> | null
  status?: 'sending' | 'failed'
}
