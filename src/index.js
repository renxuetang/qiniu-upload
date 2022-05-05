const qiniu = require('qiniu')
const path = require('path')
const Glob = require("glob").Glob
const chalk = require('chalk')
const fs = require('fs')
const dotEnv = require('dotenv')
const singleLineLog = require('single-line-log').stdout

const errorStyle = chalk.red
const successStyle = chalk.green
const infoStyle = chalk.blue
const LOGGER = 'qiniu-upload'

const zone = {
  z0: qiniu.zone.Zone_z0,
  z1: qiniu.zone.Zone_z1,
  z2: qiniu.zone.Zone_z2,
  na0: qiniu.zone.Zone_na0,
}

function loadEnv(envPath) {
  const result = dotEnv.config({
    path: envPath
  })

  if (result.error) {
    throw result.error
  }

  return result.parsed
}

const DEFAULTS = {
  debug: false,
  accessKey: '', // set in .qiniu file
  secretKey: '', // set in .qiniu file
  bucket: '', // set in .qiniu file
  cwd: process.cwd(),
  envFile: '.qiniu',
  base: 'dist',
  keyPrefix: '',
  output: 'qiniu-upload.json',
  glob: 'dist/**',
  globIgnore: [
    'dist/!(static)/**'
  ],
  overrides: false,
  parallelCount: 2,
  zone: zone.z0
}

class Uploader {
  constructor(config = {}) {
    let cwd = config.cwd || DEFAULTS.cwd
    let envFile = config.envFile === undefined ? DEFAULTS.envFile : config.envFile

    let env = {}
    if (envFile) {
      env = loadEnv(path.resolve(cwd, envFile))
    }

    this._config = { ...DEFAULTS, ...env, ...config }

    this._mac = new qiniu.auth.digest.Mac(this.config.accessKey, this.config.secretKey)
    this.showConfigInfo()

    this._bucketManager = null
  }

  showConfigInfo() {
    this._log('log', 'config: ')
    this._log('log', `      cwd: ${successStyle(this.config.cwd)}`)
    this._log('log', `      envFile: ${successStyle(this.config.envFile)}`)
    this._log('log', `      base: ${successStyle(this.config.base)}`)
    this._log('log', `      output: ${successStyle(this.config.output)}`)
    this._log('log', `      bucket: ${successStyle(this.config.bucket)}`)
    this._log('log', `      overrides: ${successStyle(this.config.overrides)}`)
  }

  resolveBase() {
    return path.resolve(this.config.cwd, this.config.base).replace(/\\/g, '/') + '/'
  }

  get config() {
    return this._config
  }

  get mac() {
    return this._mac
  }

  get bucketManager() {
    if (!this._bucketManager) {
      let config = new qiniu.conf.Config()
      config.zone = this.config.zone
      this._bucketManager = new qiniu.rs.BucketManager(this._mac, config)
    }

    return this._bucketManager
  }

  buildUploadToken(key) {
    let options = {
      scope: `${this.config.bucket}:${key}`,
      expires: 7200,
      insertOnly: this.config.overrides ? 0 : 1
    }
    return new qiniu.rs.PutPolicy(options).uploadToken(this.mac)
  }

  getWaitingUploadFiles() {
    return new Promise((resolve, reject) => {
      this._glob = new Glob(this.config.glob, {
        cwd: this.config.cwd,
        strict: true,
        absolute: true,
        nodir: true,
        ignore: this.config.globIgnore
      }, (err, files) => {
        if (err) {
          if (!(err instanceof Error)) {
            err = new Error(String(err))
          }
          this.error(errorStyle('unexpected error when getting upload files:'), errorStyle(err.stack))
          return reject(err)
        }

        this.log(`find ${files.length} files to upload.`)
        resolve(files)
      })
    })
  }

  _debugLog(level, ...args) {
    if (this.config.debug) {
      this._log(level, ...args)
    }
  }

  _log(level, ...args) {
    console[level](chalk.blue(`[${LOGGER}]`), ...args)
  }

  log(...args) {
    this._debugLog('log', ...args)
  }

  error(...args) {
    this._debugLog('error', ...args)
  }


