-- 0002-create-users
-- 規格：docs/design/database-design.md

-- Up Migration
create table users (
  user_id       uuid primary key default gen_random_uuid(),
  google_sub    text not null,
  email         text not null,
  role          text not null default 'student',
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  constraint users_google_sub_key unique (google_sub),
  constraint users_role_check check (role in ('student', 'sysadmin'))
);

-- Down Migration
