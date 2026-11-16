-- 規則包身分（bundleId＝{dept}-{entry_year}-{program}）
insert into rule_bundles (bundle_id, dept_id, entry_year, program, title)
values
  ('cse-113-day', 'cse', 113, 'day', '資工 113 日間學士班'),
  ('mmd-115-day', 'mmd', 115, 'day', '商船 115 日間學士班')
on conflict (bundle_id) do nothing;
