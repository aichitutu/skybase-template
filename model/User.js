const BaseModel = require('./BaseModel')

class User extends BaseModel {
  constructor (conn) {
    super(conn)

    this._table = 'user'
    this._dFlag = 'd_flag'
    this._cTime = 'c_time'
    this._mTime = 'm_time'
    this._dateCols = ['c_time', 'm_time']
  }
}

module.exports = (conn) => new User(conn)
