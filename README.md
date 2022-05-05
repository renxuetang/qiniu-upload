# qiniu-upload
一个简单的工具，把静态资源发布到七牛的CDN空间。

因为想把vue项目的中的静态资源，通过vue-cli-service的命令发布到七牛的cdn，所以就先做这个工具。核心目标就是把一个文件夹内指定的文件集合，全部上传到七牛特定的某个存储空间，考虑到上传会有出错的情况，所以需要支持覆盖式上传，然后还要考虑对七牛相关的密钥进行保护处理；最后希望上传过程就是一个异步处理过程，在上传完毕时，能够看到一个整体的上传统计结果(成功多少个，失败多少个)，以及失败的明细情况。

## 用法

* 安装
    ```
    npm install @renxuetang/qiniu-upload --save-dev
    ```

* 定义一个`.qiniu`配置文件
    ```
    accessKey=
    secretKey=
    bucket=
    ```
    这个文件用来在本地定义七牛的AK和SK，最好加入到`.gitignore`，避免这样的信息传递到代码仓库。

* 编写上传任务

    编写一个`upload.js`：
    ```js
    const Uploader = require('@renxuetang/qiniu-upload')

    new Uploader({
        envFile: '.qiniu', //定义ak sk的本地配置文件名
        base: 'dist', // 定义上传的基准目录
        output: 'qiniu-upload.json', // 定义上传结束后导出上传明细的文件名
        glob: 'dist/**', // 定义要上传的文件集，glob格式
        globIgnore: [
            'dist/!(static)/**'
        ], // 定义哪些文件不上传，glob格式
        bucket: 'static', // 定义要上传到的七牛空间名
        overrides: false, // 是否覆盖
        parallelCount: 2, // 并行上传任务数
        zone: Uploader.zone.z0 // 定义七牛的zone，每个空间都属于不同的zone，需要提前指定这个
    }).start()
    ```
    然后运行：
    ```js
    node upload
    ```
    最后就会在控制台看到上传的进度和上传的结果：
    ```
    [@renxuetang/qiniu-upload] config:
    [@renxuetang/qiniu-upload]       cwd: D:\code\@renxuetang/qiniu-upload
    [@renxuetang/qiniu-upload]       envFile: .qiniu
    [@renxuetang/qiniu-upload]       base: dist
    [@renxuetang/qiniu-upload]       output: qiniu-upload.json
    [@renxuetang/qiniu-upload]       bucket: static
    [@renxuetang/qiniu-upload]       overrides: false
    [@renxuetang/qiniu-upload] total files: 5, uploading:0, success:5, fail:0
    ```

## options

* accessKey
    * `{String}`
    * `default`: `''`
    * `description`: 七牛的AK，推荐在`envFile`中配置，比较安全。但是在此处指定的AK优先级比`envFile`中的高，这样当你不想启用`envFile`的时候有用，比如把AK配置到vue的`.env`相关环境变量的文件中。

* keyPrefix
    * `{String}`
    * `default`: `''`
    * `description`: 七牛的路径前缀。

* secretKey
    * `{String}`
    * `default`: `''`
    * `description`: 七牛的SK，推荐在`envFile`中配置，比较安全。但是在此处指定的SK优先级比`envFile`中的高，这样当你不想启用`envFile`的时候有用，比如把SK配置到vue的`.env`相关环境变量的文件中。

* cwd
    * `{String}`
    * `default`: `process.cwd()`
    * `description`: 工作目录。内部一些文件和目录的位置，都是相对这个值去处理的。

* envFile
    * `{String|mixed}`
    * `default`: `.qiniu`
    * `description`: 环境变量的配置文件，可用来配置AK和SK。设置为falsy值时，将禁用环境变量配置的特性。

