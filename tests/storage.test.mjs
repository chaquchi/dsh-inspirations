/**
 * 存储层回归测试：SQLite 建库、schema v1、从老 notes.json 迁移、软删除。
 *
 * 运行：node tests/storage.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const home = await mkdtemp(join(tmpdir(), 'inspirations-storage-'))
process.env.DSH_HOME = home
const dir = join(home, 'inspirations')
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'notes.json'), JSON.stringify({
  version: 1,
  notes: [
    { id: 'note-old-1', text: '老笔记一', title: '老笔记一', titleAuto: true, pinned: false, createdAt: 1000, updatedAt: 1000 },
    { id: 'note-old-2', text: '正文', title: '手写标题', titleAuto: false, pinned: true, createdAt: 2000, updatedAt: 2000 },
  ],
}), 'utf8')

const mod = await import('../lib/index.js?storage=' + Date.now())

let handler
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
    return undefined
  },
  effect(fn) {
    return fn()
  },
}

mod.apply(ctx)
assert.equal(typeof handler, 'function', 'routes registered')

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

async function call(method, body) {
  const res = fakeResponse()
  await handler(fakeRequest('/inspirations/api/' + method, body), res)
  assert.equal(res.status, 200)
  return res.payload
}

// 1. 首次打开：建库 + 从 notes.json 迁移
const first = await call('notes.list')
assert.equal(first.ok, true)
assert.equal(first.engine, 'sqlite')
assert.ok(first.path.endsWith('inspirations.db'))
assert.equal(first.notes.length, 2, 'legacy notes imported')
assert.equal(first.notes[0].id, 'note-old-2', 'pinned legacy note sorts first')
assert.equal(first.notes[0].title, '手写标题', 'manual title survives migration')
assert.equal(first.notes[0].titleAuto, false)

// 老 JSON 被改名备份，避免二次导入
const entries = await readdir(dir)
assert.equal(entries.includes('notes.json'), false, 'legacy json renamed after import')
assert.ok(entries.some((name) => name.startsWith('notes.json.imported-')), 'legacy json kept as backup')

// 2. 新建 / 更新 / 删除（软删除）
const created = await call('notes.save', { text: '# 新想法\n正文', titleAuto: true })
assert.equal(created.ok, true)
assert.equal(created.note.title, '新想法')
assert.equal(created.notes.length, 3)
const id = created.note.id

const updated = await call('notes.save', { id, text: '新想法\n改过', pinned: true })
assert.equal(updated.note.pinned, true)
assert.equal(updated.notes[0].id, id)

const removed = await call('notes.remove', { id })
assert.equal(removed.ok, true)
assert.equal(removed.notes.length, 2)

// 3. 软删除：行还在，只是 deleted_at 非空
{
  const db = new DatabaseSync(join(dir, 'inspirations.db'))
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n)
  const live = Number(db.prepare('SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL').get().n)
  const schema = Number(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value)
  assert.equal(total, 3, 'soft deleted row is kept')
  assert.equal(live, 2)
  assert.equal(schema, 1, 'schema version recorded')
  db.close()
}

// 4. 重启后仍可读（关闭再打开同一目录）
await mod.closeStore()
const reopened = await import('../lib/index.js?storage=' + Date.now() + 'b')
reopened.apply(ctx)
const afterRestart = await call('notes.list')
assert.equal(afterRestart.notes.length, 2, 'data survives restart')

await reopened.closeStore()
await rm(home, { recursive: true, force: true })
console.log('storage tests passed')
