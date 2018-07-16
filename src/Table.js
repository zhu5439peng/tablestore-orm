const Store = require('tablestore')

class Table {
  /**
   * 构造函数
   * @param  {TableStore} store     TableStore实例
   * @param  {String}     tableName 表名
   */
  constructor (tableName, options) {
    this.__store = null

    // tableName
    this.tableName = tableName

    // options
    Object.assign(this, {
      primaryKeys: options.primaryKeys || [],
      timeToLive: options.timeToLive || -1,
      maxVersions: options.maxVersions || 1,
      reservedRead: options.reservedRead || 0,
      reservedWrite: options.reservedWrite || 0,
      streamEnable: options.streamEnable || false,
      streamExpirationTime: options.streamExpirationTime || 0
    })

    // status
    this.isSynced = false
  }

  /**
   * 设置 TableStore 实例
   * @param {TableStore} store TableStore实例
   */
  setStore (store) {
    this.__store = store
    return this
  }

  /**
   * 同步 meta 数据
   */
  sync (force = false) {
    if (this.isSynced && !force) {
      return Promise.resolve(this)
    } else {
      return new Promise((resolve, reject) => {
        // 获取表 meta 数据
        this.__store.describeTable({
          tableName: this.tableName
        }).then((err, data) => {
          if (err) reject(err)
          this.primaryKeys = data.table_meta.primary_key
          this.isSynced = true
          resolve(this)
        });
      })
    }
  }

  /**
   * 批量增、删、改操作
   * @param  {Object} batchOpData 批操作数据对象
   * @return {Promise}            promise
   */
  batchWrite (batchOpData) {
    let rows = this.__parseObjectToBatchWriteRows(batchOpData)
    // 参数
    let params = {
      tables: [{
        tableName: this.tableName,
        rows: rows
      }]
    }
    // 批操作
    return this.__store.batchWriteRow(params).then((data) => {
      // 获取结果
      let arr = data.tables[this.tableName]
      // 过滤非成功的项
      rows = rows.filter((item, i) => { return (arr[i] || {}).isOk })
      // 返回操作成功的项
      return this.__parseBatchWriteRowsToObject(rows)
    })
  }

  /**
   * 保存一条数据（存在则更新）
   * @param  {Object} row 新数据行
   * @return {Promise}    promise
   */
  put (row) {
    if (!row) return Promise.reject('参数无效')
    // 单条新增
    let params = this.__buildPutRowParams(row)
    return this.__store.putRow(params).then(() => row)
  }

  /**
   * 保存多条数据（存在则更新）
   * @param  {Array} rows  新数据行数组
   * @return {Promise}     promise
   */
  batchPut (rows) {
    if (!rows || !rows.length) return Promise.reject('参数无效')
    // 批量新增
    return this.batchWrite({ put: rows })
  }

  /**
   * 新增一条数据
   * @param  {Object} row 新数据行
   * @return {Promise}    promise
   */
  insert (row) {
    if (!row) return Promise.reject('参数无效')
    // 单条新增
    let params = this.__buildInsertRowParams(row)
    return this.__store.putRow(params).then(() => row)
  }

  /**
   * 新增多条数据
   * @param  {Array} rows  新数据行数组
   * @return {Promise}     promise
   */
  batchInsert (rows) {
    if (!rows || !rows.length) return Promise.reject('参数无效')
    // 批量新增
    return this.batchWrite({ insert: rows })
  }

  /**
   * 删除一条数据
   * @param  {Object} row 待删除的数据行
   * @return {Promise}    promise
   */
  delete (row) {
    if (!row) return Promise.reject('参数无效')
    // 单条删除
    let params = this.__buildDeleteRowParams(row)
    return this.__store.deleteRow(params).then(() => row)
  }

  /**
   * 删除多条数据
   * @param  {Array} rows 待删除的数据行数组
   * @return {Promise}    promise
   */
  batchDelete (rows) {
    if (!rows || !rows.length) return Promise.reject('参数无效')
    // 批量删除
    return this.batchWrite({ delete: rows })
  }

