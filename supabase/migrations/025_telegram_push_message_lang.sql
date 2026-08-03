-- Which language the pushed screener message itself is written in (not the admin UI's language)
ALTER TABLE public.telegram_push_settings
  ADD COLUMN message_lang TEXT NOT NULL DEFAULT 'en' CHECK (message_lang IN ('en', 'zh'));
