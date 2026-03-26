/**
 * 数据表版本控制
 *
 * 用法：
 * node ./j2sql_migration.js [env] [action] [updateNum]
 *
 * [env] 环境，默认看config返回哪个了
 * [action] 动作。可选：update|undo|seeds
 * [updateNum] 数量。目前只有update接收此参数，表示更新多少个迁移文件
 * */

// ----- 配置 -----

const migrationTable = '_h_migration'

// ----- 配置 end -----
const util = require('util')
const fs = require('fs')
const path = require('path')
const $ = require('meeko')

global.$ = $

const flatten = arr =>
  arr.reduce((a, v) => a.concat(Array.isArray(v) ? flatten(v) : v), [])

class HMigration {
  /**
   * @param dbConfig 数据库配置
   * */
  constructor (dbConfig) {
    const mysql = getMysql()

    this.dbConfig = dbConfig
    this.db = mysql.createConnection(dbConfig)
  }

  async init () {
    console.log(`【数据库版本控制】本次数据库为 ${this.dbConfig.host}:${this.dbConfig.port} 的 ${this.dbConfig.database} 库`)
    const res = await this.query('show tables')
    const tables = res.map((item) => {
      return Object.values(item)[0]
    })
    if (!tables.includes(migrationTable)) {
      console.log('【数据库版本控制】无版本记录表格，正在创建')
      await this.createVersonTable()
      console.log('【数据库版本控制】版本记录表格创建成功')
    }
  }

  query () {
    const t = this
    const args = [...arguments]
    return new Promise(function (resolve, reject) {
      args.push(function (err, results, fields) {
        // console.log(11111, fields)
        if (err) {
          reject(err)
        } else {
          resolve(results)
        }
      })
      t.db.query.apply(t.db, args)
    })
  }

  async createVersonTable () {
    await this.query(`
  create table ${migrationTable}
  (
    id bigint(20) auto_increment primary key,
    version varchar(512) default '' not null comment '版本号，最后一条数据才是现在的版本号',
    batch int(9) default 0 not null comment '批次，每次一起升级的版本批次都是一样的，降级是每降一次会把最新的一批一起降',
    mig_time datetime not null comment '本次迁移的时间',
    constraint ${migrationTable}_id_uindex
      unique (id)
  )
  comment '此表由hMigration.js自动生成，如果删除，将丢失当前数据库版本的记录'
    `)
  }

  async getNowVerson () {
    const res = await this.query(`SELECT * FROM ${migrationTable} ORDER BY mig_time DESC,id DESC LIMIT 1`)
    return res.length ? res[res.length - 1] : {}
  }

  async getAllVerson () {
    const res = await this.query(`SELECT version FROM ${migrationTable}`)
    return res.length ? res.map((item) => item.version) : []
  }

