-- 0004-create-department-admins
-- 規格：docs/design/database-design.md

-- Up Migration
create table department_admins (
  dept_id    text not null references departments(dept_id),
  user_id    uuid not null references users(user_id) on delete cascade,
  granted_by uuid not null references users(user_id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references users(user_id),
  primary key (dept_id, user_id)
);

-- Down Migration