  async start({ } = {}) {
    let targetFiles = await this.getWaitingUploadFiles()
    let ended = []
    let results = {
      success: [],
      fail: []
    }
    let stats = {
      total: targetFiles.length,
      uploading: 0,
      success: 0,
      fail: 0
    }
    let end = () => {
      this.config.output &&
        fs.writeFile(path.resolve(this.config.cwd, this.config.output), JSON.stringify(results, null, '\t'), function (err) {
          if (err) {
            this.log(errorStyle(`error occured when save upload results. ${err.stack}`))
          }
        })

      this.log(infoStyle('end<=============='))
    }
    let logStats = () => {
      if (this.config.debug) return
      singleLineLog((`${infoStyle('[' + LOGGER + ']')} total files: ${stats.total}, ${infoStyle('uploading:' + stats.uploading)}, ${
        successStyle('success:' + stats.success)
        }, ${
        errorStyle('fail:' + stats.fail)
        }\n`))
    }
    this.log(infoStyle('start============>'))

    return new Promise(resolve => {
      let run = () => {
        logStats()
        let file = targetFiles.pop();
        if (!file) {
          ended.push(1)

          if (ended.length === this.config.parallelCount) {
            return resolve(end())
          }

          return
        }
        stats.uploading++

        this._createUploadTask(file).then(({ key }) => {
          stats.uploading--
          stats.success++
          results.success.push({
            file, key,
            skipped: false
          })
          this.log(successStyle('upload success:'), file)
        }).catch(({ key, msg, stack }) => {
          stats.uploading--
          stats.fail++
          results.fail.push({
            file, key, msg
          })
          this.error(errorStyle(`upload error: ${file}`))
          this.error('             ', errorStyle(stack))
        }).then(run)
      }

      let parallelCount = this.config.parallelCount
      while (parallelCount--) {
        run()
      }
    })
  }

  _createUploadTask(file) {
    return new Promise((resolve, reject) => {
      this.log('uploading:', file)
      let base = this.resolveBase()
      let key = `${this.config.keyPrefix}${file.replace(base, '')}`

      let config = new qiniu.conf.Config()
      config.zone = this.config.zone

      let formUploader = new qiniu.form_up.FormUploader(config)

      formUploader.putFile(this.buildUploadToken(key), key, file, undefined, function (respErr,
        respBody, respInfo) {
        if (respErr) {
          return reject({
            file,
            key,
            msg: respErr.message,
            statck: respErr.stack
          })
        }
        if (respInfo.statusCode == 200) {
          resolve({
            file,
            key
          })
        } else {
          let msg = respInfo.data && respInfo.data.error || `code: ${respInfo.statusCode}`
          reject({
            file,
            key,
            msg: msg,
            statusCode: respInfo.statusCode,
            stack: msg
          })
        }
      })
    })
  }

  fetchUploadedFiles({ pageSize = 500, prefix, storageAs = 'qiniu-prefix-fetch.json' } = {}) {
    if (!prefix) return

    let files = []
    return new Promise((resolve, reject) => {
      let run = ({ marker = '', pageIndex = 1 } = {}) => {
        this.log(`fetching files of page ${infoStyle(pageIndex)}`)
        this._fetch({ pageSize, prefix, marker }).then(respBody => {
          this.log(`             ${infoStyle(respBody.items.length)} items founded.`)
          respBody.items.forEach(function (item) {
            files.push(item.key)
          })

          if (respBody.marker) {
            run({ marker: respBody.marker, pageIndex: pageIndex + 1 })
          } else {
            resolve()
          }
        }).catch(reject)
      }

      run()
    }).then(() => {
      this.log(`prefix of [${infoStyle(prefix)}], ${infoStyle(files.length)} files fetched.`)
      fs.writeFileSync(path.resolve(this.config.cwd, storageAs), JSON.stringify(files, null, '\t'))
      return this
    })
  }

  _fetch({ pageSize, prefix, marker }) {
    return new Promise((resolve, reject) => {
      this.bucketManager.listPrefix(this.config.bucket, { limit: pageSize, prefix, marker }, function (err, respBody, respInfo) {
        if (err) {
          console.error(err)
          reject(err)
        }
        if (respInfo.statusCode == 200) {
          resolve(respBody)
        } else {
          reject(new Error(respInfo.statusCode))
        }
      })
    })
  }

  batchDelFiles({ batchSize = 100, fetchFile = 'qiniu-prefix-fetch.json', storageAs = 'qiniu-batch-delete.json' } = {}) {
    return new Promise((resolve, reject) => {
      let results = []
      let files = []
      if (!fs.existsSync(path.resolve(this.config.cwd, fetchFile))) {
        return this.log(errorStyle('`fetchUploadedFiles` must be executed before `batchDelFiles`'))
      }

      let content = fs.readFileSync(path.resolve(this.config.cwd, fetchFile), 'utf8')
      files = JSON.parse(content)

      this.log(`ready to delete ${infoStyle(files.length)} files...`)

      let del = (callback) => {
        let operations = files.splice(0, batchSize).map(key => qiniu.rs.deleteOp(this.config.bucket, key))

        if (operations.length === 0) return callback()

        this.bucketManager.batch(operations, function (err, respBody, respInfo) {
          if (err) {
            this.error(errorStyle(err))
          } else {
            results = results.concat(respBody)
          }
          del(callback)
        })
      }

      del(() => {
        this.log(`delete done.`)
        resolve()
        fs.writeFile(path.resolve(this.config.cwd, storageAs), JSON.stringify(results, null, '\t'), function (err) {
          if (err) {
            this.log(errorStyle(`error occured when save delted results. ${err.stack}`))
          }
        })
      })
    })
  }
}

Uploader.defaults = DEFAULTS

Uploader.zone = zone

module.exports = Uploader
