-- 管理端 demo 身分（本機用）：`DEV_USER_SUB=dev-admin` 時，resolveIdentity() 會找到這筆使用者。
-- 系所管理員在權限矩陣裡不是第三種 role，而是 student ＋ department_admins 一列；
-- 因此 role 維持 student，`can()` 會用 deptScopes=['cse'] 放行管理動作。
-- 可重複執行：使用者以 google_sub upsert，指派列以 (dept_id, user_id) upsert 並解除撤銷。
with admin_user as (
  insert into users (google_sub, email, role)
  values ('dev-admin', 'dev-admin@example.edu', 'student')
  on conflict (google_sub) do update set email = excluded.email
  returning user_id
)
insert into department_admins (dept_id, user_id, granted_by)
select 'cse', user_id, user_id from admin_user
on conflict (dept_id, user_id) do update
  set revoked_at = null, revoked_by = null;
