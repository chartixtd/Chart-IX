-- scanner 的 Telegram 推送改成**纯事件驱动**：扫描产出新警报卡就发，没有任何
-- 时间闸。053 把 push_interval_minutes 改成了「两次警报推送之间的最小间隔」，
-- 那仍然是时间驱动换了个名字——够不够钟由时钟说了算，一条刚触发的警报会被
-- 压到下一个窗口，而警报的全部价值就在时效上。
--
-- 代码已不再读写这一列。**故意不删**：跟 chat_id、show_* 一样留作回滚。
COMMENT ON COLUMN telegram_push_settings.push_interval_minutes IS
  '已弃用。scanner 推送改为事件驱动（扫到新警报卡即发），此列不再被读写；保留仅为回滚。';
