/**
 * 灵感记事本 · 客户端（@local/inspirations）
 *
 * 形态：dsh-better-sidebar 的一个侧边栏 tab（`inspirations:notebook`）。
 * 加载：DSH client 模块表按 `window.__ModuleLoader__.load` 的经典脚本形态加载本文件，
 *       React 由 `require('react')` 注入（不 import 任何官方 client 包，避开纯度门）。
 * 数据：同源 HTTP `POST /inspirations/api/<method>`，笔记全局存放于 `$DSH_HOME/inspirations`。
 */
window.__ModuleLoader__.load({ id: '@local/inspirations', factory: (require) => {
  'use strict'
  var module = { exports: {} }
  var exports = module.exports

  var React = require('react')
  var h = React.createElement
  var useState = React.useState
  var useEffect = React.useEffect
  var useRef = React.useRef
  var useMemo = React.useMemo
  var useCallback = React.useCallback

  var SAVE_DEBOUNCE_MS = 700

  /** 发丝线宽度：按 devicePixelRatio 取 1px / 0.5px / 1/3px，避免 1px 线被二次插值。 */
  function hairline() {
    var ratio = typeof window === 'undefined' || !window.devicePixelRatio ? 1 : window.devicePixelRatio
    if (!(ratio > 1)) return '1px'
    var px = Math.max(0.25, Math.round((1 / ratio) * 10000) / 10000)
    return String(px) + 'px'
  }

  /** 当前主题是否为深色：读 body 计算背景亮度，不依赖固定的媒体查询。 */
  function isDarkTheme() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return true
    var style = window.getComputedStyle(document.body)
    var raw = style && style.backgroundColor ? style.backgroundColor : ''
    var parts = raw.match(/[\d.]+/g)
    if (!parts || parts.length < 3) return true
    var luminance = (0.2126 * Number(parts[0]) + 0.7152 * Number(parts[1]) + 0.0722 * Number(parts[2])) / 255
    return luminance < 0.5
  }


  /** 文档相对路径：GUI 以 `<base href="./">` 提供页面，根绝对路径在子路径部署下会失效。 */
  function apiUrl(method) {
    var base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : 'http://localhost/'
    return new URL('inspirations/api/' + method, base).toString()
  }

  function api(method, args) {
    return fetch(apiUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    }).then(function (res) {
      if (!res.ok) return Promise.reject(new Error('HTTP ' + res.status))
      return res.json().then(function (value) {
        if (value && value.ok === false) return Promise.reject(new Error(value.error || '请求失败'))
        return value
      })
    })
  }

  function injectStyles(css) {
    if (typeof document === 'undefined') return
    var style = document.querySelector('style[data-plugin="@local/inspirations"]')
    if (style === null) {
      style = document.createElement('style')
      style.setAttribute('data-plugin', '@local/inspirations')
      document.head.appendChild(style)
    }
    if (style.textContent !== css) style.textContent = css
  }

  function BulbIcon(props) {
    var size = props && props.size ? props.size : 16
    return h('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
      strokeLinejoin: 'round', 'aria-hidden': true,
    },
      h('path', { d: 'M8 1.6a4.1 4.1 0 0 0-2.4 7.4c.5.4.8 1 .8 1.6v.5h3.2v-.5c0-.6.3-1.2.8-1.6A4.1 4.1 0 0 0 8 1.6z' }),
      h('path', { d: 'M6.4 13h3.2' }),
      h('path', { d: 'M7 14.4h2' })
    )
  }

  function CheckIcon(props) {
    var size = props && props.size ? props.size : 12
    return h('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true',
    }, h('path', { d: 'M3.3 8.4l3.1 3.1 6.3-6.8' }))
  }

  function PinIcon(props) {
    var size = props && props.size ? props.size : 12
    return h('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
      h('path', { d: 'M5.9 2h4.2l-.6 3.4 1.9 1.9-1.2 1.2H5.8L4.6 7.3l1.9-1.9z' }),
      h('path', { d: 'M8 8.5v5' })
    )
  }

  function SearchIcon(props) {
    var size = props && props.size ? props.size : 12
    return h('svg', {
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round',
      'aria-hidden': 'true',
    },
      h('circle', { cx: 7, cy: 7, r: 4.2 }),
      h('path', { d: 'M10.2 10.2L13.4 13.4' })
    )
  }

  function ChevronIcon(props) {
    var size = props && props.size ? props.size : 10
    return h('svg', {
      className: 'insp-chevron',
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true',
    }, h('path', { d: 'M3.5 6l4.5 4.5L12.5 6' }))
  }

  var CSS = [
    /* ---- 令牌层：曲线/时长/发丝线/表面色，组件内不写字面值 ---- */
    '.insp-root{--insp-hair:__HAIR__;--insp-ease-out:cubic-bezier(.22,1,.36,1);--insp-ease-in:cubic-bezier(.55,0,1,.45);--insp-ease-spring:cubic-bezier(.34,1.42,.64,1);--insp-dur-1:120ms;--insp-dur-2:200ms;--insp-dur-3:300ms;--insp-stagger:18ms;--insp-line:var(--dsw-alias-border-l1,rgba(128,128,128,.22));--insp-line-strong:var(--dsw-alias-border-l2,rgba(128,128,128,.34));--insp-surface:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));--insp-surface:color-mix(in srgb,var(--dsw-alias-bg-base,#1b1b1f) 94%,var(--dsw-alias-label-primary,#e6e6e6));--insp-surface-hover:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.14));--insp-surface-hover:color-mix(in srgb,var(--dsw-alias-bg-base,#1b1b1f) 88%,var(--dsw-alias-label-primary,#e6e6e6));--insp-surface-active:var(--dsw-alias-interactive-bg-hover-accent,rgba(77,107,254,.14));--insp-surface-active:color-mix(in srgb,var(--dsw-alias-bg-base,#1b1b1f) 84%,var(--dsw-alias-brand-primary,#4d6bfe));--insp-bubble-user:color-mix(in srgb,var(--dsw-alias-bg-base,#1b1b1f) 90%,var(--dsw-alias-brand-primary,#4d6bfe));--insp-accent:var(--dsw-alias-brand-primary,#4d6bfe);--insp-spine:var(--dsw-alias-state-warn-primary,#e0a34a);--insp-ink:#2f2a20;--insp-ink-2:rgba(47,42,32,.64);--insp-ink-3:rgba(47,42,32,.46);--insp-rope:#a9824f;--insp-rope-hi:#dcc094;--insp-peg:#c59a63;--insp-board-surface:#f3eee1;--insp-note-0:#f8e6ae;--insp-note-1:#f8c4b4;--insp-note-2:#cbe6c4;--insp-note-3:#c7ddf5;--insp-note-4:#dcd0f2;--insp-note-5:#f9d7bc;--insp-fade:14px;display:flex;flex-direction:column;flex:1;width:100%;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-base,#1b1b1f);font-size:12px;line-height:1.5}',
    /* 深色主题：纸色压暗、墨色仍取深色，便签在暗色侧栏里保持“纸”的实物感 */
    '.insp-root.is-dark{--insp-ink:#2b261d;--insp-ink-2:rgba(43,38,29,.66);--insp-ink-3:rgba(43,38,29,.48);--insp-rope:#9a7a4e;--insp-rope-hi:#c7aa7c;--insp-peg:#b08656;--insp-board-surface:#2b2721;--insp-note-0:#f2d68c;--insp-note-1:#f3b7a3;--insp-note-2:#bcdcae;--insp-note-3:#b7d3f0;--insp-note-4:#d2c2ee;--insp-note-5:#f5c8a4}',
    '.insp-root *{box-sizing:border-box;min-width:0}',

    '.insp-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;flex:0 0 auto;box-shadow:inset 0 calc(-1 * var(--insp-hair)) 0 var(--insp-line)}',
    '.insp-title{display:flex;align-items:center;gap:6px;margin-right:auto;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary,#e6e6e6);min-width:0;overflow-wrap:anywhere}',
    '.insp-root.is-dark .insp-title,.insp-root.is-dark .insp-card-title{font-weight:500;font-variation-settings:"wght" 460}',
    '.insp-title>svg{flex:0 0 auto;color:var(--insp-spine)}',
    '.insp-pill{min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:var(--insp-surface-hover);color:var(--dsw-alias-label-tertiary,#8b8b93);font-size:10px;font-weight:500;font-variant-numeric:tabular-nums;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}',
    '.insp-count{font-weight:400;color:var(--dsw-alias-label-tertiary,#8b8b93);font-size:11px;font-variant-numeric:tabular-nums}',

    /* 按钮：ghost 底 + 发丝线，只有 hover 才亮起 */
    '.insp-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:24px;padding:0 8px;border:0;border-radius:6px;background:var(--insp-surface);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line);color:var(--dsw-alias-label-primary,#e6e6e6);cursor:pointer;font-size:11px;white-space:nowrap;font-family:inherit;transition:background var(--insp-dur-1) var(--insp-ease-out),box-shadow var(--insp-dur-1) var(--insp-ease-out),color var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-btn:hover:not(:disabled){background:var(--insp-surface-hover);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line-strong)}',
    '.insp-btn:active:not(:disabled){transform:scale(.98)}',
    '.insp-btn:disabled{opacity:.45;cursor:default}',
    '.insp-btn-primary{border:0;background:var(--dsw-alias-button-primary-fill,#4d6bfe);box-shadow:none;color:#fff}',
    '.insp-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill,#4d6bfe);filter:brightness(1.08);box-shadow:none}',
    '.insp-btn.is-accent{border:0;background:var(--insp-surface-active);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-accent);color:var(--insp-accent)}',
    '.insp-btn.is-accent:hover:not(:disabled){background:var(--insp-surface-active)}',
    '.insp-btn-icon{width:24px;padding:0;font-size:14px;line-height:1}.insp-btn.is-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#f16a6a) 14%,transparent);color:var(--dsw-alias-state-error-primary,#f16a6a)}',
    /* 栏内按钮：容器已经有分隔线，按钮退成无边框 ghost */
    '.insp-bar .insp-btn:not(.insp-btn-primary):not(.is-accent){background:transparent;box-shadow:none}',
    '.insp-bar .insp-btn:not(.insp-btn-primary):not(.is-accent):hover{background:var(--insp-surface-hover)}',

    '.insp-search{position:relative;margin:8px 10px 2px;flex:0 0 auto}',
    '.insp-search>svg{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-tertiary,#8b8b93);pointer-events:none}',
    '.insp-search input{width:100%;height:28px;padding:0 9px 0 27px;border:0;border-radius:8px;background:var(--insp-surface);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line);color:inherit;font-size:12px;font-family:inherit;outline:none;transition:background var(--insp-dur-1) var(--insp-ease-out),box-shadow var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-search input::placeholder{color:var(--dsw-alias-label-tertiary,#8b8b93)}',
    '.insp-search input:hover{box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line-strong)}',
    '.insp-search input:focus{background:var(--insp-surface-hover);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-accent)}',

    /* 滚动容器：7 档非线性渐隐遮罩，触顶/触底时对应端归零 */
    '.insp-scrollable{overflow:auto;flex:1;min-height:0;-webkit-mask-image:linear-gradient(to bottom,transparent 0,rgba(0,0,0,.06) 2px,rgba(0,0,0,.2) 4px,rgba(0,0,0,.45) 6px,rgba(0,0,0,.7) 9px,rgba(0,0,0,.9) 11px,#000 14px,#000 calc(100% - 14px),rgba(0,0,0,.9) calc(100% - 11px),rgba(0,0,0,.7) calc(100% - 9px),rgba(0,0,0,.45) calc(100% - 6px),rgba(0,0,0,.2) calc(100% - 4px),rgba(0,0,0,.06) calc(100% - 2px),transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,rgba(0,0,0,.06) 2px,rgba(0,0,0,.2) 4px,rgba(0,0,0,.45) 6px,rgba(0,0,0,.7) 9px,rgba(0,0,0,.9) 11px,#000 14px,#000 calc(100% - 14px),rgba(0,0,0,.9) calc(100% - 11px),rgba(0,0,0,.7) calc(100% - 9px),rgba(0,0,0,.45) calc(100% - 6px),rgba(0,0,0,.2) calc(100% - 4px),rgba(0,0,0,.06) calc(100% - 2px),transparent 100%)}',
    '.insp-scrollable.is-top{-webkit-mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 14px),rgba(0,0,0,.9) calc(100% - 11px),rgba(0,0,0,.7) calc(100% - 9px),rgba(0,0,0,.45) calc(100% - 6px),rgba(0,0,0,.2) calc(100% - 4px),rgba(0,0,0,.06) calc(100% - 2px),transparent 100%);mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 14px),rgba(0,0,0,.9) calc(100% - 11px),rgba(0,0,0,.7) calc(100% - 9px),rgba(0,0,0,.45) calc(100% - 6px),rgba(0,0,0,.2) calc(100% - 4px),rgba(0,0,0,.06) calc(100% - 2px),transparent 100%)}',
    '.insp-scrollable.is-bottom{-webkit-mask-image:linear-gradient(to bottom,transparent 0,rgba(0,0,0,.06) 2px,rgba(0,0,0,.2) 4px,rgba(0,0,0,.45) 6px,rgba(0,0,0,.7) 9px,rgba(0,0,0,.9) 11px,#000 14px,#000 100%);mask-image:linear-gradient(to bottom,transparent 0,rgba(0,0,0,.06) 2px,rgba(0,0,0,.2) 4px,rgba(0,0,0,.45) 6px,rgba(0,0,0,.7) 9px,rgba(0,0,0,.9) 11px,#000 14px,#000 100%)}',
    '.insp-scrollable.is-top.is-bottom{-webkit-mask-image:none;mask-image:none}',

    /* 便签墙：点阵纸背景 + 横向麻绳，每行便签用木夹子挂在上方绳子上；置顶是一枚红色图钉。 */
    '.insp-board{position:relative}',
    '.insp-canvas{position:relative;min-height:100%;padding:12px 8px 18px;background-image:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--dsw-alias-label-tertiary,#8b8b93) 18%,transparent) 1px,transparent 1.7px);background-size:16px 16px}',
    '.insp-rope{position:absolute;left:0;top:0;z-index:0;pointer-events:none;overflow:visible}',
    '.insp-rope-main{fill:none;stroke:var(--insp-rope);stroke-width:1.7;stroke-linecap:round;opacity:.92}',
    '.insp-rope-end{fill:var(--insp-rope-hi);opacity:.95}',

    /* 分组标题：绳标一样的标签，可折叠；虚线一直拉到右边 */
    '.insp-section{position:relative;z-index:1}',
    '.insp-section-head{appearance:none;width:100%;display:flex;align-items:center;gap:6px;height:30px;padding:0 8px 0 6px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8b8b93);font-family:inherit;font-size:11px;font-weight:600;letter-spacing:.06em;cursor:pointer;border-radius:6px;text-align:left;transition:color var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-section-head:hover{color:var(--dsw-alias-label-secondary,#b3b3bb)}',
    '.insp-section-name{flex:0 0 auto}',
    '.insp-section-count{font-variant-numeric:tabular-nums;font-weight:500;opacity:.7}',
    '.insp-section-head::after{content:"";flex:1;min-width:8px;height:1px;background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--dsw-alias-border-l2,rgba(128,128,128,.34)) 80%,transparent) 0 2px,transparent 2px 5px);opacity:.7}',
    '.insp-chevron{flex:0 0 auto;color:inherit;opacity:.6;transition:transform var(--insp-dur-2) var(--insp-ease-out)}',
    '.insp-section-head.is-collapsed .insp-chevron{transform:rotate(-90deg)}',
    '.insp-section-notes{display:flex;flex-wrap:wrap;justify-content:center;align-content:flex-start;gap:26px 16px;padding:8px 2px 12px}',

    /* 便签纸：接近 4:3 的一张小纸，用木夹子挂在横向麻绳上；轻微倾斜、右下折角 */
    '.insp-card{position:relative;--note-paper:var(--insp-note-0);display:flex;flex-direction:column;flex:0 1 150px;aspect-ratio:4/3;padding:12px 12px 10px;border-radius:3px 8px 8px 8px;background:var(--note-paper);color:var(--insp-ink);box-shadow:0 1px 1px rgba(0,0,0,.14),0 7px 14px -9px rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.35);cursor:pointer;transform:rotate(var(--note-tilt,0deg));transform-origin:50% 0;transition:transform var(--insp-dur-2) var(--insp-ease-out),box-shadow var(--insp-dur-2) var(--insp-ease-out);animation:insp-drop var(--insp-dur-2) var(--insp-ease-out) both;animation-delay:calc(var(--insp-index,0) * var(--insp-stagger))}',
    '.insp-card::after{content:"";position:absolute;right:0;bottom:0;width:14px;height:14px;border-radius:0 0 7px 0;background:linear-gradient(135deg,color-mix(in srgb,var(--note-paper) 72%,var(--insp-ink)) 0%,var(--note-paper) 62%);opacity:.55;pointer-events:none}',
    '.insp-card:hover{transform:rotate(0deg);box-shadow:0 2px 2px rgba(0,0,0,.16),0 12px 20px -10px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.4);z-index:2}',
    '.insp-card.is-pinned{box-shadow:0 1px 1px rgba(0,0,0,.14),0 9px 18px -8px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.4)}',
    '.insp-card.is-active{box-shadow:0 0 0 2px var(--insp-accent),0 8px 18px -8px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.4)}',
    '.insp-card.c0{--note-paper:var(--insp-note-0)}',
    '.insp-card.c1{--note-paper:var(--insp-note-1)}',
    '.insp-card.c2{--note-paper:var(--insp-note-2)}',
    '.insp-card.c3{--note-paper:var(--insp-note-3)}',
    '.insp-card.c4{--note-paper:var(--insp-note-4)}',
    '.insp-card.c5{--note-paper:var(--insp-note-5)}',
    '.insp-peg{position:absolute;left:50%;top:-14px;width:9px;height:20px;border-radius:2px;background:linear-gradient(90deg,var(--insp-peg) 0%,color-mix(in srgb,var(--insp-peg) 70%,#000) 100%);box-shadow:0 1px 2px rgba(0,0,0,.3);transform:translateX(-50%) rotate(-4deg);z-index:3;pointer-events:none}',
    '.insp-peg::after{content:"";position:absolute;left:1px;right:1px;top:8px;height:1px;background:rgba(0,0,0,.3)}',

    '.insp-check{position:absolute;left:9px;top:9px;appearance:none;-webkit-appearance:none;margin:0;width:16px;height:16px;padding:0;display:grid;place-items:center;border:0;border-radius:5px;background:transparent;box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--insp-ink) 42%,transparent);color:var(--note-paper);cursor:pointer;opacity:.55;z-index:2;transition:opacity var(--insp-dur-1) var(--insp-ease-out),background var(--insp-dur-1) var(--insp-ease-out),box-shadow var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-card:hover .insp-check,.insp-check:focus-visible{opacity:1}',
    '.insp-check:hover{box-shadow:inset 0 0 0 1.5px var(--insp-accent);opacity:1}',
    '.insp-check.is-on{opacity:1;background:var(--insp-accent);box-shadow:inset 0 0 0 1.5px var(--insp-accent)}',
    '.insp-check svg{animation:insp-pop var(--insp-dur-1) var(--insp-ease-spring) both}',

    '.insp-card-main{display:flex;flex-direction:column;gap:3px;min-width:0;min-height:0;flex:1;padding-top:16px}',
    '.insp-card-title{font-size:12.5px;font-weight:600;line-height:1.35;color:var(--insp-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;letter-spacing:.005em}',
    '.insp-card-preview{font-size:11.5px;line-height:1.5;color:var(--insp-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.insp-card-meta{display:flex;align-items:center;gap:5px;margin-top:auto;padding-top:6px;font-size:10px;color:var(--insp-ink-3);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}',
    '.insp-card-meta .insp-dot{opacity:.5}',
    '.insp-pin{position:absolute;right:8px;top:8px;z-index:2;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:color-mix(in srgb,var(--insp-ink) 52%,transparent);display:grid;place-items:center;cursor:pointer;opacity:0;transition:opacity var(--insp-dur-1) var(--insp-ease-out),background var(--insp-dur-1) var(--insp-ease-out),color var(--insp-dur-1) var(--insp-ease-out),box-shadow var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-card:hover .insp-pin{opacity:.8}',
    '.insp-pin:hover{background:color-mix(in srgb,var(--insp-ink) 10%,transparent);opacity:1}',
    '.insp-pin.is-on{opacity:1;background:var(--dsw-alias-state-error-primary,#e05a5a);color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.35);transform:rotate(8deg)}',

    '.insp-empty{display:flex;flex-direction:column;align-items:center;gap:7px;padding:32px 18px;text-align:center;color:var(--dsw-alias-label-tertiary,#8b8b93);font-size:11.5px;line-height:1.6;overflow-wrap:anywhere}',
    '.insp-empty-icon{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--insp-surface-hover);color:var(--dsw-alias-label-secondary,#b3b3bb)}',
    '.insp-empty-title{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-secondary,#b3b3bb)}',
    '.insp-root.is-dark .insp-empty-title{font-weight:450;font-variation-settings:"wght" 460}',
    '.insp-empty .insp-btn{margin-top:2px}',
    '.insp-store{padding:0 12px 10px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b8b93);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 0 auto;opacity:.75;transition:opacity var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-store:hover{opacity:1}',

    /* 主栏页面：桌面上一块居中的宽便签板，横向绳子把每行便签挂起来 */
    '.insp-page{display:flex;flex:1;min-height:0;width:100%;height:100%;box-sizing:border-box;padding:clamp(14px,2vw,28px);background:radial-gradient(120% 90% at 50% -20%,rgba(255,255,255,.05),transparent 62%),var(--insp-desk,#e9e9ee)}',
    '.insp-page:has(> .insp-root.is-dark){--insp-desk:#141417}',
    '.insp-page>.insp-root{width:100%;max-width:960px;height:100%;margin:0 auto;border-radius:16px;background:var(--insp-board-surface,#f3eee1);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line-strong),0 30px 70px -40px rgba(0,0,0,.65);overflow:hidden}',
    '.insp-root.is-page .insp-bar{height:56px;padding:0 20px;gap:10px;box-shadow:inset 0 calc(-1 * var(--insp-hair)) 0 var(--insp-line)}',
    '.insp-root.is-page .insp-title{font-size:16px;gap:9px;letter-spacing:.01em}',
    '.insp-root.is-page .insp-title>svg{width:18px;height:18px}',
    '.insp-root.is-page .insp-pill{min-width:20px;height:20px;font-size:11px}',
    '.insp-root.is-page .insp-btn{height:30px;padding:0 13px;font-size:12px;border-radius:8px}',
    '.insp-root.is-page .insp-search{margin:14px 20px 4px;max-width:420px}',
    '.insp-root.is-page .insp-search input{height:34px;font-size:13px;color:var(--dsw-alias-label-primary,#e6e6e6);background:color-mix(in srgb,var(--dsw-alias-label-primary,#e6e6e6) 7%,transparent);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line)}',
    '.insp-root.is-page .insp-search input::placeholder{color:var(--dsw-alias-label-tertiary,#8b8b93)}',
    '.insp-root.is-page .insp-search input:focus{box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-accent)}',
    '.insp-root.is-page .insp-canvas{padding:14px 20px 28px;background-image:radial-gradient(circle at 1px 1px,color-mix(in srgb,var(--insp-rope,#a9824f) 20%,transparent) 1px,transparent 1.7px)}',
    '.insp-root.is-page .insp-section-head{height:36px;font-size:12px;padding:0 10px 0 8px}',
    '.insp-root.is-page .insp-section-notes{gap:30px 18px;padding:10px 2px 16px}',
    '.insp-root.is-page .insp-card{flex-basis:236px;padding:14px 14px 12px}',
    '.insp-root.is-page .insp-card-main{padding-top:18px}',
    '.insp-root.is-page .insp-card-title{font-size:13.5px}',
    '.insp-root.is-page .insp-card-preview{font-size:12px;-webkit-line-clamp:3}',
    '.insp-root.is-page .insp-card-meta{font-size:10.5px}',
    '.insp-root.is-page .insp-check{left:11px;top:11px}',
    '.insp-root.is-page .insp-pin{right:10px;top:10px}',
    '.insp-root.is-page .insp-store{padding:0 20px 14px}',
    /* 宽屏上的编辑器与讨论：内容收窄居中，别把整块板子拉成一行文本框 */
    '.insp-root.is-page .insp-editor{width:100%;max-width:680px;margin:0 auto;position:relative}',
    '.insp-root.is-page .insp-editor::before{content:"";position:absolute;left:50%;top:-12px;width:10px;height:20px;border-radius:2px;background:linear-gradient(90deg,var(--insp-peg) 0%,color-mix(in srgb,var(--insp-peg) 70%,#000) 100%);box-shadow:0 1px 2px rgba(0,0,0,.35);transform:translateX(-50%) rotate(-3deg);z-index:3;pointer-events:none}',
    '.insp-root.is-page .insp-editor::after{content:"";position:absolute;left:50%;top:-4px;width:8px;height:1px;background:rgba(0,0,0,.32);transform:translateX(-50%) rotate(-3deg);z-index:4;pointer-events:none}',
    '.insp-root.is-page .insp-editor textarea{background:var(--insp-editor-paper,var(--insp-note-0));color:var(--insp-ink);border-radius:4px 10px 10px 10px;box-shadow:0 14px 28px -18px rgba(0,0,0,.65),inset 0 0 0 var(--insp-hair) color-mix(in srgb,var(--insp-ink) 14%,transparent)}',
    '.insp-root.is-page .insp-editor textarea:focus{background:var(--insp-editor-paper,var(--insp-note-0));box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-accent)}',
    '.insp-root.is-page .insp-editor textarea::placeholder{color:var(--insp-ink-3)}',
    '.insp-root.is-page .insp-chat{width:100%;max-width:860px;margin:0 auto}',
    '.insp-root.is-page .insp-chat-body{padding:16px 20px;gap:10px}',
    '.insp-root.is-page .insp-msg{max-width:72%;font-size:13px}',
    '.insp-root.is-page .insp-chat-input{width:100%;padding:10px 20px 14px}',
    '.insp-root.is-page .insp-chat-input textarea{font-size:13px;min-height:56px}',
    '.insp-root.is-page .insp-context{width:100%;padding:8px 20px}',

    /* 编辑器：外层负责内边距，内层圆角 = 外层 - padding */
    '.insp-editor{display:flex;flex-direction:column;flex:1;min-height:0;padding:8px 10px 10px;--insp-editor-radius:14px}',
    '.insp-editor textarea{flex:1;min-height:0;width:100%;resize:none;padding:10px 11px;border:0;border-radius:calc(var(--insp-editor-radius) - 6px);background:var(--insp-editor-paper,var(--insp-surface));color:var(--insp-editor-ink,inherit);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line);font-size:12.5px;line-height:1.75;font-family:inherit;outline:none;overflow-wrap:anywhere;transition:background var(--insp-dur-1) var(--insp-ease-out),box-shadow var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-editor textarea:focus{background:var(--insp-editor-paper,var(--insp-surface-hover));box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-accent)}',
    '.insp-editor textarea::placeholder{color:var(--insp-ink-3)}',

    '.insp-foot{display:flex;align-items:center;gap:6px;padding-top:8px;flex:0 0 auto}',
    '.insp-status{margin-right:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93);overflow-wrap:anywhere}',
    '.insp-status.is-err{color:var(--dsw-alias-state-error-primary,#f16a6a)}',

    '.insp-chat{display:flex;flex-direction:column;flex:1;min-height:0}',
    '.insp-chat-body{padding:10px;display:flex;flex-direction:column;gap:8px}',
    '.insp-msg{max-width:92%;padding:7px 9px;border-radius:9px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;font-size:12px;line-height:1.6;min-width:0;animation:insp-fade-in var(--insp-dur-2) var(--insp-ease-out) both}',
    '.insp-msg-user{align-self:flex-end;background:var(--insp-bubble-user);border-radius:9px 9px 3px 9px}',
    '.insp-msg-ai{align-self:flex-start;background:var(--insp-surface);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-line);border-radius:9px 9px 9px 3px}',
    '.insp-msg-tools{display:flex;gap:6px;margin-top:6px}',
    '.insp-msg-tools .insp-btn{height:20px;padding:0 4px;font-size:10.5px;background:transparent;box-shadow:none;color:var(--insp-accent)}.insp-msg-tools .insp-btn:hover{background:var(--insp-surface-hover)}',
    '.insp-chat-input{flex:0 0 auto;padding:8px 10px 10px;display:flex;flex-direction:column;gap:6px;box-shadow:inset 0 var(--insp-hair) 0 var(--insp-line)}',
    '.insp-chat-input textarea{width:100%;min-height:52px;max-height:140px;resize:none;padding:8px 9px;border:0;border-radius:8px;background:transparent;box-shadow:none;color:inherit;font-size:12px;line-height:1.6;font-family:inherit;outline:none;overflow-wrap:anywhere;transition:background var(--insp-dur-1) var(--insp-ease-out),box-shadow var(--insp-dur-1) var(--insp-ease-out)}',
    '.insp-chat-input textarea:hover{background:var(--insp-surface)}',
    '.insp-chat-input textarea:focus{background:var(--insp-surface);box-shadow:inset 0 0 0 var(--insp-hair) var(--insp-accent)}',
    '.insp-chat-actions{display:flex;align-items:center;gap:6px;min-width:0}',
    '.insp-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93);margin-right:auto;min-width:0;overflow-wrap:anywhere}',
    '.insp-context{padding:6px 10px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b8b93);background:var(--insp-surface);box-shadow:inset 0 calc(-1 * var(--insp-hair)) 0 var(--insp-line);overflow-wrap:anywhere}',

    '@keyframes insp-rise{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
    '@keyframes insp-drop{from{opacity:0;translate:0 -6px}to{opacity:1;translate:0 0}}',
    '@keyframes insp-fade-in{from{opacity:0}to{opacity:1}}',
    '@keyframes insp-pop{from{opacity:0;transform:scale(.82)}to{opacity:1;transform:none}}',
    '@media (prefers-reduced-motion: reduce){.insp-root,.insp-root *,.insp-root *::before,.insp-root *::after{animation-duration:1ms!important;animation-delay:0ms!important;animation-iteration-count:1!important;transition-duration:1ms!important;scroll-behavior:auto!important}}',
  ].join('\n').split('__HAIR__').join(hairline())
  function formatTime(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return ''
    var date = new Date(ts)
    var now = new Date()
    var pad = function (value) { return value < 10 ? '0' + value : String(value) }
    var clock = pad(date.getHours()) + ':' + pad(date.getMinutes())
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
      return '今天 ' + clock
    }
    if (date.getFullYear() === now.getFullYear()) {
      return (date.getMonth() + 1) + '月' + date.getDate() + '日 ' + clock
    }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  }

  function noteTitle(note) {
    if (note.title && note.title.trim() !== '') return note.title
    var line = String(note.text || '').split(/\r?\n/).map(function (part) { return part.trim() }).filter(Boolean)[0]
    return line || '未命名灵感'
  }

  /** 卡片摘要：正文去掉首行后的内容（首行已是标题）。 */
  function previewOf(note) {
    var lines = String(note.text || '').split(/\r?\n/)
    var first = -1
    for (var index = 0; index < lines.length; index += 1) {
      if (lines[index].trim() !== '') {
        first = index
        break
      }
    }
    if (first < 0) return ''
    return lines.slice(first + 1).join('\n').trim()
  }

  /** 稳定哈希：同一份笔记每次渲染得到同样的纸色与倾角，不随排序变化。 */
  function hash32(text) {
    var hash = 2166136261
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  /** 便签纸色：6 组色相轮换，颜色只跟 id 有关。 */
  function notePalette(note) {
    return hash32(String(note.id || note.text || '')) % 6
  }

  /** 轻微手贴倾斜：-1.1° ~ 1.1°，角度只跟 id 有关，悬停时回正。 */
  function noteTilt(note) {
    var seed = hash32(String(note.id || note.text || '') + '#tilt') % 1000
    return ((seed / 999) * 2.2 - 1.1).toFixed(2) + 'deg'
  }

  var NOTE_GROUPS = [
    { id: 'pinned', label: '置顶' },
    { id: 'today', label: '今天' },
    { id: 'yesterday', label: '昨天' },
    { id: 'week', label: '近 7 天' },
    { id: 'older', label: '更早' },
  ]

  function startOfDay(ts) {
    var date = new Date(ts)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  /** 按「置顶 / 今天 / 昨天 / 近 7 天 / 更早」分组；组内保持宿主返回的顺序。 */
  function groupNotes(list) {
    var buckets = { pinned: [], today: [], yesterday: [], week: [], older: [] }
    var today = startOfDay(Date.now())
    var day = 86400000
    for (var index = 0; index < list.length; index += 1) {
      var note = list[index]
      if (note.pinned === true) {
        buckets.pinned.push(note)
        continue
      }
      var updated = startOfDay(typeof note.updatedAt === 'number' ? note.updatedAt : Date.now())
      if (updated >= today) buckets.today.push(note)
      else if (updated >= today - day) buckets.yesterday.push(note)
      else if (updated >= today - day * 6) buckets.week.push(note)
      else buckets.older.push(note)
    }
    var groups = []
    for (var g = 0; g < NOTE_GROUPS.length; g += 1) {
      var group = NOTE_GROUPS[g]
      if (buckets[group.id].length === 0) continue
      groups.push({ id: group.id, label: group.label, notes: buckets[group.id] })
    }
    return groups
  }

  /** 笔记很多时默认收起旧分组，后来者仍能一键展开。 */
  function defaultCollapsed(groupId, total) {
    if (groupId === 'older') return total > 10
    if (groupId === 'week') return total > 26
    return false
  }


  function emptyState(icon, title, hint, action) {
    return h('div', { className: 'insp-empty' },
      icon === null || icon === undefined ? null : h('div', { className: 'insp-empty-icon' }, icon),
      h('div', { className: 'insp-empty-title' }, title),
      hint === undefined || hint === '' ? null : h('div', {}, hint),
      action === undefined ? null : action
    )
  }

  function InspirationsView(props) {
    var scope = props && props.scope ? props.scope : undefined
    var sessionId = scope && typeof scope.sessionId === 'string' ? scope.sessionId : ''
    var page = props && props.layout === 'page'

    var notesState = useState([])
    var notes = notesState[0]
    var setNotes = notesState[1]
    var loadState = useState(true)
    var loading = loadState[0]
    var setLoading = loadState[1]
    var errorState = useState('')
    var error = errorState[0]
    var setError = errorState[1]
    var storePathState = useState('')
    var storePath = storePathState[0]
    var setStorePath = storePathState[1]

    var modeState = useState('list')
    var mode = modeState[0]
    var setMode = modeState[1]

    var draftState = useState(null)
    var draft = draftState[0]
    var setDraft = draftState[1]
    var statusState = useState('')
    var status = statusState[0]
    var setStatus = statusState[1]
    var statusErrState = useState(false)
    var statusErr = statusErrState[0]
    var setStatusErr = statusErrState[1]

    var selectedState = useState([])
    var selectedIds = selectedState[0]
    var setSelectedIds = selectedState[1]

    var queryState = useState('')
    var query = queryState[0]
    var setQuery = queryState[1]

    var chatState = useState([])
    var chat = chatState[0]
    var setChat = chatState[1]
    var inputState = useState('')
    var input = inputState[0]
    var setInput = inputState[1]
    var busyState = useState(false)
    var busy = busyState[0]
    var setBusy = busyState[1]
    var routeState = useState(null)
    var route = routeState[0]
    var setRoute = routeState[1]
    var chatErrorState = useState('')
    var chatError = chatErrorState[0]
    var setChatError = chatErrorState[1]

    var saveTimer = useRef(0)
    var saveSeq = useRef(0)
    var draftRef = useRef(null)
    var chatEndRef = useRef(null)
    var mountedRef = useRef(true)
    var darkState = useState(isDarkTheme)
    var dark = darkState[0]
    var setDark = darkState[1]
    var listRef = useRef(null)
    var canvasRef = useRef(null)
    var chatBodyRef = useRef(null)
    var lastIntentRef = useRef(0)
    var edgesState = useState({ listTop: true, listBottom: true, chatTop: true, chatBottom: true })
    var edges = edgesState[0]
    var setEdges = edgesState[1]
    var collapsedState = useState({})
    var collapsed = collapsedState[0]
    var setCollapsed = collapsedState[1]
    var ropeState = useState(null)
    var rope = ropeState[0]
    var setRope = ropeState[1]

    draftRef.current = draft

    var refresh = useCallback(function () {
      return api('notes.list').then(function (value) {
        if (!mountedRef.current) return
        setNotes(Array.isArray(value.notes) ? value.notes : [])
        setStorePath(typeof value.path === 'string' ? value.path : '')
        setError('')
      }).catch(function (err) {
        if (!mountedRef.current) return
        setError(err && err.message ? err.message : String(err))
      }).then(function () {
        if (mountedRef.current) setLoading(false)
      })
    }, [])

    useEffect(function () {
      mountedRef.current = true
      void refresh()
      return function () {
        mountedRef.current = false
        if (saveTimer.current !== 0) clearTimeout(saveTimer.current)
        var pending = draftRef.current
        if (pending !== null && pending.dirty === true && String(pending.text).trim() !== '') {
          void api('notes.save', { id: pending.id, text: pending.text }).catch(function () {})
        }
      }
    }, [refresh])

    var flushSave = useCallback(function (next) {
      if (!mountedRef.current) return Promise.resolve()
      var seq = ++saveSeq.current
      setStatus('保存中…')
      return api('notes.save', { id: next.id, text: next.text, pinned: next.pinned === true })
        .then(function (value) {
          if (!mountedRef.current) return
          var list = Array.isArray(value.notes) ? value.notes : []
          setNotes(list)
          if (value.note !== undefined && value.note !== null) {
            setDraft(function (current) {
              if (current === null) return current
              var sameDraft = current.text === next.text
              return sameDraft ? { id: value.note.id, text: current.text, pinned: value.note.pinned === true, dirty: false } : current
            })
          }
          if (seq === saveSeq.current) {
            setStatusErr(false)
            setStatus('已保存')
          }
        })
        .catch(function (err) {
          if (!mountedRef.current) return
          setStatusErr(true)
          setStatus(err && err.message ? err.message : '保存失败')
        })
    }, [])

    function scheduleSave(next) {
      if (saveTimer.current !== 0) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(function () {
        saveTimer.current = 0
        void flushSave(next)
      }, SAVE_DEBOUNCE_MS)
    }

    function openNote(note) {
      if (saveTimer.current !== 0) clearTimeout(saveTimer.current)
      saveTimer.current = 0
      setStatus('')
      setStatusErr(false)
      setMode('edit')
      setDraft({ id: note.id, text: note.text, pinned: note.pinned === true, dirty: false })
    }

    function createNote() {
      setStatus('')
      setStatusErr(false)
      setMode('edit')
      setDraft({ id: '', text: '', pinned: false, dirty: false })
    }

    function changeText(text) {
      var current = draftRef.current
      var next = {
        id: current !== null ? current.id : '',
        text: text,
        pinned: current !== null ? current.pinned === true : false,
        dirty: true,
      }
      setDraft(next)
      scheduleSave(next)
    }

    function togglePin(note) {
      var nextPinned = note.pinned !== true
      api('notes.save', { id: note.id, text: note.text, pinned: nextPinned }).then(function (value) {
        if (mountedRef.current && Array.isArray(value.notes)) setNotes(value.notes)
      }).catch(function (err) {
        if (mountedRef.current) {
          setStatusErr(true)
          setStatus(err && err.message ? err.message : '操作失败')
        }
      })
    }

    function removeNote(note) {
      var ok = typeof window === 'undefined' ? true : window.confirm('删除这条灵感？删除后无法恢复。')
      if (!ok) return
      api('notes.remove', { id: note.id }).then(function (value) {
        if (!mountedRef.current) return
        if (Array.isArray(value.notes)) setNotes(value.notes)
        setSelectedIds(function (current) { return current.filter(function (id) { return id !== note.id }) })
        setMode('list')
        setDraft(null)
      }).catch(function (err) {
        if (mountedRef.current) {
          setStatusErr(true)
          setStatus(err && err.message ? err.message : '删除失败')
        }
      })
    }

    function toggleSelected(id) {
      setSelectedIds(function (current) {
        return current.indexOf(id) >= 0 ? current.filter(function (item) { return item !== id }) : current.concat([id])
      })
    }

    function startDiscussionWith(ids) {
      var chosen = notes.filter(function (note) { return ids.indexOf(note.id) >= 0 })
      if (chosen.length === 0) {
        setStatus('先点便签左上角方框，勾选要讨论的灵感')
        setStatusErr(false)
        return
      }
      setSelectedIds(ids)
      setChat([])
      setChatError('')
      setInput('')
      setStatus('')
      setStatusErr(false)
      setMode('discuss')
      void api('route.info', { sessionId: sessionId }).then(function (value) {
        if (!mountedRef.current) return
        setRoute(value.route || null)
      }).catch(function () {
        if (mountedRef.current) setRoute(null)
      })
    }

    function startDiscussion() {
      startDiscussionWith(selectedIds)
    }

    function sendMessage() {
      var text = input.trim()
      if (text === '' || busy) return
      var chosen = notes.filter(function (note) { return selectedIds.indexOf(note.id) >= 0 })
      var nextChat = chat.concat([{ role: 'user', text: text }])
      setChat(nextChat)
      setInput('')
      setBusy(true)
      setChatError('')
      api('discuss', {
        sessionId: sessionId,
        notes: chosen.map(function (note) { return note.text }),
        messages: nextChat,
      }).then(function (value) {
        if (!mountedRef.current) return
        setBusy(false)
        setChat(nextChat.concat([{ role: 'assistant', text: String(value.reply || '') }]))
        if (value.route) setRoute(value.route)
      }).catch(function (err) {
        if (!mountedRef.current) return
        setBusy(false)
        setChat(nextChat)
        setChatError(err && err.message ? err.message : String(err))
      })
    }

    function saveReplyAsNote(text) {
      api('notes.save', { text: text }).then(function (value) {
        if (!mountedRef.current) return
        if (Array.isArray(value.notes)) setNotes(value.notes)
        if (value.note && value.note.id) setSelectedIds([value.note.id])
        setStatusErr(false)
        setStatus('已存为新灵感')
      }).catch(function (err) {
        if (mountedRef.current) {
          setStatusErr(true)
          setStatus(err && err.message ? err.message : '保存失败')
        }
      })
    }


    var filtered = useMemo(function () {
      var keyword = query.trim().toLowerCase()
      if (keyword === '') return notes
      return notes.filter(function (note) {
        return String(note.text || '').toLowerCase().indexOf(keyword) >= 0
      })
    }, [notes, query])

    var groups = useMemo(function () { return groupNotes(filtered) }, [filtered])
    var searching = query.trim() !== ''

    function isFolded(group) {
      if (searching) return false
      var value = collapsed[group.id]
      if (typeof value === 'boolean') return value
      return defaultCollapsed(group.id, filtered.length)
    }

    function toggleGroup(group) {
      var folded = isFolded(group)
      setCollapsed(function (current) {
        var next = {}
        for (var key in current) {
          if (Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key]
        }
        next[group.id] = !folded
        return next
      })
    }

    /** 量出每张便签的木夹子位置，按行生成横向麻绳：同一行的夹子挂在同一根绳上。 */
    function measureRope() {
      var canvas = canvasRef.current
      if (!canvas || typeof canvas.getBoundingClientRect !== 'function') return
      var rect = canvas.getBoundingClientRect()
      if (!(rect.width > 1) || !(rect.height > 1)) return
      var pegs = canvas.querySelectorAll('[data-rope-anchor]')
      var anchors = []
      for (var p = 0; p < pegs.length; p += 1) {
        var pegRect = pegs[p].getBoundingClientRect()
        var cardRect = pegs[p].parentNode ? pegs[p].parentNode.getBoundingClientRect() : null
        anchors.push({
          key: pegs[p].getAttribute('data-rope-anchor'),
          x: pegRect.left - rect.left + pegRect.width / 2,
          y: pegRect.top - rect.top + pegRect.height / 2,
          w: cardRect ? cardRect.width : 0,
        })
      }
      if (anchors.length === 0) { setRope(null); return }
      /* 便签按行聚在一起：同一行的夹子 y 相近，绳子从行首拉到行尾。 */
      anchors.sort(function (left, right) { return left.y - right.y || left.x - right.x })
      var rows = []
      for (var index = 0; index < anchors.length; index += 1) {
        var anchor = anchors[index]
        var row = rows.length > 0 ? rows[rows.length - 1] : null
        if (!row || Math.abs(anchor.y - row.y) > 22) {
          row = { y: anchor.y, anchors: [] }
          rows.push(row)
        }
        row.anchors.push(anchor)
      }
      var lines = []
      var ends = []
      for (var r = 0; r < rows.length; r += 1) {
        var rowAnchors = rows[r].anchors
        rowAnchors.sort(function (left, right) { return left.x - right.x })
        var y = rowAnchors[0].y
        /* 绳子只比这一行的便签左右各长出一点，像一段挂在墙上的晾衣绳。 */
        var firstX = rowAnchors[0].x
        var lastX = rowAnchors[rowAnchors.length - 1].x
        var startX = Math.max(8, firstX - Math.max(26, (rowAnchors[0].w || 0) / 2 + 18))
        var endX = Math.min(rect.width - 8, lastX + Math.max(26, (rowAnchors[rowAnchors.length - 1].w || 0) / 2 + 18))
        var sag = Math.min(5, (endX - startX) * 0.02)
        var lineY = y.toFixed(1)
        lines.push({
          key: 'l' + r,
          d: 'M' + startX.toFixed(1) + ' ' + lineY +
            ' Q' + ((startX + endX) / 2).toFixed(1) + ' ' + (y + sag).toFixed(1) +
            ' ' + endX.toFixed(1) + ' ' + lineY,
        })
        ends.push({ key: 'a' + r, x: startX, y: y }, { key: 'b' + r, x: endX, y: y })
      }
      setRope({ w: rect.width, h: rect.height, lines: lines, ends: ends })
    }

    useEffect(function () {
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return
      var frame = window.requestAnimationFrame(function () {
        frame = window.requestAnimationFrame(measureRope)
      })
      /* 入场动画带 translate，量绳要等动画结束再量一次，否则绳子会比便签高几像素。 */
      var timer = typeof window.setTimeout === 'function' ? window.setTimeout(measureRope, 460) : 0
      return function () {
        window.cancelAnimationFrame(frame)
        if (timer) window.clearTimeout(timer)
      }
    }, [notes, filtered, collapsed, dark, mode, loading, error, query])

    useEffect(function () {
      if (typeof ResizeObserver === 'undefined' || !canvasRef.current) return
      var observer = new ResizeObserver(function () { measureRope() })
      observer.observe(canvasRef.current)
      return function () { observer.disconnect() }
    }, [groups.length, collapsed])

    var chatContext = notes.filter(function (note) { return selectedIds.indexOf(note.id) >= 0 })

    /** 用户主动滚动（wheel/touch/keydown）打点：150ms 内不自动跟随。 */
    function markScrollIntent() {
      lastIntentRef.current = Date.now()
    }

    function readEdges(el) {
      if (!el) return { top: true, bottom: true }
      return {
        top: el.scrollTop <= 1,
        bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
      }
    }

    function syncEdges() {
      var list = readEdges(listRef.current)
      var chatPane = readEdges(chatBodyRef.current)
      setEdges(function (current) {
        if (
          current.listTop === list.top && current.listBottom === list.bottom &&
          current.chatTop === chatPane.top && current.chatBottom === chatPane.bottom
        ) return current
        return { listTop: list.top, listBottom: list.bottom, chatTop: chatPane.top, chatBottom: chatPane.bottom }
      })
    }

    useEffect(syncEdges, [notes, filtered, mode, loading, chat, busy])

    useEffect(function () {
      if (mode !== 'discuss') return
      var el = chatBodyRef.current
      if (!el) return
      if (Date.now() - lastIntentRef.current <= 150) return
      var distance = el.scrollHeight - el.scrollTop - el.clientHeight
      if (distance > 18) return
      el.scrollTop = el.scrollHeight
    }, [chat, busy, mode])

    useEffect(function () {
      if (mode !== 'discuss') return
      var el = chatBodyRef.current
      if (!el) return
      el.scrollTop = el.scrollHeight
    }, [mode])

    useEffect(function () {
      if (typeof ResizeObserver === 'undefined') return
      var observer = new ResizeObserver(function () { syncEdges() })
      if (listRef.current) observer.observe(listRef.current)
      if (chatBodyRef.current) observer.observe(chatBodyRef.current)
      return function () { observer.disconnect() }
    }, [mode])

    useEffect(function () {
      if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
      var observer = new MutationObserver(function () { setDark(isDarkTheme()) })
      var options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] }
      observer.observe(document.documentElement, options)
      if (document.body) observer.observe(document.body, options)
      return function () { observer.disconnect() }
    }, [])

    var rootClass = 'insp-root' + (dark ? ' is-dark' : '') + (page ? ' is-page' : '')

    function copyStorePath() {
      var clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!clipboard || typeof clipboard.writeText !== 'function') {
        setStatus('复制失败：剪贴板不可用')
        setStatusErr(true)
        return
      }
      clipboard.writeText(storePath).then(function () {
        if (!mountedRef.current) return
        setStatus('已复制笔记路径')
        setStatusErr(false)
      }).catch(function () {
        if (!mountedRef.current) return
        setStatus('复制失败')
        setStatusErr(true)
      })
    }

    if (mode === 'edit' && draft !== null) {
      var editorPaper = 'var(--insp-note-' + notePalette({ id: draft.id || '' }) + ')'
      return h('div', { className: rootClass, style: { '--insp-editor-paper': editorPaper, '--insp-editor-ink': 'var(--insp-ink)' } },
        h('div', { className: 'insp-bar' },
          h('button', {
            type: 'button', className: 'insp-btn insp-btn-icon', title: '返回列表',
            onClick: function () {
              if (saveTimer.current !== 0) {
                clearTimeout(saveTimer.current)
                saveTimer.current = 0
                if (draft.dirty) void flushSave(draft)
              }
              setMode('list')
              setDraft(null)
              setStatus('')
            },
          }, '‹'),
          h('div', { className: 'insp-title' }, draft.id ? '编辑灵感' : '新灵感'),
          h('span', { className: 'insp-status' + (statusErr ? ' is-err' : '') }, status),
          draft.id
            ? h('button', {
              type: 'button', className: 'insp-btn', title: '置顶/取消置顶',
              onClick: function () {
                var next = { id: draft.id, text: draft.text, pinned: draft.pinned !== true, dirty: true }
                setDraft(next)
                void flushSave(next)
              },
            }, draft.pinned ? '取消置顶' : '置顶')
            : null,
          draft.id
            ? h('button', {
              type: 'button', className: 'insp-btn', title: '和 AI 讨论这条灵感',
              onClick: function () {
                if (saveTimer.current !== 0) {
                  clearTimeout(saveTimer.current)
                  saveTimer.current = 0
                  if (draft.dirty) void flushSave(draft)
                }
                startDiscussionWith([draft.id])
              },
            }, '讨论')
            : null,
          draft.id
            ? h('button', {
              type: 'button', className: 'insp-btn is-danger', title: '删除这条灵感',
              onClick: function () {
                if (draft.dirty && draft.text.trim() !== '') {
                  void api('notes.save', { id: draft.id, text: draft.text }).catch(function () {})
                }
                removeNote({ id: draft.id, text: draft.text })
              },
            }, '删除')
            : null
        ),
        h('div', { className: 'insp-editor' },
          h('textarea', {
            value: draft.text,
            autoFocus: true,
            placeholder: '随手写下此刻的灵感…\n\n（自动保存；第一行会作为标题显示）',
            onChange: function (ev) { changeText(ev.target.value) },
            onKeyDown: function (ev) {
              if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
                if (saveTimer.current !== 0) {
                  clearTimeout(saveTimer.current)
                  saveTimer.current = 0
                }
                if (draft.dirty) void flushSave(draft)
                setMode('list')
                setDraft(null)
              }
            },
          })
        )
      )
    }

    if (mode === 'discuss') {
      return h('div', { className: rootClass },
        h('div', { className: 'insp-bar' },
          h('button', {
            type: 'button', className: 'insp-btn insp-btn-icon', title: '返回列表',
            onClick: function () { setMode('list'); setChatError(''); setStatus('') },
          }, '‹'),
          h('div', { className: 'insp-title' }, '和 AI 讨论'),
          h('span', { className: 'insp-count' }, chatContext.length + ' 条灵感')
        ),
        h('div', { className: 'insp-context' },
          route === null ? '正在读取当前会话的模型…' : '模型：' + route.provider + ' / ' + route.model + (route.source === 'default' ? '（默认）' : '')
        ),
        h('div', { className: 'insp-chat' },
          h('div', {
            className: 'insp-scrollable insp-chat-body' +
              (edges.chatTop ? ' is-top' : '') + (edges.chatBottom ? ' is-bottom' : ''),
            ref: chatBodyRef,
            onScroll: syncEdges,
            onWheel: markScrollIntent,
            onTouchMove: markScrollIntent,
            onKeyDown: markScrollIntent,
          },
            chatContext.length === 0
              ? h('div', { className: 'insp-empty' }, '返回列表，勾选想讨论的灵感后再进来。')
              : null,
            chat.length === 0 && !busy
              ? h('div', { className: 'insp-empty' }, '说点什么开始讨论：想听建议、找漏洞，还是把它拆成下一步？')
              : null,
            chat.map(function (message, index) {
              if (message.role === 'user') {
                return h('div', { key: 'm' + index, className: 'insp-msg insp-msg-user' }, message.text)
              }
              return h('div', { key: 'm' + index, className: 'insp-msg insp-msg-ai' },
                message.text,
                h('div', { className: 'insp-msg-tools' },
                  h('button', {
                    type: 'button', className: 'insp-btn', title: '把这段回答存成一条新灵感',
                    onClick: function () { saveReplyAsNote(message.text) },
                  }, '存为新灵感')
                )
              )
            }),
            busy ? h('div', { className: 'insp-msg insp-msg-ai' }, '思考中…') : null,
            chatError !== '' ? h('div', { className: 'insp-msg insp-msg-ai' }, h('span', { style: { color: 'var(--dsw-alias-state-error-primary,#f16a6a)' } }, chatError)) : null
          ),
          h('div', { className: 'insp-chat-input' },
            h('textarea', {
              value: input,
              placeholder: '继续讨论…（Enter 发送，Shift+Enter 换行）',
              onChange: function (ev) { setInput(ev.target.value) },
              onKeyDown: function (ev) {
                if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                  ev.preventDefault()
                  sendMessage()
                }
              },
            }),
            h('div', { className: 'insp-chat-actions' },
              h('span', { className: 'insp-hint' }, busy ? '模型正在回答…' : '讨论不会占用主对话上下文'),
              h('button', {
                type: 'button', className: 'insp-btn insp-btn-primary', disabled: busy || input.trim() === '',
                onClick: sendMessage,
              }, '发送')
            )
          )
        )
      )
    }

    return h('div', { className: rootClass },
      h('div', { className: 'insp-bar' },
        h('div', { className: 'insp-title' }, h(BulbIcon, { size: 14 }), '灵感',
          h('span', { className: 'insp-pill' }, String(notes.length))
        ),
        h('button', { type: 'button', className: 'insp-btn insp-btn-primary', onClick: createNote }, '＋ 新灵感'),
        h('button', {
          type: 'button',
          className: 'insp-btn' + (selectedIds.length > 0 ? ' is-accent' : ''),
          title: selectedIds.length === 0 ? '先点便签左上角方框勾选，再和 AI 讨论' : '和 AI 讨论选中的灵感',
          onClick: startDiscussion,
        }, '讨论' + (selectedIds.length > 0 ? ' ' + selectedIds.length : ''))
      ),
      h('div', { className: 'insp-search' },
        h(SearchIcon, { size: 12 }),
        h('input', {
          value: query,
          placeholder: '搜索灵感…',
          spellCheck: false,
          onChange: function (ev) { setQuery(ev.target.value) },
        })
      ),
      h('div', {
        className: 'insp-scrollable insp-list' +
          (edges.listTop ? ' is-top' : '') + (edges.listBottom ? ' is-bottom' : ''),
        ref: listRef,
        onScroll: syncEdges,
        onWheel: markScrollIntent,
        onTouchMove: markScrollIntent,
        onKeyDown: markScrollIntent,
      },
        h('div', { className: 'insp-canvas', ref: canvasRef },
          rope === null ? null : h('svg', {
            className: 'insp-rope',
            width: rope.w,
            height: rope.h,
            viewBox: '0 0 ' + rope.w + ' ' + rope.h,
            'aria-hidden': true,
          },
            rope.lines.map(function (line) {
              return h('path', { key: line.key, className: 'insp-rope-main', d: line.d })
            }),
            rope.ends.map(function (end) {
              return h('circle', {
                key: end.key, className: 'insp-rope-end',
                cx: end.x.toFixed(1), cy: end.y.toFixed(1), r: 1.7,
              })
            })
          ),
          loading ? emptyState(h(BulbIcon, { size: 16 }), '正在读取灵感…') : null,
          !loading && error !== '' ? emptyState(null, '读取失败', error) : null,
          !loading && error === '' && notes.length === 0
            ? emptyState(h(BulbIcon, { size: 16 }), '还没有灵感', '想到什么就写下来，第一行会自动成为标题。',
              h('button', { type: 'button', className: 'insp-btn insp-btn-primary', onClick: createNote }, '＋ 记下第一条'))
            : null,
          !loading && notes.length > 0 && filtered.length === 0
            ? emptyState(h(SearchIcon, { size: 16 }), '没有匹配的灵感', '换个关键词试试，或清空搜索框。')
            : null,
          groups.map(function (group, groupIndex) {
            var folded = isFolded(group)
            var offset = 0
            for (var before = 0; before < groupIndex; before += 1) {
              offset += groups[before].notes.length
            }
            return h('section', { key: group.id, className: 'insp-section' + (folded ? ' is-collapsed' : '') },
              h('button', {
                type: 'button',
                className: 'insp-section-head' + (folded ? ' is-collapsed' : ''),
                'aria-expanded': folded ? 'false' : 'true',
                title: folded ? '展开「' + group.label + '」' : '收起「' + group.label + '」',
                onClick: function () { toggleGroup(group) },
              },
                h(ChevronIcon, { size: 10 }),
                h('span', { className: 'insp-section-name' }, group.label),
                h('span', { className: 'insp-section-count' }, String(group.notes.length))
              ),
              folded ? null : h('div', { className: 'insp-section-notes' },
                group.notes.map(function (note, noteIndex) {
                  var checked = selectedIds.indexOf(note.id) >= 0
                  var preview = previewOf(note)
                  var chars = String(note.text || '').length
                  return h('div', {
                    key: note.id,
                    className: 'insp-card c' + notePalette(note) +
                      (checked ? ' is-active' : '') + (note.pinned ? ' is-pinned' : ''),
                    style: {
                      '--insp-index': String(Math.min(offset + noteIndex, 12)),
                      '--note-tilt': noteTilt(note),
                    },
                    onClick: function () { openNote(note) },
                  },
                    h('span', { className: 'insp-peg', 'data-rope-anchor': note.id, 'aria-hidden': true }),
                    h('button', {
                      type: 'button',
                      className: 'insp-check' + (checked ? ' is-on' : ''),
                      title: checked ? '取消选择' : '选择这条灵感去讨论',
                      'aria-pressed': checked ? 'true' : 'false',
                      onClick: function (ev) { ev.stopPropagation(); toggleSelected(note.id) },
                    }, checked ? h(CheckIcon, { size: 11 }) : null),
                    h('div', { className: 'insp-card-main' },
                      h('div', { className: 'insp-card-title' }, noteTitle(note)),
                      preview !== '' ? h('div', { className: 'insp-card-preview' }, preview) : null,
                      h('div', { className: 'insp-card-meta' },
                        h('span', {}, formatTime(note.updatedAt)),
                        h('span', { className: 'insp-dot' }, '·'),
                        h('span', {}, chars + ' 字')
                      )
                    ),
                    h('button', {
                      type: 'button',
                      className: 'insp-pin' + (note.pinned ? ' is-on' : ''),
                      title: note.pinned ? '取消置顶' : '置顶',
                      onClick: function (ev) { ev.stopPropagation(); togglePin(note) },
                    }, h(PinIcon, { size: 12 }))
                  )
                })
              )
            )
          })
        )
      ),
      storePath !== '' && notes.length > 0
        ? h('div', {
          className: 'insp-store',
          title: '点击复制：' + storePath,
          onClick: copyStorePath,
        }, String(storePath))
        : null,
      status !== ''
        ? h('div', {
          className: 'insp-bar',
          style: { boxShadow: 'inset 0 1px 0 var(--insp-line)', paddingTop: '5px', paddingBottom: '5px' },
        }, h('span', { className: 'insp-status' + (statusErr ? ' is-err' : '') }, status))
        : null
    )
  }

  /** 左侧导航行里的图标：只画灯泡，行按钮/文字/提示由外壳负责。 */
  function InspirationsPanelIcon(props) {
    var size = props && typeof props.size === 'number' ? props.size : 16
    return h('svg', {
      'data-dsh-panel-entry': 'inspirations',
      width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': 'true',
    },
      h('path', { d: 'M8 1.6a4.1 4.1 0 0 0-2.4 7.4c.5.4.8 1 .8 1.6v.5h3.2v-.5c0-.6.3-1.2.8-1.6A4.1 4.1 0 0 0 8 1.6z' }),
      h('path', { d: 'M6.4 13h3.2' }),
      h('path', { d: 'M7 14.4h2' })
    )
  }

  /** 主栏页面：桌面中间一块便签板，宽屏时便签自动排成多列。 */
  function InspirationsPage(props) {
    return h('div', { className: 'insp-page' },
      h(InspirationsView, {
        layout: 'page',
        scope: props && props.scope ? props.scope : undefined,
      })
    )
  }

  var PANEL_ID = 'inspirations'

  function apply(ctx) {
    injectStyles(CSS)
    if (!ctx.slots || typeof ctx.slots.inject !== 'function') return
    // slots 是外壳核心服务：exports.inject 已声明依赖，等它就绪后再注册
    // 左侧导航行（sidebar.panellist）和与之同 id 的主栏页面（main）。
    ctx.effect(function () {
      var slots = ctx.slots
      var disposers = []
      disposers.push(slots.inject('sidebar.panellist', function () {
        return slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: function () { return '灵感' },
        }, InspirationsPanelIcon)
      }))
      disposers.push(slots.inject('main', function () {
        return slots.register({
          name: 'main',
          key: PANEL_ID,
        }, InspirationsPage)
      }))
      return function () {
        for (var index = 0; index < disposers.length; index += 1) {
          try { disposers[index]() } catch (err) {}
        }
      }
    })
  }

  exports.apply = apply
  exports.inject = ['slots']
  // 仅供离线渲染测试取到视图组件（不参与插件契约）。
  exports.__internals = { InspirationsView: InspirationsView, InspirationsPage: InspirationsPage, InspirationsPanelIcon: InspirationsPanelIcon }
  return module.exports
} })
