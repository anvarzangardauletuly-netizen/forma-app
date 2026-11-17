-- Дневной лимит запросов к AI (используется функцией food-ai). Применено в проекте Supabase.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  n integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;

create or replace function public.ai_bump(p_user uuid, p_limit integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  insert into public.ai_usage(user_id, day, n) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set n = public.ai_usage.n + 1
  returning n into v;
  if v > p_limit then
    update public.ai_usage set n = n - 1 where user_id = p_user and day = current_date;
    return -1;
  end if;
  return v;
end $$;
revoke all on function public.ai_bump(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_bump(uuid, integer) to service_role;
