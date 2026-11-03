/**
 * 安装后自检：确认宿主路由已在运行中的 DSH 上注册。
 * 用法：node tests/live.mjs [http://127.0.0.1:4116]
 *
 * 注意：新增 bundle 需要重启 DSH 才会挂载；重启前本脚本会提示 405/404。
 */

const origin = process.argv[2] || process.env.DSH_WEB_URL || 'http://127.0.0.1:4116'
const url = origin.replace(/\/+$/, '') + '/inspirations/api/notes.list'

const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})

if (response.status === 405 || response.status === 404) {
  console.log('✗ 路由未挂载（HTTP ' + response.status + '）— 新增 bundle 后需要重启 DSH 再试。')
  process.exit(1)
}

if (!response.ok) {
  console.log('✗ HTTP ' + response.status + '：' + (await response.text()).slice(0, 200))
  process.exit(1)
}

const payload = await response.json()
if (!payload || payload.ok !== true) {
  console.log('✗ 宿主返回失败：' + JSON.stringify(payload).slice(0, 200))
  process.exit(1)
}

const notes = Array.isArray(payload.notes) ? payload.notes : []
console.log('✓ 路由已挂载 ' + url)
console.log('  笔记文件：' + payload.path)
console.log('  笔记数量：' + notes.length)
for (const note of notes.slice(0, 5)) {
  console.log('   - ' + (note.pinned ? '★ ' : '') + note.title + '（' + note.text.length + ' 字）')
}
console.log(notes.length === 0 ? '  （空库：打开侧边栏「灵感」标签写第一条）' : '')