  /**
   * 默认更新到最新版
   * @param num 往最新更新多少个版本，默认是更新到最新。migrations文件夹里有多少个文件就等于多少级
   * */
  async update (num) {
    console.log('【数据库版本控制】正在初始化')
    await this.init()

    // 读取文件
    const [vers, migs] = await getAllMigs()

    if (!migs.length) {
      console.log('【数据库版本控制】无升级文件')
      return
    }

    const { batch = 0 } = await this.getNowVerson()
    // console.log(`【数据库版本控制】现版本为：${version || '无'}`)
    // console.log(`【数据库版本控制】最新版本：${vers[vers.length - 1]}`)

    const allVersons = await this.getAllVerson()
    const needUpdateIndexs = []

    vers.some((ver, i) => {
      if (!allVersons.includes(ver)) {
        needUpdateIndexs.push(i)
      }
      if (num && needUpdateIndexs.length >= num) {
        return true
      }
    })

    const nowBatch = batch + 1

    if (!needUpdateIndexs.length) {
      console.log('【数据库版本控制】本次无需更新')
      return
    }

    const utils = new Utils(this.query.bind(this))

    // 把所有迁移文件检测一遍
    needUpdateIndexs.some((i) => {
      const item = migs[i]
      if (!item.up || !item.down) {
        throw new Error(`${vers[i]}没有up或者down方法，无法使用`)
      }
      if (Object.prototype.toString.call(item.up) !== '[object AsyncFunction]') {
        throw new Error(`${vers[i]}的up方法不是async函数，请使用async函数`)
      }
      if (Object.prototype.toString.call(item.down) !== '[object AsyncFunction]') {
        throw new Error(`${vers[i]}的down方法不是async函数，请使用async函数`)
      }
    })

    console.log('【数据库版本控制】即将更新的有：\n', needUpdateIndexs.map((i) => vers[i]))

    let nowRunning = ''
    // 开始升级数据库，但要有回滚措施（DDL方法是无法用事务回滚的）
    try {
      for (const i of needUpdateIndexs) {
        nowRunning = vers[i]
        const now = $.now().format('YYYY-MM-DD HH:mm:ss')
        const res = await migs[i].up(this.query.bind(this), utils)
        if (res === false) {
          console.error(`${nowRunning}的up函数返回false，已停止本次升级操作，之前成功执行的不会回退。`)
          break
        }
        await this.query(`INSERT INTO ${migrationTable} (version,batch,mig_time) VALUES ('${vers[i]}',${nowBatch},'${now}')`)
        console.log(`【数据库版本控制】已成功更新：${vers[i]}`)
      }
    } catch (e) {
      console.log(`【数据库版本控制】在执行${nowRunning}时出错，且不回退版本。`)
      console.error(e)
      let roleBackSucc = true
      // 有时执行的sql文件不按命名顺序，试过版本已经到00078了，还跑了00001，结果表已存在，就跑回退，把表删了
      // 因为DDL语句不能被回滚，所以不能用事务
      // for (;i >= startI; i--) {
      //   try {
      //     await migs[i].down(this.query.bind(this), utils)
      //     await this.query(`DELETE FROM ${migrationTable} WHERE version = '${vers[i]}'`)
      //   } catch (e) {
      //     roleBackSucc = false
      //     console.log(`【数据库版本控制】无法回滚${vers[i]}的操作，通常是${vers[i]}的down方法有问题：`)
      //     console.error(e)
      //   }
      // }
      if (roleBackSucc) {
        // console.log(`【数据库版本控制】已回滚本次所有操作`)
      }
    }
  }

  /**
   *
   * */
  async reUpdate () {

  }

  /**
   *
   * */
  async degrade () {}

  // 执行种子生成
  async seeds () {
    console.log('【数据库版本控制】正在执行种子')

    // 读取文件
    const [vers, seeds] = await getAllSeeks()

    if (!seeds.length) {
      console.log('【数据库版本控制】无种子文件')
      return
    }

    const utils = new Utils(this.query.bind(this))

    for (let i = 0; i < seeds.length; i++) {
      await seeds[i](this.query.bind(this), utils)
      console.log(`【数据库版本控制】已成功执行：${vers[i]}`)
    }
  }
}

// 给迁移文件用的工具库
class Utils {
  constructor (query) {
    this.query = query
  }

