-- 0015-create-student-sync-state
-- 規格：docs/design/database-design.md

-- Up Migration
create table student_sync_state (
  user_id         uuid primary key references users(user_id) on delete cascade,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_result     text,
  last_error_code text,
  constraint student_sync_state_result_check check (last_result is null or last_result in ('ok','failed','never'))
);

-- Down Migration
