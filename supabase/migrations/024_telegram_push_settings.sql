-- Telegram push settings: singleton row, admin-configured bot + which screener
-- fields ride along in the push. bot_token is stored encrypted (see src/lib/crypto.ts),
-- same pattern as api_keys.secret_encrypted.
CREATE TABLE public.telegram_push_settings (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled           BOOLEAN NOT NULL DEFAULT false,
  bot_token_encrypted TEXT,
  chat_id           TEXT,
  show_price        BOOLEAN NOT NULL DEFAULT false,
  show_change_24h   BOOLEAN NOT NULL DEFAULT false,
  show_amplitude    BOOLEAN NOT NULL DEFAULT false,
  show_market_cap   BOOLEAN NOT NULL DEFAULT false,
  show_volume       BOOLEAN NOT NULL DEFAULT false,
  show_oi_ratio     BOOLEAN NOT NULL DEFAULT false,
  show_funding      BOOLEAN NOT NULL DEFAULT false,
  show_score        BOOLEAN NOT NULL DEFAULT false,
  show_edge         BOOLEAN NOT NULL DEFAULT false,
  last_pushed_at    TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_push_settings ENABLE ROW LEVEL SECURITY;
-- No public/authenticated policies on purpose: only the service-role client
-- (admin API routes + the cron route) may read or write the bot token.

INSERT INTO public.telegram_push_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
