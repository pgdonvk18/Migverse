-- =============================================================================
-- MigVerse 0001_foundation.sql
-- Identity, profiles, settings, staff roles, friends, blocks, rooms, room chat,
-- DMs, notifications, reports, audit log.
--
-- OWNERSHIP RULES
--   * Supabase Auth (auth.users.id, a UUID) is the ONLY identity. Never use usernames as keys.
--   * Anything sensitive (staff roles, bans, room passwords, audit logs) is written
--     only by SECURITY DEFINER functions. Clients get no direct INSERT/UPDATE on them.
--   * Wallet / coins / gifts come in 0002 (kept separate on purpose).
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------- enums ------------------------------------------------------------
create type presence_status   as enum ('online','offline','busy','invisible');
create type room_visibility   as enum ('public','private','password','invite_only');
create type room_role         as enum ('owner','admin','moderator','vip','member');
create type friendship_status as enum ('pending','accepted');
create type report_target     as enum ('user','message','room','dm_message');
create type report_status     as enum ('open','reviewing','actioned','dismissed','appealed');
create type staff_role        as enum ('super_admin','moderator','support');

-- ---------- generic helpers --------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------- profiles & settings ---------------------------------------------
create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  username       citext not null unique
                 check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name   text not null check (char_length(display_name) between 1 and 40),
  avatar_url     text,
  bio            text check (char_length(bio) <= 300),
  country        text check (char_length(country) <= 2),
  interests      text[] not null default '{}' check (cardinality(interests) <= 12),
  status_message text check (char_length(status_message) <= 80),
  presence       presence_status not null default 'offline',
  last_seen_at   timestamptz,
  suspended_at   timestamptz,               -- set by moderators via RPC only
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

create table user_settings (
  user_id            uuid primary key references profiles(id) on delete cascade,
  show_last_seen     boolean not null default true,
  send_read_receipts boolean not null default true,
  show_typing        boolean not null default true,
  who_can_dm         text not null default 'everyone' check (who_can_dm in ('everyone','friends','nobody')),
  theme              text not null default 'dark' check (theme in ('dark','light','system')),
  reduce_motion      boolean not null default false,
  text_scale         numeric(3,2) not null default 1.00 check (text_scale between 0.8 and 1.6),
  high_contrast      boolean not null default false,
  updated_at         timestamptz not null default now()
);
create trigger trg_settings_updated before update on user_settings
  for each row execute function set_updated_at();

-- Staff roles: no client write policy exists, so only service role / definer functions can change them.
create table staff_roles (
  user_id    uuid primary key references profiles(id) on delete cascade,
  role       staff_role not null,
  granted_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create or replace function staff_role_of(uid uuid default auth.uid()) returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff_roles where user_id = uid
$$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff_roles where user_id = auth.uid())
$$;

