# Design

<!-- impeccable:design-schema 1 -->

## Direction contract

**THESIS** — Chart-IX 是一家"私人财富俱乐部"，不是又一个霓虹发光的加密仪表盘。它拒绝近黑底 + 单一荧光色 + 发光边框的品类默认。金色是被镌刻/烫压进深色石墨与黑曜石表面的贵金属，而不是屏幕上的荧光高亮。安静、精密、有分量——像私人银行的对账单与会员卡，而非交易所的赌场界面。

**OWN-WORLD** — 暖调深炭底（非纯黑，带一丝棕褐），香槟金（#C9A24B 系）作镌刻式点缀。展示字用 Marcellus（罗马碑刻式衬线，权威而非浮夸；CJK 回落 Noto Serif SC）；正文/界面用 Inter + Noto Sans SC；数字与行情用 JetBrains Mono 等宽。材质语汇：发丝金分隔线（hairline）、金箔渐变仅用于极少数徽记与分隔、柔和有偏移的投影（非零偏移光晕）、细腻的颗粒/噪点纹理暗示纸与金属。圆角克制（4–12px）。即使删除所有内容，凭"暖炭底 + 镌刻香槟金 + 碑刻衬线标题 + 发丝金线"也应能认出这是 Chart-IX。

**STORY** — 访客理解：这是一个把学习、模拟、实盘串成一条清晰路径的严肃平台；相信：我的资金安全、平台专业可信、风险可控；行动：免费注册 / 查看教学。

**FIRST VIEWPORT（首页）** — 全宽暖炭底，背景超大 "IX" 金色水印。碑刻式大标题（Marcellus，`clamp(2.75rem, 9vw, 6rem)` "+"学习交易，掌握未来""）主导第一屏，金色仅落在水印与发丝线上。主 CTA "免费注册" 为实心金箔按钮，次 CTA "查看教学内容" 为幽灵按钮配金色箭头。英雄底部一条克制的热门币行情条（BTC / ETH / SOL / BNB），发丝竖线分隔，等宽数字对齐，作为"静默证明"而非交易面板。风险声明以小字克制呈现。信任区为编辑式左右分栏（粘性标题 + 发丝线台账列表），步骤区为衬线序号台账。

**FORM** — Persuade（首页/转化）用编辑式分栏 + 镌刻标题；Operate（交易/仪表盘）保持信息密度优先，金色退为状态与强调的精密细节。

## Modes by surface

- Persuade：首页、注册/登录、Pro 升级 — 设计即产品，赢得信任与行动。
- Operate：交易终端、仪表盘、设置、后台 — 可扫读、一致、原生预期优先；金色只在强调处。
- Read：文章、视频详情、学习路径 — 阅读舒适度与结构优先。

## Color strategy

Restrained（中性暖炭 + 单一金色强调）。金色在页面尺度上以"镌刻/分隔/关键强调"落地，而非满屏散点。深色不是默认而是场景决定：交易者常在夜间、低环境光下长时间盯盘，深色护眼且让金色与行情色（涨绿/跌红）跳出。

### Tokens（durable roles）

- 背景：ink 深炭（`bg-primary #0B0A08`）、`bg-secondary #14120E`、`bg-tertiary #1C1913`、`bg-hover #262117`。
- 描边：`border-default #2C271C`、`border-hover #3A3325`；发丝金 `border-gold rgba(201,162,75,.35)`。
- 金：`gold #C9A24B`（主）、`gold-hover #DDB964`、`gold-light #EBD08A`、`gold-dark #A5813A`。金箔渐变 `gold-gradient`（135deg 深金→亮金）。
- 文本：`text-primary #F5F0E6`（暖白，非纯白）、`text-secondary #A89F8C`、`text-muted #6E675A`。
- 行情：涨 `success #34C77B`、跌 `danger #E5484D`、警示 `warning #E0A93B`、信息 `info #5B8DEF`。

## Typography

- Display：`font-display` = Marcellus, "Noto Serif SC", serif。用于 H1/H2 与英雄标题、俱乐部式标题。
- Body/UI：`font-sans` = Inter, "Noto Sans SC", system-ui。
- Mono：`font-mono` = JetBrains Mono。仅用于价格、数量、时间等数据/度量，不作"技术感"装饰。
- 规则：标题字距收紧（tracking ≤ -0.02em），正文行宽 65–75ch，尺度与字重台阶明显。

## Materials & motion

- 发丝金分隔线（1px，金/20-35% 透明）替代大量卡片边框。
- 金箔渐变仅用于 logo 强调、主按钮、关键分隔徽记；不做通用渐变文字。
- 投影必须有偏移 + 柔和模糊（`shadow-card`/`shadow-modal`），禁止零偏移彩色光晕当装饰。
- 细颗粒纹理（噪点/纸感）可用于英雄区与大面积深色，极低透明度。
- 动效：一次编排好的入场（exp ease-out，从已可见状态微移/微显），而非每个 section 相同入场或散乱 hover。尊重 prefers-reduced-motion。

## Prohibitions（check against the world, not to silence a linter）

- 不用荧光/霓虹单色 + 发光边框的加密品类默认外观。
- 不用通用渐变正文文字（金箔仅限徽记/logo/主按钮等被"烫压"的少数元素）。
- 不用等宽字体当"技术感"装饰（仅数据/度量）。
- 卡片不作页面主结构堆叠；用发丝线与留白分区。
- 强调靠字重/字号/金色镌刻，而非到处彩色 border-left。

## Preserved constraints

功能、交互逻辑、三语文案、品牌名 Chart-IX 与 logo.png、技术栈（Next.js + Tailwind + 现有组件架构）保持不变。