  /**
   * 更新一条或多条数据
   * @param  {Object|Array} row 待更新的数据行
   * @return {Promise}      promise
   */
  update (row) {
    if (!row) return Promise.reject('参数无效')
    // 单条更新
    let params = this.__buildUpdateRowParams(row)
    return this.__store.updateRow(params)
  }

  /**
   * 更新多条数据
   * @param  {Object|Array} rows 待更新的数据行数组
   * @return {Promise}     promise
   */
  batchUpdate (rows) {
    if (!rows || rows.length === 0) return Promise.reject('参数无效')
    // 批量更新
    return this.batchWrite({ update: rows })
  }

  /**
   * 根据主键获取一条数据
   * @param  {Object} row         带主键的行
   * @param  {Object} options     选项
   * @return {Promise}            promise
   */
  get (row, options) {
    if (!row) return Promise.reject('参数无效')

    // options
    options = options || {}

    // params
    let params = {
      tableName: this.tableName,
      primaryKey: this.__parseRowToPrimaryKey(row, ''),
      startColumn: options.startColumn,
      endColumn: options.endColumn
    }

    // getRow
    return this.__store.getRow(params).then((data) => {
      let row = data.row
      if (Object.keys(row).length === 0) return null
      return this.__parseDataToRow(row)
    })
  }

  /**
   * 根据主键集合获取多条数据
   * @param  {Object} rows        带主键的行数组
   * @param  {Object} options     选项
   * @return {Promise}            promise
   */
  batchGet (rows, options) {
    if (!rows || !rows.length) return Promise.reject('参数无效')

    // options
    options = options || {}

    // params
    let params = {
      tables: [{
        tableName: this.tableName,
        primaryKey: rows.map(row => this.__parseRowToPrimaryKey(row, '')),
        startColumn: options.startColumn,
        endColumn: options.endColumn
      }]
    }

    // getRow
    return this.__store.batchGetRow(params).then((data) => {
      let arr = data.tables[0] || []
      if (!arr.length) return arr
      // parse
      arr = arr.filter((item) => item.isOk)
      return arr.map((item) => this.__parseDataToRow(item))
    })
  }

  /**
   * 读取指定主键范围内的数据
   * @param  {Object} startRow    起始主键行
   * @param  {Object} endRow      结束主键行
   * @param  {Object} options     选项
   * @return {Promise}            promise
   */
  getRange (startRow, endRow, options) {
    // options
    options = options || { __rows: [] }

    // params
    let params = {
      tableName: this.tableName,
      direction: Store.Direction.FORWARD,
      inclusiveStartPrimaryKey: this.__parseRowToPrimaryKey(startRow, Store.INF_MIN),
      exclusiveEndPrimaryKey: this.__parseRowToPrimaryKey(endRow, Store.INF_MAX),
      startColumn: options.startColumn,
      endColumn: options.endColumn,
      limit: 5
    }

    // 异步递归获取
    return this.__store.getRange(params).then((data) => {
      options.__rows = options.__rows.concat(data.rows)
      if (data.next_start_primary_key) {
        data.next_start_primary_key.forEach((item) => { startRow[item.name] = item.value })
        return this.getRange(startRow, endRow, options)
      } else {
        return options.__rows.map((item) => this.__parseDataToRow(item))
      }
    })
  }

  /**
   * 读取指定主键范围内的数据
   * @param  {Object} options              查询选项
   * @param  {Object} options.where        带分区键的条件
   * @param  {Number} options.limit        每页多少条
   * @param  {Number} options.page         获取第几页
   * @param  {String} options.startColumn  获取第几页
   * @param  {String} options.endColumn    获取第几页
   * @return {Promise}             promise
   */
  select (options) {
    options = Object.assign({
      where: {},
      limit: 10,
      page: 1,
      startColumn: null,
      endColumn: null
    }, options)

    let page = options.page <= 0 ? 1 : options.page
    let isFirst = (page === 1)
    let offset = (page - 1) * options.limit

    // params
    let params = {
      tableName: this.tableName,
      direction: Store.Direction.FORWARD,
      inclusiveStartPrimaryKey: this.__parseRowToPrimaryKey(options.where, Store.INF_MIN),
      exclusiveEndPrimaryKey: this.__parseRowToPrimaryKey({}, Store.INF_MAX),
      startColumn: isFirst ? options.startColumn : '_',
      endColumn: isFirst ? options.endColumn : '__',
      limit: isFirst ? options.limit : offset
    }

    // 获取分页数据
    return this.__store.getRange(params).then((data) => {
      if (isFirst) {
        // 获取首页数据
        return data.rows
      } else if (data.next_start_primary_key) {
        // 获取非首页数据
        params.startColumn = options.startColumn
        params.endColumn = options.endColumn
        params.limit = options.limit
        params.inclusiveStartPrimaryKey = data.next_start_primary_key.map((item) => ({[item.name]: item.value}))
        return this.__store.getRange(params).then((data) => (data.rows || []))
      } else {
        // 获取的页码超过总页数
        return []
      }
    }).then((rows) => {
      return rows.map((item) => this.__parseDataToRow(item))
    })
  }

