
var Schema = require('mongoose').Schema;

module.exports = exports = tree;

/**
 * Tree Behavior for Mongoose
 *
 * Implements the materialized path strategy with cascade child re-parenting
 * on delete for storing a hierarchy of documents with mongoose
 * 
 * @param  {mongoose.Schema} schema
 * @param  {Object} options
 */
function tree(schema, options) {
  var pathSeparator = options && options.pathSeparator || '#';
    , onDelete = options && options.onDelete || 'REPARENT';

  /**
   * Add parent and path properties
   * 
   * @property {ObjectID} parent
   * @property {String} path
   */
  schema.add({
    parent : {
      type : Schema.ObjectId,
      set : function(val) {
        if(typeof(val) === "object" && val._id) {
          return val._id;
        }
        return val;
      },
      index: true
    },
    path : {
      type : String,
      index: true
    }
  });

  /**
   * Save callback
   * Build or rebuild path when needed
   *
   * @param  {Function} next
   */
  schema.pre('save', function(next) {
    var isParentChange = this.isModified('parent');

    if(this.isNew || isParentChange) {
      if(!this.parent) {
        this.path = this._id.toString();
        return next();
      }

      var self = this;
      this.collection.findOne({ _id : this.parent }, function(err, doc) {
        if(err) return next(err);

        var previousPath = self.path;
        self.path = doc.path + pathSeparator + self._id.toString();

        if(isParentChange) {
          // When the parent is changed we must rewrite all children paths as well
          self.collection.find({ path : { '$regex' : '^' + previousPath + pathSeparator } }, function(err, cursor) {
            if(err) return next(err);

            var stream = cursor.stream();
            stream.on('data', function (doc) {
              var newPath = self.path+doc.path.substr(previousPath.length);
              self.collection.update({ _id : doc._id }, { $set : { path : newPath } }, function(err) {
                if(err) return next(err);
              });
            });
            stream.on('close', function() {
              next();
            });
            stream.on('error', function(err) {
              next(err);
            });
          });
        } else {
          next();
        }
      });
    } else {
      next();
    }
  });

  /**
   * Pre Remove callback
   * Currently removes all children on delete
   *
   * @todo: Support the onDelete config option to decide for cascade removal or reparenting 
   * @param  {Function} next
   */
  schema.pre('remove', function(next) {
    if(!this.path) {
      return next();
    }
    this.collection.remove({ path : { '$regex' : '^' + this.path + pathSeparator } }, next);
  });

  /**
   * getChildren method
   *
   * @param  {[type]}   recursive
   * @param  {Function} cb
   * @return {Model}
   */
  schema.method('getChildren', function(recursive, cb) {
    if(typeof(recursive) === "function") {
      cb = recursive;
      recursive = false;
    }
    var filter = recursive ? { path : { $regex : '^' + this.path + pathSeparator } } : { parent : this._id };
    return this.model(this.constructor.modelName).find(filter, cb);
  });

  /**
   * getParent method
   *
   * @param  {Function} cb
   * @return {Model}
   */
  schema.method('getParent', function(cb) {
    return this.model(this.constructor.modelName).findOne({ _id : this.parent }, cb);
  });

  /**
   * getAncestors method
   *
   * @param  {Function} cb
   * @return {Model}
   */
  var getAncestors = function(cb) {
    if(this.path) {
      var ids = this.path.split(pathSeparator);
      ids.pop();
    } else {
      var ids = [];
    }
    var filter = { _id : { $in : ids } };
    return this.model(this.constructor.modelName).find(filter, cb);
  };

  // Support for wrong spelled of Ancestors
  // @todo: remove
  schema.method('getAnsestors', getAncestors);
  schema.method('getAncestors', getAncestors);

  /**
   * @property {Number} level <virtual>
   */
  schema.virtual('level').get(function() {
    return this.path ? this.path.split(pathSeparator).length : 0;
  });
}
