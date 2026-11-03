# 灵感便签（dsh-inspirations）

DSH 左侧栏里的一面便签墙：点左侧导航的「灵感」进入主页面，随手记下灵感，勾选若干条，直接和 AI 讨论。

- **形态**：左侧导航行（`sidebar.panellist`，id `inspirations`）+ 同一 id 的主栏页面（`main`），不再依赖 `dsh-better-sidebar`。
- **存储**：全局一份 SQLite 数据库 `$DSH_HOME/inspirations/inspirations.db`（默认 `C:\Users\<你>\.dsh\inspirations\inspirations.db`），内置 `node:sqlite`、WAL 模式；从 0.6.4 起由旧的 `notes.json` 自动迁移（迁移后原文件改名为 `notes.json.imported-<时间戳>.bak` 保留备份）。跨会话、跨工作区共享；桌面端与网页端看到的是同一份。
- **讨论**：点「讨论 N」把勾选的灵感连同对话历史一起发给当前会话正在使用的模型；没勾选时点它会提示先勾选。点开任意一张便签，编辑器右上角也有「讨论」，直接把这一条带进讨论。回答里可以一键「存为新灵感」。讨论不占用主对话上下文。
- **标题与复制**：标题独立于正文（`title` + `titleAuto`）：留空时自动取正文第一行，手写后固定、不再被正文覆盖，清空又回到自动。卡片悬停右上角、编辑器底部都有「复制」，复制纯文本（手写标题会带上标题行）。

## 使用

1. 左侧导航点「灵感」，主栏打开一面铺满窗口的便签板；
2. 「＋ 新灵感」→ 先写标题（可留空，留空自动取正文第一行），再写正文；自动保存，`Ctrl/Cmd+Enter` 保存并返回列表；
3. 列表里勾选若干条 → 右上角「讨论 N」→ 开始对话；或者点开某条便签，在编辑器右上角点「讨论」只讨论这一条；
4. 搜索框按正文过滤；
5. 点卡片右上角图钉置顶，置顶的便签会进入最上面的「置顶」分组；
6. 想复制一条灵感：卡片悬停右上角点复制，或点开便签用编辑器底部的「复制」。

**笔记多了怎么整理**：列表按 `置顶 / 今天 / 昨天 / 近 7 天 / 更早` 自动分组；每组标题可点击折叠。默认在笔记超过 10 条时收起「更早」、超过 26 条时再收起「近 7 天」，搜索时全部分组自动展开。每张便签的纸色和倾角由 id 的稳定哈希决定，来回切换不会变色。

## 目录结构

```
inspirations/
├── package.json         # dsh.bundle.patch + dsh.client（platform: web）
├── cordis.patch.yml     # 向档案 insert 一行宿主插件
├── lib/index.js         # 宿主端：SQLite 存储 + POST /inspirations/api/*
├── lib/client.js        # 客户端：注册左侧导航行（sidebar.panellist）+ 主栏便签墙（main）
├── tests/host.test.mjs  # 宿主端回归测试（假 ctx 驱动路由）
├── tests/storage.test.mjs # 存储层测试（建库、迁移、软删除、重启恢复）
└── README.md
```

## 宿主端接口

客户端一律 `POST /inspirations/api/<method>`（JSON），响应固定带 `ok`：

| method | 入参 | 说明 |
| --- | --- | --- |
| `notes.list` | – | 全部笔记（置顶优先、按更新时间倒序）+ `path` 与 `engine`（`sqlite` / `json`） |
| `notes.save` | `{ id?, text, title?, titleAuto?, pinned? }` | 无 `id` 新建，有 `id` 更新；`title` 手写标题，`titleAuto:false` 固定标题，`titleAuto:true` 或留空标题时按正文首行推导；文本和标题都为空才拒绝；返回 `{ note, notes }` |
| `notes.remove` | `{ id }` | 软删除（`deleted_at` 置位，行保留可追溯）；返回剩余 `notes` |
| `route.info` | `{ sessionId }` | 当前会话的 `{ provider, model, source }` |
| `discuss` | `{ sessionId, notes: string[], messages }` | 一次讨论轮次，返回 `{ reply, route, elapsedMs }` |

模型路由三级回落：活体 agent 的 `options` → 会话日志里最新的 `request/header` → `agentDefaultModel` 全局默认。所以在一个还没发过消息的新会话里也能讨论（走默认模型）。

## 存储（0.6.4 起：SQLite）