  /**
   * 验证一行数据是否为该表的有效数据
   * @param  {Object} row 数据行
   * @return {Boolean}    是否有效
   */
  validateRow (row) {
    if (!row) return false
    let result = true
    this.primaryKeys.forEach((item) => {
      if (!row.hasOwnProperty(item.name)) {
        result = false
        return false
      }
    })
    return result
  }

  // ================ 构建 putRow/insertRow/deleteRow 参数 ================

  /**
   * 构建 putRow 参数
   * @param  {Object} row       数据行
   * @param  {Condition} [condition] 条件（可选，默认 RowExistenceExpectation.IGNORE）
   * @return {Object}           putRow 参数
   */
  __buildPutRowParams (row, condition) {
    condition = condition || new Store.Condition(Store.RowExistenceExpectation.IGNORE, null)
    return {
      tableName: this.tableName,
      condition: condition,
      primaryKey: this.__parseRowToPrimaryKey(row),
      attributeColumns: this.__parseRowToAttributeColumns(row),
      returnContent: {
        returnType: Store.ReturnType.Primarykey
      }
    }
  }

  /**
   * 构建 insertRow 参数
   * @param  {Object} row       数据行
   * @param  {Condition} [condition] 条件（可选，默认 RowExistenceExpectation.EXPECT_NOT_EXIST）
   * @return {Object}           putRow 参数
   */
  __buildInsertRowParams (row, condition) {
    condition = condition || new Store.Condition(Store.RowExistenceExpectation.EXPECT_NOT_EXIST, null)
    return this.__buildPutRowParams(row, condition)
  }

  /**
   * 构建 deleteRow 参数
   * @param  {Object} row       数据行
   * @param  {Condition} [condition] 条件（可选，默认 RowExistenceExpectation.IGNORE）
   * @return {Object}           deleteRow 参数
   */
  __buildDeleteRowParams (row, condition) {
    condition = condition || new Store.Condition(Store.RowExistenceExpectation.IGNORE, null)
    return {
      tableName: this.tableName,
      condition: condition,
      primaryKey: this.__parseRowToPrimaryKey(row)
    }
  }

  /**
   * 构建 updateRow 参数（与 putRow、batchWriteRow 兼容）
   * @param  {Object} row       数据行
   * @param  {Condition} [condition] 条件（可选，默认 RowExistenceExpectation.EXPECT_EXIST）
   * @return {Object}           updateRow 参数
   */
  __buildUpdateRowParams (row, condition) {
    condition = condition || new Store.Condition(Store.RowExistenceExpectation.EXPECT_EXIST, null)
    let attributeColumns = this.__parseRowToUpdateOfAttributeColumns(row)
    return {
      tableName: this.tableName,
      condition: condition,
      primaryKey: this.__parseRowToPrimaryKey(row),
      updateOfAttributeColumns: attributeColumns,
      attributeColumns: attributeColumns,
      returnContent: {
        returnType: Store.ReturnType.Primarykey
      }
    }
  }

  // ================ 将 row 转换为 params 参数 ================

  /**
   * 将带主键信息的数据行转换为主键参数数组
   * @param  {Object} row           数据行
   * @param  {String} defaultValue  为空时的默认值
   * @return {Array}                主键参数数组
   */
  __parseRowToPrimaryKey (obj, defaultValue) {
    obj = obj || {}
    let arr = []
    this.primaryKeys.forEach((item) => {
      let key = item.name
      let value = obj[key]
      if (obj.hasOwnProperty(key)) {
        if (item.type === Store.Long) {
          value = Store.Long.fromNumber(parseInt(value))
        }
        arr.push({[key]: value})
      } else if (defaultValue !== undefined) {
        arr.push({[key]: defaultValue})
      }
    })
    return arr
  }

