/**
 * 灵感记事本 · 宿主端（dsh-inspirations）
 *
 * 职责：
 *  - 灵感笔记的持久化：`$DSH_HOME/inspirations/notes.json`（原子写，与工作区无关，
 *    任何会话、任何工作区都能看到同一份笔记）；
 *  - 客户端 RPC：`POST /inspirations/api/<method>`（同源 HTTP，重启后依然生效）；
 *  - 「和 AI 讨论」：读取当前会话正在使用的模型路由，经 `llm` 服务完成一次讨论轮次。
 *
 * 刻意不 import 任何 `@deepseek-ai/*` 包：第三方插件从档案的 node_modules 解析，
 * 官方包不一定可解析；所有服务一律经 `ctx.get()` 读取并对缺失做降级。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'dsh-inspirations'

// 只硬依赖 webServer；llm / agents / sessions 等按需读取，缺失时返回可读错误。
export const inject = ['webServer']

/** 单条灵感正文上限（字符）。 */
const MAX_TEXT = 200_000
/** 手写标题上限（字符）。 */
const MAX_TITLE = 120
/** 讨论请求体上限（字节），防止一次塞入过多历史。 */
const MAX_BODY_BYTES = 4_000_000
/** 一次讨论轮次的超时与输出预算。 */
const DISCUSS_TIMEOUT_MS = 120_000
const DISCUSS_MAX_TOKENS = 2048
/** 讨论时附带给模型的历史轮数上限。 */
const DISCUSS_HISTORY_LIMIT = 20

/** DSH 主目录：环境变量优先，回落 `~/.dsh`。 */
function dshHome() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  return join(homedir(), '.dsh')
}

function storeFile() {
  return join(dshHome(), 'inspirations', 'notes.json')
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value, max) {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\u0000/g, '')
  return max === undefined || text.length <= max ? text : text.slice(0, max)
}

/** 标题取正文第一行有效内容，去掉 Markdown 前缀。 */
function titleOf(text) {
  const line = String(text)
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  if (line === undefined) return '未命名灵感'
  const cleaned = line.replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s+/, '').trim()
  return cleaned.length > 60 ? cleaned.slice(0, 60) + '…' : cleaned || '未命名灵感'
}

function normalizeNote(raw) {
  const now = Date.now()
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
  const text = str(raw.text, MAX_TEXT)
  const manualTitle = str(raw.title, MAX_TITLE).trim()
  // 老数据没有 titleAuto：默认按“首行即标题”继续推导；客户端手写标题时显式传 false。
  const titleAuto = raw.titleAuto !== false || manualTitle === ''
  return {
    id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : 'note-' + randomUUID(),
    text,
    title: titleAuto ? titleOf(text) : manualTitle,
    titleAuto,
    pinned: raw.pinned === true,
    createdAt,
    updatedAt,
  }
}

function isNote(value) {
  return isRecord(value) && typeof value.text === 'string'
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

async function readStore() {
  const file = storeFile()
  try {
    const text = await readFile(file, 'utf8')
    const parsed = JSON.parse(text)
    const list = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.notes) ? parsed.notes : []
    return { version: 1, notes: list.filter(isNote).map(normalizeNote) }
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code !== 'ENOENT') {
      console.warn('[inspirations] 笔记读取失败：' + String(error.message ?? error))
    }
    return { version: 1, notes: [] }
  }
}

async function writeStore(store) {
  const file = storeFile()
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp'
  await writeFile(tmp, JSON.stringify({ version: 1, notes: store.notes }, null, 2), 'utf8')
  await rename(tmp, file)
}

async function readJsonBody(req) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  const parsed = JSON.parse(text)
  return isRecord(parsed) ? parsed : {}
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/**
 * 解析当前会话正在使用的 provider/model 路由，三级回落：
 * 活体 agent 的 options → 会话日志里最新的 `request/header` → 全局默认模型。
 */
