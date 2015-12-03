'use strict'
var path = require('path')
var isDev = require('./is-dev.js').isDev
var npm = require('../npm.js')
var packageId = require('../utils/package-id.js')

module.exports = function (tree) {
  var pkg = tree.package
  var isRequiredBy = tree.requiredBy.length
  var isTopLevel = tree.parent == null
  var isChildOfTop = !isTopLevel && tree.parent.parent == null
  var isTopGlobal = isChildOfTop && tree.parent.path === path.resolve(npm.globalDir, '..')
  var topHasNoPackageJson = isChildOfTop && tree.parent.error
  return !isTopLevel && (!isChildOfTop || !topHasNoPackageJson) && !isTopGlobal && !isRequiredBy && !isDev(tree)
}
