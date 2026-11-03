/**
 * 宿主端回归测试：不启动 DSH，用假的 ctx / req / res 驱动 `apply()` 注册的路由，
 * 覆盖笔记的增删改查与「和 AI 讨论」的模型路由回落。
 *
 * 运行：node tests/host.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'inspirations-test-'))
process.env.DSH_HOME = home

const { apply } = await import('../lib/index.js')

function fakeRequest(url, body) {
  return {
    method: 'POST',
    url,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body ?? {}), 'utf8')
    },
  }
}

function fakeResponse() {
  return {
    status: 0,
    payload: undefined,
    writeHead(status) {
      this.status = status
    },
    end(text) {
      this.payload = JSON.parse(text)
    },
  }
}

let handler
let llmRequests = []
const llm = {
  async *stream(request) {
    llmRequests.push(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: '这个想法可以先写一页' }
    yield { type: 'text-delta', index: 0, text: '最小原型。' }
    yield { type: 'finish', reason: 'stop' }
  },
}

const ctx = {
  get(name) {
    if (name === 'webServer') {
      return {
        register(spec) {
          handler = spec.handler
          return () => {}
        },
      }
    }
    if (name === 'llm') return llm
    if (name === 'agents') {
      return {
        get(id) {
          return id === 'live-session'
            ? { options: { provider: 'deepseek-account', model: 'deepseek-flash' } }
            : undefined
        },
      }
    }
    if (name === 'sessions') {
      return {
        get(id) {
          if (id !== 'logged-session') return undefined
          return {
            snapshotEvents() {
              return [
                { type: 'request/header', data: { header: { config: { provider: 'opencode-go', model: 'glm-4.6' } } } },
              ]
            },
          }
        },
      }
    }
    if (name === 'agentDefaultModel') {
      return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
    }
    return undefined
  },
  effect(fn) {
    return fn()
  },
  plugin() {},
  logger: { warn() {}, info() {} },
}

apply(ctx)
assert.equal(typeof handler, 'function', 'routes registered')

async function call(method, body) {
  const res = fakeResponse()
  await handler(fakeRequest('/inspirations/api/' + method, body), res)
  assert.equal(res.status, 200, method + ' should answer 200')
  return res.payload
}

// 空库
const initial = await call('notes.list')
assert.deepEqual(initial.notes, [])
assert.ok(initial.path.includes('inspirations'), 'store path is namespaced under DSH_HOME')

// 新建
const created = await call('notes.save', { text: '# 灵感一\n想法正文' })
assert.equal(created.ok, true)
assert.equal(created.note.title, '灵感一')
const id = created.note.id
assert.equal(created.notes.length, 1)

// 更新
const updated = await call('notes.save', { id, text: '灵感一\n改过的正文' })
assert.equal(updated.note.text, '灵感一\n改过的正文')
assert.equal(updated.notes.length, 1)

// 手写标题：titleAuto=false 后标题固定，不随正文变化
const manual = await call('notes.save', { id, text: '这是正文\n第二行', title: '手写标题', titleAuto: false })
assert.equal(manual.note.title, '手写标题')
assert.equal(manual.note.titleAuto, false)
const renamed = await call('notes.save', { id, text: '正文改了' })
assert.equal(renamed.note.title, '手写标题', '手写标题不会被正文覆盖')
// 清空标题回到自动模式：标题重新取正文第一行
const autoAgain = await call('notes.save', { id, text: '新的第一行\n正文', title: '', titleAuto: true })
assert.equal(autoAgain.note.title, '新的第一行')
assert.equal(autoAgain.note.titleAuto, true)
// 只有标题、没有正文也允许保存
const titleOnly = await call('notes.save', { text: '', title: '只有标题', titleAuto: false })
assert.equal(titleOnly.ok, true)
assert.equal(titleOnly.note.title, '只有标题')
await call('notes.remove', { id: titleOnly.note.id })

// 置顶排序
const second = await call('notes.save', { text: '第二条' })
const pinned = await call('notes.save', { id: second.note.id, text: '第二条', pinned: true })
assert.equal(pinned.notes[0].id, second.note.id, 'pinned note sorts first')

// 空内容不允许新建
const rejected = await call('notes.save', { text: '   ' })
assert.equal(rejected.ok, false)

// 删除
const removed = await call('notes.remove', { id: second.note.id })
assert.equal(removed.ok, true)
assert.equal(removed.notes.length, 1)

// 未知方法 / 非 POST
{
  const res = fakeResponse()
  await handler(fakeRequest('/inspirations/api/nope', {}), res)
  assert.equal(res.status, 404)
}
{
  const res = fakeResponse()
  await handler({ method: 'GET', url: '/inspirations/api/notes.list' }, res)
  assert.equal(res.status, 404)
}

// 模型路由：活体 agent → 会话日志 → 默认
assert.deepEqual((await call('route.info', { sessionId: 'live-session' })).route, {
  provider: 'deepseek-account', model: 'deepseek-flash', source: 'session',
})
assert.deepEqual((await call('route.info', { sessionId: 'logged-session' })).route, {
  provider: 'opencode-go', model: 'glm-4.6', source: 'session-log',
})
assert.deepEqual((await call('route.info', { sessionId: 'unknown' })).route, {
  provider: 'deepseek-account', model: 'deepseek-flash', source: 'default',
})

// 讨论：把选中的灵感、历史与问题合并成一次请求，并回传模型解答
const discussion = await call('discuss', {
  sessionId: 'live-session',
  notes: ['灵感一\n改过的正文'],
  messages: [{ role: 'user', text: '这个方向可行吗？' }],
})
assert.equal(discussion.ok, true)
assert.equal(discussion.reply, '这个想法可以先写一页最小原型。')
assert.equal(discussion.route.provider, 'deepseek-account')
assert.equal(llmRequests.length, 1)
const sent = llmRequests[0]
assert.equal(sent.provider, 'deepseek-account')
assert.equal(sent.model, 'deepseek-flash')
assert.ok(sent.system.includes('灵感讨论'))
const promptText = sent.messages[0].content[0].text
assert.ok(promptText.includes('改过的正文'), 'selected note body travels with the request')
assert.ok(promptText.includes('可行吗'), 'conversation history travels with the request')

await rm(home, { recursive: true, force: true })
console.log('host tests passed')
