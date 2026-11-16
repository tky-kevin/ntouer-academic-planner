-- 0021-add-student-record-classification
-- 背景：規則包的 selector 用 `category:CE`／`category:REQ`（共同教育／專業必修）與
-- `tag:*`（program、core、general、domainHuman…）。但 student_records 原本只有
-- required／elective／unknown，而且沒有 tags／owner，真實資料永遠無法滿足規則包。
-- 這裡補上引擎需要的分類與標籤，並把 category 的詞彙對齊規則包。
-- 保留 required／elective 兩個舊值：AIS 同步（I3）目前仍會產生這兩個粗略分類，
-- 對應到 CE／REQ／ELE 的映射要和系所確認後才做，不在此遷移裡猜。

-- Up Migration
alter table student_records drop constraint if exists student_records_category_check;
alter table student_records
  add constraint student_records_category_check
  check (category in ('CE', 'REQ', 'ELE', 'required', 'elective', 'unknown'));

alter table student_records add column tags text[] not null default '{}';
alter table student_records add column owner text not null default 'own';
alter table student_records
  add constraint student_records_owner_check check (owner in ('own', 'other'));

create index idx_student_records_tags on student_records using gin (tags);

-- Down Migration
drop index if exists idx_student_records_tags;
alter table student_records drop constraint if exists student_records_owner_check;
alter table student_records drop column if exists owner;
alter table student_records drop column if exists tags;
alter table student_records drop constraint if exists student_records_category_check;
alter table student_records
  add constraint student_records_category_check check (category in ('required', 'elective', 'unknown'));
