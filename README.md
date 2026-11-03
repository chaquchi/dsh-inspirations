# 灵感便签（@local/inspirations）

DSH 左侧栏里的一面便签墙：点左侧导航的「灵感」进入主页面，随手记下灵感，勾选若干条，直接和 AI 讨论。

- **形态**：左侧导航行（`sidebar.panellist`，id `inspirations`）+ 同一 id 的主栏页面（`main`），不再依赖 `dsh-better-sidebar`。
- **存储**：全局一份 `$DSH_HOME/inspirations/notes.json`（默认 `C:\Users\<你>\.dsh\inspirations\notes.json`），跨会话、跨工作区共享；桌面端与网页端看到的是同一份。
- **讨论**：点「讨论 N」把勾选的灵感连同对话历史一起发给当前会话正在使用的模型；没勾选时点它会提示先勾选。点开任意一张便签，编辑器右上角也有「讨论」，直接把这一条带进讨论。回答里可以一键「存为新灵感」。讨论不占用主对话上下文。

## 使用

1. 左侧导航点「灵感」，主栏打开一面居中的便签板；
2. 「＋ 新灵感」→ 输入正文（第一行自动成为标题，自动保存，`Ctrl/Cmd+Enter` 保存并返回列表）；
3. 列表里勾选若干条 → 右上角「讨论 N」→ 开始对话；或者点开某条便签，在编辑器右上角点「讨论」只讨论这一条；
4. 搜索框按正文过滤；
5. 点卡片右上角图钉置顶，置顶的便签会进入最上面的「置顶」分组。

**笔记多了怎么整理**：列表按 `置顶 / 今天 / 昨天 / 近 7 天 / 更早` 自动分组；每组标题可点击折叠。默认在笔记超过 10 条时收起「更早」、超过 26 条时再收起「近 7 天」，搜索时全部分组自动展开。每张便签的纸色和倾角由 id 的稳定哈希决定，来回切换不会变色。

## 目录结构

```
inspirations/
├── package.json         # dsh.bundle.patch + dsh.client（platform: web）
├── cordis.patch.yml     # 向档案 insert 一行宿主插件
├── lib/index.js         # 宿主端：笔记存储 + POST /inspirations/api/*
├── lib/client.js        # 客户端：注册左侧导航行（sidebar.panellist）+ 主栏便签墙（main）
├── tests/host.test.mjs  # 宿主端回归测试（假 ctx 驱动路由）
└── README.md
```

## 宿主端接口

客户端一律 `POST /inspirations/api/<method>`（JSON），响应固定带 `ok`：

| method | 入参 | 说明 |
| --- | --- | --- |
| `notes.list` | – | 全部笔记（置顶优先、按更新时间倒序）+ 存储路径 |
| `notes.save` | `{ id?, text, pinned? }` | 无 `id` 新建，有 `id` 更新；返回 `{ note, notes }` |
| `notes.remove` | `{ id }` | 删除；返回剩余 `notes` |
| `route.info` | `{ sessionId }` | 当前会话的 `{ provider, model, source }` |
| `discuss` | `{ sessionId, notes: string[], messages }` | 一次讨论轮次，返回 `{ reply, route, elapsedMs }` |

模型路由三级回落：活体 agent 的 `options` → 会话日志里最新的 `request/header` → `agentDefaultModel` 全局默认。所以在一个还没发过消息的新会话里也能讨论（走默认模型）。

## 安装到档案

推荐直接用 `plugin_manager install_bundle`，`target` 指向本目录：

```
plugin_manager({ action: "install_bundle", target: "E:\\VScode\\插件\\inspirations" })
```

它会把 `link:` 依赖写进档案 `package.json` 并加入 `dsh.profile.bundles`。已经装过同一包名时先 `remove_bundle` 再装（否则会返回 `already-installed`）。手动方式等价于：

```jsonc
// <profile>/package.json
"dependencies": { "@local/inspirations": "link:E:/VScode/插件/inspirations" },
"dsh": { "profile": { "bundles": [ /* … */ "@local/inspirations" ] } }
```

然后在该档案目录 `pnpm install`，重启 DSH。`cordis.patch.yml` 会向档案 insert 一行 `id: inspirations`。

## 开发约束（踩过的坑）

