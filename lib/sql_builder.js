/**
 * 构建sql语句，仅仅是构建，不会执行哦
 *
 * 用这里的方法构建的sql语句，会是这种形式返回：
 * {
 * sql: 'SELECT * FROM `books` WHERE `author` = ?',
 * timeout: 40000, // 40s
 * values: ['David']
 * }
 *
 * 这种格式可以直接传入mysql的query的第一个参数
 * */
const mysql = require('mysql2')

const flatten = arr =>
  arr.reduce((a, v) => a.concat(Array.isArray(v) ? flatten(v) : v), [])

const trim = function (str) {
  return str.replace(/^\s+|\s$/, '')
}

/**
 * 用引号括起key值，可多次调用该方法，不会重复加引号
 *
 * k可以是：
 * a.b        某表的某字段
 * count(1)   带括号的函数
 * `a`.`b`    已有引号的
 * a.b as c   带 as 的
 *
 * @param {string} k
 * @param {string} [defTable] 默认表，就是如果字段没指定是哪个表的，可以通过这个参数给字段加一个
 * */
const quotK = (k, defTable) => {
  // 判断是否需要拆开转义
  if (k.includes(' as ')) {
    return k.split(' as ').map(v => quotK(v)).join(' as ')
  }
  // 已括起和函数、纯数字，都不转义
  if (k.includes('`') || k.includes('(') || /^\d+$/.test(k)) {
    return k
  }
  if (k.includes('.')) {
    return k.split('.').map(quotBase).join('.')
  }
  return (defTable ? `${quotBase(defTable)}.` : '') + quotBase(k)
}

// const quotBase = k => k === '*' ? k : `\`${k}\``

const quotBase = k => {
  if (k === '*') return k
  return mysql.escapeId(k)
}