* glob
    * `{String}`
    * `default`: `dist/**`
    * `description`: 按照[node-glob](https://github.com/isaacs/node-glob)开发的`glob`格式的字符串，用来查找待上传的文件列表。默认值是`dist/**`，因为这个工具目标是给vue用的，所以默认值跟`vue`关联比较紧密。`dist/**`表示要上传的文件范围就是`dist/`目录下的所有文件，包含子孙目录。

* globIgnore
    * `{String|Array}`
    * `default`: `[
        'dist/!(static)/**'
    ]`
    * `description`: 按照[node-glob](https://github.com/isaacs/node-glob)开发的`glob`格式的字符串，用来排除不想上传的文件。也可以是一个数组，指定多个排除的`glob`串。建议自行配置。

* base
    * `{String}`
    * `default`: `dist`
    * `description`: 上传的基准目录。假如有一个文件`dist/static/js/app.js`，因为`base`是`dist`，所以这个文件将会按照`static/js/app.js`这个形式，作为七牛的key，进行上传。

* output:
    * `{String}`
    * `default`: `'qiniu-upload.json`
    * `description`: 指定上传结束后存储上传明细的导出文件。

* bucket:
    * `{String}`
    * `default`: `''`
    * `description`: 指定七牛的bucket。

* overrides:
    * `{Boolean}`
    * `default`: `false`
    * `description`: 指定是否进行覆盖上传。建议保留为false，因为根据七牛对于覆盖上传的说明，同名文件，只要etag相同，如果`overrides`配置为false，也能上传成功；但是`overrides`为false时，如果同名文件etag不同，则会导致上传失败，所以`overrides`对于文件有一定的保护作用。

* zone:
    * `{Uploader.zone}`
    * `default`: `Uploader.zone.z0`
    * `description`: 指定七牛的zone。 有`z0 z1 z2 na0`可选。

* parallelCount:
    * `{Number}`
    * `default`: `2`
    * `description`: 设置并行上传数。

## 按照前缀进行文件的批量删除
根据七牛官方的NODE SDK，要实现指定前缀的文件批量删除，还是非常容易的。这个库的使用示例如下：
```js
const Uploader = require('@renxuetang/qiniu-upload')

new Uploader({
    debug: true
})
.fetchUploadedFiles({prefix: 'test/0.1.1/'})
.then(uploader => {
    uploader.batchDelFiles()
})
```
第一步，先构造`Uploader`。 这一步构造时，以下几个option在删除操作中仍然是需要的：
```
accessKey: '', // set in .qiniu file
secretKey: '', // set in .qiniu file
cwd: process.cwd(),
envFile: '.qiniu',
bucket: 'static',
zone: zone.z0
```
第二步，先调用`fetchUploadedFiles`方法，抓取指定前缀的文件列表。 这个方法接收一个对象作为参数，包含以下几个属性：
```js
{ pageSize = 500, prefix, storageAs = 'qiniu-prefix-fetch.json' }
```
`pageSize`代表从七牛抓取文件时，每次抓取的数量，因为七牛提供的接口类似分页列表；`prefix`指定相关的文件的前缀；`storageAs`指定一个文件，用来存储最后获取到的所有满足前缀条件的文件列表。
`fetchUploadedFiles`是一个异步的，所以会返回一个`Promise`实例，在`Promise`被`resolve`的时候，进行下一步操作。
第三步，调用`batchDelFiles`进行删除。此方法内部接收一个对象作为参数，包含以下几个属性：
```js
{ batchSize = 100, fetchFile = 'qiniu-prefix-fetch.json', storageAs = 'qiniu-batch-delete.json' }
```
`batchSize`表示每次调用七牛批量删除接口请求时的删除数量，`fetchFile`表示要删除的文件列表文件，一般要与`fetchUploadedFiles`方法里的`storageAs`参数保持一致，`storageAs`指定一个文件，最终会存储所有文件的删除结果。

## Special Thanks

- [liuyunzhuge](https://github.com/liuyunzhuge/simple-qiniu-upload)


## License

Copyright © 2020, [renxuetang](https://github.com/renxuetang).
Released under the [MIT License](LICENSE).