- **引擎**：宿主进程内置 `node:sqlite`（DSH 桌面自带 Node 24.21 / SQLite 3.53.4），库文件 `$DSH_HOME/inspirations/inspirations.db`；`journal_mode=WAL`、`synchronous=NORMAL`、`busy_timeout=2000`。
- **schema v1**（版本号存 `meta.schema_version`）：`notes(id, text, title, title_auto, pinned, created_at, updated_at, deleted_at)`，索引 `notes_live(deleted_at, pinned DESC, updated_at DESC)`；`relations` 表为 0.7 的灵感关系分析预留（`a_id / b_id / kind / reason / confidence / analyzed_at / model / prompt_version`，唯一键 `(a_id, b_id, kind)`）。
- **迁移**：首次打开且发现旧的 `notes.json` 时自动导入（`titleAuto` 等字段按老数据规则补齐），成功后把原文件改名为 `notes.json.imported-<时间戳>.bak`；`meta.legacy_json_imported` 记录后不再重复导入。
- **软删除**：`notes.remove` 只写 `deleted_at`，列表过滤但不物理删除，方便以后做回收站；同一 id 再次保存会复活该行。
- **回退**：运行环境没有 `node:sqlite`（老 Node）时自动降级回单文件 JSON，接口与字段不变，只是 `notes.list` 的 `engine` 变成 `json`。
- **并发**：宿主进程内是同步 API，天然串行；多窗口共享同一连接；跨进程靠 WAL + `busy_timeout`，不会互相清空数据。

## 安装

**从 GitHub 安装（推荐）**：

```sh
dsh plugin add github:chaquchi/dsh-inspirations
```

桌面端也可以打开 **插件 → 发现 / 插件市场**，搜索 `dsh-inspirations` 一键安装（收录社区后可见）。

**本地开发安装**：直接用 `plugin_manager install_bundle`，`target` 指向本目录：

```
plugin_manager({ action: "install_bundle", target: "<本仓库目录>" })
```

它会把 `link:` 依赖写进档案 `package.json` 并加入 `dsh.profile.bundles`。已经装过同一包名时先 `remove_bundle` 再装（否则会返回 `already-installed`）。`cordis.patch.yml` 会向档案 insert 一行 `id: inspirations`。

笔记保存在 `$DSH_HOME/inspirations/inspirations.db`（默认 `C:\Users\<你>\.dsh\inspirations\inspirations.db`），升级或重装插件不会动这份数据；旧的 `notes.json` 会在首次启动时自动迁移并留备份。

## 开发约束（踩过的坑）

- **左侧导航走核心 `slots` 服务**：`exports.inject = ['slots']`，在 `ctx.slots.inject('sidebar.panellist', …)` 里注册导航行，在 `ctx.slots.inject('main', …)` 里注册同 id 页面；`main` 的 key 必须等于 panellist 的 id。不要写进 `dsh.client.inject`（那是客户端模块依赖列表）。
- **纸墨色和界面色要分开**：`--insp-ink` 是便签纸上的深棕字色（深色主题也不反转），只能用在 `.insp-card` 里；板面上的标题、搜索框、编辑器、讨论气泡必须用 `--dsw-alias-label-*` / `--dsw-alias-border-*`，否则深色主题下就是深棕字画在深棕板上（踩过：编辑页正文一度完全看不见）。
- **`.insp-page` 不在 `.insp-root` 内**：全局 `box-sizing` 兜底只作用于 `.insp-root *`，`.insp-page` 自己写了 `height:100%` 就必须显式 `box-sizing:border-box`，否则 padding 会撑出视口、底部讨论输入框被裁掉。
- **客户端不要 `require()` 任何 `@deepseek-ai/dsh-client-*`**：client 模块表对第三方插件的 value-import 有纯度门。图标自绘 SVG。
- **宿主端不要 import `@deepseek-ai/dsh-llm`**：第三方插件从档案 `node_modules` 解析，官方包不保证可见；服务一律 `ctx.get()` 读取并降级，chunk 自行累积（`text-delta` → `chunk.text`）。
- **路由前缀必须唯一**：`/inspirations/api`。
- **存储只用内置 `node:sqlite`**：不要引 `better-sqlite3` 之类的原生模块（Electron ABI 与重装编译都麻烦）；schema 变更走 `meta.schema_version` 迁移，别在 `SCHEMA_V1` 之外手改老库。
- 笔记目录放在 `$DSH_HOME` 下而非工作区：灵感是全局的，且要能跨工作区读取。

## 视觉与动效规范（v11：满幅便签墙 + 叠纸编辑 + 图钉固定的下垂麻绳）

列表不再是「记事本行」，每张灵感是一张挂在横向麻绳上的便签，按行挂着：

