-- 0009-create-review-records
-- 規格：docs/design/database-design.md

-- Up Migration
create table review_records (
  record_id       bigint generated always as identity primary key,
  version_id      text not null references rule_versions(version_id),
  action          text not null,
  actor_id        uuid references users(user_id),
  actor_role      text not null,
  actor_dept_scope text,
  at              timestamptz not null default now(),
  detail          jsonb,
  content_hash    text not null,
  diff_from       jsonb,
  constraint review_records_action_check check (action in ('created','validated','tested','submitted','approved','rejected','published','superseded'))
);

-- Down Migration
