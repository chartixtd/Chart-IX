-- 021: 跨实例限流存储
-- 背景：src/lib/trading/rate-limit.ts 原先是进程内内存滑动窗口，Vercel 会横向扩出
-- 多个 serverless 实例，各自内存独立，导致同一用户打到不同实例时限流形同虚设。
-- 这里用 Postgres 做跨实例共享的固定窗口计数器，用一条原子 UPSERT 保证并发安全，
-- 不需要显式加锁。

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key          TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
COMMENT ON TABLE public.rate_limit_buckets IS '跨实例限流固定窗口计数；window_start 为该窗口起点的毫秒时间戳';

-- 仅服务端（service role）读写，不对外暴露
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rpc_check_rate_limit(
  p_key TEXT,
  p_window_ms BIGINT,
  p_max INTEGER
) RETURNS TABLE(ok BOOLEAN, retry_after_ms BIGINT) AS $$
DECLARE
  v_now BIGINT := (extract(epoch FROM clock_timestamp()) * 1000)::BIGINT;
  v_window_start BIGINT := (v_now / p_window_ms) * p_window_ms;
  v_count INTEGER;
BEGIN
  -- 顺手清掉同一 key 下已经过期的旧窗口，避免这张表无限增长
  DELETE FROM public.rate_limit_buckets
  WHERE key = p_key AND window_start < v_window_start - p_window_ms;

  INSERT INTO public.rate_limit_buckets (key, window_start, count)
  VALUES (p_key, v_window_start, 1)
  ON CONFLICT (key, window_start)
  DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING count INTO v_count;

  IF v_count > p_max THEN
    RETURN QUERY SELECT false, (v_window_start + p_window_ms - v_now);
  ELSE
    RETURN QUERY SELECT true, 0::BIGINT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
