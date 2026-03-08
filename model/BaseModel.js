/**
 * ps. 此 BaseModel 需要被继承后使用，继承此类后，需要给子类定义以下字段
 *
 * _table 表名
 *
 * ps. 此类使用说明
 *
 * 说明1. 继承此类后，所有model都必须在每次网络请求时重新实例化，否则如果使用了事务，会打破事务的原子性。以下是详细解释
 *
 * 因为每次开始事务，需要调用本类的 setConn 方法，这将在此实例设置一个“事务中”的状态，如果所有网络请求共用同一个model实例，
 * 则所有网络请求中的数据库操作都会被认为是“事务中”的操作，万一事务回滚，则所有操作都回滚了。
 * 而如果每次新实例化，则不会共用状态。
 *
 * 说明2. 此类的所有对外方法，均可以使用await，当不使用await时，返回的是本类，可用于链式调用，
 * 当使用await后，会调用本类的then方法从执行生成好的sql语句，并返回数据库操作结果，此时无法再加链式。
 * 例：
 *
 * const m = new BaseModel()
 * const result = m.has({id:1}) // 此时不会执行数据库操作，result就是m
 * const result = await m.has({id:1}) // 此时会执行数据库操作，result是操作结果
 * */
const mysql = require('mysql2')
const $  = require('meeko')
const config = require('../config')
const showSql = config.showSql
const sqlBuilder = require('../lib/sql_builder')
const wordId = config.port ? config.port % 32 : 1
const multipleStatements = config.mysql?.multipleStatements

const snowflake = new $.Snowflake(wordId, 1, process.pid)

/**
 * @template T
 */
class BaseModel {
  /**
    * db与conn的区别是，db是完整的mysql实例，它里面有连接池，而conn是它连接池里的其中一个连接，
    * 如果传了conn，则只使用该conn执行sql语句，但是会用db检查表是否存在
    * */
  constructor(conn, db) {
    this.db = db || global.db
    this.conn = conn || false // 执行时使用的连接
    // this.sqls = [] // 有可能批量执行，一般是insert方法会这样，此时会生成多少sql语句
    this.sql = ''
    this.formatResult = '' // 根据不同情况格式化返回结果

    this.lastErr = null

    this.__col = '*' // 当前select的字段
    this._pageData = {} // 使用 page 函数时，这个字段才有用

    this._table = '' // 此子类的表，没有配置此属性会报错
    this._dFlag = false // 此表有没有 是否已删除 字段，且它叫什么
    this._cTime = false // 此表有没有 创建时间 字段，且它叫什么
    this._mTime = false // 此表有没有 上次修改时间 字段，且它叫什么
    this._path = false // 树结构的表需要这个字段，否则有的函数没法用

    this._sid = false // 如果需要这里面自动生成sid，则需要配置这个字段
    this.lastSid = '' // 如果需要自动生成sid，生成好sid之后，这里会被设置为最新的sid

    this._dateCols = [] // 数据库中类型为date的字段，如果填了这个字段，则会把这些字段改为 YYYY-MM-DD HH:mm:ss

    this.__debuging = false // 本次是否需要debug
    this.__preventDebug = false // 如果开启了全局debug，而某次执行查询不需要debug时
  }

  debug() {
    // $.log(this.sql)
    if (!this.__preventDebug) {
      this.__debuging = true
    }
    return this
  }

  // 如果开启了全局debug，可以用这个来取消单次debug
  noDebug() {
    this.__preventDebug = true
    return this
  }

  /**
    * 查一个sid或多个sid，但只返回第一个符合的数据
    * */
  getBySid(sid, col) {
    return this.get({
      sid
    }, col)
  }

  /**
    * 查多个sid
    * */
  getBySids(sids, col) {
    return this.select({
      sid: sids
    }, col)
  }

  /**
    * 查一个id或多个id，但只返回第一个符合的数据
    * */
  getByID(id, col) {
    return this.get({ id }, col)
  }

