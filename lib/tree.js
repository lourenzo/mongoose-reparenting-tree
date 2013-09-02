
var Schema = require('mongoose').Schema;

module.exports = exports = tree;

/**
 * @class tree
 * Tree Behavior for Mongoose
 *
 * Implements the materialized path strategy with cascade child re-parenting
 * on delete for storing a hierarchy of documents with mongoose
 *
 * @param  {mongoose.Schema} schema
 * @param  {Object} options
 */
function tree(schema, options) {
  var pathSeparator = options && options.pathSeparator || '#'
    , onDelete = options && options.onDelete || 'REPARENT';

  /**
   * Add parent and path properties
   *
   * @property {ObjectID} parent
   * @property {String} path
   */
  schema.add({
    parent: {
      type: Schema.ObjectId,
      set: function(val) {
        return (typeof(val) === "object" && val._id)? val._id : val;
      },
      index: true
    },
    path: {
      type: String,
      index: true
    }
  });

  /**
   * Pre-save middleware
   * Build or rebuild path when needed
   *
   * @param  {Function} next
   */
  schema.pre('save', function preSave(next) {
    var isParentChange = this.isModified('parent');

    if(this.isNew || isParentChange) {
      if(!this.parent) {
        this.path = this._id.toString();
        return next();
      }

      var self = this;
      this.collection.findOne({ _id: this.parent }, function(err, doc) {
        if(err) return next(err);

        var previousPath = self.path;
        self.path = doc.path + pathSeparator + self._id.toString();

        if(isParentChange) {
          // When the parent is changed we must rewrite all children paths as well
          self.collection.find({ path: { '$regex': '^' + previousPath + pathSeparator } }, function(err, cursor) {
            if(err) return next(err);

            var stream = cursor.stream();
            stream.on('data', function(doc) {
              var newPath = self.path + doc.path.substr(previousPath.length);
              self.collection.update({ _id: doc._id }, { $set: { path: newPath } }, function(err) {
                if(err) return next(err);
              });
            });
            stream.on('close', next);
            stream.on('error', next);
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
   * Pre-remove middleware
   *
   * @param  {Function} next
   */
  schema.pre('remove', function preRemove(next) {
    if(!this.path) return next();

    if (onDelete == 'DELETE') {
      this.collection.remove({ path : { '$regex' : '^' + this.path + pathSeparator } }, next);
    }
    else {
      var self = this,
          newParent = this.parent,
          previousParent = this._id;

      // Update parent property from children
      this.collection.find({ parent: previousParent }, function(err, cursor){
        if(err) return next(err);
          var stream = cursor.stream();
          stream.on('data', function streamOnData(doc) {
            self.collection.update({ _id: doc._id }, { $set: { parent : newParent } }, function(err) {
              if(err) return next(err);
            });
          });
          stream.on('close', function streamOnClose() {
            // Cascade update Path
            self.collection.find({ path: { $regex : previousParent + pathSeparator} }, function(err, cursor){

              var subStream = cursor.stream();
              subStream.on('data', function subStreamOnData(doc) {
                var newPath = doc.path.replace(previousParent + pathSeparator, '');
                self.collection.update({ _id: doc._id }, { $set: { path: newPath } }, function(err) {
                  if(err) return next(err);
                });
              });
              subStream.on('close', next);
              subStream.on('error', next);
            });
          });
          stream.on('error', next);
      });
      //this.collection.update({})
    }
  });

  /**
   * @method getChildren
   *
   * @param  {[type]}   recursive
   * @param  {Function} next
   * @return {Model}
   */
  schema.method('getChildren', function getChildren(recursive, next) {
    if(typeof(recursive) === "function") {
      next = recursive;
      recursive = false;
    }
    var filter = recursive ? { path: { $regex: '^' + this.path + pathSeparator } } : { parent : this._id };
    return this.model(this.constructor.modelName).find(filter, next);
  });

  /**
   * @method getParent
   *
   * @param  {Function} next
   * @return {Model}
   */
  schema.method('getParent', function getParent(next) {
    return this.model(this.constructor.modelName).findOne({ _id : this.parent }, next);
  });

  /**
   * @method getAncestors
   *
   * @param  {Function} next
   * @return {Model}
   */
  schema.method('getAncestors', function getAncestors(next) {
    if(this.path) {
      var ids = this.path.split(pathSeparator);
      ids.pop();
    } else {
      var ids = [];
    }
    var filter = { _id : { $in : ids } };
    return this.model(this.constructor.modelName).find(filter, next);
  });

  /**
   * @property {Number} level <virtual>
   */
  schema.virtual('level').get(function virtualPropLevel() {
    return this.path ? this.path.split(pathSeparator).length : 0;
  });
}
