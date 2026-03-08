const $ = require('meeko')
const axios = require('axios')

async function test () {
  let t = $.now()
  let txtStr = escape($.Mock.genText(4065 / 3))
  let len = txtStr.length
  let count = 1000
  for (let i = 0; i < count; i++) {
    await axios({
      url: 'http://127.0.0.1:13000/skyapi/mock/echo',
      method: 'POST',
      data: new URLSearchParams({ str: txtStr })
    })
    //process.stdout.cursorTo(0)
    process.stdout.write($.c.xy(0, 0))
    //process.stdout.clearLine()
    let diff = $.now() - t
    process.stdout.write(
      `\r 总耗时: ${diff} 总传输量: ${(
        (i + 1) *
        len *
        2
      ).prettyBytes()} 每秒速率: ${(
        (((i + 1) * len * 2) / diff) *
        1000
      ).prettyBytes()}          `
    )
  }
  console.log(
    '\n',
    'http接口基准测试',
    ((count / ($.now() - t)) * 1000) | 0,
    '次/秒'
  )
}
test()
