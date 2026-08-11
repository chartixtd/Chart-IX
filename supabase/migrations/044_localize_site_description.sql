-- 让 footer 的站点标语跟随语言切换。
--
-- 问题：site_description 从 004_create_admin.sql 起就是一个纯中文字符串
-- （'"加密货币交易教育平台"'），而 src/lib/site-settings.ts 的 pickLocalized
-- 对字符串是原样返回的——所以英文/马来文页面的 footer 也照样显示中文。
--
-- 代码本来就支持 {locale: text} 形态的值（pickLocalized 会按当前语言取，取不到
-- 还会退到同语种的其他地区变体），后台的设置编辑器也用 JSON.parse/stringify
-- 往返，能正常编辑对象。所以这里只需要把数据换成三语对照，不用改任何代码。
--
-- 用 update 而不是 upsert：这一行由 004 种下，一定存在；写成 upsert 反而会在
-- 管理员后来改过文案的环境里把他的改动覆盖掉。

update public.admin_settings
set value = jsonb_build_object(
      'zh-CN', '加密货币交易教育平台',
      'en-US', 'Crypto trading education platform',
      'ms-MY', 'Platform pendidikan dagangan kripto'
    ),
    updated_at = now()
where key = 'site_description';