  /**
    * 根据多个id，查询所有符合的数据
    * @param ids array 传入数组，每个数组子项是一个id，如果这里面有无法转为整数的内容，将返回空数组
    * @param col array|string 字符串*，表示所有列都查，字符串表示只查其中一个列，查出来的结果会只有这一列。
    * @param order 可以传 select 中允许的值
    * */
  getByIDs(ids, col, order) {
    if (!ids || !ids.length) {
      return []
    }

    // 防sql注入
    let err = false
    ids.map((item) => {
      item = parseInt(item)
      if (isNaN(item)) {
        err = true
      }
      return item
    })
    if (err) {
      return []
    }
    if (order === 'byID') {
      order = {
        id: `FIELD(\`id\`, ${ids.join(',')})`
      }
    }
    return this.select({ id: ids }, col, order, ids.length)
  }

  /**
    * 判断符合某条件的数据是否存在
    * 存在则返回1，不存在返回null
    * */
  has(where) {
    return this.get(where, '1')
  }

  /**
    * 只取一行数据
    * */
  get(where, col, order, offset) {
    this.__col = col
    this.sql = sqlBuilder.select(this._tb, where, col, order, 1, offset)
    this.formatResult = 'get'
    return this
  }

  /**
    * 多行查询
    * @param where
    * @param col
    * @param order 传对象，这样：{c_time:'desc',id:'desc'}
    * @param limit
    * @param offset
    * @param groupBy 直接传字符串，多个用英文逗号隔开
    * */
  select(where, col, order, limit, offset, groupBy) {
    this.__col = col
    this.sql = sqlBuilder.select(this._tb, where, col, order, limit, offset, groupBy)
    this.formatResult = 'select'
    return this
  }

  /**
   * 是select的分页版本
   * @param where 这个参数可以是对象,会自动解析成sql语句.也可以直接是string,会认为这是where内的sql语句(不要在string写where单词),建议还是使用数组,
   * @param col
   * @param order
   * @param page
   * @param pageSize
   * @param needTotal
   * @param groupBy
   * */
  page(where, col, order, page, pageSize, needTotal, groupBy) {
    page = page && page > 1 ? page : 1
    pageSize = pageSize && pageSize > 0 ? (Math.min(10000, pageSize)) : 15

    this.select(where, col, order, pageSize, (page - 1) * pageSize, groupBy)
    this.formatResult = 'page'
    this._pageData = {
      page, pageSize, needTotal, where
    }
    return this
  }

  /**
    * 更新数据，where
    * @param where 为了防止出错，这个参数必填，并且不能为空对象
    * @param data 要改成的数据
    * @param limit 为了防止误修改更多数据，这个参数默认为1，可以把它改为0，则不限制修改条数
    * @param allowEmpty 如果非要把where设为空，就把这个字段设为true
    * @param noUpdateTime 默认更新 this._mTime 为当前时间
    * */
  update(where, data, limit = 1, noUpdateTime = false, allowEmpty = false) {
    if (this._mTime && !data[this._mTime] && !noUpdateTime) {
      data[this._mTime] = $.now().format('YYYY-MM-DD HH:mm:ss')
    }
    this.sql = sqlBuilder.update(this._tb, where, data, limit, allowEmpty)
    this.formatResult = 'update'
    return this
  }

  /**
    * 删除
    * @param where
    * @param limit
    * @param allowEmpty 如果非要把where设为空，就把这个字段设为true
    * @param isSoft 是否软删除，默认true。只有配置了 this._dFlag 这个属性才能软删除，否则这个参数必须手动设为true
    * */
  destory(where, limit = 1, allowEmpty = false, isSoft = true) {
    if (isSoft) {
      if (!this._dFlag) {
        return this
      }
      this.update(where, {
        [this._dFlag]: 1
      }, limit, allowEmpty)
    } else {
      this.sql = sqlBuilder.delete(this._tb, where, limit, allowEmpty)
      this.formatResult = 'delete'
    }
    return this
  }

