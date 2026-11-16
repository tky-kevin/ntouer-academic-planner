-- 系所（只放有規則包樣本的兩個系所；機械與機電只有條文摘要，不建樣本）
insert into departments (dept_id, name, college)
values
  ('cse', '資訊工程學系', null),
  ('mmd', '商船學系', null)
on conflict (dept_id) do nothing;
