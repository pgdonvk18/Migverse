# MigVerse

Mobile-first social chat. React + TypeScript + Vite + Tailwind on Supabase.

## Setup
1. Create a Supabase project.
2. SQL editor: run `supabase/migrations/0001_foundation.sql` on a fresh project.
3. Auth settings: enable email confirmation; add your dev and production URLs to Redirect URLs (the app uses `/` and `/reset`). Google sign-in needs the Google provider configured in Supabase.
4. `cp .env.example .env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (anon key only, never service_role).
5. `npm install && npm run dev`, then `npm run typecheck`.

## Built so far
Auth (signup, login, reset, Google), profiles and settings, room directory with search/categories, create/join (public and password), live room chat (realtime, presence, typing, optimistic send with retry, idempotent writes, reconnect catch-up, pagination).

## Not built yet
DMs and friends UI, room moderation UI, notifications UI, avatar upload, wallet/gifts, admin dashboard, PWA manifest, voice, AI.

## Test with two users
Register two accounts (two browsers), join the same room, exchange messages, kill the network on one and send (shows Failed, retry works), and confirm a non-member cannot read a room's messages (try a SQL query as that user).

## Known limits
Message list is paginated (50 + load earlier) but not virtualized. Realtime is Supabase Realtime: presence and broadcast scale per channel, so very large rooms need load testing.
