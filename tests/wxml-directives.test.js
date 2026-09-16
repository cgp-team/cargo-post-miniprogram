/**
 * WXML 条件指令校验（Node 直跑，无需微信工具）
 *
 * 运行：node tests/wxml-directives.test.js
 *
 * 背景：微信 WXML 只认 `wx:if` / `wx:elif` / `wx:else` 三个指令。
 *   1. 写成 `wx:else-if`（Vue 习惯）不会报错，但它是"未知属性" → 该元素永远渲染，
 *      链条断掉，后面的 `wx:elif` 就会报 "Bad attr `wx:elif` ... wx:if not found"，整页编译失败；
 *   2. `wx:elif` / `wx:else` 必须紧跟同层级的 `wx:if` / `wx:elif` 兄弟元素。
 * 本测试用真实标签 tokenizer 扫全仓 WXML，把这类问题在提交前拦下来。
 */
const assert = require('assert')
const fs = require('fs')
const path = require('path')

/** 递归收集 WXML 文件 */
function collect(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name === 'libs') continue
      collect(full, out)
    } else if (name.endsWith('.wxml')) {
      out.push(full)
    }
  }
  return out
}

/**
 * 标签 tokenizer：忽略注释，正确处理属性里的引号与 `>`（如 wx:if="{{a > b}}"）、自闭合标签。
 * 返回 [{type:'open'|'close', tag, attrs, selfClosing, line}]
 */
function tokenize(source) {
  const tokens = []
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let match
  while ((match = re.exec(source)) !== null) {
    const raw = match[0]
    if (raw.startsWith('<!--')) continue
    const line = source.slice(0, match.index).split('\n').length
    if (raw.startsWith('</')) {
      tokens.push({ type: 'close', tag: match[1], attrs: '', selfClosing: false, line })
    } else {
      tokens.push({
        type: 'open',
        tag: match[1],
        attrs: match[2] || '',
        selfClosing: match[3] === '/',
        line
      })
    }
  }
  return tokens
}

const hasIf = (attrs) => /(^|\s)wx:if\s*=/.test(attrs)
const hasElif = (attrs) => /(^|\s)wx:elif\s*=/.test(attrs)
const hasElse = (attrs) => /(^|\s)wx:else(?![-\w])\s*=/.test(attrs)
const hasElseIfTypo = (attrs) => /wx:else-if|wx:elseif/.test(attrs)

/** 校验单个 WXML：返回问题描述数组 */
function checkFile(file, source) {
  const problems = []
  const tokens = tokenize(source)
  const stack = []
  const lastClosedSibling = [] // 每个深度上"最近一个已闭合的兄弟元素"

  for (const token of tokens) {
    if (token.type === 'open') {
      const depth = stack.length
      if (hasElseIfTypo(token.attrs)) {
        problems.push(`${file}:${token.line} 使用了 wx:else-if/wx:elseif（WXML 只认 wx:elif）`)
      }
      if (hasElif(token.attrs) || hasElse(token.attrs)) {
        const prev = lastClosedSibling[depth]
        const prevOk = !!prev && (hasIf(prev.attrs) || hasElif(prev.attrs))
        if (!prevOk) {
          const label = hasElif(token.attrs) ? 'wx:elif' : 'wx:else'
          problems.push(`${file}:${token.line} ${label} 没有紧跟在同层级 wx:if/wx:elif 之后`)
        }
      }
      if (token.selfClosing) {
        lastClosedSibling[depth] = token
      } else {
        stack.push({ ...token, depth })
      }
    } else {
      const open = stack.pop()
      if (open) lastClosedSibling[open.depth] = open
    }
  }
  return problems
}

const root = path.join(__dirname, '..')
const files = collect(root, []).filter((f) => !f.includes('miniprogram_npm'))
assert.ok(files.length > 0, '未找到任何 WXML 文件，检查路径')

const all = []
for (const file of files) {
  all.push(...checkFile(path.relative(root, file).replace(/\\/g, '/'), fs.readFileSync(file, 'utf8')))
}

// 反向自检：故意造一个 wx:else-if + 悬挂 wx:elif，确认检查器真的能发现
const broken = [
  '<view wx:if="{{a}}">A</view>',
  '<view wx:else-if="{{b}}">B</view>',
  '<view wx:elif="{{c}}">C</view>'
].join('\n')
const brokenProblems = checkFile('self-check.wxml', broken)
assert.strictEqual(brokenProblems.length, 2, '自检用例应报出 1 处拼写 + 1 处悬挂')

assert.deepStrictEqual(all, [], `WXML 指令检查未通过：\n${all.join('\n')}`)
console.log(`wxml-directives.test.js 全部通过（扫描 ${files.length} 个 WXML）`)