module.exports = {
  timeout: 0,
  /**
   * 设置超时时间
   * @param mil 超时时间，单位毫秒
   * */
  setTimeout (mil) {
    this.timeout = mil
  },

  /**
   * 对应sql的insert
   * */
  insert (table, data) {
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

    // const sql = `INSERT INTO \`${table}\` (\`${fields.join('`,`')}\`) VALUES (${dataArr.join('),(')})`
    // return this.return(sql, values)

    const headerSql = mysql.format('INSERT INTO ?? (??)', [table, fields])
    const sql = `${headerSql} VALUES (${dataArr.join('),(')})`

    return this.return(sql, values)
  },
  /**
   * 对应sql的insert or update
   * */
  insertOrUpdate (table, data, dupkeys) {
    const isMult = data instanceof Array
    if (!isMult) {
      data = [data]
    }

    const values = []

    let fields = data.map((item) => {
      return Object.keys(item)
    })

    // 拉平+去重
    fields = Array.from(new Set(flatten(fields)))

    const dataArr = []
    data.forEach((item) => {
      dataArr.push(fields.map((field) => {
        const v = item[field]
        if (v === undefined || v === null) {
          return 'DEFAULT'
        }

        if (v instanceof Date) {
          values.push(v?.format('YYYY-MM-DD HH:mm:ss'))
        } else if (Buffer.isBuffer(v)) {
          values.push(v)
        } else if (typeof v === 'object') {
          values.push(JSON.stringify(v))
        } else {
          values.push(v)
        }

        return '?'
      }))
    })
    if(typeof dupkeys === 'string') dupkeys = [dupkeys]

    const dupStr = dupkeys.map(d => `${mysql.escapeId(d)} = VALUES(${mysql.escapeId(d)})`).join(',')
    const headerSql = mysql.format('INSERT INTO ?? (??)', [table, fields])
    const sql = `${headerSql} VALUES (${dataArr.join('),(')}) ON DUPLICATE KEY UPDATE ${dupStr}`

    return this.return(sql, values)
  },
  /**
   * 对应sql的insert not exists
   * */
  insertNotExists (table, data, dupkeys) {
    const values = []
    const fields = Object.keys(data)
    const dataArr = fields.map( field => {
      values.push(data[field])
      return '?'
    })
    if(typeof dupkeys === 'string') dupkeys = [dupkeys]
    dupkeys = dupkeys.map(d => {
      values.push(data[d])
      return `\`${d}\` = ?`
    })

    // const sql = `INSERT INTO \`${table}\` (\`${fields.join('`,`')}\`) SELECT ${dataArr.join(',')} FROM DUAL WHERE NOT EXISTS ( SELECT 1 FROM \`${table}\` WHERE ${dupkeys.join(' AND ')})`
    // return this.return(sql, values)
    const headerSql = mysql.format('INSERT INTO ?? (??)', [table, fields])

    // SELECT 这里的 dataArr 是 ?,?,? 这种，是安全的
    const sql = `${headerSql} SELECT ${dataArr.join(',')} FROM DUAL WHERE NOT EXISTS ( SELECT 1 FROM ${mysql.escapeId(table)} WHERE ${whereParts.join(' AND ')})`
    return this.return(sql, values)
  },

  /**
   * 对应sql的replace
   * */
  replace (table, data) {
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

    // const sql = `REPLACE INTO \`${table}\` (\`${fields.join('`,`')}\`) VALUES (${dataArr.join('),(')})`
    // return this.return(sql, values)
    const headerSql = mysql.format('REPLACE INTO ?? (??)', [table, fields])
    const sql = `${headerSql} VALUES (${dataArr.join('),(')})`

    return this.return(sql, values)
  },

  /**
   * 对应sql的 DELETE FROM
   * */
  delete (table, where, limit = 1, allowEmpty = false) {
    const [whereSqls, vals2] = this.whereMain(where)
    if (!(whereSqls || allowEmpty)) {
      return this.return('', [])
    }
    limit = ['number', 'string'].includes(typeof limit) ? +limit : 1
    const sql = `DELETE FROM ${mysql.escapeId(table)}${whereSqls ? (' WHERE ' + whereSqls) : ''}${limit ? ` LIMIT ${limit}` : ''}`
    return this.return(sql, vals2)
  },

  /**
   * 生成update语句
   * */
  update (table, where, data, limit = 1, allowEmpty = false) {
    const [colsSqls, vals1] = this.whereMain(data, 'update')
    if (!colsSqls) {
      return this.return('', [])
    }
    const [whereSqls, vals2] = this.whereMain(where)
    if (!(whereSqls.length || allowEmpty)) {
      return this.return('', [])
    }
    limit = ['number', 'string'].includes(typeof limit) ? +limit : 1

    const sql = `UPDATE ${mysql.escapeId(table)} SET ${colsSqls}${whereSqls ? (' WHERE ' + whereSqls) : ''}${limit ? ` LIMIT ${limit}` : ''}`
    return this.return(sql, [...vals1, ...vals2])
  },

  // 生成select语句
  select (table, where, col, order, limit, offset, groupBy) {
    const myWhere = (typeof where === 'object' && !Array.isArray(where)) ? { ...where } : where

    // 判断是否要给表设置别名
    let asTable = ''
    ;['as', 'AS'].some(d => {
      if (myWhere[d]) {
        asTable = myWhere[d]
        delete myWhere[d]
        return true
      }
    })

    // 判断是否有left join
    let leftJoins = []
    ;['LEFT JOIN', 'left join'].some(d => {
      if (myWhere[d]) {
        leftJoins = myWhere[d]
        delete myWhere[d]
        return true
      }
    })

    const leftJoin = this.leftJoin(leftJoins)

    const defTable = leftJoin ? (asTable || table) : ''

    // 选择的列
    let colsArr = []
    if (col) {
      if (typeof col === 'string') {
        colsArr.push(col)
      } else if (col instanceof Array) {
        colsArr = col
      } else {
        colsArr = Object.keys(col)
      }
      colsArr = colsArr.map(c => quotK(c, defTable))
    }

    // 排序
    const orderArr = []

    const limitStr = ['number', 'string'].includes(typeof limit) ? +limit : 0
    const offsetStr = parseInt(offset)
    if (order) {
      for (const [k, v] of Object.entries(order)) {
        const key = quotK(k, defTable)
        if (typeof v === 'string') {
          if (v === 'desc' || v === 'DESC') {
            orderArr.push(key + ' DESC')
          } else if (v === 'asc' || v === 'ASC') {
            orderArr.push(key + ' ASC')
          } else if (/^\w+\(.+\)$/.test(v)) {
            orderArr.push(v)
          }
        } else if (v === -1) {
          orderArr.push(key + ' DESC')
        } else {
          orderArr.push(key + ' ASC')
        }
      }
    }

    const [whereStr, vals] = this.whereMain(myWhere, 'select', defTable)

    // const sql = `SELECT ${colsArr.join(',') || '*'} FROM \`${table}\`` +
    //   (asTable ? ` AS ${asTable}` : '') +
    //   (leftJoin || '') +
    //   (whereStr ? ' WHERE ' + whereStr : '') +
    //   (groupBy ? ' GROUP BY ' + groupBy : '') + // 必须先 group by，否则会报sql错误
    //   (orderArr.length ? ' ORDER BY ' + orderArr.join(',') : '') +
    //   (limitStr ? (' LIMIT ' + limitStr) : '') +
    //   (offsetStr ? (' OFFSET ' + offsetStr) : '')
    // return this.return(sql, vals)

    let groupBySql = ''
    if (groupBy) {
      // 假设 groupBy 是字符串 'a, b'，我们拆分后转义
      const groups = groupBy.split(',').map(g => quotK(trim(g), defTable))
      groupBySql = ' GROUP BY ' + groups.join(',')
    }

    // 【修改点】Table 使用 escapeId，asTable 也转义（如果存在）
    let tableSql = mysql.escapeId(table)
    if (asTable) {
      tableSql += ` AS ${mysql.escapeId(asTable)}`
    }

    const sql = `SELECT ${colsArr.join(',') || '*'} FROM ${tableSql}` +
      (leftJoin || '') +
      (whereStr ? ' WHERE ' + whereStr : '') +
      groupBySql +
      (orderArr.length ? ' ORDER BY ' + orderArr.join(',') : '') +
      (limitStr ? (' LIMIT ' + limitStr) : '') +
      (offsetStr ? (' OFFSET ' + offsetStr) : '')
    return this.return(sql, vals)
  },

  // 生成where语句,可接收的数据格式更多,对象里还能用AND和OR
  whereMain (where, type, defTable) {
    if (typeof where === 'string') {
      return [where, []]
    }

    // 直接传 where里的sql语句和对应的值进来
    if (where instanceof Array) {
      if (type === 'select' && where.length > 0 && where[0] && typeof where[0] === 'object' && !Array.isArray(where[0])) {
        const sqls = []
        const vals = []
        for (const w of where) {
          const [s, v] = this.breakWhere(w, 'and', defTable)
          if (s) {
            sqls.push(`(${s})`)
            vals.push(...v)
          }
        }
        // 数组之间的元素用 OR 连接
        return [sqls.join(' OR '), vals]
      }
      return where
    }

    if (type === 'update') {
      const [whereSqls, vals] = this.updateWhere(where)
      return [whereSqls.join(','), vals]
    }
    return this.breakWhere(where, 'and', defTable)
  },

  // 分解where对象，让whereMain支持and和or
  breakWhere (where, andOr = 'and', defTable) {
    andOr = andOr.toUpperCase()
    const sqls = []
    const vals = []
    for (const [k, v] of Object.entries(where)) {
      const ks = k.split('#')
      const key = trim(ks[0])
      if (['or', 'OR', 'and', 'AND'].includes(key)) {
        if (!v) {
          continue
        }
        const [ss, vs] = this.breakWhere(v, key, defTable)
        sqls.push(`(${ss})`)
        vals.push(...vs)
      } else if (key === 'function') {
        sqls.push(v)
      } else {
        const andOr = trim(ks[1] || 'AND').toUpperCase()
        const [ss, vs] = this.whereOne(quotK(key, defTable), '=', v, ['AND', 'OR'].includes(andOr) ? andOr : 'AND')
        sqls.push(...ss)
        vals.push(...vs)
      }
    }
    return [sqls.join(` ${andOr} `), vals]
  },

  /**
   * 仅仅生成where中的语句，可选是select中的，还是update中的
   * 返回方式跟上面的不一样
   * @param o 对象形式的参数
   * @param isUpdate 类型，只能传 'update' ，表示这里生成的语句是用于 update 的 set 里
   * */
  updateWhere (o, isUpdate = true) {
    const sqls = []
    const vals = []
    Object.entries(o).forEach(([k, v]) => {
      k = trim(k.split('#')[0])
      if (k === 'function') { // 是函数
        sqls.push(v)
        return
      }
      k = quotK(k)
      switch (typeof v) {
      case 'string':
      case 'number':
        sqls.push(`${k} = ?`)
        vals.push(v)
        break
      case 'boolean':
        sqls.push(`${k} = ?`)
        vals.push(v ? 1 : 0)
        break
      case 'object': {
        if (isUpdate) {
          // console.log('---------------------',v)
          if(v && v.createdByHSqlBuilder) {
            sqls.push(`${k} = (${v.sql})`)
            if (v.values && v.values.length) {
              vals.push(...v.values)
            }
          }
          else if (v) {
            const symb = ['+', '-', '*', '/', '^']
            for (const [kk, vv] of Object.entries(v)) {
              if (symb.includes(kk)) {
                sqls.push(`${k} = ${k} ${kk} ?`)
                vals.push(vv)
              }
            }
          } else {
            sqls.push(`${k} = null`)
          }
          break
        }
        if (!v) {
          // NOTICE: 不能严格等于
          sqls.push(`${k} is NULL`)
          break
        }
        if (v instanceof Date) {
          console.error('不支持Date类型：', JSON.stringify({ [k]: v }))
          break
        }
        if (v instanceof Array) {
          sqls.push(`${k} in (${new Array(v.length).fill('?')})`)
          vals.push(...v)
          break
        }
        if (v instanceof RegExp) {
          sqls.push(`${k} like ?`)
          vals.push(v.toString().replaceAll('/g', '').replaceAll('/', ''))
          break
        }

        // value是对象，如： {'!=':'','not':[1,2,3]}
        Object.entries(v).forEach(([kk, vv]) => {
          kk = trim(kk.split('#')[0])
          if (['string', 'number'].includes(typeof vv)) {
            sqls.push(`${k} ${kk === '!' ? '!=' : kk} ?`)
            vals.push(vv)
          } else if (vv instanceof Array) {
            kk = kk.toUpperCase()
            let operator = 'NOT IN'
            if (!['!', '!=', 'NOT', 'NOT IN'].includes(kk)) {
              operator = 'IN'
            }
            sqls.push(`${k} ${operator} (${new Array(vv.length).fill('?')})`)
            vals.push(...vv)
          } else {
            console.error('不支持这种传值方式：', JSON.stringify({ [k]: {
              [kk]: vv
            } }))
          }
        })
        break
      }
      case 'undefined':
        if (isUpdate) {
          sqls.push(`${k} = NULL`)
        } else {
          sqls.push(`${k} is NULL`)
        }
        break
      default:
        console.error('不支持这种传值方式：', JSON.stringify({ [k]: v }))
      }
    })
    return [sqls, vals]
  },

  whereOne (key, operator, value, andOr = 'AND') {
    const sqls = []
    const vals = []
    operator = operator === '!' ? '!=' : operator
    switch (typeof value) {
    case 'string':
    case 'number':
      sqls.push(`${key} ${operator} ?`)
      vals.push(value)
      break
    case 'boolean':
      sqls.push(`${key} ${operator} ?`)
      vals.push(value ? 1 : 0)
      break
    case 'object': {
      if (!value) {
        // NOTICE: 不能严格等于
        let op = 'IS'
        if (['!', '!=', 'NOT', 'IS NOT'].includes(operator)) {
          op = 'IS NOT'
        }
        sqls.push(`${key} ${op} NULL`)
        break
      }
      if (value instanceof Date) {
        console.error('不支持Date类型：', JSON.stringify({ [key]: value }))
        break
      }
      if (value instanceof Array && key.includes(',')) {
        let op = 'NOT IN'
        if (!['!', '!=', 'NOT', 'NOT IN'].includes(operator)) {
          op = 'IN'
        }

        sqls.push(`${key} ${op} (${new Array(value.length).fill(`( ${new Array(key.split(',').length).fill('?')} )`)})`)
        vals.push(...value.reduce((p, v) => {
          p.push(...v)
          return p
        }, []))
        break
      }
      if (value instanceof Array) {
        let op = 'NOT IN'
        if (!['!', '!=', 'NOT', 'NOT IN'].includes(operator)) {
          op = 'IN'
        }

        sqls.push(`${key} ${op} (${new Array(value.length).fill('?')})`)
        vals.push(...value)
        break
      }
      if (value instanceof RegExp) {
        sqls.push(`${key} like ?`)
        vals.push(value.toString().replace(/^\/([\w\W]*)\/\w*$/, '$1'))
        break
      }

      // 如果value是本工具生成的sql对象
      if (value.createdByHSqlBuilder) {
        sqls.push(`${key} ${operator} (${value.sql})`)
        if (value.values && value.values.length) {
          vals.push(...value.values)
        }
      } else {
        // value是对象，且对象中的key是操作符，如： {'!=':'','not':[1,2,3]}
        const objSqls = []
        Object.entries(value).forEach(([operator, vv]) => {
          operator = trim(operator.split('#')[0])
          const [ss, vs] = this.whereOne(key, operator, vv)
          objSqls.push(...ss)
          vals.push(...vs)
        })
        const s = objSqls.join(` ${andOr} `)
        sqls.push(objSqls.length > 1 ? `(${s})` : s)
      }
      break
    }
    case 'undefined':
      let op = 'IS'
      if (['!', '!=', 'NOT', 'IS NOT'].includes(operator)) {
        op = 'IS NOT'
      }
      sqls.push(`${key} ${op} NULL`)
      break
    default:
      console.error('不支持这种传值方式：', JSON.stringify({ [key]: value }))
    }
    return [sqls, vals]
  },

  /**
   * @return string
   * */
  leftJoin (leftJoins) {
    if (typeof leftJoins === 'string') { return `LEFT JOIN ${leftJoins}` }
    return (leftJoins.length ? ' LEFT JOIN ' : '') + leftJoins.join(' LEFT JOIN ')
  },

  return (sql, values) {
    const data = {
      sql,
      values,
      createdByHSqlBuilder: true
    }
    if (this.timeout) {
      data.timeout = this.timeout
    }
    return data
  }
}
