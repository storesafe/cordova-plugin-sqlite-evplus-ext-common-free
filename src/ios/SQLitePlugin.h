/*
 * Copyright (c) 2012-present Christopher J. Brody (aka Chris Brody)
 * Copyright (C) 2011 Davide Bertola
 *
 * License for this version: GPL v3 (http://www.gnu.org/licenses/gpl.txt) or commercial license.
 * Contact for commercial license: info@litehelpers.net
 */

#import <Cordova/CDVPlugin.h>

// Used to remove dependency on sqlite3.h in this header:
struct sqlite3;

enum WebSQLError {
    UNKNOWN_ERR = 0,
    DATABASE_ERR = 1,
    VERSION_ERR = 2,
    TOO_LARGE_ERR = 3,
    QUOTA_ERR = 4,
    SYNTAX_ERR_ = 5,
    CONSTRAINT_ERR = 6,
    TIMEOUT_ERR = 7
};
typedef int WebSQLError;

@interface SQLitePlugin : CDVPlugin {
    NSMutableDictionary *openDBs;
}

@property (nonatomic, copy) NSMutableDictionary *openDBs;
@property (nonatomic, copy) NSMutableDictionary *appDBPaths;

// Self-test
-(void) echoStringValue: (CDVInvokedUrlCommand*)command;

// Open / Close / Delete
-(void) open: (CDVInvokedUrlCommand*)command;
-(void) close: (CDVInvokedUrlCommand*)command;
-(void) delete: (CDVInvokedUrlCommand*)command;

// Internal functions not needed:
// -(void) openNow: (CDVInvokedUrlCommand*)command;
// -(void) closeNow: (CDVInvokedUrlCommand*)command;
// -(void) deleteNow: (CDVInvokedUrlCommand*)command;

// fj batch processing interface
-(void) fj: (CDVInvokedUrlCommand*)command;

// More internal functions not needed:
// -(void) executeSqlBatchNow: (CDVInvokedUrlCommand*)command;
// +(NSDictionary *)captureSQLiteErrorFromDb:(struct sqlite3 *)db

@end /* vim: set expandtab : */
