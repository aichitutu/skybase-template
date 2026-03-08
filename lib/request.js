const request = require('axios')
const { HttpsProxyAgent } = require('https-proxy-agent')
const { proxy } = require('../config')

const ua = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
]

const getRandomUA = () => ua[Math.floor(Math.random() * ua.length)]

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

const createInstance = (options = {}, useProxy = false) => {
  const config = {
    timeout: 10000,
    ...options,
  }

  // 处理代理逻辑
  if (useProxy && proxy && proxy.host && proxy.port) {
    config.proxy = false // axios 自带的 proxy 设为 false
    config.httpsAgent = new HttpsProxyAgent(`${proxy.host}:${proxy.port}`)
  }

  const instance = request.create(config)

  // --- 请求拦截器 ---
  instance.interceptors.request.use(config => {
    // 确保 headers 存在
    config.headers = config.headers || {}
    config.headers['user-agent'] = getRandomUA()

    // 初始化重试配置（如果调用时没传，默认重试 3 次，间隔 1 秒）
    config.retry = config.retry ?? 3
    config.retryDelay = config.retryDelay ?? 1000
    config.retryCount = config.retryCount ?? 0

    return config
  }, error => Promise.reject(error))

  // --- 响应拦截器 1：重试逻辑 (必须放在格式化拦截器之前) ---
  instance.interceptors.response.use(undefined, async (err) => {
    const config = err.config

    // 1. 基础检查：如果没有 config 或未开启重试，直接抛出
    if (!config || !config.retry) return Promise.reject(err)

    // 2. 智能筛选：判断错误类型是否值得重试
    const isTimeout = err.code === 'ECONNABORTED' || err.message?.includes('timeout')
    const isNetworkError = !err.response // 没有 response 通常意味着断网或 DNS 错误
    const isServerError = err.response && err.response.status >= 500 // 服务端崩了，可以重试

    // 如果不是以上三种情况（比如是 404, 401, 403），则直接放弃，不重试
    if (!isTimeout && !isNetworkError && !isServerError) {
      return Promise.reject(err)
    }

    // 3. 次数检查
    if (config.retryCount >= config.retry) {
      return Promise.reject(err)
    }

    // 4. 执行重试
    config.retryCount += 1

    // 这里的日志可以帮你观察是否是因为超时重试的
    // console.log(`[Retry ${config.retryCount}/${config.retry}] Type: ${isTimeout ? 'Timeout' : 'Network/Server Error'}, URL: ${config.url}`)

    // 延时等待
    await sleep(config.retryDelay)

    // 重新发起请求
    return instance(config)
  })

  // --- 响应拦截器 2：格式化返回值
  instance.interceptors.response.use(
    response => {
      return [200, '', response.data]
    },
    error => {
      // 只有在重试都失败后，才会走到这里
      const status = +(error.response?.status ?? 400)
      const msg = error?.response?.data || error.message
      const errorInfo = {
        baseURL: error?.config?.baseURL ?? '',
        url: error?.config?.url ?? ''
      }

      console.error('Request Final Error:', (errorInfo.baseURL) + (errorInfo.url), msg)
      return [status, msg, errorInfo]
    }
  )

  return instance
}

const create = (config) => request.create(config)
const inst = createInstance()
const instProxy = createInstance({}, true)

exports = module.exports = inst
exports.axios = request
exports.create = create
exports.instProxy = instProxy
exports.ua = ua
