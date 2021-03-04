/*
License for this version: GPL v3 (http://www.gnu.org/licenses/gpl.txt) or commercial license.
Contact for commercial license: sales@litehelpers.net
 */

(function() {
  var DB_STATE_INIT, DB_STATE_OPEN, READ_ONLY_REGEX, SQLiteFactory, SQLitePlugin, SQLitePluginTransaction, SelfTest, argsArray, dblocations, iosLocationMap, newSQLError, nextTick, root, txLocks;

  root = this;

  READ_ONLY_REGEX = /^(\s|;)*(?:alter|create|delete|drop|insert|reindex|replace|update)/i;

  DB_STATE_INIT = "INIT";

  DB_STATE_OPEN = "OPEN";

  txLocks = {};

  newSQLError = function(error, code) {
    var sqlError;
    sqlError = error;
    if (!code) {
      code = 0;
    }
    if (!sqlError) {
      sqlError = new Error("a plugin had an error but provided no response");
      sqlError.code = code;
    }
    if (typeof sqlError === "string") {
      sqlError = new Error(error);
      sqlError.code = code;
    }
    if (!sqlError.code && sqlError.message) {
      sqlError.code = code;
    }
    if (!sqlError.code && !sqlError.message) {
      sqlError = new Error("an unknown error was returned: " + JSON.stringify(sqlError));
      sqlError.code = code;
    }
    return sqlError;
  };

  nextTick = window.setImmediate || function(fun) {
    window.setTimeout(fun, 0);
  };


  /*
    Utility that avoids leaking the arguments object. See
    https://www.npmjs.org/package/argsarray
   */

  argsArray = function(fun) {
    return function() {
      var args, i, len;
      len = arguments.length;
      if (len) {
        args = [];
        i = -1;
        while (++i < len) {
          args[i] = arguments[i];
        }
        return fun.call(this, args);
      } else {
        return fun.call(this, []);
      }
    };
  };

  SQLitePlugin = function(openargs, openSuccess, openError) {
    var dbname;
    if (!(openargs && openargs['name'])) {
      throw newSQLError("Cannot create a SQLitePlugin db instance without a db name");
    }
    dbname = openargs.name;
    if (typeof dbname !== 'string') {
      throw newSQLError('sqlite plugin database name must be a string');
    }
    this.openargs = openargs;
    this.dbname = dbname;
    this.openSuccess = openSuccess;
    this.openError = openError;
    this.openSuccess || (this.openSuccess = function() {
      console.log("DB opened: " + dbname);
    });
    this.openError || (this.openError = function(e) {
      console.log(e.message);
    });
    this.open(this.openSuccess, this.openError);
  };

  SQLitePlugin.prototype.databaseFeatures = {
    isSQLitePluginDatabase: true
  };

  SQLitePlugin.prototype.openDBs = {};

  SQLitePlugin.prototype.dbidmap = {};

  SQLitePlugin.prototype.fjmap = {};

  SQLitePlugin.prototype.addTransaction = function(t) {
    if (!txLocks[this.dbname]) {
      txLocks[this.dbname] = {
        queue: [],
        inProgress: false
      };
    }
    txLocks[this.dbname].queue.push(t);
    if (this.dbname in this.openDBs && this.openDBs[this.dbname] !== DB_STATE_INIT) {
      this.startNextTransaction();
    } else {
      if (this.dbname in this.openDBs) {
        console.log('new transaction is queued, waiting for open operation to finish');
      } else {
        console.log('database is closed, new transaction is [stuck] waiting until db is opened again!');
      }
    }
  };

  SQLitePlugin.prototype.transaction = function(fn, error, success) {
    if (!this.openDBs[this.dbname]) {
      error(newSQLError('database not open'));
      return;
    }
    this.addTransaction(new SQLitePluginTransaction(this, fn, error, success, true, false));
  };

  SQLitePlugin.prototype.readTransaction = function(fn, error, success) {
    if (!this.openDBs[this.dbname]) {
      error(newSQLError('database not open'));
      return;
    }
    this.addTransaction(new SQLitePluginTransaction(this, fn, error, success, false, true));
  };

  SQLitePlugin.prototype.startNextTransaction = function() {
    var self;
    self = this;
    nextTick((function(_this) {
      return function() {
        var txLock;
        if (!(_this.dbname in _this.openDBs) || _this.openDBs[_this.dbname] !== DB_STATE_OPEN) {
          console.log('cannot start next transaction: database not open');
          return;
        }
        txLock = txLocks[self.dbname];
        if (!txLock) {
          console.log('cannot start next transaction: database connection is lost');
          return;
        } else if (txLock.queue.length > 0 && !txLock.inProgress) {
          txLock.inProgress = true;
          txLock.queue.shift().start();
        }
      };
    })(this));
  };

  SQLitePlugin.prototype.abortAllPendingTransactions = function() {
    var l, len1, ref, tx, txLock;
    txLock = txLocks[this.dbname];
    if (!!txLock && txLock.queue.length > 0) {
      ref = txLock.queue;
      for (l = 0, len1 = ref.length; l < len1; l++) {
        tx = ref[l];
        tx.abortFromQ(newSQLError('Invalid database handle'));
      }
      txLock.queue = [];
      txLock.inProgress = false;
    }
  };

  SQLitePlugin.prototype.open = function(success, error) {
    var openerrorcb, opensuccesscb, step2;
    if (this.dbname in this.openDBs) {
      console.log('database already open: ' + this.dbname);
      this.dbid = this.dbidmap[this.dbname];
      nextTick((function(_this) {
        return function() {
          success(_this);
        };
      })(this));
    } else {
      console.log('OPEN database: ' + this.dbname);
      opensuccesscb = (function(_this) {
        return function(fjinfo) {
          var txLock;
          console.log('OPEN database: ' + _this.dbname + ' - OK');
          if (!!fjinfo && !!fjinfo.dbid) {
            console.log('Detected Android/iOS/macOS platform version with flat JSON interface');
            _this.dbidmap[_this.dbname] = _this.dbid = fjinfo.dbid;
            _this.fjmap[_this.dbname] = true;
          }
          if (!_this.openDBs[_this.dbname]) {
            console.log('database was closed during open operation');
          }
          if (_this.dbname in _this.openDBs) {
            _this.openDBs[_this.dbname] = DB_STATE_OPEN;
          }
          if (!!success) {
            success(_this);
          }
          txLock = txLocks[_this.dbname];
          if (!!txLock && txLock.queue.length > 0 && !txLock.inProgress) {
            _this.startNextTransaction();
          }
        };
      })(this);
      openerrorcb = (function(_this) {
        return function() {
          console.log('OPEN database: ' + _this.dbname + ' FAILED, aborting any pending transactions');
          if (!!error) {
            error(newSQLError('Could not open database'));
          }
          delete _this.openDBs[_this.dbname];
          delete _this.dbidmap[_this.dbname];
          delete _this.fjmap[_this.dbname];
          _this.abortAllPendingTransactions();
        };
      })(this);
      this.openDBs[this.dbname] = DB_STATE_INIT;
      this.dbidmap[this.dbname] = this.dbid = null;
      this.fjmap[this.dbname] = false;
      step2 = (function(_this) {
        return function() {
          cordova.exec(opensuccesscb, openerrorcb, "SQLitePlugin", "open", [_this.openargs]);
        };
      })(this);
      cordova.exec(step2, step2, 'SQLitePlugin', 'close', [
        {
          path: this.dbname
        }
      ]);
    }
  };

  SQLitePlugin.prototype.close = function(success, error) {
    if (this.dbname in this.openDBs) {
      if (txLocks[this.dbname] && txLocks[this.dbname].inProgress) {
        console.log('cannot close: transaction is in progress');
        error(newSQLError('database cannot be closed while a transaction is in progress'));
        return;
      }
      console.log('CLOSE database: ' + this.dbname);
      delete this.openDBs[this.dbname];
      if (txLocks[this.dbname]) {
        console.log('closing db with transaction queue length: ' + txLocks[this.dbname].queue.length);
      } else {
        console.log('closing db with no transaction lock state');
      }
      cordova.exec(success, error, "SQLitePlugin", "close", [
        {
          path: this.dbname
        }
      ]);
    } else {
      console.log('cannot close: database is not open');
      if (error) {
        nextTick(function() {
          return error();
        });
      }
    }
  };

  SQLitePlugin.prototype.executeSql = function(statement, params, success, error) {
    var myerror, myfn, mysuccess;
    mysuccess = function(t, r) {
      if (!!success) {
        return success(r);
      }
    };
    myerror = function(t, e) {
      if (!!error) {
        return error(e);
      }
    };
    myfn = function(tx) {
      tx.addStatement(statement, params, mysuccess, myerror);
    };
    this.addTransaction(new SQLitePluginTransaction(this, myfn, null, null, false, false));
  };

  SQLitePlugin.prototype.sqlBatch = function(sqlStatements, success, error) {
    var f, ss;
    if (!sqlStatements || sqlStatements.constructor !== Array) {
      throw newSQLError('sqlBatch expects an array');
    }
    ss = sqlStatements.slice(0);
    f = function(tx) {
      var l, len1, results, s;
      results = [];
      for (l = 0, len1 = ss.length; l < len1; l++) {
        s = ss[l];
        if (s.constructor === Array) {
          if (s.length === 0) {
            throw newSQLError('sqlBatch array element of zero (0) length');
          }
          results.push(tx.addStatement(s[0], (s.length === 0 ? [] : s[1]), null, null));
        } else {
          results.push(tx.addStatement(s, [], null, null));
        }
      }
      return results;
    };
    this.addTransaction(new SQLitePluginTransaction(this, f, error, success, true, false));
  };

  SQLitePluginTransaction = function(db, fn, error, success, txlock, readOnly) {
    if (typeof fn !== "function") {

      /*
      This is consistent with the implementation in Chrome -- it
      throws if you pass anything other than a function. This also
      prevents us from stalling our txQueue if somebody passes a
      false value for fn.
       */
      throw newSQLError("transaction expected a function");
    }
    this.db = db;
    this.fn = fn;
    this.error = error;
    this.success = success;
    this.txlock = txlock;
    this.readOnly = readOnly;
    this.executesLength = 0;
    this.flatExecutesList = [];
    this.executeCallbacks = [];
    if (txlock) {
      this.addStatement("BEGIN", [], null, function(tx, err) {
        throw newSQLError("unable to begin transaction: " + err.message, err.code);
      });
    } else {
      this.addStatement("SELECT 1", [], null, null);
    }
  };

  SQLitePluginTransaction.prototype.start = function() {
    var err;
    try {
      this.fn(this);
      this.run();
    } catch (error1) {
      err = error1;
      txLocks[this.db.dbname].inProgress = false;
      this.db.startNextTransaction();
      if (this.error) {
        this.error(newSQLError(err));
      }
    }
  };

  SQLitePluginTransaction.prototype.executeSql = function(sql, values, success, error) {
    if (this.finalized) {
      throw {
        message: 'InvalidStateError: DOM Exception 11: This transaction is already finalized. Transactions are committed after its success or failure handlers are called. If you are using a Promise to handle callbacks, be aware that implementations following the A+ standard adhere to run-to-completion semantics and so Promise resolution occurs on a subsequent tick and therefore after the transaction commits.',
        code: 11
      };
      return;
    }
    if (this.readOnly && READ_ONLY_REGEX.test(sql)) {
      this.handleStatementFailure(error, {
        message: 'invalid sql for a read-only transaction'
      });
      return;
    }
    this.addStatement(sql, values, success, error);
  };

  SQLitePluginTransaction.prototype.addStatement = function(sql, values, success, error) {
    var flatlist, l, len1, sqlStatement, t, v;
    sqlStatement = typeof sql === 'string' ? sql : sql.toString();
    this.executesLength++;
    flatlist = this.flatExecutesList;
    flatlist.push(sqlStatement);
    if (!!values && values.constructor === Array) {
      flatlist.push(values.length);
      for (l = 0, len1 = values.length; l < len1; l++) {
        v = values[l];
        t = typeof v;
        flatlist.push(v === null || v === void 0 ? null : t === 'number' || t === 'string' ? v : v.toString());
      }
    } else {
      flatlist.push(0);
    }
    this.executeCallbacks.push({
      success: success,
      error: error
    });
  };

  SQLitePluginTransaction.prototype.handleStatementSuccess = function(handler, response) {
    var payload, rows;
    if (!handler) {
      return;
    }
    rows = response.rows || [];
    payload = {
      rows: {
        item: function(i) {
          return rows[i];
        },
        length: rows.length
      },
      rowsAffected: response.rowsAffected || 0,
      insertId: response.insertId || void 0
    };
    handler(this, payload);
  };

  SQLitePluginTransaction.prototype.handleStatementFailure = function(handler, response) {
    if (!handler) {
      throw newSQLError("a statement with no error handler failed: " + response.message, response.code);
    }
    if (handler(this, response) !== false) {
      throw newSQLError("a statement error callback did not return false: " + response.message, response.code);
    }
  };

  SQLitePluginTransaction.prototype.run = function() {
    var batchExecuteCallbacks, batchExecutesLength, flatBatchExecutes, handlerFor, tx, txFailure, waiting;
    txFailure = null;
    batchExecutesLength = this.executesLength;
    flatBatchExecutes = this.flatExecutesList;
    batchExecuteCallbacks = this.executeCallbacks;
    waiting = batchExecutesLength;
    this.executesLength = 0;
    this.flatExecutesList = [];
    this.executeCallbacks = [];
    tx = this;
    handlerFor = function(index, didSucceed) {
      return function(response) {
        var err;
        if (!txFailure) {
          try {
            if (didSucceed) {
              tx.handleStatementSuccess(batchExecuteCallbacks[index].success, response);
            } else {
              tx.handleStatementFailure(batchExecuteCallbacks[index].error, newSQLError(response));
            }
          } catch (error1) {
            err = error1;
            txFailure = newSQLError(err);
          }
        }
        if (--waiting === 0) {
          if (txFailure) {
            tx.executesLength = 0;
            tx.flatExecutesList = [];
            tx.executeCallbacks = [];
            tx.$abort(txFailure);
          } else if (tx.executesLength > 0) {
            tx.run();
          } else {
            tx.$finish();
          }
        }
      };
    };
    if (this.db.fjmap[this.db.dbname]) {
      this.run_batch_flatjson(batchExecutesLength, flatBatchExecutes, handlerFor);
    } else {
      this.run_batch1(batchExecutesLength, flatBatchExecutes, handlerFor);
    }
  };

  SQLitePluginTransaction.prototype.run_batch_flatjson = function(batchExecutesLength, flatBatchExecutes, handlerFor) {
    var check1, flatlist, mycb, mycb2, rrr;
    this.db.dbid = this.db.dbidmap[this.db.dbname];
    flatlist = [this.db.dbid, batchExecutesLength];
    flatlist = flatlist.concat(flatBatchExecutes);
    flatlist.push('extra');
    check1 = false;
    rrr = [];
    mycb = function(result) {
      var c, changes, code, errormessage, i, insert_id, j, k, r, ri, rl, row, rows, v;
      i = 0;
      ri = 0;
      rl = result.length;
      if (rl > 0 && result[0] === 'batcherror') {
        while (i < batchExecutesLength) {
          handlerFor(i, false)({
            result: {
              code: -1,
              sqliteCode: -1,
              message: 'internal batch error'
            }
          });
          ++i;
        }
        return;
      }
      while (ri < rl) {
        r = result[ri++];
        if (r === 'ok') {
          handlerFor(i, true)({
            rows: []
          });
        } else if (r === "ch2") {
          changes = result[ri++];
          insert_id = result[ri++];
          handlerFor(i, true)({
            rowsAffected: changes,
            insertId: insert_id
          });
        } else if (r === 'okrows') {
          rows = [];
          changes = 0;
          insert_id = void 0;
          if (result[ri] === 'changes') {
            ++ri;
            changes = result[ri++];
          }
          if (result[ri] === 'insert_id') {
            ++ri;
            insert_id = result[ri++];
          }
          while (result[ri] !== 'endrows') {
            c = result[ri++];
            j = 0;
            row = {};
            while (j < c) {
              k = result[ri++];
              v = result[ri++];
              row[k] = v;
              ++j;
            }
            rows.push(row);
          }
          handlerFor(i, true)({
            rows: rows,
            rowsAffected: changes,
            insertId: insert_id
          });
          ++ri;
        } else if (r === 'error') {
          code = result[ri++];
          ++ri;
          errormessage = result[ri++];
          handlerFor(i, false)({
            code: code,
            message: errormessage
          });
        }
        ++i;
      }
    };
    mycb2 = function(result) {
      if (result.length === 0) {
        return mycb(rrr);
      } else if (result[0] === "multi") {
        return check1 = true;
      } else if (result[0] === null) {
        if (check1) {
          return mycb(rrr);
        }
      } else {
        if (check1) {
          return rrr = rrr.concat(result.slice(0, result.length - 1));
        } else {
          return mycb(result);
        }
      }
    };
    if (this.db.dbid !== -1) {
      cordova.exec(mycb2, null, "SQLitePlugin", "fj:" + flatlist.length + ";extra", flatlist);
    } else {
      cordova.exec(mycb, null, "SQLitePlugin", "fj", [
        {
          dbargs: {
            dbname: this.db.dbname
          },
          flen: batchExecutesLength,
          flatlist: flatlist
        }
      ]);
    }
  };

  SQLitePluginTransaction.prototype.run_batch1 = function(batchExecutesLength, flatBatchExecutes, handlerFor) {
    var fi, fi2, i, mycb, mycbmap, params, paramsCount, sql, tropts;
    tropts = [];
    mycbmap = {};
    fi = 0;
    i = 0;
    while (i < batchExecutesLength) {
      sql = flatBatchExecutes[fi++];
      paramsCount = flatBatchExecutes[fi++];
      fi2 = fi + paramsCount;
      params = flatBatchExecutes.slice(fi, fi2);
      fi = fi2;
      mycbmap[i] = {
        success: handlerFor(i, true),
        error: handlerFor(i, false)
      };
      tropts.push({
        sql: sql,
        params: params
      });
      i++;
    }
    mycb = function(result) {
      var l, q, r, ref, res, resultIndex, type;
      for (resultIndex = l = 0, ref = result.length - 1; 0 <= ref ? l <= ref : l >= ref; resultIndex = 0 <= ref ? ++l : --l) {
        r = result[resultIndex];
        type = r.type;
        res = r.result;
        q = mycbmap[resultIndex];
        if (q) {
          if (q[type]) {
            q[type](res);
          }
        }
        ++i;
      }
    };
    cordova.exec(mycb, null, "SQLitePlugin", "backgroundExecuteSqlBatch", [
      {
        dbargs: {
          dbname: this.db.dbname
        },
        executes: tropts
      }
    ]);
  };

  SQLitePluginTransaction.prototype.$abort = function(txFailure) {
    var failed, succeeded, tx;
    if (this.finalized) {
      return;
    }
    tx = this;
    succeeded = function(tx) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.error && typeof tx.error === 'function') {
        tx.error(txFailure);
      }
    };
    failed = function(tx, err) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.error && typeof tx.error === 'function') {
        tx.error(newSQLError('error while trying to roll back: ' + err.message, err.code));
      }
    };
    this.finalized = true;
    if (this.txlock) {
      this.addStatement("ROLLBACK", [], succeeded, failed);
      this.run();
    } else {
      succeeded(tx);
    }
  };

  SQLitePluginTransaction.prototype.$finish = function() {
    var failed, succeeded, tx;
    if (this.finalized) {
      return;
    }
    tx = this;
    succeeded = function(tx) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.success && typeof tx.success === 'function') {
        tx.success();
      }
    };
    failed = function(tx, err) {
      txLocks[tx.db.dbname].inProgress = false;
      tx.db.startNextTransaction();
      if (tx.error && typeof tx.error === 'function') {
        tx.error(newSQLError('error while trying to commit: ' + err.message, err.code));
      }
    };
    this.finalized = true;
    if (this.txlock) {
      this.addStatement("COMMIT", [], succeeded, failed);
      this.run();
    } else {
      succeeded(tx);
    }
  };

  SQLitePluginTransaction.prototype.abortFromQ = function(sqlerror) {
    if (this.error) {
      this.error(sqlerror);
    }
  };

  dblocations = ["docs", "libs", "nosync"];

  iosLocationMap = {
    'default': 'nosync',
    'Documents': 'docs',
    'Library': 'libs'
  };

  SQLiteFactory = {

    /*
    NOTE: this function should NOT be translated from Javascript
    back to CoffeeScript by js2coffee.
    If this function is edited in Javascript then someone will
    have to translate it back to CoffeeScript by hand.
     */
    openDatabase: argsArray(function(args) {
      var dblocation, errorcb, okcb, openargs;
      if (args.length < 1 || !args[0]) {
        throw newSQLError('Sorry missing mandatory open arguments object in openDatabase call');
      }
      if (args[0].constructor === String) {
        throw newSQLError('Sorry first openDatabase argument must be an object');
      }
      openargs = args[0];
      if (!openargs.name) {
        throw newSQLError('Database name value is missing in openDatabase call');
      }
      if (!openargs.iosDatabaseLocation && !openargs.location && openargs.location !== 0 && !openargs.androidDatabaseLocation) {
        throw newSQLError('Database location (or iosDatabaseLocation or androidDatabaseLocation) setting is now mandatory in openDatabase call.');
      }
      if (!!openargs.location && !!openargs.iosDatabaseLocation) {
        throw newSQLError('AMBIGUOUS: both location and iosDatabaseLocation settings are present in openDatabase call. Please use either setting, not both.');
      }
      if (!!openargs.location && !!openargs.androidDatabaseLocation) {
        throw newSQLError('AMBIGUOUS: both location and androidDatabaseLocation settings are present in openDatabase call. Please use either setting, not both. But you *can* use androidDatabaseLocation and iosDatabaseLocation together.');
      }
      dblocation = !!openargs.location && openargs.location === 'default' ? iosLocationMap['default'] : !!openargs.iosDatabaseLocation ? iosLocationMap[openargs.iosDatabaseLocation] : !openargs.location && openargs.location !== 0 ? iosLocationMap['default'] : dblocations[openargs.location];
      if (!dblocation) {
        throw newSQLError('Valid iOS database location could not be determined in openDatabase call');
      }
      openargs.dblocation = dblocation;
      if (!!openargs.createFromLocation && openargs.createFromLocation === 1) {
        openargs.createFromResource = "1";
      }
      if (!!openargs.androidDatabaseProvider && !!openargs.androidDatabaseImplementation) {
        throw newSQLError('AMBIGUOUS: both androidDatabaseProvider and deprecated androidDatabaseImplementation settings are present in openDatabase call. Please drop androidDatabaseImplementation in favor of androidDatabaseProvider.');
      }
      if (openargs.androidDatabaseProvider !== void 0 && openargs.androidDatabaseProvider !== 'default' && openargs.androidDatabaseProvider !== 'system') {
        throw newSQLError("Incorrect androidDatabaseProvider value. Valid values are: 'default', 'system'");
      }
      if (!!openargs.androidDatabaseProvider && openargs.androidDatabaseProvider === 'system') {
        openargs.androidOldDatabaseImplementation = 1;
      }
      if (!!openargs.androidDatabaseImplementation && openargs.androidDatabaseImplementation === 2) {
        openargs.androidOldDatabaseImplementation = 1;
      }
      if (!!openargs.androidLockWorkaround && openargs.androidLockWorkaround === 1) {
        openargs.androidBugWorkaround = 1;
      }
      okcb = null;
      errorcb = null;
      if (args.length >= 2) {
        okcb = args[1];
        if (args.length > 2) {
          errorcb = args[2];
        }
      }
      return new SQLitePlugin(openargs, okcb, errorcb);
    }),
    deleteDatabase: function(first, success, error) {
      var args, dblocation, dbname;
      args = {};
      if (first.constructor === String) {
        throw newSQLError('Sorry first deleteDatabase argument must be an object');
      } else {
        if (!(first && first['name'])) {
          throw new Error("Please specify db name");
        }
        dbname = first.name;
        if (typeof dbname !== 'string') {
          throw newSQLError('delete database name must be a string');
        }
        args.path = dbname;
      }
      if (!first.iosDatabaseLocation && !first.location && first.location !== 0 && !first.androidDatabaseLocation) {
        throw newSQLError('Database location (or iosDatabaseLocation or androidDatabaseLocation) setting is now mandatory in deleteDatabase call.');
      }
      if (!!first.location && !!first.iosDatabaseLocation) {
        throw newSQLError('AMBIGUOUS: both location and iosDatabaseLocation settings are present in deleteDatabase call. Please use either setting value, not both.');
      }
      if (!!first.location && !!first.androidDatabaseLocation) {
        throw newSQLError('AMBIGUOUS: both location and androidDatabaseLocation settings are present in deleteDatabase call. Please use either setting, not both. But you *can* use androidDatabaseLocation and iosDatabaseLocation together.');
      }
      dblocation = !!first.location && first.location === 'default' ? iosLocationMap['default'] : !!first.iosDatabaseLocation ? iosLocationMap[first.iosDatabaseLocation] : !first.location && first.location !== 0 ? iosLocationMap['default'] : dblocations[first.location];
      if (!dblocation) {
        throw newSQLError('Valid iOS database location could not be determined in deleteDatabase call');
      }
      args.dblocation = dblocation;
      if (!!first.androidDatabaseLocation) {
        args.androidDatabaseLocation = first.androidDatabaseLocation;
      }
      delete SQLitePlugin.prototype.openDBs[args.path];
      delete SQLitePlugin.prototype.dbidmap[args.path];
      delete SQLitePlugin.prototype.fjmap[args.path];
      return cordova.exec(success, error, "SQLitePlugin", "delete", [args]);
    }
  };

  SelfTest = {
    DBNAME: '___$$$___litehelpers___$$$___test___$$$___.db',
    start: function(successcb, errorcb) {
      SQLiteFactory.deleteDatabase({
        name: SelfTest.DBNAME,
        location: 'default'
      }, (function() {
        return SelfTest.step1(successcb, errorcb);
      }), (function() {
        return SelfTest.step1(successcb, errorcb);
      }));
    },
    step1: function(successcb, errorcb) {
      SQLiteFactory.openDatabase({
        name: SelfTest.DBNAME,
        location: 'default'
      }, function(db) {
        var check1;
        check1 = false;
        db.transaction(function(tx) {
          tx.executeSql('SELECT UPPER("Test") AS upperText', [], function(ignored, resutSet) {
            if (!resutSet.rows) {
              return SelfTest.finishWithError(errorcb, 'Missing resutSet.rows');
            }
            if (!resutSet.rows.length) {
              return SelfTest.finishWithError(errorcb, 'Missing resutSet.rows.length');
            }
            if (resutSet.rows.length !== 1) {
              return SelfTest.finishWithError(errorcb, "Incorrect resutSet.rows.length value: " + resutSet.rows.length + " (expected: 1)");
            }
            if (!resutSet.rows.item(0).upperText) {
              return SelfTest.finishWithError(errorcb, 'Missing resutSet.rows.item(0).upperText');
            }
            if (resutSet.rows.item(0).upperText !== 'TEST') {
              return SelfTest.finishWithError(errorcb, "Incorrect resutSet.rows.item(0).upperText value: " + (resutSet.rows.item(0).upperText) + " (expected: 'TEST')");
            }
            check1 = true;
          }, function(ignored, tx_sql_err) {
            return SelfTest.finishWithError(errorcb, "TX SQL error: " + tx_sql_err);
          });
        }, function(tx_err) {
          return SelfTest.finishWithError(errorcb, "TRANSACTION error: " + tx_err);
        }, function() {
          if (!check1) {
            return SelfTest.finishWithError(errorcb, 'Did not get expected upperText result data');
          }
          db.executeSql('BEGIN', null, function(ignored) {
            return nextTick(function() {
              delete db.openDBs[SelfTest.DBNAME];
              delete txLocks[SelfTest.DBNAME];
              nextTick(function() {
                db.transaction(function(tx2) {
                  tx2.executeSql('SELECT 1');
                }, function(tx_err) {
                  if (!tx_err) {
                    return SelfTest.finishWithError(errorcb, 'Missing error object');
                  }
                  SelfTest.step2(successcb, errorcb);
                }, function() {
                  return SelfTest.finishWithError(errorcb, 'Missing error object');
                });
              });
            });
          });
        });
      }, function(open_err) {
        return SelfTest.finishWithError(errorcb, "Open database error: " + open_err);
      });
    },
    step2: function(successcb, errorcb) {
      SQLiteFactory.openDatabase({
        name: SelfTest.DBNAME,
        location: 'default'
      }, function(db) {
        db.transaction(function(tx) {
          tx.executeSql('SELECT ? AS myResult', [null], function(ignored, resutSet) {
            if (!resutSet.rows) {
              return SelfTest.finishWithError(errorcb, 'Missing resutSet.rows');
            }
            if (!resutSet.rows.length) {
              return SelfTest.finishWithError(errorcb, 'Missing resutSet.rows.length');
            }
            if (resutSet.rows.length !== 1) {
              return SelfTest.finishWithError(errorcb, "Incorrect resutSet.rows.length value: " + resutSet.rows.length + " (expected: 1)");
            }
            SelfTest.step3(successcb, errorcb);
          });
        }, function(txError) {
          return SelfTest.finishWithError(errorcb, "UNEXPECTED TRANSACTION ERROR: " + txError);
        });
      }, function(open_err) {
        return SelfTest.finishWithError(errorcb, "Open database error: " + open_err);
      });
    },
    step3: function(successcb, errorcb) {
      SQLiteFactory.openDatabase({
        name: SelfTest.DBNAME,
        location: 'default'
      }, function(db) {
        return db.sqlBatch(['CREATE TABLE TestTable(id integer primary key autoincrement unique, data);', ['INSERT INTO TestTable (data) VALUES (?);', ['test-value']]], function() {
          var firstid;
          firstid = -1;
          return db.executeSql('SELECT id, data FROM TestTable', [], function(resutSet) {
            if (!resutSet.rows) {
              SelfTest.finishWithError(errorcb, 'Missing resutSet.rows');
              return;
            }
            if (!resutSet.rows.length) {
              SelfTest.finishWithError(errorcb, 'Missing resutSet.rows.length');
              return;
            }
            if (resutSet.rows.length !== 1) {
              SelfTest.finishWithError(errorcb, "Incorrect resutSet.rows.length value: " + resutSet.rows.length + " (expected: 1)");
              return;
            }
            if (resutSet.rows.item(0).id === void 0) {
              SelfTest.finishWithError(errorcb, 'Missing resutSet.rows.item(0).id');
              return;
            }
            firstid = resutSet.rows.item(0).id;
            if (!resutSet.rows.item(0).data) {
              SelfTest.finishWithError(errorcb, 'Missing resutSet.rows.item(0).data');
              return;
            }
            if (resutSet.rows.item(0).data !== 'test-value') {
              SelfTest.finishWithError(errorcb, "Incorrect resutSet.rows.item(0).data value: " + (resutSet.rows.item(0).data) + " (expected: 'test-value')");
              return;
            }
            return db.transaction(function(tx) {
              return tx.executeSql('UPDATE TestTable SET data = ?', ['new-value']);
            }, function(tx_err) {
              return SelfTest.finishWithError(errorcb, "UPDATE transaction error: " + tx_err);
            }, function() {
              var readTransactionFinished;
              readTransactionFinished = false;
              return db.readTransaction(function(tx2) {
                return tx2.executeSql('SELECT id, data FROM TestTable', [], function(ignored, resutSet2) {
                  if (!resutSet2.rows) {
                    throw newSQLError('Missing resutSet2.rows');
                  }
                  if (!resutSet2.rows.length) {
                    throw newSQLError('Missing resutSet2.rows.length');
                  }
                  if (resutSet2.rows.length !== 1) {
                    throw newSQLError("Incorrect resutSet2.rows.length value: " + resutSet2.rows.length + " (expected: 1)");
                  }
                  if (!resutSet2.rows.item(0).id) {
                    throw newSQLError('Missing resutSet2.rows.item(0).id');
                  }
                  if (resutSet2.rows.item(0).id !== firstid) {
                    throw newSQLError("resutSet2.rows.item(0).id value " + (resutSet2.rows.item(0).id) + " does not match previous primary key id value (" + firstid + ")");
                  }
                  if (!resutSet2.rows.item(0).data) {
                    throw newSQLError('Missing resutSet2.rows.item(0).data');
                  }
                  if (resutSet2.rows.item(0).data !== 'new-value') {
                    throw newSQLError("Incorrect resutSet2.rows.item(0).data value: " + (resutSet2.rows.item(0).data) + " (expected: 'test-value')");
                  }
                  return readTransactionFinished = true;
                });
              }, function(tx2_err) {
                return SelfTest.finishWithError(errorcb, "readTransaction error: " + tx2_err);
              }, function() {
                if (!readTransactionFinished) {
                  SelfTest.finishWithError(errorcb, 'readTransaction did not finish');
                  return;
                }
                return db.transaction(function(tx3) {
                  tx3.executeSql('DELETE FROM TestTable');
                  return tx3.executeSql('INSERT INTO TestTable (data) VALUES(?)', [123]);
                }, function(tx3_err) {
                  return SelfTest.finishWithError(errorcb, "DELETE transaction error: " + tx3_err);
                }, function() {
                  var secondReadTransactionFinished;
                  secondReadTransactionFinished = false;
                  return db.readTransaction(function(tx4) {
                    return tx4.executeSql('SELECT id, data FROM TestTable', [], function(ignored, resutSet3) {
                      if (!resutSet3.rows) {
                        throw newSQLError('Missing resutSet3.rows');
                      }
                      if (!resutSet3.rows.length) {
                        throw newSQLError('Missing resutSet3.rows.length');
                      }
                      if (resutSet3.rows.length !== 1) {
                        throw newSQLError("Incorrect resutSet3.rows.length value: " + resutSet3.rows.length + " (expected: 1)");
                      }
                      if (!resutSet3.rows.item(0).id) {
                        throw newSQLError('Missing resutSet3.rows.item(0).id');
                      }
                      if (resutSet3.rows.item(0).id === firstid) {
                        throw newSQLError("resutSet3.rows.item(0).id value " + (resutSet3.rows.item(0).id) + " incorrectly matches previous unique key id value value (" + firstid + ")");
                      }
                      if (!resutSet3.rows.item(0).data) {
                        throw newSQLError('Missing resutSet3.rows.item(0).data');
                      }
                      if (resutSet3.rows.item(0).data !== 123) {
                        throw newSQLError("Incorrect resutSet3.rows.item(0).data value: " + (resutSet3.rows.item(0).data) + " (expected 123)");
                      }
                      return secondReadTransactionFinished = true;
                    });
                  }, function(tx4_err) {
                    return SelfTest.finishWithError(errorcb, "second readTransaction error: " + tx4_err);
                  }, function() {
                    if (!secondReadTransactionFinished) {
                      SelfTest.finishWithError(errorcb, 'second readTransaction did not finish');
                      return;
                    }
                    db.close(function() {
                      SelfTest.cleanupAndFinish(successcb, errorcb);
                    }, function(close_err) {
                      SelfTest.finishWithError(errorcb, "close error: " + close_err);
                    });
                  });
                });
              });
            });
          }, function(select_err) {
            return SelfTest.finishWithError(errorcb, "SELECT error: " + select_err);
          });
        }, function(batch_err) {
          return SelfTest.finishWithError(errorcb, "sql batch error: " + batch_err);
        });
      }, function(open_err) {
        return SelfTest.finishWithError(errorcb, "Open database error: " + open_err);
      });
    },
    cleanupAndFinish: function(successcb, errorcb) {
      SQLiteFactory.deleteDatabase({
        name: SelfTest.DBNAME,
        location: 'default'
      }, successcb, function(cleanup_err) {
        SelfTest.finishWithError(errorcb, "CLEANUP DELETE ERROR: " + cleanup_err);
      });
    },
    finishWithError: function(errorcb, message) {
      console.log("selfTest ERROR with message: " + message);
      SQLiteFactory.deleteDatabase({
        name: SelfTest.DBNAME,
        location: 'default'
      }, function() {
        errorcb(newSQLError(message));
      }, function(err2) {
        console.log("selfTest CLEANUP DELETE ERROR " + err2);
        errorcb(newSQLError("CLEANUP DELETE ERROR: " + err2 + " for error: " + message));
      });
    }
  };

  root.sqlitePlugin = {
    sqliteFeatures: {
      isSQLitePlugin: true
    },
    echoTest: function(okcb, errorcb) {
      var error, ok;
      ok = function(s) {
        if (s === 'test-string') {
          return okcb();
        } else {
          return errorcb("Mismatch: got: '" + s + "' expected 'test-string'");
        }
      };
      error = function(e) {
        return errorcb(e);
      };
      return cordova.exec(ok, error, "SQLitePlugin", "echoStringValue", [
        {
          value: 'test-string'
        }
      ]);
    },
    selfTest: SelfTest.start,
    openDatabase: SQLiteFactory.openDatabase,
    deleteDatabase: SQLiteFactory.deleteDatabase
  };

}).call(this);
