const BaseModel = require('./BaseModel')
const hTools = require('../lib/tools')


module.exports = class BaseTreeModel extends BaseModel {

  constructor(conn) {
    super(conn)
    this._path = 'path'
    // this._dFlag = 'd_flag'
    // this._cTime = 'c_time'
    // this._mTime = 'm_time'
    // this._dateCols = ['c_time', 'm_time', 'first_visit_time']
  }

  async getPathById(id) {
    const path = await this.get({
      d_flag: 0,
      id
    }, this._path)
    return path
  }

  async getPathByCode(code) {
    const path = await this.get({
      d_flag: 0,
      code
    }, this._path)
    return path
  }

  async getChildrenById(
    id,
    col,
    order,
    isTree
  ) {
    const rootPath = await this.getPathById(id)
    if (!rootPath) return false
    const children = await this.select({
      d_flag: 0,
      or: {
        path: {
          LIKE: `${rootPath},%`
        },
        'path#': rootPath
      }

    }, col, order)
    return isTree ? BaseTreeModel.arry2tree(children) : children
  }

  async getChildrenByCode(
    code,
    col,
    order,
    isTree
  ) {
    const rootPath = await this.getPathByCode(code)
    if (!rootPath) return false

    const children = await this.select({
      d_flag: 0,
      or: {
        path: {
          LIKE: `${rootPath},%`
        },
        'path#': rootPath
      }

    }, col, order)
    return isTree ? BaseTreeModel.arry2tree(children) : children
  }

  async getChildMapByCode(code) {
    const rootPath = await this.getPathByCode(code)
    if (!rootPath) return false
    const data = await this.select({
      d_flag: 0,
      path: {
        LIKE: `${rootPath},%`
      },
    }, ['id', 'pid', 'code', 'data'])

    return BaseTreeModel.arrayToMap(data)
  }

  async add(pid, data) {
    let rootPath = ''
    if (pid) {
      rootPath = await this.getPathById(pid)
      if (!rootPath) {
        return [400, '无效父节点id']
      }
      (Array.isArray(data) ? data : [data]).forEach(d => {
        d.pid = pid
      })
    }

    let rinsert
    const res = await BaseModel.transaction(async conn => {
      this.conn = conn
      rinsert = await this.insert(data)
      if (!rinsert) return [500, '插入节点失败']
      const ids = Array.isArray(rinsert) ? rinsert : [rinsert]
      for (let id of ids) {
        const rupdate = await this.update({ id }, {
          path: rootPath ? `${rootPath},${id}` : `${id}`
        })
        if (!rupdate) return [500, '更新节点path失败']
      }
      return true
    })
    return res === true ? [200, 'ok', rinsert] : res
  }

  async addBycode(code, data) {
    let rootPath = '', pid = 0
    if (code) {
      const pnode = await this.get({
        d_flag: 0,
        code
      }, ['id', this._path])
      if (!pnode) {
        return [400, '无效父节点id']
      }
      rootPath = pnode[this._path]
      if (!Array.isArray(data)) data = [data]
      data.forEach(d => {
        d.pid = pnode.id
      })
    }

    let rinsert
    const res = await BaseModel.transaction(async conn => {
      this.conn = conn
      rinsert = await this.insert(data)
      if (!rinsert) return [500, '插入节点失败']
      const ids = Array.isArray(rinsert) ? rinsert : [rinsert]
      for (let id of ids) {
        const rupdate = await this.update({ id }, {
          path: rootPath ? `${rootPath},${id}` : `${id}`
        })
        if (!rupdate) return [500, '更新节点path失败']
      }
      return true
    })
    return res === true ? [200, 'ok', rinsert] : res
  }

  async addByTree(tree,
    nameProperty = 'name',
    codeProperty = 'code',
    dataProperty = 'data'
  ) {

    if (!tree) return [400, '无效数据']
    const nodes = BaseTreeModel.flattenNode(tree, codeProperty).map(node => {
      const { [nameProperty]: name = '', [codeProperty]: code = '', [dataProperty]: data = '', pid: pcode, path } = node
      return { id: 0, pid: 0, pcode, path, name, code, data }
    })
    const res = await BaseTreeModel.transaction(async (conn) => {
      this.conn = conn
      const rIds = await this.insert(nodes.map(n => {
        const { name, code, data } = n
        return { name, code, data }
      }))
      if (!rIds) return [500, '插入数据失败']
      // 补全数据库id
      rIds.forEach((id, i) => {
        nodes[i].id = id
      })
      //
      const map_code_node = hTools.arrayToMap(nodes, codeProperty)

      for (const node of nodes) {
        const { id, pcode, path } = node
        const oriPid = map_code_node[pcode] ? map_code_node[pcode].id : 0
        const dbPath = path.split(',').map((code) => map_code_node[code].id).join(',')
        const rupdate = await this.update({
          id
        }, {
          pid: oriPid,
          path: dbPath
        })
        if (!rupdate) return [500, '更新节点数据路径失败']
        node.pid = oriPid
        node.path = dbPath
      }
      return true
    })
    return res === true ? [200, 'ok', nodes] : res
  }

  static flattenNode(node, idKey = 'code') {
    if (!node) return []

    const flatter = (node, r) => {
      r.push(node)
      const hasArr = Object.values(node).find(d => Array.isArray(d))
      if (hasArr) {
        hasArr.forEach((d) => {
          d.pid = node[idKey] || ''
          d.path = node.path ? `${node.path},${d[idKey]}` : `${d[idKey]}`
          return flatter(d, r)
        })
      }
      return r
    }
    node.path = `${node[idKey]}`
    return flatter(node, [])
  }

  static arry2tree(datas) {
    const map_pid_ndoe = hTools.arrayToMapArr(datas, 'pid')
    datas.forEach((data) => {
      data.items = map_pid_ndoe[data.id]
      //delete data.pid
    })
    const r = datas.filter((data) => !data.pid)
    datas.forEach(d => delete d.pid)

    return r
  }

  static arrayToMap(data) {
    if (!Array.isArray(data)) return {}
    const map = data.reduce((p, v) => {
      if (v.data) {
        try {
          v.data = JSON.parse(v.data)
        } catch { }
      }
      const keys = v.code.split('#'), keyCount = keys.length - 1
      keys.reduce((pp, key, i) => {
        if (i < keyCount) {
          pp[key] = pp[key] ?? {}
        } else {
          pp[key] = v.data
        }
        return pp[key]
      }, p)
      return p
    }, {})
    return map
  }

}