  /**
    * 对应sql的insert
    * @param data array|object 可以传入一个对象，也可以传入多个对象
    * @param [returnOriData] bool 是否返回mysql原始的数据
    * @returns {this & Promise<number | any>} 默认返回最新的自增id
    * */
  insert(data, returnOriData) {
    this.inputDatas = {
      data,
      returnOriData
    }
    const isMult = data instanceof Array
    if (!isMult) {
      data = [data]
    }
    if (this._cTime || this._mTime || this._sid) {
      const time = $.now().format('YYYY-MM-DD HH:mm:ss')
      for (let i = 0; i < data.length; i++) {
        if (this._cTime && !data[i][this._cTime]) {
          data[i][this._cTime] = data[i][this._cTime] || time
        }
        if (this._mTime && !data[i][this._mTime]) {
          data[i][this._mTime] = data[i][this._mTime] || time
        }
        if (this._sid && !data[i][this._sid]) {
          this.lastSid = BaseModel.createSid()
          if (!this.lastSid || this.lastSid < 0) {
            return 0 // 没有sid是很严重的一件事
          }
          data[i][this._sid] = this.lastSid
        }
      }
    }
    this.sql = sqlBuilder.insert(this._tb, data)
    this.formatResult = returnOriData ? 'insertOriData' : (isMult ? 'insertMult' : 'insert')
    return this
  }
  insertOrUpdate(data, dupkeys, returnOriData) {
    this.inputDatas = {
      data,
      returnOriData
    }
    const isMult = data instanceof Array
    if (!isMult) {
      data = [data]
    }
    if (this._cTime || this._mTime || this._sid) {
      const time = $.now().format('YYYY-MM-DD HH:mm:ss')
      for (let i = 0; i < data.length; i++) {
        if (this._cTime && !data[i][this._cTime]) {
          data[i][this._cTime] = data[i][this._cTime] || time
        }
        if (this._mTime && !data[i][this._mTime]) {
          data[i][this._mTime] = data[i][this._mTime] || time
        }
        if (this._sid && !data[i][this._sid]) {
          this.lastSid = BaseModel.createSid()
          if (!this.lastSid || this.lastSid < 0) {
            return 0 // 没有sid是很严重的一件事
          }
          data[i][this._sid] = this.lastSid
        }
      }
    }
    this.sql = sqlBuilder.insertOrUpdate(this._tb, data, dupkeys)
    this.formatResult = returnOriData ? 'insertOriData' : (isMult ? 'insertMult' : 'insert')
    return this
  }
  insertNotExists(data, dupkeys, returnOriData) {
    this.inputDatas = {
      data,
      returnOriData
    }
    if (this._cTime || this._mTime || this._sid) {
      const time = $.now().format('YYYY-MM-DD HH:mm:ss')
      if (this._cTime && !data[this._cTime]) {
        data[this._cTime] = data[this._cTime] || time
      }
      if (this._mTime && !data[this._mTime]) {
        data[this._mTime] = data[this._mTime] || time
      }
      if (this._sid && !data[this._sid]) {
        this.lastSid = BaseModel.createSid()
        if (!this.lastSid || this.lastSid < 0) {
          return 0 // 没有sid是很严重的一件事
        }
        data[this._sid] = this.lastSid
      }
    }
    this.sql = sqlBuilder.insertNotExists(this._tb, data, dupkeys)
    this.formatResult = returnOriData ? 'insertOriData' : 'insert'
    return this
  }

  replace(data) {
    this.inputDatas = {
      data
    }
    const isMult = data instanceof Array
    if (!isMult) {
      data = [data]
    }
    if (this._cTime || this._mTime || this._sid) {
      const time = $.now().format('YYYY-MM-DD HH:mm:ss')
      for (let i = 0; i < data.length; i++) {
        if (this._cTime && !data[i][this._cTime]) {
          data[i][this._cTime] = data[i][this._cTime] || time
        }
        if (this._mTime && !data[i][this._mTime]) {
          data[i][this._mTime] = data[i][this._mTime] || time
        }
        if (this._sid && !data[i][this._sid]) {
          this.lastSid = BaseModel.createSid()
          if (!this.lastSid || this.lastSid < 0) {
            return 0 // 没有sid是很严重的一件事
          }
          data[i][this._sid] = this.lastSid
        }
      }
    }
    this.sql = sqlBuilder.replace(this._tb, data)
    this.formatResult = 'upsert'
    return this
  }

  /**
    * 删除
    * @param where
    * @param limit
    * @param allowEmpty 如果非要把where设为空，就把这个字段设为true
    * @param isSoft 是否软删除，默认true。只有配置了 this._dFlag 这个属性才能软删除，否则这个参数必须手动设为true
    * */
  delete(where, limit = 1, allowEmpty = false, isSoft = true) {
    return this.destory(where, limit, allowEmpty, isSoft)
  }

  // *** 树结构 ***

