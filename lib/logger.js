'use strict'

const os = require('os')
const { AsyncLocalStorage } = require('async_hooks')

const ANSI_RE = /\x1b\[[0-9;]*m/g
const als = new AsyncLocalStorage()

function strip(str) {
  return typeof str === 'string' ? str.replace(ANSI_RE, '') : str
}

function serialize(args) {
  return args.map(a => {
    if (a === null || a === undefined) return String(a)
    if (typeof a === 'string') return strip(a)
    try { return JSON.stringify(a) } catch { return String(a) }
  }).join(' ')
}

function getCallerInfo() {
  const lines = new Error().stack.split('\n')
  const cwd = process.cwd() + '/'
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.includes('/lib/logger.js')) continue
    if (l.includes('node:internal') || l.includes('node:async_hooks')) continue
    const m = l.match(/\((.+):(\d+):\d+\)/) || l.match(/at (.+):(\d+):\d+/)
    if (m) return { file: m[1].replace(cwd, ''), line: +m[2] }
  }
  return {}
}

const CALLER_LEVELS = new Set(['warn', 'error'])

function createWriter(level) {
  return function (...args) {
    const { file, line } = CALLER_LEVELS.has(level) ? getCallerInfo() : {}
    const store = als.getStore()
    const ctx = store?.ctx
    const entry = {
      ts:      new Date()?.date2Str(),
      level,
      pid:     process.pid,
      host:    os.hostname(),
      file,
      line,
      traceId: store?.traceId || undefined,
      method:  ctx?.method || undefined,
      ip:      ctx?.ip || undefined,
      api:     ctx?.apiSetting?.controller || undefined,
      url:     ctx?.path || undefined,
      msg:     serialize(args)
    }
    Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k])
    process.stdout.write(JSON.stringify(entry) + '\n')
  }
}

function enable(_serviceName) {
  console.log   = createWriter('info')
  console.info  = createWriter('info')
  console.warn  = createWriter('warn')
  console.error = createWriter('error')
  console.debug = createWriter('debug')
}

module.exports = { enable, als }
