-- 0014-create-student-plans
-- 規格：docs/design/database-design.md

-- Up Migration
create table student_plans (
  user_id     uuid not null references users(user_id) on delete cascade,
  term        text not null,
  course_code text not null,
  section_id  text not null default '',
  sort        integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, term, course_code, section_id)
);

-- Down Migration
