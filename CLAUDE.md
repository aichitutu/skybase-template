# CLAUDE.md

Guide for AI agents working in this `server` project.

## Quick Rules

- Framework: Skybase on Koa2, middleware order is defined in `config/config.default.js`.
- Request flow: `sky-cors` -> `sky-body-parse` -> `sky-static-server` -> `sky-check-param` -> `sky-check-token` -> `sky-output` -> `sky-api-register`
- Read validated input from `ctx.checkedData.data`
- Return success with `ctx.ok(...)`; throw errors with `ctx.throw(status, message)`
- New business APIs must go in versioned directories like `model/api/v1/`, not `model/api/skyapi/`
- If MySQL is already configured for the feature, persist state in MySQL; do not default to in-memory state for production business logic
- Do not put all service logic in one file; split by responsibility such as `constants`, `helpers`, `repo`, `core`, `actions`
- Do not rely on bare `throw new Error(...)` for business logic; use explicit business errors with `status`, `code`, and clear messages, then map them in the router
- Keep code ASCII-only; Chinese is allowed in comments only
- Prefer `meeko` utilities over hand-written helpers when equivalent functionality exists

## Common Commands

```bash
# start
node index.js
pm2 start pm2_v4.config.js

# checks
npx eslint .
npm run apitest
npm run inject

# db migration
npm run db:update
node ./sql/migration.js local update 0
node ./sql/migration.js local update 1
node ./sql/migration.js local seeds

# meeko TestCase
node <file>.js -test
node <file>.js -test <name>
node <file>.js -testList
```

## Project Layout

- `model/api/<version-or-group>/`: API schema definitions
- `router/<group>/` or `router/<file>.js`: controllers
- `service/<group>/`: business logic
- `middleware/`: custom middleware
- `config/`: config merge entry is `config/index.js`
- `lib/`: shared utilities
- `sql/migrations/`: migration files
- `sql/seeds/`: seed files
- `skyconfig.js`: project-level skybase settings

For new APIs, use this pattern:

- `model/api/v1/...` for API definitions
- `router/...` for controllers
- `service/...` for business logic
- Inside complex services, split files by responsibility instead of keeping all rules, repo calls, and actions in a single file

## Core Patterns

### Controller

```javascript
/* global $ db redis */
module.exports = {
  async functionName (ctx) {
    const data = ctx.checkedData.data
    ctx.ok(data)
  }
}
```

For non-trivial modules, prefer a shared router wrapper that catches domain errors and converts them to `ctx.throw(err.status, err.message, { code: err.code, details: err.details })`.

### API Schema

```javascript
module.exports = {
  endpointName: {
    name: 'Display Name',
    desc: 'Description',
    method: 'get', // get | post | all
    controller: 'group.file.methodName',
    param: {
      fieldName: { type: 'string', req: 1, desc: '...' }
    },
    token: false,
    needSign: false,
    front: true
  }
}
```

### Testable Module with meeko

```javascript
const testCases = {
  testA: async () => {},
  all: async () => { await testCases.testA() }
}
new $.tools.TestCase(testCases)
```

## Database

- DB access is through `global.db` using `j2sql2`
- Each table is available as `db['table_name']`
- Prefer `model/BaseModel.js` for model wrappers
- `BaseModel` is chainable and executes on `await`
- Instantiate models per request; do not share instances across requests or transactions
- If data is part of the real feature state, add migration files and write it to MySQL instead of keeping it only in process memory

Example:

```javascript
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
```

Transaction pattern:

```javascript
const result = await BaseModel.transaction(async (conn) => {
  const m = new MyModel(conn)
  await m.insert(data)
  return true
})
```

## Globals

Declare globals at the top of files when used:

```javascript
/* global $ db redis $G */
```

- `$`: meeko utilities
- `db`: MySQL connection
- `redis`: ioredis connection

## Config Notes

- `config/index.js` merges `config.default.js` with `NODE_ENV` overrides
- Local defaults are MySQL `127.0.0.1:3306` and Redis `localhost:6379`
- Set `showSql: true` in mysql config if SQL logging is needed

## SQL Migration

Migration entrypoint:

```bash
npm run db:update
node ./sql/migration.js [env] [action] [updateNum]
```

Default shortcut:

- `npm run db:update` currently maps to `node ./sql/migration.js local update 0`
- Use the explicit `node ./sql/migration.js ...` form when you need a different env, run only part of the pending migrations, or execute seeds

- `env`: selects `NODE_ENV`, then uses `require('../config').mysql`
- `action`: `update` or `seeds`
- `updateNum`: only for `update`; `0` or omitted means all pending migrations

Migration rules:

- Files are loaded from `sql/migrations/` in filename order
- Each migration must export async `up(query, utils)` and async `down(query, utils)`
- Applied versions are recorded in `_h_migration`
- `undo` is not implemented in the CLI flow yet
- Failures are logged; applied DDL is not auto-rolled back
- Seed files run from `sql/seeds/` in filename order
- `utils` provides `addIndex`, `addPrimary`, `addCol`, `editCol`, `dropCol`, `insert`, `transaction`

## Style

- 2-space indent
- LF line endings
- single quotes
- semicolons optional
- Keep new features modular: API definition -> router -> service
