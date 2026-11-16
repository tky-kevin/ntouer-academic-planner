-- 0020-add-user-profile
-- 背景：`GET /api/me/progress` 要「該學生所屬系所與入學年度的最新已發布版本」，
-- 但 users 只有身分欄位，沒有任何系所／入學年度，規格（api-spec §7.3）因此無法實作。
-- 這裡把學生的學籍屬性放回 users（一個使用者只會有一個學籍；管理員這兩欄可以是 null）。

-- Up Migration
alter table users add column dept_id text references departments(dept_id);
alter table users add column entry_year smallint;
alter table users add column program text not null default 'day';

alter table users
  add constraint users_entry_year_check check (entry_year is null or entry_year between 100 and 130);

create index idx_users_dept_year on users (dept_id, entry_year);

-- Down Migration
drop index if exists idx_users_dept_year;
alter table users drop constraint if exists users_entry_year_check;
alter table users drop column if exists program;
alter table users drop column if exists entry_year;
alter table users drop column if exists dept_id;
