
/*!
 * migrate - Set
 * Copyright (c) 2010 TJ Holowaychuk <tj@vision-media.ca>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var EventEmitter = require('events').EventEmitter
  , fs = require('fs');

/**
 * Expose `Set`.
 */

module.exports = Set;

/**
 * Initialize a new migration `Set` with the given `path`
 * which is used to store data between migrations.
 *
 * @param {String} path
 * @api private
 */

function Set(path) {
  this.migrations = [];
  this.path = path;
  this.pos = 0;
};

/**
 * Inherit from `EventEmitter.prototype`.
 */

Set.prototype.__proto__ = EventEmitter.prototype;

/**
 * Save the migration data and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.save = function(fn){
  var self = this
  this.connect(fn);
};

/**
 * Load the migration data and call `fn(err, obj)`.
 *
 * @param {Function} fn
 * @return {Type}
 * @api public
 */

Set.prototype.load = function(fn){
  this.emit('load');
  this.connect(fn, 'new');
};

/**
 * Connect to mongo
 */

Set.prototype.connect = function(fn, type) {
  var path = require('path');
  var self = this;
  // get the config file path from env variable
  var configPath = path.resolve(process.env.NODE_MONGOOSE_MIGRATIONS_CONFIG);
  var mongoose = require('mongoose');
  var json = require(configPath);
  var env = process.env.NODE_ENV || 'development';
  var config = json[env];
  var db = mongoose.createConnection(config.db);
  var Schema = mongoose.Schema;
  var MigrationSchema = new Schema(config.schema);
  var Migration;

  db.on('connected', function () {
    if (type) {
      Migration = mongoose.model(config.modelName, MigrationSchema);
    } else {
      Migration = mongoose.model(config.modelName);
    }

    Migration.findOne().exec(function (err, doc) {
      if (err) return fn(err);

      if (type) {
        try {
          var obj = doc && doc.migration
            ? doc.migration
            : { pos: 0, migrations: [] }
          fn(null, obj);
        } catch (err) {
          fn(err);
        }
      } else {
        if (!doc) {
          var m = new Migration({ migration: self });
          m.save(cb);
        } else {
          doc.migration = self;
          doc.save(cb);
        }
      }
    });
  });

  function cb(err) {
    self.emit('save');
    fn && fn(err);
  }
};

/**
 * Run down migrations and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.down = function(fn, migrationName){
  this.migrate('down', fn, migrationName);
};

/**
 * Run up migrations and call `fn(err)`.
 *
 * @param {Function} fn
 * @api public
 */

Set.prototype.up = function(fn, migrationName){
  this.migrate('up', fn, migrationName);
};

/**
 * Migrate in the given `direction`, calling `fn(err)`.
 *
 * @param {String} direction
 * @param {Function} fn
 * @api public
 */

Set.prototype.migrate = function(direction, fn, migrationName){
  var self = this;
  fn = fn || function(){};
  this.load(function(err, obj){
    if (err) {
      if ('ENOENT' != err.code) return fn(err);
    } else {
      self.pos = obj.pos;
    }
    self._migrate(direction, fn, migrationName);
  });
};

/**
 * Get index of given migration in list of migrations
 *
 * @api private
 */

 function positionOfMigration(migrations, filename) {
   for(var i=0; i < migrations.length; ++i) {
     if (migrations[i].title == filename) return i;
   }
   return -1;
 }

/**
 * Perform migration.
 *
 * @api private
 */

Set.prototype._migrate = function(direction, fn, migrationName){
  var self = this
    , migrations
    , migrationPos;

  if (!migrationName) {
    migrationPos = direction == 'up' ? this.migrations.length : 0;
  } else if ((migrationPos = positionOfMigration(this.migrations, migrationName)) == -1) {
    console.error("Could not find migration: " + migrationName);
    process.exit(1);
  }

  switch (direction) {
    case 'up':
      migrations = this.migrations.slice(this.pos, migrationPos+1);
      this.pos += migrations.length;
      break;
    case 'down':
      migrations = this.migrations.slice(migrationPos, this.pos).reverse();
      this.pos -= migrations.length;
      break;
  }

  function next(err, migration) {
    // error from previous migration
    if (err) return fn(err);

    // done
    if (!migration) {
      self.emit('complete');
      self.save(fn);
      return;
    }

    self.emit('migration', migration, direction);
    migration[direction](function(err){
      next(err, migrations.shift());
    });
  }

  next(null, migrations.shift());
};
