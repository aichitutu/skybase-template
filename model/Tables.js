const BaseModel = require('./BaseModel')
const TABLES = {
  USER: 'user',
}

Object.freeze(TABLES)

module.exports = {
  TABLES,
  User: () => BaseModel.create(TABLES.USER),
}
