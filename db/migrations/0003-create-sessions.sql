-- 0003-create-sessions
-- 規格：docs/design/database-design.md

-- Up Migration
create table sessions (
  token_hash  text primary key,
  user_id     uuid not null references users(user_id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz,
  user_agent  text
);

-- Down Migration
