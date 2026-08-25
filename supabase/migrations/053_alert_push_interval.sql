-- T25：scanner 的 Telegram 推送从「每 N 分钟发一张榜单」改成「扫到新警报卡就发」。
--
-- push_interval_minutes 这一列的**语义因此变了**：它原先是定时器（多久发一次
-- 榜单），现在是节流闸（两条警报推送之间至少隔多久，其间的新卡片攒起来一起发）。
--
-- 不迁移这个值会有一个很安静的后果：线上存着的是 240（每 4 小时一次榜单），
-- 换语义之后它会把每一条警报最多压 4 小时才发出去——而警报的全部价值就在时效上。
-- 换句话说，功能上线当天就是坏的，而且看起来完全正常（推送在发，只是晚 4 小时）。
--
-- 归零 = 有新警报就发，这也是新的默认值。想要节流的人去后台自己填。
UPDATE telegram_push_settings SET push_interval_minutes = 0 WHERE id = 1;

ALTER TABLE telegram_push_settings ALTER COLUMN push_interval_minutes SET DEFAULT 0;

COMMENT ON COLUMN telegram_push_settings.push_interval_minutes IS
  '两次警报推送之间的最小间隔（分钟）。0 = 不节流，有新警报卡就发。T25 之前是「榜单推送间隔」。';

-- show_* 那九列（show_price / show_change_24h / show_amplitude / show_market_cap /
-- show_volume / show_oi_ratio / show_funding / show_score / show_edge）是榜单表格
-- 的列开关，代码已不再读写。**故意不删**：跟 chat_id 一样留作回滚，删了要恢复
-- 榜单推送就得连数据一起重建。