  /**
    * 获取树结构中，某节点的所有子集，可以指定获取的level级，比如获取广东省的所有区/县级行政单位，此时获取的是下下级的数据
    * @param pid
    * @param col
    * @param level 这里的每个节点都能指定一个级别
    * @return array
    * */
  treeGetSons(pid, col, level) {
    const where = {}

    // 一般会设置把dFlag和其它字段组合索引，所以这个要在前面
    if (this._dFlag) {
      where[this._dFlag] = 0
    }
    where.pid = pid

    if (level) { }

    return this.select(where, col)
  }

  /**
    * 获取某节点的所有上级节点
    * @param id
    * @param col
    * @param parentNum int 可以指定获取的节点数，这个数值不含自己本身，比如传入一个南山区的id，此参数传2，则查出来是：广东 深圳 南山。传0则表示所有都要
    * */
  async treeGetPathByID(id, col, parentNum) {
    if (!this._path) {
      throw new Error(`${this._tb}的model需要有this._path参数`)
    }
    const colIsStr = typeof col === 'string'
    let thisNode = await this.getByID(id, !col || col === '*' ? '*' : (colIsStr ? [this._path, col] : [this._path, ...col]))
    if (!thisNode) {
      return []
    }

    let pathIDs = thisNode.path.split(',').filter((item) => {
      return !!item && parseInt(item) !== parseInt(id)
    })

    if (parentNum) {
      pathIDs = pathIDs.slice(-parentNum)
    }

    const parents = await this.getByIDs(pathIDs, col) || []

    if (col && col !== '*') {
      if (colIsStr) {
        thisNode = thisNode[col]
      } else if (!col.includes(this._path)) {
        delete thisNode[this._path]
      }
    }

    parents.push(thisNode)
    return parents
  }
  // *** 树结构 ***

  // ----- 以下是基础方法 -----

  // tb 属性的get方法
  get _tb() {
    if (!this._table) {
      throw new Error('未定义this._table')
    }
    if (!this.db[this._table]) {
      throw new Error(`${this._table}表不存在，请检查`)
    }
    return this._table
  }

  then(fn) {
    this.run().then(fn)
    return this
  }