- **左侧导航走核心 `slots` 服务**：`exports.inject = ['slots']`，在 `ctx.slots.inject('sidebar.panellist', …)` 里注册导航行，在 `ctx.slots.inject('main', …)` 里注册同 id 页面；`main` 的 key 必须等于 panellist 的 id。不要写进 `dsh.client.inject`（那是客户端模块依赖列表）。
- **纸墨色和界面色要分开**：`--insp-ink` 是便签纸上的深棕字色（深色主题也不反转），只能用在 `.insp-card` 里；板面上的标题、搜索框、编辑器、讨论气泡必须用 `--dsw-alias-label-*` / `--dsw-alias-border-*`，否则深色主题下就是深棕字画在深棕板上（踩过：编辑页正文一度完全看不见）。
- **`.insp-page` 不在 `.insp-root` 内**：全局 `box-sizing` 兜底只作用于 `.insp-root *`，`.insp-page` 自己写了 `height:100%` 就必须显式 `box-sizing:border-box`，否则 padding 会撑出视口、底部讨论输入框被裁掉。
- **客户端不要 `require()` 任何 `@deepseek-ai/dsh-client-*`**：client 模块表对第三方插件的 value-import 有纯度门。图标自绘 SVG。
- **宿主端不要 import `@deepseek-ai/dsh-llm`**：第三方插件从档案 `node_modules` 解析，官方包不保证可见；服务一律 `ctx.get()` 读取并降级，chunk 自行累积（`text-delta` → `chunk.text`）。
- **路由前缀必须唯一**：`/inspirations/api`。
- 笔记目录放在 `$DSH_HOME` 下而非工作区：灵感是全局的，且要能跨工作区读取。

## 视觉与动效规范（v7：横向麻绳 + 明亮纸色）

列表不再是「记事本行」，每张灵感是一张挂在横向麻绳上的便签，按行挂着：

- **主页面**：左侧导航「灵感」进入；桌面上一块 960px 宽、暖纸色的便签板（`--insp-board-surface`），四周留 `clamp(14px,2vw,28px)` 桌面边距。便签 `flex-wrap` 居中成行，行间距 `30px 18px`；窄到放不下两张时自动变单列。
- **纸**：6 组明亮纸色（暖黄 `#f8e6ae` / 珊瑚 `#f8c4b4` / 薄荷 `#cbe6c4` / 天蓝 `#c7ddf5` / 淡紫 `#dcd0f2` / 蜜桃 `#f9d7bc`，深色主题另给一组略深的同色系 `--insp-note-*`）按 `hash(id) % 6` 稳定分配，直接铺满纸面，不再和灰米色底混成发黑的颜色；卡片固定 `aspect-ratio: 4/3`（主页面 `flex-basis: 236px`，约 236×177），不再是被拉长的横条。倾角同样由 id 决定（±1.1°），悬停回正。右下角折角、上沿木夹子，都是纯 CSS。
- **编辑器**：点开便签后，编辑页的纸面直接取这张便签的颜色（`--insp-editor-paper`），顶部挂同一枚木夹子，像把便签放大摊开写，而不是切到一个灰扑扑的文本框。
- **绳**：每一行便签一根横向 SVG 麻绳，从行首外 18px 拉到行尾外 18px，中间一段轻微下垂；木夹子挂在绳正下方。几何在布局完成后测量（`data-rope-anchor` + `ResizeObserver` + 双 rAF + 460ms 兜底重测，避开入场动画），折叠、搜索、切主题、换窗口都会重新量。行与行之间不共用绳，这样整行折起来时绳也跟着收起。
- **分组**：`置顶 / 今天 / 昨天 / 近 7 天 / 更早`，标题带折叠箭头、条数和一条虚线绳标；折叠后只留标题，不再挂绳。
- **背景**：整块板是一张暖色点阵纸（主页面点阵取麻绳色 20%），深浅主题各自成立；页面上的搜索框、分组标题、编辑器外框、讨论区一律用主题字色/边线令牌，只有便签纸面（卡片、编辑纸）内才用纸墨色。
- **置顶**：不再用左侧 inset 竖条（那是旧版最丑的地方）；置顶 = 卡片右上角一枚红色图钉 + 进入最上方「置顶」分组。
- **标题**：卡片只显示一行标题（首行，省略号截断），下面最多三行摘要（主页面），再一行时间/字数元信息；单行笔记没有摘要时保持留白。

