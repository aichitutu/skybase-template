'use strict'
const crypto = require('crypto')
const { als } = require('../lib/logger')

module.exports = async (ctx, next) => {
  const traceId = ctx.get('X-Request-ID') || crypto.randomUUID()
  ctx.set('X-Request-ID', traceId)
  await als.run({ ctx, traceId }, next)
}