  /**
   * 将数据行转换为数据属性列 attributeColumns
   * @param  {Object} row 数据行
   * @return {Array}      数据属性列
   */
  __parseRowToAttributeColumns (obj) {
    let arr = []
    let ignoreKeys = this.primaryKeys.map((item) => item.name)
    for (let key in obj) {
      if (ignoreKeys.indexOf(key) >= 0) continue
      let value = obj[key]
      arr.push({[key]: value})
    }
    return arr
  }

  /**
   * 将数据行转换为数据更新属性列 updateOfAttributeColumns
   * @param  {Object} row 数据行
   * @return {Array}      数据更新属性列
   */
  __parseRowToUpdateOfAttributeColumns (obj) {
    let putColumns = this.__parseRowToAttributeColumns(obj)
    return [{ PUT: putColumns }]
  }

  /**
   * 将批操作对象转换为批量写 rows
   * @param  {Object} obj 批操作对象
   * @return {Array}      批量写 rows
   */
  __parseObjectToBatchWriteRows (obj) {
    let writeRows = []
    // parse
    for (let key in obj) {
      let op = key.toLocaleUpperCase()
      let rows = obj[key] || []
      if (!rows.length) continue
      rows.forEach((row) => {
        let item = null
        switch (op) {
          case 'PUT':
            item = this.__buildPutRowParams(row)
            item.type = 'PUT'
            delete item.tableName
            writeRows.push(item)
          break;
          case 'INSERT':
            item = this.__buildInsertRowParams(row)
            item.type = 'PUT'
            delete item.tableName
            writeRows.push(item)
          break;
          case 'UPDATE':
            item = this.__buildUpdateRowParams(row)
            item.type = 'UPDATE'
            delete item.tableName
            writeRows.push(item)
          break;
          case 'DELETE':
            item = this.__buildDeleteRowParams(row)
            item.type = 'DELETE'
            delete item.tableName
            writeRows.push(item)
          break;
        }
      })
    }
    // return
    return writeRows
  }

  /**
   * 将批量写 rows 转换为批操作对象
   * @param  {Object} obj 批操作对象
   * @return {Array}      批量写 rows
   */
  __parseBatchWriteRowsToObject (writeRows) {
    let obj = {
      put: [],
      insert: [],
      update: [],
      delete: []
    }

    // parse
    writeRows.forEach((item) => {
      let row = this.__parseParamsToRow(item)
      switch (item.type) {
        case 'PUT':
          obj.put.push(row)
        break;
        case 'INSERT':
          obj.insert.push(row)
        break;
        case 'UPDATE':
          obj.update.push(row)
        break;
        case 'DELETE':
          obj.delete.push(row)
        break;
      }
    })

    return obj
  }

  // ================ 将 data/params 转换为 row 结构 ================

  /**
   * 将从数据库获取的数据转换为 row 对象
   * @param  {Object} data 数据对象
   * @return {Object}      row 对象
   */
  __parseDataToRow (data) {
    let row = { }

    // 主键列
    if (data.primaryKey instanceof Array) {
      data.primaryKey.forEach((item) => {
        row[item.name] = item.value
      })
    }

    // 属性列
    if (data.attributes instanceof Array) {
      data.attributes.forEach((item) => {
        row[item.columnName] = item.columnValue
      })
    }

    return row
  }

  /**
   * 将参数对象转换为 row 对象
   * @param  {Object} params 数据对象
   * @return {Object}      row 对象
   */
  __parseParamsToRow (params) {
    let row = { }

    // 主键列
    if (params.primaryKey instanceof Array) {
      params.primaryKey.forEach((item) => {
        Object.assign(row, item)
      })
    }

    // 属性列
    if (params.attributeColumns instanceof Array) {
      params.attributeColumns.forEach((item) => {
        Object.assign(row, item)
      })
    }

    return row
  }
}

module.exports = Table