  /**
   * 给指定表添加索引
   * @param table
   * @param col obj {id: 'DESC', version:'ASC'}
   * @param unique 是否唯一索引
   * */
  async addIndex (table, col, unique) {
    // CREATE UNIQUE INDEX `_h_migration_id_version_uindex` ON `_h_migration` (id DESC, version DESC)
    let name = col
    let colStr = '`' + col + '`'
    if (col instanceof Array) {
      colStr = '`' + col.join('`,`') + '`'
      name = col.join('_')
    } else if (typeof col === 'object') {
      const colArr = []
      for (const [k, v] of Object.entries(col)) {
        colArr.push('`' + k + '`' + (!v || v.toUpperCase() === 'ASC' ? '' : ' DESC'))
      }
      colStr = colArr.join(',')
      name = colArr.join('_').replace(/`/g, '').replace(/\s/g, '_')
    }
    const indexName = `${table}_${name}_${unique ? 'u' : ''}index`
    await this.query(`create ${unique ? 'unique' : ''} index ${indexName} on \`${table}\` (${colStr})`)
  }

  /**
   * 给制定表添加主键索引
   * */
  async addPrimary (table, col) {
    // alter table user add primary key (id)
    await this.query(`alter table \`${table}\` add primary key (\`${col}\`)`)
  }

  /**
   * 给指定表添加字段
   * @param colSql 类似这样的sql：level tinyint(2) DEFAULT 0 NOT NULL COMMENT '哈哈'
   * @param afterCol 此新增字段跟在哪个原有字段后，默认是最后
   * */
  async addCol (table, colSql, afterCol) {
    await this.query(`ALTER TABLE ${table} ADD COLUMN ${colSql}`)
    if (afterCol) {
      await this.query(`ALTER TABLE ${table} MODIFY COLUMN ${colSql} AFTER ${afterCol}`)
    }
  }

  /**
   * 给指定表修改字段
   * @param colSql 类似这样的sql：level tinyint(2) DEFAULT 0 NOT NULL COMMENT '哈哈'
   * @param afterCol 此新增字段跟在哪个原有字段后，默认是最后
   * */
  async editCol (table, colSql, afterCol) {
    await this.query(`ALTER TABLE ${table} MODIFY COLUMN ${colSql}${afterCol ? ` AFTER ${afterCol}` : ''}`)
  }

  /**
   * 给指定表删除指定字段
   * @param col
   * */
  async dropCol (table, col) {
    await this.query(`ALTER TABLE ${table} DROP ${col}`)
  }

  /**
   * 对应sql的insert
   * */
  async insert (table, data) {
    const isMult = data instanceof Array
    if (!isMult) {
      data = [data]
    }
    // insert into `coords` (`x`, `y`) values (20, DEFAULT), (DEFAULT, 30), (10, 20)

    const values = []

    let fields = data.map((item) => {
      return Object.keys(item)
    })

    // 拉平+去重
    fields = Array.from(new Set(flatten(fields)))

    // values.push(...fields)

    const dataArr = []
    data.forEach((item) => {
      dataArr.push(fields.map((field) => {
        if (item[field] === undefined || item[field] === null) {
          return 'DEFAULT'
        } else {
          values.push(item[field])
          return '?'
        }
      }))
    })

    const sql = `insert into \`${table}\` (\`${fields.join('`,`')}\`) values (${dataArr.join('),(')})`
    const res = await this.query(sql, values)
    if (isMult) {
      return res
    } else {
      return res && res.insertId
    }
  }

  async transaction (fn) {
    await this.query('START TRANSACTION;')
    try {
      const res = await fn()
      if (res === true) {
        await this.query('COMMIT;')
      } else {
        await this.query('ROLLBACK;')
      }
      return res
    } catch (e) {
      console.log('【数据库版本控制】事务中报错：', e)
      await this.query('ROLLBACK;')
    }
  }
}

async function start () {
  console.log('【数据库版本控制】开始！')
  if (process.argv[2]) {
    process.env.NODE_ENV = process.argv[2]
  }
  const config = require('../config').mysql
  const mig = new HMigration(config)

  switch (process.argv[3]) {
  case 'undo': // 还没写撤消操作
    break
  case 'seeds': // 执行种子文件
    await mig.seeds()
    break
  default:
    await mig.update(parseInt(process.argv[4] || 0))
  }
}

start().then(function () {
  console.log('【数据库版本控制】已完成！')
  process.exit()
}).catch(function (err) {
  console.error(err)
  console.log('【数据库版本控制】已失败！')
  process.exit()
})

async function getAllMigs () {
  const files = (await util.promisify(fs.readdir)(path.join(__dirname, './migrations')) || []).filter(file => /\.js$/.test(file))
  const fns = []
  for (const item of files) {
    fns.push(require(`./migrations/${item}`))
  }
  return [files, fns]
}

async function getAllSeeks () {
  const files = await util.promisify(fs.readdir)(path.join(__dirname, './seeds'))
  const fns = []
  for (const item of files) {
    fns.push(require(`./seeds/${item}`))
  }
  return [files, fns]
}

function getMysql () {
  let mysql
  if (!mysql) {
    try {
      mysql = require('mysql')
      console.log('【数据库版本控制】正在使用mysql库')
    } catch (e) {}
  }
  if (!mysql) {
    try {
      mysql = require('mysql2')
      console.log('【数据库版本控制】正在使用mysql2库')
    } catch (e) {}
  }
  if (!mysql) {
    throw new Error('请安装mysql模块或者mysql2模块')
  }
  return mysql
}
