-- Remove unused live_stream feature flag
DELETE FROM public.feature_flags WHERE feature_key = 'live_stream';