- **满幅板面 + 边界**：左侧导航「灵感」进入；便签板占满主栏，但四周留一圈 `clamp(10px,1.4vw,16px)` 的桌面色（`--insp-desk`），板本身是 16px 圆角 + 一圈发丝描边 + 外投影——这样板的左右边缘有明确界线，不是一块没有边、和窗口糊在一起的面。便签 `flex-wrap` 从左到右依次挂好（`justify-content:flex-start`），行间距 `30px 18px`；窄到放不下两张时自动变单列。
- **纸**：6 组明亮纸色（暖黄 `#f8e6ae` / 珊瑚 `#f8c4b4` / 薄荷 `#cbe6c4` / 天蓝 `#c7ddf5` / 淡紫 `#dcd0f2` / 蜜桃 `#f9d7bc`，深色主题另给一组略深的同色系 `--insp-note-*`）按 `hash(id) % 6` 稳定分配，直接铺满纸面，不再和灰米色底混成发黑的颜色；卡片固定 `aspect-ratio: 4/3`（主页面 `flex-basis: 236px`，约 236×177），不再是被拉长的横条。倾角同样由 id 决定（±1.1°），悬停回正。右下角折角、上沿木夹子，都是纯 CSS。
- **叠纸编辑**：点开便签时列表留在原地、压暗（`--insp-scrim`），编辑纸从便签位置放大浮起（`.insp-overlay` + `.insp-sheet`），背后再露两张错位的纸边；纸面直接取这张便签的颜色（`--insp-editor-paper`），顶部挂同一枚木夹子，像把便签撕下来摊开到桌上写，而不是切到一个灰扑扑的文本框。编辑纸放大到主页面 `min(920px,100%)`、最小高度 `min(76%,640px)`（侧栏 `min(680px,100%)`、`min(66%,520px)`），正文编辑区最小 240px 高，不再是「一个小框」；窄到 440px 以下自动缩小标题字号、隐藏快捷键提示（容器查询）。
- **绳**：每一行便签一根**固定长度**的横向 SVG 麻绳，永远从板面左内边（26px）拉到右内边（26px），不随便签多少变长变短；两端各钉一枚黄铜**图钉**（圆钉头 + 高光 + 针脚 + 投影），不再是三圈绳结。绳穿过木夹子的**上半部分**（挂点比夹子中心高 4px，正好落在夹子顶部的凹槽上，夹子把绳压在下面），夹子夹住便签、便签挂在绳下。夹子与夹子之间没有支撑，绳只受重力**往下垂**（`min(12px, 间距 × 0.05)`，任何位置都不会向上鼓）；两端图钉到最近夹子、以及最后一张便签到右图钉的空绳段也会下垂（`min(30px, 边长 × 0.06)`），所以挂 1 张是一段吊床，挂 3 张是三次下垂，折叠、搜索、切主题、换窗口都会重新量并重挂。麻绳由三层叠出体积：底下深色加粗的阴影层（`--insp-rope-shade`，向下偏 1.1px）、中间麻绳主线、上面 0.6px 的高光层（向上偏 0.7px）；入场时绳子从左端开始画出来（`pathLength=1` + `stroke-dashoffset`），图钉随后淡入，木夹子会摆动一下；几何测量见 `data-rope-anchor` + `ResizeObserver` + 双 rAF + 460ms 兜底重测（避开入场动画）。行与行之间不共用绳，这样整行折起来时绳也跟着收起；`prefers-reduced-motion` 下所有入场动画关闭。
- **分组**：`置顶 / 今天 / 昨天 / 近 7 天 / 更早`，标题带折叠箭头、条数和一条虚线绳标；折叠后只留标题，不再挂绳。
- **背景**：整块板垫在一层桌面色（`--insp-desk`，亮 `#dfdbd0` / 暗 `#0f0f12`）上，四周留 10–16px 边、16px 圆角、发丝描边和外投影，左右有清晰边界；板本身是一张暖色点阵纸（主页面点阵取麻绳色 20%），深浅主题各自成立；页面上的搜索框、分组标题、编辑器外框、讨论区一律用主题字色/边线令牌，只有便签纸面（卡片、编辑纸）内才用纸墨色。
- **置顶**：不再用左侧 inset 竖条（那是旧版最丑的地方）；置顶 = 卡片右上角一枚红色图钉 + 进入最上方「置顶」分组。
- **标题**：卡片只显示一行标题（手写标题优先，否则正文首行；省略号截断），下面最多三行摘要（主页面），再一行时间/字数元信息；单行笔记没有摘要时保持留白。手写标题后摘要从正文第一行开始，不再重复标题。
- **字体**：便签标题、摘要、编辑器统一用 `--insp-hand`（霞鹜文楷 → 楷体 → Noto Serif 兜底）的手写栈；纸面字色固定 `--insp-card-ink`，不跟主题反转。
- **复制**：卡片悬停右上角出现复制按钮，编辑器底部也有「复制」；复制纯文本，走 `navigator.clipboard`，失败回退到隐藏 textarea + `execCommand`。

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
| `--insp-card-ink / -2 / -3` | 亮 `#3a3026`（后两级为透明度） | 纸面上的固定字色，卡片与叠纸编辑都取它 |
| `--insp-hand` | 霞鹜文楷 → 楷体 → Noto Serif 的字体栈 | 便签标题/摘要、编辑器标题与正文 |
| `--insp-scrim` | 亮 `rgba(54,40,24,.24)` / 暗 `rgba(8,6,4,.46)` | 叠纸编辑层的压暗底色 |
| `--insp-ink / -2 / -3` | 亮 `#2f2a20` / 暗 `#2b261d`（后两级为透明度） | 便签上的字色，不跟随界面明暗反转；只能出现在纸面内（卡片、编辑纸、讨论气泡里的引用块） |
| `--insp-rope / --insp-rope-hi` | 亮 `#a9824f` / 暗 `#9a7a4e` | 横向麻绳主线与高光 |
| `--insp-rope-shade` | 亮 `#6d5330` / 暗 `#4a3521` | 麻绳底下的深色阴影层，和主线错位 1px 做出圆柱体积 |
| `--insp-peg` | 亮 `#c59a63` / 暗 `#b08656` | 木夹子 |
| `--insp-board-surface` | 亮 `#f3eee1` / 暗 `#2b2721` | 主页面便签板的纸面 |
| `--insp-desk` | 亮 `#dfdbd0` / 暗 `#0f0f12` | 板子四周的桌面底色，衬出板面左右边界 |

