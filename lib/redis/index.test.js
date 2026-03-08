global.$ = require('meeko')

const assert = require('assert')
const config = require('../../config')

const redis = require('skybase/sky-module/create_ioredis')(config.redis)
const hRedis = new (require('./index'))(redis)

const useKey = 'unitTest:test1'
const testData = '哈哈单元测试来的'

describe('hRedis单元测试', () => {
  before('启动', async function () {
    await redis.waitForConnected()
  })

  describe('字符串/整型', async function () {
    it('set', async function () {
      const res = await hRedis.set(useKey, testData, 1)
      assert.strictEqual(res, true)
    })
    it('ttl', async function () {
      const res = await hRedis.ttl(useKey)
      assert.strictEqual(res, 1)
    })
    it('ttl-不存在', async function () {
      const res = await hRedis.ttl('hnfeiheeqwdsfgerg')
      assert.strictEqual(res, -2)
    })
    it('get', async function () {
      const res = await hRedis.get(useKey)
      assert.strictEqual(res, testData)
    })
    it('1秒后再get', async function () {
      await $.wait(1000)
      const res = await hRedis.get(useKey)
      assert.strictEqual(res, null)
    })
    it('ttl-过期后再取', async function () {
      const res = await hRedis.ttl(useKey)
      assert.strictEqual(res, -2)
    })
    it('del', async function () {
      await hRedis.set(useKey, testData, 2)
      const res = await hRedis.del(useKey)
      assert.strictEqual(res, true)
    })
    it('del后再查询是否真的删除了', async function () {
      const res = await hRedis.get(useKey)
      assert.strictEqual(res, null)
    })
    it('incrby', async function () {
      const res = await hRedis.incrby(useKey)
      assert.strictEqual(res, true)
    })
    it('incrby是否有值', async function () {
      const res = await hRedis.get(useKey)
      assert.strictEqual(res, '1')
    })
    it('incrby21', async function () {
      const res = await hRedis.incrby(useKey, 21)
      assert.strictEqual(res, true)
    })
    it('incrby21是否有值', async function () {
      const res = await hRedis.get(useKey)
      assert.strictEqual(res, '22')
    })
  })

  describe('哈希', async function () {
    it('hset', async function () {
      const res = await hRedis.hset(useKey, 'filedTest', testData, 1)
      assert.strictEqual(res, 1)
    })
    it('hIncrby', async function () {
      const res = await hRedis.hIncrby(useKey, 'filedTestNumber', 1)
      assert.strictEqual(res, 1)
    })
    it('hIncrby+', async function () {
      const res = await hRedis.hIncrby(useKey, 'filedTestNumber', 10)
      assert.strictEqual(res, 11)
      const res2 = await hRedis.hget(useKey, 'filedTestNumber')
      assert.strictEqual(res2, '11')
    })
    it('hget', async function () {
      const res = await hRedis.hget(useKey, 'filedTest')
      assert.strictEqual(res, testData)
    })
    it('hdel', async function () {
      const res = await hRedis.hdel(useKey, 'filedTest')
      assert.strictEqual(res, 1)
    })
    it('hget', async function () {
      const res = await hRedis.hget(useKey, 'filedTest')
      assert.strictEqual(res, null)
    })
    it('expire', async function () {
      await hRedis.hset(useKey, 'filedTest', testData, 1)
      await $.wait(1000)
      const res = await hRedis.hget(useKey, 'filedTest')
      assert.strictEqual(res, null)
    })
    it('hgetall', async function () {
      await hRedis.hset(useKey, 'filedTest', testData, 1)
      await hRedis.hset(useKey, 'filedTest2', testData, 1)
      const res = await hRedis.hgetall(useKey)
      assert.strictEqual(JSON.stringify(res), JSON.stringify({
        filedTest: testData,
        filedTest2: testData
      }))
    })
  })

  describe('测试“...”用在传参时的语法', async function () {
    it('1', async function () {
      function a (a, b, c) {
        assert.strictEqual(JSON.stringify([a, b, c]), '[1,2,3]')
      }
      a(...[1, 2], 3)
    })
  })
})

