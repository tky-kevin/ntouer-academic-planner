-- 0011-create-student-records
-- 規格：docs/design/database-design.md

-- Up Migration
create table student_records (
  user_id            uuid not null references users(user_id) on delete cascade,
  record_key         text not null,
  course_code        text not null,
  course_name        text,
  credits            numeric(4,1) not null,
  category           text not null default 'unknown',
  status             text not null,
  term               text,
  raw                jsonb not null,
  previous_raw       jsonb,
  previous_synced_at timestamptz,
  synced_at          timestamptz not null,
  primary key (user_id, record_key),
  constraint student_records_credits_check check (credits >= 0),
  constraint student_records_category_check check (category in ('required','elective','unknown')),
  constraint student_records_status_check check (status in ('passed','failed','inProgress','transfer','waived','unknown'))
);

-- Down Migration
