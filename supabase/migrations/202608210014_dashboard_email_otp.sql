create table if not exists public.dashboard_login_challenges (
  id uuid primary key,
  request_fingerprint text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.dashboard_login_challenges enable row level security;

revoke all on table public.dashboard_login_challenges from anon, authenticated;

create index if not exists dashboard_login_challenges_fingerprint_created_idx
  on public.dashboard_login_challenges (request_fingerprint, created_at desc);

create index if not exists dashboard_login_challenges_expiry_idx
  on public.dashboard_login_challenges (expires_at);

comment on table public.dashboard_login_challenges is
  'Server-only hashed dashboard email OTP challenges. Plaintext login codes are never stored.';