describe('有序集合', () => {
  before('启动', async function () {
    await redis.waitForConnected()
  })

  it('zAdd', async function () {
    const res = await hRedis.zAdd(useKey, testData, parseInt(new Date() / 1000), 1)
    assert.strictEqual(res, 1)
  })

  it('zAdd mult，顺便替换', async function () {
    const res = await hRedis.zAdd(useKey, {
      [testData]: 1,
      [testData + '2']: 2,
      [testData + '3']: 3,
      [testData + '4']: 4,
      [testData + '5']: 3
    }, 2)
    assert.strictEqual(res, 5)
  })
  it('zRem，删除多个', async function () {
    const res = await hRedis.zRem(useKey, [testData, testData + '2'])
    assert.strictEqual(res, 2)
  })
  it('zRem，验证是否已删除', async function () {
    const res = await hRedis.zScore(useKey, testData)
    assert.strictEqual(res, null)
  })
  it('把删除的加回来', async function () {
    await hRedis.zAdd(useKey, {
      [testData]: 1,
      [testData + '2']: 2
    }, 2)
  })
  it('zRemAndMin，删除多个', async function () {
    const res = await hRedis.zRemAndMin(useKey, testData + '5')
    assert.strictEqual(res, 3)
  })
  it('zRem，验证是否已删除', async function () {
    assert.strictEqual(await hRedis.zScore(useKey, testData), null)
    assert.strictEqual(await hRedis.zScore(useKey, testData + '2'), null)
    assert.strictEqual(await hRedis.zScore(useKey, testData + '5'), null)
    assert.strictEqual(await hRedis.zScore(useKey, testData + '3'), '3')
  })
  it('把删除的加回来', async function () {
    await hRedis.zAdd(useKey, {
      [testData]: 1,
      [testData + '2']: 2
    }, 2)
  })
  it('zAdd score传非数字测试', async function () {
    const res = await hRedis.zAdd(useKey, testData, '规划与风格')
    assert.strictEqual(res, 0)
  })
  it('用区间方式获取全部', async function () {
    const res = await hRedis.zRangeByScore(useKey, '-', '+', false)
    assert.strictEqual(res.length, 4)
  })
  it('用区间方式测试>和<', async function () {
    const res = await hRedis.zRangeByScore(useKey, '(1', '(4', false)
    console.log(res)
    assert.strictEqual(res.length, 2)
  })
  it('获取带score的', async function () {
    const res = await hRedis.zRangeByScore(useKey, '(1', '(4', true)
    console.log(res)
    assert.strictEqual(res.length, 4)
    assert.strictEqual(res[1], '2')
  })
  it('获取带score的对象', async function () {
    const res = await hRedis.zRangeByScore(useKey, '(1', '(4', { returnObj: true })
    console.log(res)
    assert.strictEqual(Object.keys(res).length, 2)
    assert.strictEqual(res[testData + '2'], '2')
  })
  it('获取一个成员的score', async function () {
    const res = await hRedis.zScore(useKey, testData + '3')
    console.log(res)
    assert.strictEqual(res, '3')
  })
  it('获取多个成员的score', async function () {
    const res = await hRedis.zScore(useKey, ['efasdw', testData + '2', testData + '3'])
    console.log(res)
    assert.strictEqual(JSON.stringify(res), JSON.stringify([null, '2', '3']))
  })
  it('获取一个不存在成员的score', async function () {
    const res = await hRedis.zScore(useKey, 'ehfiuhdfishd')
    assert.strictEqual(res, null)
  })
  it('删除<=1的', async function () {
    const res = await hRedis.zRemRangeByScore(useKey, '-', 1)
    assert.strictEqual(res, 1)
  })
  it('删除>=4的数据', async function () {
    const res = await hRedis.zRemRangeByScore(useKey, 4, '+')
    assert.strictEqual(res, 1)
  })
  it('获取指定区间内的数据，指定了数量', async function () {
    const res = await hRedis.zRangeByScore(useKey, '-', parseInt(new Date() / 1000), false, 0, 2)
    assert.strictEqual(res.length, 2)
    assert.strictEqual(res[0], testData + '2')
  })
  it('1秒后过期', async function () {
    await $.wait(1000)
    const res = await hRedis.zRangeByScore(useKey, 0, parseInt(new Date() / 1000), false, 0, 2)
    assert.strictEqual(res.length, 0)
  })
})

describe('无需集合', () => {
  before('启动', async function () {
    await redis.waitForConnected()
  })

  it('sadd单个', async function () {
    const res = await hRedis.sadd(useKey, testData, 1)
    assert.strictEqual(res, 1)
  })
  it('sadd多个', async function () {
    const res = await hRedis.sadd(useKey, [
      testData,
      `${testData}1`,
      `${testData}2`,
      `${testData}3`,
      `${testData}4`,
      `${testData}5`
    ], 1)
    assert.strictEqual(res, 5)
  })
  it('sadd多个-检查是否真的存在', async function () {
    assert.strictEqual(await hRedis.sismember(useKey, `${testData}3`), true)
    assert.strictEqual(await hRedis.sismember(useKey, `${testData}5`), true)
  })
})

describe('单机锁-使用symbol key', () => {
  before('启动', async function () {
    await redis.waitForConnected()
  })

  // 有时reids是远程的，超时时间可以设长一点，否则有的单元测试测到的时候，锁就自动没了。
  const lockTimeout = 500

  it('验证锁功能是否只有一个能锁上', async function () {
    const lockFn = async (i) => {
      await $.wait(50 - i)
      const res = await hRedis.lock(useKey, lockTimeout, {
        symbolKey: true
      })
      return res && i
    }
    const fns = []
    for (let i = 0; i < 5; i++) {
      fns.push(lockFn(i))
    }
    const res = await Promise.all(fns)
    let succI = -1
    const succNum = res.reduce((prev, curr) => {
      if (curr !== false) {
        succI = curr
        return ++prev
      }
      return prev
    }, 0)
    console.log(`获得锁的index：${succI.toString()}`)
    assert.strictEqual(succNum, 1)
    await $.wait(lockTimeout)
  })

  it('手动解锁-symbolKey', async function () {
    const res1 = await hRedis.lock(useKey, lockTimeout, {
      symbolKey: true
    })
    assert.strictEqual(!!res1, true)
    assert.strictEqual(typeof res1, 'symbol')

    let res = await hRedis.lock(useKey, lockTimeout, {
      symbolKey: true
    })
    assert.strictEqual(!!res, false)

    res = await hRedis.unLock(useKey, Symbol('test'))
    assert.strictEqual(res, false)

    res = await hRedis.unLock(useKey, res1, {
      symbolKey: true
    })
    assert.strictEqual(res, true)

    res = await hRedis.lock(useKey, lockTimeout, {
      symbolKey: true
    })
    assert.strictEqual(!!res, true)
    await hRedis.unLock(useKey, res)
  })

  it('自动解锁', async function () {
    let res = await hRedis.lock(useKey, lockTimeout, {
      symbolKey: true
    })
    assert.strictEqual(!!res, true)

    await $.wait(lockTimeout)

    res = await hRedis.lock(useKey, lockTimeout, {
      symbolKey: true
    })
    assert.strictEqual(!!res, true)
  })
})
