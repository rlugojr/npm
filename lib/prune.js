// prune extraneous packages.

module.exports = prune
module.exports.Pruner = Pruner

prune.usage = 'npm prune [[<@scope>/]<pkg>...] [--production]'

var npm = require('./npm.js')
var log = require('npmlog')
var util = require('util')
var moduleName = require('./utils/module-name.js')
var Installer = require('./install.js').Installer
var isExtraneous = require('./install/is-extraneous.js')
var removeDeps = require('./install/deps.js').removeDeps
var loadExtraneous = require('./install/deps.js').loadExtraneous
var chain = require('slide').chain

prune.completion = require('./utils/completion/installed-deep.js')

function prune (args, cb) {
  var dryrun = !!npm.config.get('dry-run')
  new Pruner('.', dryrun, args).run(cb)
}

function Pruner (where, dryrun, args) {
  Installer.call(this, where, dryrun, args)
}
util.inherits(Pruner, Installer)

Pruner.prototype.loadAllDepsIntoIdealTree = function (cb) {
  log.silly('uninstall', 'loadAllDepsIntoIdealtree')

  var cg = this.progress.loadAllDepsIntoIdealTree
  var steps = []

  var self = this
  var toPrune = this.currentTree.children.filter(isExtraneous).map(function (child) { return moduleName(child) }).filter(function (child) {
    return self.args.length === 0 || self.args.indexOf(child) !== -1
  }).map(function (child) { return {name: child} })

  steps.push(
    [removeDeps, toPrune, this.idealTree, null, cg.newGroup('removeDeps')],
    [loadExtraneous, this.idealTree, cg.newGroup('loadExtraneous')])
  chain(steps, cb)
}

Pruner.prototype.runTopLevelLifecycles = function (cb) { cb() }
