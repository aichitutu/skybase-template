// 小工具

const { dirname } = require('node:path')
const fs = require('fs')
const axios = require('axios')
module.exports = {
  // async 版 setTimeout
  async setTimeout (ms) {
    return new Promise(function (resolve, reject) {
      global.setTimeout(() => resolve(), ms)
    })
  },

  /**
   *  比较两个版本
   *  @param versionA
   *  @param versionB
   *  @param isSame boolean 比较方式
   *  如果为false --- 判断第一个版本号是不是比第二个大，如果相同返回false
   *  如果为true --- 判断两个版本号是否相同
   *  @return boolean
   * */
  versionIsBigger (versionA, versionB, isSame = false) {
    const versionAArr = versionA.split('.')
    const versionBArr = versionB.split('.')
    for (let i = 0; i < Math.max(versionBArr.length, versionAArr.length); i++) {
      const a = parseInt(versionAArr[i])
      const b = parseInt(versionBArr[i])
      if (a > b) {
        return true
      } else if (a < b) {
        return false
      }
    }
    return isSame
  },

  /**
   * @getClientIP
   * @desc 获取用户 ip 地址
   * @param {Object} req - 请求
   * @param {boolean} ipv6 - 是否优先取的是IPv6。不一定能取到想要的类型，因为据说2025年以后出的设备，就只支持ipv6了
   */
  getClientIP (req, ipv6 = false) {
    const ip = req.headers['x-forwarded-for'] || // 判断是否有反向代理 IP
      (req.connection && req.connection.remoteAddress) || // 判断 connection 的远程 IP
      req.socket && req.socket.remoteAddress || // 判断后端的 socket 的 IP
      (req.connection && req.connection.socket && req.connection.socket.remoteAddress)
    // $.log('x:'+ req.headers['x-forwarded-for'], req.connection ? `cr:${req.connection.remoteAddress}`: '',
    //   req.connection && req.connection.socket? `csr: ${req.connection.socket.remoteAddress}`: '', req.socket.remoteAddress, )
    // $.log(ip)
    if(!ip) return ''

    if (ipv6) {
      return ip
    }

    // 这个可能是ipv6的地址
    // 如果启动server时，没有填第二个参数，就会获取到IPv6，所以如果想直接拿IPv4，可以这样启动： server.listen(8080, '0.0.0.0')
    // https://nodejs.org/dist/latest-v10.x/docs/api/net.html#net_server_listen_port_host_backlog_callback
    // ipv6里有可能内嵌了ipv4的地址（以后不支持ipv4的设备可能就不会内嵌ipv4了），所以可以这样提取：
    let ipv4 = ''
    if (ip.includes(':')) {
      ipv4 = ip.split(':').pop()
    } else if(ip.includes(',')) {
      ipv4 = ip.split(',')[0]
    }

    return ipv4.includes('.') ? ipv4 : ip
  },

  /**
   * 返回最小值和最大值之间的随机数
   * @param min 最小值，整形，含
   * @param max 最大值，整形，也含
   * @return number 整形
   * */
  rand (min, max) {
    return parseInt(Math.random() * (max + 1 - min)) + min
  },

  // 去掉字符串前后空格
  trim (str) {
    return str && str.replace ? str.replace(/^\s+|\s+$/, '') : str
  },

  /**
   * 把对象数组里，每个子项的某个key的value取出来当key
   * ps. 如果遇到多次相同的value，后面的会覆盖前面的
   * @param {array<object>} array 传入的对象数组
   * @param {string} key 对象中哪个字段的值作为key
   * @param {boolean} [delKey] 把那个字段拿出来当key之后，是否删掉他在原来对象中的存在
   * @return {object}
   * */
  arrayToMap (array, key, delKey) {
    return array.reduce((last, item) => {
      const nowValue = { ...last }
      nowValue[item[key]] = item
      if (delKey) {
        delete item[key]
      }
      return nowValue
    }, {})
  },

  /**
   * 把对象数组里，每个子项的某个key的value取出来当key
   * ps. 与上面的方法差不多，但是返回的对象里，每个value都是数组，所以即使遇到相同的value，都会放进数组里。
   * @param {array<object>} array 传入的对象数组
   * @param {string} key 对象中哪个字段的值作为key
   * @param {boolean} [delKey] 把那个字段拿出来当key之后，是否删掉他在原来对象中的存在
   * @return {object<string, array>}
   * */
  arrayToMapArr (array, key, delKey) {
    return array.reduce((last, item) => {
      const nowValue = { ...last }
      if (!nowValue[item[key]]) {
        nowValue[item[key]] = []
      }
      nowValue[item[key]].push(item)
      if (delKey) {
        delete item[key]
      }
      return nowValue
    }, {})
  },

  /**
   * 把一个对象内所有下横线key都改为驼峰
   *
   * @param map obj|array
   * @param level 转换多少层
   * */
  mapKeyToCamel (map, level = 10) {
    if (!map || level <= 0) {
      return map
    }
    if (map instanceof Array) {
      return map.map(v => this.mapKeyToCamel(v, level - 1))
    }
    // 从数据库查出来的是 RowDataPacket 对象，并不是普通对象，所以不能这样判断
    if (typeof map !== 'object') {
      return map
    }
    const newMap = {}
    Object.entries(map).forEach(([k, v]) => {
      newMap[this.strToCamel(k)] =
        typeof v === 'object'
          ? this.mapKeyToCamel(v, level - 1)
          : v
    })
    return newMap
  },

  /**
   * 把字符串转为驼峰方式
   * 如果出现 _2 或者 _A 这些情况，只会把下横线去掉
   * 如果下横线开头，则首字母也会大写
   * */
  strToCamel (str) {
    return str.replace(/_([a-zA-Z0-9])/g, (_, p1) => p1.toUpperCase())
  },

  // 筛选对象
  objectFilter (obj, keys) {
    const newObj = {}
    keys.forEach(k => { obj[k] && (newObj[k] = obj[k]) })
    return newObj
  },

  // 简单的json对象转xml
  json2Xml (json) {
    return `<xml>${Object.entries(json).map(([k, v]) => `<${k}><![CDATA[${((v && (typeof v === 'string')) ? v : JSON.stringify(v)) || ''}]]></${k}>`).join('')}</xml>`
  },

  /**
   * 根据 URL 下载文件并保存到本地
   *
   * @param {string} url         要下载的文件 URL（支持 http 和 https）
   * @param {string} dest        保存的文件完整路径（如 './downloads/avatar.jpg'）
   * @param {Object} [options]       可选配置
   *   - timeout:   number   请求超时毫秒（默认 30 秒）
   *   - headers:   object   自定义请求头（如需要 cookie、User-Agent 等）
   *   - followRedirect: boolean 是否自动跟随重定向（默认 true）
   * @returns {Promise<string>}      成功时返回保存的文件路径，失败抛出错误
   */
  async download(url, dest, options = {}) {
    const dir = dirname(dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      const response = await axios({
        method: 'GET',
        url,
        timeout: options.timeout || 30_000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Node.js Downloader)',
          ...options.headers,
        },
        responseType: 'stream',           // 关键：流式下载
        maxRedirects: 5,                  // 自动处理重定向
      })

      let filename = null;

      const disposition = response.headers['content-disposition'];
      if (disposition) {
        const match = disposition.match(/filename\*?=['"]?(?:UTF-8'')?([^;"']+)/i);
        if (match) {
          filename = decodeURIComponent(match[1]);
        }
      }

      const writer = fs.createWriteStream(dest);

      response.data.pipe(writer);

      return new Promise((resolve) => {
        writer.on('finish', () => {
          resolve([200, 'ok']);
        });

        writer.on('error', (err) => {
          fs.unlink(dest, () => {}); // 删除残留文件
          resolve([500, '写入文件失败: ' + err.message]);
        });
      });

    } catch (err) {
      // 网络错误、重定向失败、超时、404、500 等全部走这里
      const status = err.response?.status || 0;
      const msg = err.code === 'ETIMEDOUT' ? '请求超时' :
        err.code === 'ENOTFOUND' ? '域名解析失败' :
          err.response?.statusText || err.message || '未知错误';

      // 如果有部分文件已创建，尝试删除
      fs.unlink(dest, () => {});

      if (status >= 400 && status < 600) {
        return [status, msg];
      }
      if (status === 0) {
        return [500, '网络错误: ' + msg];
      }
      return [500, msg];
    }
  }
}