色相 `c0..c5` 只给 `--note-paper` 赋值：6 组纸色是写死的低饱和高明度色板（便签本身就是实体纸，不跟主题色走），深色主题单独给一组略深的同色系，保证在深棕板上仍然是一张亮纸而非黑块；深色主题下纸上的 `--insp-ink` 不反转，保证字始终可读。

已实现的规则：发丝线（含 dpr 自适应）、tabular-nums、`min-width:0` 全局兜底、内层圆角 `calc(外层 - padding)`、容器有分隔线时内部按钮/输入框 ghost 化、深色模式字重补偿（`is-dark` + `font-variation-settings`）、曲线/时长令牌、`prefers-reduced-motion` 降级、讨论区自动跟随的 150ms 用户意图保护（距离 >1 行才停跟随，直接写 `scrollTop` 而非 smooth）、滚动容器 7 档非线性渐隐遮罩（触顶/触底该端归零）。

不适用的规则（本项目没有对应交互）：拖拽死区、分栏拖动/双击复位、画布缩放锚点 —— 插件里没有拖拽、分栏和画布。`pnpm` 依赖保持为零新增。

截图（用真实客户端模块 + 桩数据在无头 Edge 里渲染，非手绘示意）：

- `docs/preview-page.png` 左侧导航打开的便签板主页面（深色，满幅）
- `docs/preview-page-light.png` 便签板主页面（浅色）
- `docs/preview-page-many.png` 主页面 20 条笔记滚动到底：「近 7 天」与自动折叠的「更早」
- `docs/preview-page-edit.png` 主页面点开便签：压暗列表、叠纸编辑浮起，编辑纸面 = 这张便签的颜色，可直接「讨论」
- `docs/preview-page-edit-light.png` 浅色主题下的叠纸编辑
- `docs/preview-list.png` 侧栏便签墙（深色）
- `docs/preview-light.png` 侧栏便签墙（浅色，验证纸色/墨色/麻绳在亮色主题下仍成立）
- `docs/preview-many.png` 侧栏 20 条笔记滚动到底
- `docs/preview-edit.png` 侧栏编辑器（同样铺便签纸色）
- `docs/preview-discuss.png` 讨论页

生成/复查：`node .scratch/make-preview.cjs [--light|--many|--page]` → `.scratch/preview[-light|-many|-page].html`，再用 `msedge --headless=new --screenshot` 截图（需要 `.scratch/rtest` 里的 react UMD 构建；`?v=bottom|expand` 可截滚动到底部/展开分组的状态，`?v=geo|geobottom` 会打出布局几何，`?v=edit|discuss` 直接截编辑器/讨论页，`?v=flat` 会关掉入场动画以便截到叠纸编辑的最终状态）。

校验脚本：`node .scratch/ui-rules.test.cjs`（在 jsdom 里跑客户端、取注入的 CSS 做规则体检）。

## 测试

```bash
node tests/host.test.mjs
```

覆盖：空库、新建/更新/手写标题固定与清空回落/只有标题的便签/置顶排序/空内容拒绝/删除/未知方法 404/非 POST 404、模型路由三级回落、讨论请求的上下文拼装与回复累积。
