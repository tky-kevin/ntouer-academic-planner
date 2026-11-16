-- 0012-create-student-overrides
-- 規格：docs/design/database-design.md

-- Up Migration
create table student_overrides (
  user_id    uuid not null references users(user_id) on delete cascade,
  record_key text not null,
  field      text not null,
  value      text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, record_key, field),
  constraint student_overrides_field_check check (field in ('credits','category','status','course_name'))
);

-- Down Migration
