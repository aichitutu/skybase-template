const config = require('./config')
if (config.logFormat === 'json') require('./lib/logger').enable()

const sky = require('skybase')
const $ = require('meeko')
const SkyDB = require('j2sql2')

config.beforeMount = async () => {
  // 连接mysql

  const skyDB = new SkyDB({ mysql: config.mysql })
  // 创建mysql实例
  global.db = await skyDB.mysql

  /* j2sql老的方案
  // 连接mysql main实例
  const dbMain = require('j2sql')(config.mysqlMain)
  await $.tools.waitNotEmpty(dbMain, '_mysql')
  global.dbMain = dbMain

   // 连接redis
  const redis = createIoredis(config.redis)
  await redis.waitForConnected()
  global.redis = redis

  // 连接redis main实例
  const redisMain = createIoredis(config.redisMain)
  await redis.waitForConnected()
  global.redisMain = redisMain

  // 连接mq
  global.MQ = await createRbmq(config.rabbitMQ)

  // 连接kafka
  global.Kafka = await createKafka(config.kafka) */
}

sky.start(config, async () => {
  console.log(`${config.name} launched successfully`)
  console.log('http://127.0.0.1:13000/skyapi/mock/first', '查看mock例子')
})
