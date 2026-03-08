# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the application
node index_skybase_test.js   # main test entry with MySQL + Redis
node index.js.tpl            # template entry (copy and rename for new projects)

# Process manager
pm2 start pm2_v4.config.js

# API validation (scans for missing params)
npm run apitest

# SQL injection detection
npm run inject

# Linting
npx eslint .

# Changelog + commit
npm run cz

# Testing with meeko TestCase pattern
node <file>.js -test           # run all tests in file
node <file>.js -test <name>    # run specific test
node <file>.js -testList       # list available tests
```

## Architecture

**Framework**: Skybase (Koa2-based) with onion middleware model. Middleware order defined in `config/config.default.js` under `middlewares[]`.

**Request flow**: `sky-cors` → `sky-body-parse` → `sky-static-server` → `sky-check-param` → `sky-check-token` → `sky-output` → `sky-api-register`

**Directory structure**:
- `model/api/<group>/` — API schema definitions: declares endpoint metadata, params, method, and maps to a controller string (e.g. `mock.easy.getEmpty`)
- `router/<group>/` — Controllers: exports object with `async fn(ctx)` handlers
- `service/<group>/` — Business logic layer
- `middleware/` — Custom Koa middleware (auto-loaded by skybase if listed in config)
- `config/` — `config.default.js` is base; `config.dev/prod/test.js` override it; `config/index.js` merges them
- `lib/` — Shared utilities (`tools.js`, `sql_builder.js`, `BaseModel.js` is in `model/`)
- `skyconfig.js` — Project-level skybase config (apiDir, routerDir, middlewares list, etc.)

**Database**: `j2sql2` ORM accessed via `global.db`. Each table is `db['tablename']`. `BaseModel` (`model/BaseModel.js`) is the preferred ORM layer — extend it per table:

```javascript
class User extends BaseModel {
  constructor(conn) {
    super(conn)
    this._table = 'user'
    this._dFlag = 'd_flag'   // soft-delete column
    this._cTime = 'c_time'   // created_at column
    this._mTime = 'm_time'   // updated_at column
    this._dateCols = ['c_time', 'm_time']
  }
}
module.exports = (conn) => new User(conn)
```

`BaseModel` uses a chainable + `await` pattern: chain methods build the SQL, `await` triggers execution. Always instantiate per request (not shared) to avoid transaction state leakage.

**Globals**: Declared at top of each file as `/* global $ db redis $G */`
- `$` — meeko utility library (array, string, date ops, `$.now()`, `$.log()`, `$.err()`, `$.tools.*`)
- `db` — MySQL connection pool (j2sql2)
- `redis` — ioredis connection

## Code Patterns

### Controller
```javascript
/* global $ db redis */
module.exports = {
  async functionName(ctx) {
    const { param } = ctx.checkedData.data  // validated params only
    ctx.ok(data)                            // success
    // ctx.throw(400, 'message')            // error
  }
}
```

### API Schema (`model/api/<group>/`)
```javascript
module.exports = {
  endpointName: {
    name: 'Display Name',
    desc: 'Description',
    method: 'get',                        // 'get' | 'post' | 'all'
    controller: 'group.file.methodName',  // maps to router/group/file.js → methodName
    param: {
      fieldName: { type: 'string', required: true, desc: '...' }
    },
    token: false,
    needSign: false,
    front: true
  }
}
```

### TestCase (meeko pattern for testable modules)
```javascript
const testCases = {
  testA: async () => { /* ... */ },
  all: async () => { await testCases.testA() }
}
new $.tools.TestCase(testCases)
```

### Transactions
```javascript
const result = await BaseModel.transaction(async (conn) => {
  const m = new MyModel(conn)
  await m.insert(data)
  return true  // commit; anything else rolls back
})
```

## Configuration

`config/index.js` merges `config.default.js` with environment-specific overrides (`NODE_ENV`). Local DB defaults: MySQL at `127.0.0.1:3306`, Redis at `localhost:6379`. Override in `config.dev.js` / `config.prod.js`.

Set `showSql: true` in mysql config to log all BaseModel SQL queries.

## Style

- 2-space indent, LF line endings, single quotes, no required semicolons
- Chinese comments are common and acceptable
- Prefer `meeko` ($) utilities over hand-rolling common logic
- New features follow module pattern: `model/api/<name>/`, `router/<name>/`, `service/<name>/`