  /**
    * 运行sql语句
    *
    * 这会控制输出格式
    * 不同情况返回不同的类型：
    *
    * - select 返回一个数组，数组里是对象，即使无数据它也会是一个空数组
    *
    * - pluck 返回一个数组，数组里直接是指定的字段的数据，即使无数据它也会是一个空数组：
    * ['nickname1','nickname2','nickname3']
    *
    * - first 如果传入first方法是一个参数且它是字符串，则只返回查询的那个数据，数据是什么格式就是什么，无数据是undefined还是null来着：
    * 'nickname1'
    * 如果是其它的，则回传一个对象，好像对象是叫TextRow吧，无数据是undefined还是null来着：
    * {nickname:'nickname1'}
    *
    * - insert 一条数据时返回一个int类型，表示新的id：
    * 1553
    *
    * - insert 多条数据时，返回以下数据，其中insertId是第一条新数据的id，意味着后续的新数据id在它基础上++：
    * ResultSetHeader {
       fieldCount: 0,
       affectedRows: 3,
       insertId: 14,
       info: 'Records: 3  Duplicates: 0  Warnings: 0',
       serverStatus: 2,
       warningStatus: 0
      }
    *
    * - delete、update、counter 都是返回本次操作受影响的条数，int类型
    * */
  async run() {
    const conn = this.conn || this.db._mysql // db._mysql是连接池，直接使用它就会自动取一个连接来执行
    let rows
    const start = Date.now()
    try {
      if (!this.sql) {
        throw new Error('sql语句为空！')
      }
      if (showSql) {
        this.debug()
      }
      if (typeof this.sql === 'object' && this.sql.sql) {
        // 如果你按照之前的建议改了 sql_builder 返回对象
        [rows] = await conn.query(this.sql.sql, this.sql.values)
      } else {
        // 如果还是纯字符串
        [rows] = await conn.query(this.sql)
      }
    } catch (e) {
      $.err('sql错误：', e.message, this.sql)
      this.lastErr = e

      rows = null
    }

    if (this.__debuging) {
      let debugData
      try {
        debugData = JSON.stringify({
          takeTime: Date.now() - start,
          sql: this.sql,
          result: rows
        })
      } catch (e) {
        debugData = {
          takeTime: Date.now() - start,
          sql: this.sql,
          result: '无法解析为json'
        }
      }
      $.log(debugData)
    }

    let retData
    if (rows === null) {
      retData = this.getDefaultReturn()
    } else {
      retData = rows
      try {
        // 格式化输出的值
        switch (this.formatResult) {
        case 'has':
          retData = !!(rows && rows.length)
          break
        case 'insert':
          retData = rows.insertId
          break
        case 'insertOriData':
          retData = rows
          break
        case 'insertMult':
          if (!rows || !rows.affectedRows || !rows.insertId) {
            retData = []
          } else {
            retData = new Array(rows.affectedRows).fill(rows.insertId).map((item, i) => item + i)
          }
          break
        case 'get':
        case 'select':
        case 'page':
          // 格式化时间
          if (this._dateCols.length &&
               (!this.__col || this.__col === '*' || this.__col instanceof Array || this._dateCols.includes(this.__col))
          ) {
            rows.some((row, i) => {
              this._dateCols.some((col) => {
                if (row[col]) {
                  rows[i][col] = new Date(row[col]).format()
                }
              })
            })
          }
          const pluck = typeof this.__col === 'string' && this.__col !== '*' ? this.__col : ''
          if (this.formatResult === 'get') {
            retData = pluck ? (rows[0] && rows[0][pluck]) : rows[0]
          } else {
            retData = pluck ? rows.map((item) => item[pluck]) : rows
          }
          if (this.formatResult === 'page') {
            // 只要是有分页需求的，就要这个数据结构
            retData = {
              page: this._pageData.page,
              page_size: this._pageData.pageSize,
              more_page: retData.length >= this._pageData.pageSize ? true : false,
              total: 0, // -1表示未查询总共有多少页，移动端一般不需要查
              list: retData
            }
            if (this._pageData.needTotal) {
              if (retData.page === 1 && retData.list.length < retData.page_size) { // 1是第一页,这种情况就无需查数据库
                retData.total = retData.list.length
              } else {
                const sql = sqlBuilder.select(this._table, this._pageData.where || {}, 'count(1) as co')
                const [data] = await conn.query(sql)
                retData.total = data[0].co || data[0].co === 0 ? parseInt(data[0].co) : 0
              }
            }
          }
          break
        case 'delete':
        case 'update':
          retData = rows.affectedRows
        }
      } catch (e) {
        $.err('格式化返回值错误：', this.sql, rows, e.stack)
        retData = this.getDefaultReturn()
      }
    }

    // 这些不要忘记清了
    this.resetState()
    return retData
  }

  // 获取一个默认的返回结构体，一般是数据库操作报错之后会用到这个结构体
  getDefaultReturn() {
    let ret
    // 不同类型返回不同的默认值，否则外面以为没报错，直接结构了里面的东西，就gg了
    switch (this.formatResult) {
    case 'has':
      ret = false
      break
    case 'insert':
      ret = 0
      break
    case 'insertOriData':
      ret = {}
      break
    case 'insertMult':
      ret = []
      break
    case 'delete':
    case 'update':
      ret = 0
      break
    case 'page':
      ret = {
        page: this._pageData.page,
        page_size: this._pageData.pageSize,
        more_page: false,
        total: 0, // -1表示未查询总共有多少页，移动端一般不需要查
        list: []
      }
      break
    case 'select':
      ret = []
      break
    case 'get':
    default:
      ret = null
    }
    return ret
  }

  // 重置状态，有可能这个类要多次使用
  resetState() {
    this.sql = ''
    this.__col = '*'
    this.formatResult = ''
    this._pageData = {}
    this.inputDatas = undefined
    this.__debuging = false
    this.__preventDebug = false
  }

  /**
    * 设置本model使用的连接
    * 用途：开启事务后，把事务所用的数据库连接设置进来，后续的所有查询都会使用这个连接
    * 所以要注意在事务执行完毕后要调用释放连接
    * */
  setConn(conn) {
    this.conn = conn
  }

  /**
    * 释放本model使用的连接
    * */
  releaseConn() {
    this.conn = false
  }
  // ----- 以下是静态方法 -----

