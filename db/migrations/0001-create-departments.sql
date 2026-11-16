-- 0001-create-departments
-- 規格：docs/design/database-design.md

-- Up Migration
create table departments (
  dept_id     text primary key,
  name        text not null,
  college     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint departments_name_key unique (name)
);

-- Down Migration
