-- Оплата Premium переводом (Kaspi и т.п.): заявки и настройки реквизитов.
-- Доступ только через функцию premium (service role); клиентам таблицы закрыты.
create table if not exists public.pay_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  plan text not null check (plan in ('month','year')),
  amount numeric not null,
  currency text not null default 'KZT',
  code text not null,
  payer text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists pay_requests_status_idx on public.pay_requests(status, created_at desc);
create index if not exists pay_requests_user_idx on public.pay_requests(user_id, created_at desc);
alter table public.pay_requests enable row level security;
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.pay_requests from anon, authenticated;
revoke all on public.app_settings from anon, authenticated;