  /**
    * 执行事务
    * @author hhh
    * @param {function | string} fn 可传入string类型的sql语句，多条使用半角分号分隔。也可以传入一个async函数。
    * @param {Object} [conn] 数据库连接
    * @param {Object} [db] 数据库实例，如果传了conn，这个参数可以不传
    *
    * 如果是async函数，只有此参数函数返回值全等于true，才提交，否则回滚，且此参数函数的返回值会原封不动地作为此函数的返回值。
    *
    * ps. 在fn中执行的数据库操作，要用传回的连接执行，否则与此不用同一个数据库连接是无法回滚的
    * */
  static async transaction(fn, conn, db) {
    if (!conn) {
      const pool = (db || global.db)._mysql
      conn = await pool.getConnection()
    }
    let r = null

    if (typeof fn === 'function') {
      try {
        await conn.beginTransaction()

        r = await fn(conn)

        if (r === true) {
          await conn.commit()
        } else {
          await conn.rollback()
        }
      } catch (e) {
        $.err(e && e.stack)
        await conn.rollback()

        $.err('事务错误(已回滚)：', e.stack)

        return null
      }
      await conn.release()
      return r
    } else {
      let sqlAry = multipleStatements ? [fn] : fn.split(';')
      const r = []
      let i = 0
      sqlAry = sqlAry.filter(item => {
        return item.length > 0
      })
      try {
        await conn.beginTransaction()
        for (; i < sqlAry.length; i++) {
          const [result] = await conn.query(sqlAry[i])
          r[i] = result
        }
        await conn.commit()
        await conn.release()
        return r
      } catch (e) {
        await conn.rollback()
        await conn.release()
        $.err('transSql err sql ->', e.message, sqlAry[i])
        return -1
      }
    }
  }

  /**
    * 直接跑原生sql，如果不想用 global.db 来跑sql，可以使用其它 db._mysql.query(sql) 来跑
    * */
  static async query() {
    const args = [...arguments]
    const start = Date.now()

    let rows
    try {
      const [sql, params] = args
      [ rows ] = await db._mysql.query(sql, params)
    } catch (e) {
      $.err('sql错误：', e.message, args)
      rows = false
    }

    if (showSql) {
      let debugData
      try {
        debugData = JSON.stringify({
          takeTime: Date.now() - start,
          args: args,
          result: rows
        }).substr(0, 2000)
      } catch (e) {
        debugData = {
          takeTime: Date.now() - start,
          result: '无法解析为json'
        }
      }
      $.log(debugData)
    }

    return rows
  }

  /**
   * Convert internal sql config to executable SQL string.
   *
   * @returns {string} Final SQL string
   */
  toSql(){
    if (!this.sql) return ''
    if (typeof this.sql === 'object' && this.sql.sql) {
      return mysql.format(this.sql.sql, this.sql.values)
    } else if (typeof this.sql === 'string') {
      return this.sql
    }
    return ''
  }

  static async multiQuery(sqls) {
    if (!Array.isArray(sqls) || sqls.length < 1) return false
    const cmds = []
    for(let sqlItem of sqls) {
      if(sqlItem.createdByHSqlBuilder) {
        const {sql, values}  = sqlItem
        cmds.push(mysql.format(sql, values))
      } else if(typeof sqlItem === 'string') {
        cmds.push(sqlItem)
      }
    }
    return BaseModel.query(cmds.join(';'))
  }

  /**
    * 给插入到数据库的数据，增加两个常用字段：c_time 和 m_time
    * @param obj obj 需要插入数据库的数据对象
    * @param needCreate boolean 是否需要 c_time
    * */
  static addCTime(obj, needCreate) {
    const time = $.now().format('YYYY-MM-DD HH:mm:ss')
    const newObj = { ...obj } // 拷贝一个
    newObj.m_time = time
    if (needCreate) {
      newObj.c_time = time
    }
    return newObj
  }

  static createSid() {
    return snowflake.nextId().toString()
  }

  /**
   * @template T
   * @param {String} table 表名
   * @param {Object} [conn] 数据库连接
   * @param {Object} [options] 可选的覆盖配置
   * @returns {BaseModel<T>}
   */
  static create(table, conn, options) {
    const instance = new BaseModel(conn)

    instance._table = table

    instance._dFlag = options ? options.dFlag || false : 'd_flag'
    instance._cTime = options ? options.cTime || false : 'c_time'
    instance._mTime = options ? options.mTime || false : 'm_time'
    instance._dateCols = options ? options.dateCols || [] : ['c_time', 'm_time']

    return instance
  }
}

module.exports = BaseModel
