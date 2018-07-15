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
   * @param  {Object} data 批操作数据对象
   * @return {Promise}     promise
   */
  batchWrite (data) {
    // 参数
    let params = {
      tables: [{
        tableName: this.tableName,
        rows: this.__parseObjectToBatchWriteRows(data)
      }]
    }
    // 批操作
    return this.__store.batchWriteRow(params).then((data) => data)
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
    return writeRows
  }

  // ================ 将 data 转换为 row 结构 ================
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
}

module.exports = Table