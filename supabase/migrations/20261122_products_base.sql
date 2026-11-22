-- Большая база продуктов (Open Food Facts, ODbL, до 500 000 товаров) и товары, добавленные пользователями.
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.off_products (
  code text primary key, name text not null, brand text not null default '',
  kcal real not null, p real not null default 0, f real not null default 0, c real not null default 0,
  fib real not null default 0, sug real not null default 0, salt real not null default 0,
  portion real not null default 100, scans int not null default 0, cc text not null default '',
  q text generated always as (lower(replace(name || ' ' || brand, 'ё', 'е'))) stored
);
alter table public.off_products enable row level security;
create policy off_read on public.off_products for select to anon, authenticated using (true);
-- индекс создаётся после загрузки (scripts/seed_off_server.py):
create index if not exists off_products_q_trgm on public.off_products using gin (q extensions.gin_trgm_ops);

create table if not exists public.community_foods (
  code text primary key check (code ~ '^\d{8,14}$'),
  name text not null check (char_length(name) between 2 and 120),
  brand text not null default '' check (char_length(brand) <= 60),
  kcal real not null check (kcal between 0 and 950),
  p real not null default 0 check (p between 0 and 100), f real not null default 0 check (f between 0 and 100),
  c real not null default 0 check (c between 0 and 100), fib real not null default 0 check (fib between 0 and 100),
  sug real not null default 0 check (sug between 0 and 100), salt real not null default 0 check (salt between 0 and 100),
  portion real not null default 100 check (portion between 1 and 5000),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  q text generated always as (lower(replace(name || ' ' || brand, 'ё', 'е'))) stored
);
alter table public.community_foods enable row level security;
create policy cf_read on public.community_foods for select to anon, authenticated using (true);
create policy cf_insert on public.community_foods for insert to authenticated with check (created_by = auth.uid());
create policy cf_update on public.community_foods for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create index if not exists community_foods_q_trgm on public.community_foods using gin (q extensions.gin_trgm_ops);
grant select on public.off_products to anon, authenticated;
grant select, insert, update on public.community_foods to authenticated;
grant select on public.community_foods to anon;

create or replace function public.search_products(q text, lim int default 30)
returns table (src text, code text, name text, brand text, kcal real, p real, f real, c real, fib real, sug real, salt real, portion real)
language sql stable security invoker set search_path = public, extensions as $$
  with w as (
    select array_agg('%' || t || '%') as pats
    from unnest(regexp_split_to_array(lower(replace(trim(coalesce($1, '')), 'ё', 'е')), '\s+')) t
    where char_length(t) >= 2
  )
  (select 'community', c.code, c.name, c.brand, c.kcal, c.p, c.f, c.c, c.fib, c.sug, c.salt, c.portion
     from community_foods c, w where w.pats is not null and c.q like all (w.pats) order by c.updated_at desc limit 10)
  union all
  (select 'off', o.code, o.name, o.brand, o.kcal, o.p, o.f, o.c, o.fib, o.sug, o.salt, o.portion
     from off_products o, w where w.pats is not null and o.q like all (w.pats) order by o.scans desc limit least(greatest(coalesce($2, 30), 1), 60))
$$;
grant execute on function public.search_products(text, int) to anon, authenticated;

create or replace function public.product_by_code(code text)
returns table (src text, code text, name text, brand text, kcal real, p real, f real, c real, fib real, sug real, salt real, portion real)
language sql stable security invoker set search_path = public as $$
  with k as (select ltrim(regexp_replace(coalesce($1, ''), '\D', '', 'g'), '0') as z)
  (select 'community', c.code, c.name, c.brand, c.kcal, c.p, c.f, c.c, c.fib, c.sug, c.salt, c.portion
     from community_foods c, k where k.z <> '' and c.code in (k.z, lpad(k.z, 8, '0'), lpad(k.z, 12, '0'), lpad(k.z, 13, '0'), lpad(k.z, 14, '0')) limit 1)
  union all
  (select 'off', o.code, o.name, o.brand, o.kcal, o.p, o.f, o.c, o.fib, o.sug, o.salt, o.portion
     from off_products o, k where k.z <> '' and o.code in (k.z, lpad(k.z, 8, '0'), lpad(k.z, 12, '0'), lpad(k.z, 13, '0'), lpad(k.z, 14, '0')) limit 1)
$$;
grant execute on function public.product_by_code(text) to anon, authenticated;