function resolveRoute(ctx, sessionId) {
  if (typeof sessionId === 'string' && sessionId !== '') {
    const agents = ctx.get('agents')
    const live = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
    const options = live?.options
    if (isRecord(options) && typeof options.provider === 'string' && options.provider !== ''
      && typeof options.model === 'string' && options.model !== '') {
      return { provider: options.provider, model: options.model, source: 'session' }
    }
    const sessions = ctx.get('sessions')
    const session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : undefined
    if (Array.isArray(events)) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index]
        if (!isRecord(event) || event.type !== 'request/header') continue
        const config = event.data?.header?.config
        if (!isRecord(config)) continue
        if (typeof config.provider === 'string' && config.provider !== ''
          && typeof config.model === 'string' && config.model !== '') {
          return { provider: config.provider, model: config.model, source: 'session-log' }
        }
      }
    }
  }
  const defaults = ctx.get('agentDefaultModel')
  const selection = typeof defaults?.currentSelection === 'function' ? defaults.currentSelection() : undefined
  if (isRecord(selection) && typeof selection.provider === 'string' && selection.provider !== ''
    && typeof selection.model === 'string' && selection.model !== '') {
    return { provider: selection.provider, model: selection.model, source: 'default' }
  }
  return undefined
}

function systemPromptFor(contextNotes) {
  return [
    '你是「灵感讨论」伙伴，帮助用户把他随手记下的灵感想清楚。',
    '原则：',
    '1. 先用一两句话复述你理解到的核心想法，确认没有会错意；',
    '2. 再给出具体的推进建议：可能的形态、下一步动作、潜在风险或反例；',
    '3. 信息不足时直接提出关键问题，不要编造事实；',
    '4. 用简体中文回答，语气像并肩思考的同事，不要客套话和空泛的赞美；',
    '5. 适度使用短列表，避免长篇大论；用户问得很短时你也答得短。',
    contextNotes.length === 0 ? '本轮没有附带灵感正文。' : '',
  ].filter((part) => part !== '').join('\n')
}

function buildDiscussionPrompt(notes, messages) {
  const parts = []
  if (notes.length > 0) {
    parts.push('【我选中的灵感】')
    notes.forEach((note, index) => {
      parts.push(`--- 灵感 ${index + 1}（${titleOf(note)}）---`)
      parts.push(str(note, MAX_TEXT))
    })
  }
  const history = Array.isArray(messages) ? messages.slice(-DISCUSS_HISTORY_LIMIT * 2) : []
  const turns = history
    .filter((message) => isRecord(message) && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => (message.role === 'user' ? '我：' : '你：') + str(message.text, 20_000).trim())
    .filter((line) => line !== '我：' && line !== '你：')
  if (turns.length > 0) {
    parts.push('【到目前为止的讨论】')
    parts.push(turns.join('\n\n'))
  }
  const last = turns.length > 0 ? turns[turns.length - 1] : ''
  if (turns.length === 0) {
    parts.push('【请开始】先复述你理解到的核心想法，再给出 2-3 条具体的推进建议。')
  } else if (last.startsWith('我：')) {
    parts.push('请回答上面「我」的最后一条。')
  }
  return parts.join('\n\n')
}