-- Auto-create profile + settings when a user signs up.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  uname := 'user_' || substr(replace(new.id::text,'-',''),1,10);
  insert into profiles (id, username, display_name)
  values (new.id, uname,
          coalesce(nullif(left(new.raw_user_meta_data->>'display_name',40),''), uname));
  insert into user_settings (user_id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- friends & blocks -------------------------------------------------
create table friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references profiles(id) on delete cascade,
  addressee_id uuid not null references profiles(id) on delete cascade,
  status       friendship_status not null default 'pending',
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
-- One row per unordered pair
create unique index uq_friend_pair on friendships (least(requester_id,addressee_id), greatest(requester_id,addressee_id));
create index idx_friend_addressee on friendships (addressee_id, status);

create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create or replace function is_blocked_between(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

-- ---------- rooms ------------------------------------------------------------
create table chat_rooms (
  id                uuid primary key default gen_random_uuid(),
  slug              citext not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name              text not null check (char_length(name) between 3 and 50),
  description       text check (char_length(description) <= 500),
  category          text not null default 'friendship',
  language          text not null default 'en',
  visibility        room_visibility not null default 'public',
  owner_id          uuid not null references profiles(id),
  capacity          int not null default 200 check (capacity between 2 and 5000),
  slow_mode_seconds int not null default 0 check (slow_mode_seconds between 0 and 300),
  announcement      text check (char_length(announcement) <= 500),
  pinned_message_id uuid,
  is_closed         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_rooms_browse on chat_rooms (category, created_at desc) where not is_closed;
create trigger trg_rooms_updated before update on chat_rooms
  for each row execute function set_updated_at();

-- Password hashes live in their own table with NO select policy: never reachable from the client.
create table room_secrets (
  room_id       uuid primary key references chat_rooms(id) on delete cascade,
  password_hash text not null
);

create table room_members (
  room_id    uuid not null references chat_rooms(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       room_role not null default 'member',
  muted_until timestamptz,
  banned_until timestamptz,
  banned_permanently boolean not null default false,
  is_favorite boolean not null default false,
  joined_at  timestamptz not null default now(),
  last_active_at timestamptz,
  primary key (room_id, user_id)
);
create index idx_room_members_user on room_members (user_id);

create table room_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references chat_rooms(id) on delete cascade,
  sender_id  uuid not null references profiles(id),
  body       text not null check (char_length(body) between 1 and 2000),
  reply_to   uuid references room_messages(id) on delete set null,
  client_id  uuid not null,                       -- idempotency key from the client
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (sender_id, client_id)                   -- retries/duplicates become no-ops
);
create index idx_room_msgs_page on room_messages (room_id, created_at desc, id desc);

create table message_reactions (
  message_id uuid not null references room_messages(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ---------- room helper functions (SECURITY DEFINER avoids RLS recursion) ----
create or replace function is_room_member(rid uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from room_members m
    where m.room_id = rid and m.user_id = uid
      and not m.banned_permanently and (m.banned_until is null or m.banned_until < now()))
$$;

create or replace function room_role_of(rid uuid, uid uuid default auth.uid()) returns room_role
language sql stable security definer set search_path = public as $$
  select role from room_members where room_id = rid and user_id = uid
$$;

create or replace function can_moderate_room(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(room_role_of(rid) in ('owner','admin','moderator'), false) or is_staff()
$$;

-- ---------- DMs ---------------------------------------------------------------
create table conversations (
  id         uuid primary key default gen_random_uuid(),
  is_group   boolean not null default false,
  title      text check (char_length(title) <= 60),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  is_admin        boolean not null default false,
  is_pinned       boolean not null default false,
  last_read_at    timestamptz not null default 'epoch',
  joined_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index idx_conv_members_user on conversation_members (user_id);

create table direct_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id       uuid not null references profiles(id),
  body            text not null check (char_length(body) between 1 and 4000),
  client_id       uuid not null,
  created_at      timestamptz not null default now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  unique (sender_id, client_id)
);
create index idx_dm_page on direct_messages (conversation_id, created_at desc, id desc);

create or replace function is_conversation_member(cid uuid, uid uuid default auth.uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = cid and user_id = uid)
$$;

-- ---------- notifications, reports, audit -----------------------------------
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null,                 -- friend_request, dm, mention, mod_action, ...
  payload    jsonb not null default '{}',
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index idx_notif_user on notifications (user_id, created_at desc);
create index idx_notif_unread on notifications (user_id) where read_at is null;

create table reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id),
  target_type report_target not null,
  target_id   uuid not null,
  reason      text not null check (char_length(reason) between 3 and 1000),
  status      report_status not null default 'open',
  handled_by  uuid references profiles(id),
  resolution  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_reports_queue on reports (status, created_at);
create trigger trg_reports_updated before update on reports
  for each row execute function set_updated_at();

create table audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references profiles(id),
  action     text not null,
  target_type text,
  target_id  text,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_audit_time on audit_logs (created_at desc);

create or replace function write_audit(action text, ttype text, tid text, details jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, action, target_type, target_id, details)
  values (auth.uid(), action, ttype, tid, details)
$$;
revoke all on function write_audit(text,text,text,jsonb) from public, anon, authenticated;

-- ---------- message guards (flood + slow mode + mute/ban) -------------------
create or replace function guard_room_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare r chat_rooms; m room_members; last_ts timestamptz; recent int;
begin
  select * into r from chat_rooms where id = new.room_id;
  if r.id is null or r.is_closed then raise exception 'room_closed'; end if;
  select * into m from room_members where room_id = new.room_id and user_id = new.sender_id;
  if m.user_id is null then raise exception 'not_a_member'; end if;
  if m.banned_permanently or (m.banned_until is not null and m.banned_until > now()) then
    raise exception 'banned'; end if;
  if m.muted_until is not null and m.muted_until > now() then raise exception 'muted'; end if;

  -- flood protection: max 10 messages / 10s / user / room
  select count(*) into recent from room_messages
   where sender_id = new.sender_id and room_id = new.room_id and created_at > now() - interval '10 seconds';
  if recent >= 10 then raise exception 'rate_limited'; end if;

  -- slow mode (moderators exempt)
  if r.slow_mode_seconds > 0 and m.role not in ('owner','admin','moderator') then
    select max(created_at) into last_ts from room_messages
     where sender_id = new.sender_id and room_id = new.room_id;
    if last_ts is not null and last_ts > now() - make_interval(secs => r.slow_mode_seconds) then
      raise exception 'slow_mode'; end if;
  end if;

  update room_members set last_active_at = now() where room_id = new.room_id and user_id = new.sender_id;
  return new;
end $$;
create trigger trg_guard_room_message before insert on room_messages
  for each row execute function guard_room_message();

create or replace function guard_direct_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare other uuid; recent int; pref text;
begin
  if not is_conversation_member(new.conversation_id, new.sender_id) then raise exception 'not_a_member'; end if;
  select count(*) into recent from direct_messages
   where sender_id = new.sender_id and created_at > now() - interval '10 seconds';
  if recent >= 15 then raise exception 'rate_limited'; end if;
  -- 1:1 conversations: enforce blocks
  if exists (select 1 from conversations where id = new.conversation_id and not is_group) then
    select user_id into other from conversation_members
     where conversation_id = new.conversation_id and user_id <> new.sender_id limit 1;
    if other is not null and is_blocked_between(new.sender_id, other) then raise exception 'blocked'; end if;
  end if;
  return new;
end $$;
create trigger trg_guard_dm before insert on direct_messages
  for each row execute function guard_direct_message();

-- ---------- RPCs (all sensitive writes go through here) ---------------------
create or replace function create_room(p_name text, p_slug text, p_description text, p_category text,
  p_visibility room_visibility default 'public', p_password text default null, p_capacity int default 200)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if (select suspended_at from profiles where id = auth.uid()) is not null then raise exception 'suspended'; end if;
  if (select count(*) from chat_rooms where owner_id = auth.uid() and not is_closed) >= 3 then
    raise exception 'room_limit'; end if;   -- tune/replace with the "apply to create" flow later
  if p_visibility = 'password' and coalesce(length(p_password),0) < 4 then raise exception 'password_required'; end if;
  insert into chat_rooms (name, slug, description, category, visibility, owner_id, capacity)
  values (p_name, lower(p_slug), p_description, p_category, p_visibility, auth.uid(), p_capacity)
  returning id into rid;
  if p_visibility = 'password' then
    insert into room_secrets values (rid, crypt(p_password, gen_salt('bf')));
  end if;
  insert into room_members (room_id, user_id, role) values (rid, auth.uid(), 'owner');
  return rid;
end $$;

create or replace function join_room(p_room uuid, p_password text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r chat_rooms; m room_members; cnt int;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if (select suspended_at from profiles where id = auth.uid()) is not null then raise exception 'suspended'; end if;
  select * into r from chat_rooms where id = p_room and not is_closed;
  if r.id is null then raise exception 'room_not_found'; end if;
  select * into m from room_members where room_id = p_room and user_id = auth.uid();
  if m.user_id is not null then
    if m.banned_permanently or (m.banned_until is not null and m.banned_until > now()) then raise exception 'banned'; end if;
    return; -- already a member
  end if;
  if r.visibility = 'invite_only' or r.visibility = 'private' then raise exception 'invite_required'; end if;
  if r.visibility = 'password' and not exists (
      select 1 from room_secrets s where s.room_id = p_room and s.password_hash = crypt(coalesce(p_password,''), s.password_hash))
  then raise exception 'wrong_password'; end if;
  select count(*) into cnt from room_members where room_id = p_room;
  if cnt >= r.capacity then raise exception 'room_full'; end if;
  insert into room_members (room_id, user_id) values (p_room, auth.uid());
end $$;

create or replace function leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if room_role_of(p_room) = 'owner' then raise exception 'owner_cannot_leave'; end if;
  delete from room_members where room_id = p_room and user_id = auth.uid()
    and not banned_permanently and (banned_until is null or banned_until < now()); -- bans persist
end $$;

-- Moderation: mute / kick / ban with hierarchy checks and audit.
create or replace function moderate_member(p_room uuid, p_target uuid, p_action text, p_minutes int default null)
returns void language plpgsql security definer set search_path = public as $$
declare actor room_role; tgt room_role;
  rank_a int; rank_t int;
begin
  actor := room_role_of(p_room); tgt := room_role_of(p_room, p_target);
  if not can_moderate_room(p_room) then raise exception 'forbidden'; end if;
  rank_a := case when is_staff() then 99 else array_position(array['member','vip','moderator','admin','owner']::text[], actor::text) end;
  rank_t := coalesce(array_position(array['member','vip','moderator','admin','owner']::text[], tgt::text), 0);
  if p_target = auth.uid() or rank_a <= rank_t then raise exception 'insufficient_rank'; end if;

  if p_action = 'mute' then
    update room_members set muted_until = now() + make_interval(mins => coalesce(p_minutes,10)) where room_id=p_room and user_id=p_target;
  elsif p_action = 'unmute' then
    update room_members set muted_until = null where room_id=p_room and user_id=p_target;
  elsif p_action = 'kick' then
    delete from room_members where room_id=p_room and user_id=p_target;
  elsif p_action = 'ban' then
    if p_minutes is null then
      update room_members set banned_permanently = true where room_id=p_room and user_id=p_target;
    else
      update room_members set banned_until = now() + make_interval(mins => p_minutes) where room_id=p_room and user_id=p_target;
    end if;
  elsif p_action = 'unban' then
    update room_members set banned_permanently=false, banned_until=null where room_id=p_room and user_id=p_target;
  else raise exception 'unknown_action'; end if;

  perform write_audit('room.'||p_action, 'user', p_target::text, jsonb_build_object('room', p_room, 'minutes', p_minutes));
  insert into notifications (user_id, kind, payload)
    values (p_target, 'mod_action', jsonb_build_object('room', p_room, 'action', p_action));
end $$;

create or replace function send_friend_request(p_to uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_to = auth.uid() then raise exception 'self'; end if;
  if is_blocked_between(auth.uid(), p_to) then raise exception 'blocked'; end if;
  insert into friendships (requester_id, addressee_id) values (auth.uid(), p_to)
    on conflict do nothing;
  insert into notifications (user_id, kind, payload)
    values (p_to, 'friend_request', jsonb_build_object('from', auth.uid()));
end $$;

create or replace function respond_friend_request(p_request uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_accept then
    update friendships set status='accepted', responded_at=now()
      where id=p_request and addressee_id=auth.uid() and status='pending';
  else
    delete from friendships where id=p_request and addressee_id=auth.uid() and status='pending';
  end if;
end $$;

create or replace function block_user(p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_target = auth.uid() then raise exception 'self'; end if;
  insert into blocks values (auth.uid(), p_target) on conflict do nothing;
  delete from friendships
   where least(requester_id,addressee_id) = least(auth.uid(),p_target)
     and greatest(requester_id,addressee_id) = greatest(auth.uid(),p_target);
end $$;

create or replace function get_or_create_dm(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid; pref text; are_friends boolean;
begin
  if p_other = auth.uid() then raise exception 'self'; end if;
  if is_blocked_between(auth.uid(), p_other) then raise exception 'blocked'; end if;
  select who_can_dm into pref from user_settings where user_id = p_other;
  select exists (select 1 from friendships where status='accepted'
    and least(requester_id,addressee_id)=least(auth.uid(),p_other)
    and greatest(requester_id,addressee_id)=greatest(auth.uid(),p_other)) into are_friends;
  if pref = 'nobody' or (pref = 'friends' and not are_friends) then raise exception 'dm_not_allowed'; end if;

  select c.id into cid from conversations c
   where not c.is_group
     and exists (select 1 from conversation_members where conversation_id=c.id and user_id=auth.uid())
     and exists (select 1 from conversation_members where conversation_id=c.id and user_id=p_other)
   limit 1;
  if cid is null then
    insert into conversations (created_by) values (auth.uid()) returning id into cid;
    insert into conversation_members (conversation_id, user_id) values (cid, auth.uid()), (cid, p_other);
  end if;
  return cid;
end $$;

create or replace function mark_conversation_read(p_conv uuid) returns void
language sql security definer set search_path = public as $$
  update conversation_members set last_read_at = now()
   where conversation_id = p_conv and user_id = auth.uid()
$$;

create or replace function dm_unread_counts() returns table (conversation_id uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select cm.conversation_id, count(dm.id)
    from conversation_members cm
    left join direct_messages dm on dm.conversation_id = cm.conversation_id
         and dm.created_at > cm.last_read_at and dm.sender_id <> cm.user_id and dm.deleted_at is null
   where cm.user_id = auth.uid()
   group by cm.conversation_id
$$;

create or replace function file_report(p_type report_target, p_target uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if (select count(*) from reports where reporter_id=auth.uid() and created_at > now() - interval '1 hour') >= 10
    then raise exception 'rate_limited'; end if;
  insert into reports (reporter_id, target_type, target_id, reason) values (auth.uid(), p_type, p_target, p_reason)
  returning id into rid;
  return rid;
end $$;

-- Staff-only: resolve a report (audited)
create or replace function resolve_report(p_report uuid, p_status report_status, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  update reports set status=p_status, resolution=p_resolution, handled_by=auth.uid() where id=p_report;
  perform write_audit('report.'||p_status, 'report', p_report::text, jsonb_build_object('resolution', p_resolution));
end $$;

-- Staff-only: suspend / unsuspend account
create or replace function set_suspension(p_user uuid, p_suspended boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if staff_role_of() not in ('super_admin','moderator') then raise exception 'forbidden'; end if;
  update profiles set suspended_at = case when p_suspended then now() else null end where id = p_user;
  perform write_audit(case when p_suspended then 'user.suspend' else 'user.unsuspend' end,'user',p_user::text,
                      jsonb_build_object('reason', p_reason));
end $$;

-- Function execute rights: authenticated only (never anon)
do $$
declare f text;
begin
  for f in select unnest(array[
    'create_room(text,text,text,text,room_visibility,text,int)','join_room(uuid,text)','leave_room(uuid)',
    'moderate_member(uuid,uuid,text,int)','send_friend_request(uuid)','respond_friend_request(uuid,boolean)',
    'block_user(uuid)','get_or_create_dm(uuid)','mark_conversation_read(uuid)','dm_unread_counts()',
    'file_report(report_target,uuid,text)','resolve_report(uuid,report_status,text)','set_suspension(uuid,boolean,text)'])
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------- ROW LEVEL SECURITY ----------------------------------------------
alter table profiles            enable row level security;
alter table user_settings       enable row level security;
alter table staff_roles         enable row level security;
alter table friendships         enable row level security;
alter table blocks              enable row level security;
alter table chat_rooms          enable row level security;
alter table room_secrets        enable row level security;   -- no policies = no client access
alter table room_members        enable row level security;
alter table room_messages       enable row level security;
alter table message_reactions   enable row level security;
alter table conversations       enable row level security;
alter table conversation_members enable row level security;
alter table direct_messages     enable row level security;
alter table notifications       enable row level security;
alter table reports             enable row level security;
alter table audit_logs          enable row level security;

-- profiles: any signed-in user can read; only the owner edits (suspension is RPC-only, see trigger below)
create policy profiles_read   on profiles for select to authenticated using (true);
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create or replace function protect_profile_fields() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null and not is_staff() then
    new.suspended_at := old.suspended_at;   -- users cannot un-suspend themselves
    new.id := old.id;
  end if;
  return new;
end $$;
create trigger trg_protect_profile before update on profiles
  for each row execute function protect_profile_fields();

create policy settings_own on user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy staff_self_read on staff_roles for select to authenticated using (user_id = auth.uid());

-- friendships: participants read; writes only through RPCs
create policy friends_read on friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy blocks_read   on blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_delete on blocks for delete to authenticated using (blocker_id = auth.uid());

-- rooms: directory shows non-private rooms, plus any room you belong to
create policy rooms_read on chat_rooms for select to authenticated
  using (visibility in ('public','password') or is_room_member(id) or is_staff());
create policy rooms_update on chat_rooms for update to authenticated
  using (room_role_of(id) in ('owner','admin')) with check (room_role_of(id) in ('owner','admin'));

-- members: visible to fellow members; users may toggle their own favorite only (via limited update)
create policy rmembers_read on room_members for select to authenticated
  using (is_room_member(room_id) or is_staff());
create policy rmembers_fav on room_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function protect_member_fields() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null then   -- direct client updates may only change is_favorite
    new.role := old.role; new.muted_until := old.muted_until; new.banned_until := old.banned_until;
    new.banned_permanently := old.banned_permanently; new.room_id := old.room_id; new.user_id := old.user_id;
  end if;
  return new;
end $$;
-- NOTE: SECURITY DEFINER RPCs run as the function owner, where auth.uid() is still the caller.
-- So moderate_member must bypass this guard: it sets a transaction-local flag.
-- Simplest safe approach: the trigger exempts updates made while 'migverse.rpc' is set.
create or replace function protect_member_fields_v2() returns trigger
language plpgsql as $$
begin
  if current_setting('migverse.rpc', true) is distinct from 'on' and auth.uid() is not null then
    new.role := old.role; new.muted_until := old.muted_until; new.banned_until := old.banned_until;
    new.banned_permanently := old.banned_permanently; new.room_id := old.room_id; new.user_id := old.user_id;
  end if;
  return new;
end $$;
drop function protect_member_fields();
create trigger trg_protect_member before update on room_members
  for each row execute function protect_member_fields_v2();
-- moderate_member must call: perform set_config('migverse.rpc','on',true); before its updates.
-- (Applied below by redefining the function body header.)
create or replace function moderate_member(p_room uuid, p_target uuid, p_action text, p_minutes int default null)
returns void language plpgsql security definer set search_path = public as $$
declare actor room_role; tgt room_role; rank_a int; rank_t int;
  ranks text[] := array['member','vip','moderator','admin','owner'];
begin
  perform set_config('migverse.rpc','on',true);
  actor := room_role_of(p_room); tgt := room_role_of(p_room, p_target);
  if not can_moderate_room(p_room) then raise exception 'forbidden'; end if;
  rank_a := case when is_staff() then 99 else array_position(ranks, actor::text) end;
  rank_t := coalesce(array_position(ranks, tgt::text), 0);
  if p_target = auth.uid() or rank_a <= rank_t then raise exception 'insufficient_rank'; end if;

  if p_action = 'mute' then
    update room_members set muted_until = now() + make_interval(mins => coalesce(p_minutes,10)) where room_id=p_room and user_id=p_target;
  elsif p_action = 'unmute' then
    update room_members set muted_until = null where room_id=p_room and user_id=p_target;
  elsif p_action = 'kick' then
    delete from room_members where room_id=p_room and user_id=p_target;
  elsif p_action = 'ban' then
    if p_minutes is null then
      update room_members set banned_permanently = true where room_id=p_room and user_id=p_target;
    else
      update room_members set banned_until = now() + make_interval(mins => p_minutes) where room_id=p_room and user_id=p_target;
    end if;
  elsif p_action = 'unban' then
    update room_members set banned_permanently=false, banned_until=null where room_id=p_room and user_id=p_target;
  else raise exception 'unknown_action'; end if;

  perform write_audit('room.'||p_action, 'user', p_target::text, jsonb_build_object('room', p_room, 'minutes', p_minutes));
  insert into notifications (user_id, kind, payload)
    values (p_target, 'mod_action', jsonb_build_object('room', p_room, 'action', p_action));
end $$;
revoke all on function moderate_member(uuid,uuid,text,int) from public, anon;
grant execute on function moderate_member(uuid,uuid,text,int) to authenticated;

-- room messages: only members read & write; moderators may soft-delete via update
create policy rmsg_read on room_messages for select to authenticated
  using (is_room_member(room_id) or is_staff());
create policy rmsg_insert on room_messages for insert to authenticated
  with check (sender_id = auth.uid() and is_room_member(room_id));   -- guard trigger adds mute/slow/flood checks
create policy rmsg_delete_soft on room_messages for update to authenticated
  using (sender_id = auth.uid() or can_moderate_room(room_id))
  with check (sender_id = auth.uid() or can_moderate_room(room_id));
create or replace function protect_message_fields() returns trigger
language plpgsql as $$
begin   -- updates may only set deleted_at; content is immutable
  new.body := old.body; new.sender_id := old.sender_id; new.room_id := old.room_id;
  new.client_id := old.client_id; new.created_at := old.created_at; new.reply_to := old.reply_to;
  return new;
end $$;
create trigger trg_protect_message before update on room_messages
  for each row execute function protect_message_fields();

create policy react_read on message_reactions for select to authenticated
  using (exists (select 1 from room_messages m where m.id = message_id and is_room_member(m.room_id)));
create policy react_write on message_reactions for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from room_messages m where m.id = message_id and is_room_member(m.room_id)));
create policy react_delete on message_reactions for delete to authenticated using (user_id = auth.uid());

-- DMs: strictly participants only (enforced here, not just in the UI)
create policy conv_read on conversations for select to authenticated using (is_conversation_member(id));
create policy cmembers_read on conversation_members for select to authenticated
  using (is_conversation_member(conversation_id));
create policy cmembers_pin on conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dm_read on direct_messages for select to authenticated using (is_conversation_member(conversation_id));
create policy dm_insert on direct_messages for insert to authenticated
  with check (sender_id = auth.uid() and is_conversation_member(conversation_id));
create policy dm_own_update on direct_messages for update to authenticated
  using (sender_id = auth.uid()) with check (sender_id = auth.uid());

-- notifications: owner reads / marks read; creation only by definer functions
create policy notif_read   on notifications for select to authenticated using (user_id = auth.uid());
create policy notif_update on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- reports: reporter sees own; staff sees all; creation via file_report()
create policy reports_read on reports for select to authenticated
  using (reporter_id = auth.uid() or is_staff());

-- audit logs: staff read only; nobody writes directly
create policy audit_read on audit_logs for select to authenticated using (is_staff());

-- ---------- table privileges: clients get only what policies need -----------
revoke all on all tables in schema public from anon, authenticated;
grant select on profiles, chat_rooms, room_members, room_messages, message_reactions, conversations,
  conversation_members, direct_messages, notifications, reports, friendships, blocks, staff_roles, audit_logs
  to authenticated;
grant update (display_name, avatar_url, bio, country, interests, status_message, presence, last_seen_at) on profiles to authenticated;
grant select, insert, update on user_settings to authenticated;
grant update (name, description, category, language, slow_mode_seconds, announcement, pinned_message_id, capacity) on chat_rooms to authenticated;
grant update (is_favorite) on room_members to authenticated;
grant insert on room_messages to authenticated;
grant update (deleted_at) on room_messages to authenticated;
grant insert, delete on message_reactions to authenticated;
grant insert on direct_messages to authenticated;
grant update (body, deleted_at, edited_at) on direct_messages to authenticated;
grant update (is_pinned) on conversation_members to authenticated;
grant update (read_at) on notifications to authenticated;
grant delete on blocks to authenticated;

-- ---------- realtime (RLS still applies to every subscription) ---------------
alter publication supabase_realtime add table room_messages, direct_messages, notifications, room_members;