所有观感参数集中在 `.insp-root` 的 CSS 变量里，组件内不写字面值：

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--insp-hair` | `1/dpr`（dpr2→`0.5px`，dpr3→`0.3333px`） | 1px 线一律 `box-shadow: inset 0 0 0 var(--insp-hair)`，不再用 `border` |
| `--insp-ease-out` | `cubic-bezier(.22,1,.36,1)` | 出（多数入场/悬停） |
| `--insp-ease-in` | `cubic-bezier(.55,0,1,.45)` | 进（离场） |
| `--insp-ease-spring` | `cubic-bezier(.34,1.42,.64,1)` | 过冲，只给小元素（对勾 ≤10%） |
| `--insp-dur-1/2/3` | `120/200/300ms` | 微交互 / 面板 / 大块 |
| `--insp-stagger` | `18ms` | 卡片入场错峰（最多 12 张） |
| `--insp-surface(-hover,-active)` | `color-mix(bg-base 94/88/84%, label-primary)` | 搜索框、编辑器、讨论气泡的三级“等感知步进”，深浅色主题都成立 |
| `--insp-note-0…5` | 暖黄 `#f8e6ae` / 珊瑚 `#f8c4b4` / 薄荷 `#cbe6c4` / 天蓝 `#c7ddf5` / 淡紫 `#dcd0f2` / 蜜桃 `#f9d7bc`（深色主题 `#f2d68c/#f3b7a3/#bcdcae/#b7d3f0/#d2c2ee/#f5c8a4`） | 6 张便签的纸色；`c0..c5` 只给 `--note-paper` 赋值 |
| `--insp-editor-paper` | 由当前便签的 `cN` 决定（内联变量） | 编辑页纸面颜色 = 卡片颜色 |
| `--insp-ink / -2 / -3` | 亮 `#2f2a20` / 暗 `#2b261d`（后两级为透明度） | 便签上的字色，不跟随界面明暗反转；只能出现在纸面内（卡片、编辑纸、讨论气泡里的引用块） |
| `--insp-rope / --insp-rope-hi` | 亮 `#a9824f` / 暗 `#9a7a4e` | 横向麻绳主线与两端绳头 |
| `--insp-peg` | 亮 `#c59a63` / 暗 `#b08656` | 木夹子 |
| `--insp-board-surface` | 亮 `#f3eee1` / 暗 `#2b2721` | 主页面便签板的纸面 |
| `--insp-desk` | 亮 `#e9e9ee` / 暗 `#141417` | 主页面桌面底色；`.insp-page` 在 `.insp-root` 之外，所以用 `.insp-page:has(> .insp-root.is-dark)` 切换 |

色相 `c0..c5` 只给 `--note-paper` 赋值：6 组纸色是写死的低饱和高明度色板（便签本身就是实体纸，不跟主题色走），深色主题单独给一组略深的同色系，保证在深棕板上仍然是一张亮纸而非黑块；深色主题下纸上的 `--insp-ink` 不反转，保证字始终可读。

已实现的规则：发丝线（含 dpr 自适应）、tabular-nums、`min-width:0` 全局兜底、内层圆角 `calc(外层 - padding)`、容器有分隔线时内部按钮/输入框 ghost 化、深色模式字重补偿（`is-dark` + `font-variation-settings`）、曲线/时长令牌、`prefers-reduced-motion` 降级、讨论区自动跟随的 150ms 用户意图保护（距离 >1 行才停跟随，直接写 `scrollTop` 而非 smooth）、滚动容器 7 档非线性渐隐遮罩（触顶/触底该端归零）。

不适用的规则（本项目没有对应交互）：拖拽死区、分栏拖动/双击复位、画布缩放锚点 —— 插件里没有拖拽、分栏和画布。`pnpm` 依赖保持为零新增。

截图（用真实客户端模块 + 桩数据在无头 Edge 里渲染，非手绘示意）：

- `docs/preview-page.png` 左侧导航打开的便签板主页面（深色，960px）
- `docs/preview-page-light.png` 便签板主页面（浅色）
- `docs/preview-page-many.png` 主页面 20 条笔记滚动到底：「近 7 天」与自动折叠的「更早」
- `docs/preview-page-edit.png` 主页面点开便签：编辑纸面 = 这张便签的颜色，右上角可直接「讨论」
- `docs/preview-list.png` 侧栏便签墙（深色）
- `docs/preview-light.png` 侧栏便签墙（浅色，验证纸色/墨色/麻绳在亮色主题下仍成立）
- `docs/preview-many.png` 侧栏 20 条笔记滚动到底
- `docs/preview-edit.png` 侧栏编辑器（同样铺便签纸色）
- `docs/preview-discuss.png` 讨论页

生成/复查：`node .scratch/make-preview.cjs [--light|--many|--page]` → `.scratch/preview[-light|-many|-page].html`，再用 `msedge --headless=new --screenshot` 截图（需要 `.scratch/rtest` 里的 react UMD 构建；`?v=bottom|expand` 可截滚动到底部/展开分组的状态，`?v=geo|geobottom` 会打出布局几何，`?v=edit|discuss` 直接截编辑器/讨论页）。

校验脚本：`node .scratch/ui-rules.test.cjs`（在 jsdom 里跑客户端、取注入的 CSS 做规则体检）。

## 测试

```bash
node tests/host.test.mjs
```

覆盖：空库、新建/更新/置顶排序/空内容拒绝/删除/未知方法 404/非 POST 404、模型路由三级回落、讨论请求的上下文拼装与回复累积。