export function apply(ctx) {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) {
    console.warn('[inspirations] webServer 服务不可用，客户端接口未注册')
    return
  }

  async function listNotes() {
    const store = await readStore()
    return { ok: true, notes: sortNotes(store.notes), path: storeFile() }
  }

  async function saveNote(args) {
    const text = str(args.text, MAX_TEXT)
    const id = typeof args.id === 'string' && args.id !== '' ? args.id : ''
    const store = await readStore()
    const now = Date.now()
    const existingIndex = id === '' ? -1 : store.notes.findIndex((note) => note.id === id)
    const existing = existingIndex >= 0 ? store.notes[existingIndex] : undefined
    const title = typeof args.title === 'string' ? str(args.title, MAX_TITLE).trim() : existing?.title
    const titleAuto = typeof args.titleAuto === 'boolean' ? args.titleAuto : existing?.titleAuto
    if (text.trim() === '' && String(title ?? '').trim() === '' && existingIndex < 0) {
      return { ok: false, error: '灵感不能为空' }
    }
    let note
    if (existing !== undefined) {
      note = normalizeNote({
        ...existing,
        text,
        title: title ?? existing.title,
        titleAuto: titleAuto ?? existing.titleAuto,
        pinned: typeof args.pinned === 'boolean' ? args.pinned : existing.pinned,
        updatedAt: now,
      })
      store.notes[existingIndex] = note
    } else {
      note = normalizeNote({
        id: id !== '' ? id : 'note-' + randomUUID(),
        text,
        title: title ?? '',
        titleAuto: titleAuto ?? true,
        pinned: args.pinned === true,
        createdAt: now,
        updatedAt: now,
      })
      store.notes.push(note)
    }
    await writeStore(store)
    return { ok: true, note, notes: sortNotes(store.notes) }
  }

  async function removeNote(args) {
    const id = typeof args.id === 'string' ? args.id : ''
    if (id === '') return { ok: false, error: '缺少灵感 id' }
    const store = await readStore()
    const notes = store.notes.filter((note) => note.id !== id)
    if (notes.length === store.notes.length) return { ok: false, error: '灵感不存在（可能已被删除）' }
    await writeStore({ version: 1, notes })
    return { ok: true, notes: sortNotes(notes) }
  }

  async function routeInfo(args) {
    const route = resolveRoute(ctx, typeof args.sessionId === 'string' ? args.sessionId : '')
    if (route === undefined) return { ok: false, error: '当前会话还没有可用的模型路由' }
    return { ok: true, route: { provider: route.provider, model: route.model, source: route.source } }
  }

  async function discuss(args) {
    const llm = ctx.get('llm')
    if (llm === undefined || typeof llm.stream !== 'function') {
      return { ok: false, error: 'llm 服务不可用，无法发起讨论' }
    }
    const route = resolveRoute(ctx, typeof args.sessionId === 'string' ? args.sessionId : '')
    if (route === undefined) return { ok: false, error: '没有可用的模型，请先在主对话里发一条消息再试' }
    const notes = (Array.isArray(args.notes) ? args.notes : [])
      .map((note) => str(note, MAX_TEXT))
      .filter((note) => note.trim() !== '')
    const messages = Array.isArray(args.messages) ? args.messages : []
    const prompt = buildDiscussionPrompt(notes, messages)
    const request = {
      provider: route.provider,
      model: route.model,
      system: systemPromptFor(notes),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: DISCUSS_MAX_TOKENS,
      signal: AbortSignal.timeout(DISCUSS_TIMEOUT_MS),
    }
    let reply = ''
    const startedAt = Date.now()
    try {
      for await (const chunk of llm.stream(request)) {
        if (isRecord(chunk) && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          reply += chunk.text
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: '讨论失败：' + message, route: { provider: route.provider, model: route.model } }
    }
    const text = reply.trim()
    if (text === '') return { ok: false, error: '模型没有返回内容，请重试' }
    return {
      ok: true,
      reply: text,
      route: { provider: route.provider, model: route.model, source: route.source },
      elapsedMs: Date.now() - startedAt,
    }
  }

  const dispatch = {
    'notes.list': listNotes,
    'notes.save': saveNote,
    'notes.remove': removeNote,
    'discuss': discuss,
    'route.info': routeInfo,
  }

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/inspirations/api',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const method = (url.pathname.replace(/^\/inspirations\/api\/?/, '')).replace(/\/+$/, '')
      const fn = Object.hasOwn(dispatch, method) ? dispatch[method] : undefined
      if (fn === undefined || req.method !== 'POST') {
        sendJson(res, 404, { ok: false, error: 'no such route: ' + req.method + ' /' + method })
        return
      }
      try {
        const args = await readJsonBody(req)
        sendJson(res, 200, await fn(args))
      } catch (error) {
        sendJson(res, 200, { ok: false, error: String(error instanceof Error ? error.message : error) })
      }
    },
  }))

  console.log('[inspirations] 已加载，笔记文件：' + storeFile())
}
