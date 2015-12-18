// Everything in this file uses child processes, because we're
// testing a command line utility.

var chain = require('slide').chain
var child_process = require('child_process')
var path = require('path')
var testdir = __dirname
var fs = require('graceful-fs')
var npmpkg = path.dirname(testdir)
var npmcli = path.resolve(npmpkg, 'bin', 'npm-cli.js')

var temp = process.env.TMPDIR ||
           process.env.TMP ||
           process.env.TEMP ||
           (process.platform === 'win32'
              ? 'c:\\windows\\temp'
              : '/tmp')

temp = path.resolve(temp, 'npm-test-' + process.pid)

var root = path.resolve(temp, 'root')
var cache = path.resolve(temp, 'npm_cache')

var failures = 0
var mkdir = require('mkdirp')
var rimraf = require('rimraf')
var isWindows = require('../lib/utils/is-windows.js')

var pathEnvSplit = isWindows ? ';' : ':'
var pathEnv = process.env.PATH.split(pathEnvSplit)
var npmPath = isWindows ? root : path.join(root, 'bin')

pathEnv.unshift(npmPath, path.join(root, 'node_modules', '.bin'))

// lastly, make sure that we get the same node that is being used to do
// run this script.  That's very important, especially when running this
// test file from in the node source folder.
pathEnv.unshift(path.dirname(process.execPath))

// the env for all the test installs etc.
var env = {}
Object.keys(process.env).forEach(function (i) {
  env[i] = process.env[i]
})
env.npm_config_prefix = root
env.npm_config_color = 'always'
env.npm_config_global = 'true'
// have to set this to false, or it'll try to test itself forever
env.npm_config_npat = 'false'
env.PATH = pathEnv.join(pathEnvSplit)
env.NODE_PATH = path.join(root, 'node_modules')
env.npm_config_cache = cache
env.npm_config_user_agent = ''

function cleanup (cb) {
  if (failures !== 0) return
  rimraf(root, function (er) {
    if (er) cb(er)
    mkdir(root, parseInt('0755', 8), cb)
  })
}

function prefix (content, pref) {
  return pref + (content.trim().split(/\r?\n/).join('\n' + pref))
}

var execCount = 0

function exec (cmd, args, cwd, shouldFail, cb) {
  if (typeof shouldFail === 'function') {
    cb = shouldFail
    shouldFail = false
  }

  var cmdShow = cmd + ' ' + args.join(' ')

  console.error('\n+' + cmdShow + (shouldFail ? ' (expect failure)' : ''))

  // special: replace 'node' with the current execPath,
  // and 'npm' with the thing we installed.
  function swapInDirectPaths (cmd) {
    if (cmd === 'node') return process.execPath
    if (cmd === 'npm') return path.resolve(npmPath, 'npm')
    return cmd
  }
  cmd = swapInDirectPaths(cmd)
  args = args.map(swapInDirectPaths)

  console.error('$$$$$$ cd %s; PATH=%s %s', cwd, env.PATH, cmd, args.join(' '))

  console.error('!!!!!! Full diagnostics:')
  console.error('!!!!!! cwd: %s', cwd)
  console.error('!!!!!! cmd: %s', cmd)
  console.error('!!!!!! args: %s', args.join(' '))
  Object.keys(env).forEach(function (k) {
    console.error('!!!!!! env[%s]: %s', k, env[k])
  })
  if (isWindows) {
    var quote = function (value) { return '"' + value + '"' }
    var cmdBits = cmd.split(path.delimiter)
    var drive = /^[A-Za-z]:$/.test(cmdBits[0]) ? cmdBits.shift() + '\\' : ''
    var execStr = drive + cmdBits.map(quote).join(path.delimiter) +
                  ' ' + args.map(quote).join(' ')
    console.error('!!!!!! execing: %s', execStr)
    child_process.exec(execStr, {cwd: cwd, env: env}, finishExec)
  } else {
    child_process.execFile(cmd, args, {cwd: cwd, env: env}, finishExec)
  }

  function finishExec (er, stdout, stderr) {
    console.error('$$$$$$ after command', cmd, args, cwd)
    if (stdout) {
      console.error(prefix(stdout, ' 1> '))
    }
    if (stderr) {
      console.error(prefix(stderr, ' 2> '))
    }

    execCount++
    if (!shouldFail && !er || shouldFail && er) {
      // stdout = (''+stdout).trim()
      console.log('ok ' + execCount + ' ' + cmdShow)
      return cb()
    } else {
      console.log('not ok ' + execCount + ' ' + cmdShow)
      cb(new Error('failed ' + cmdShow))
    }
  }
}

function flatten (arr) {
  return arr.reduce(function (l, r) {
    return l.concat(r)
  }, [])
}

function setup (cb) {
  cleanup(function (er) {
    if (er) return cb(er)
    exec('node', [npmcli, 'install', '--ignore-scripts', npmpkg], root, false, cb)
  })
}

function main (cb) {
  console.log('# testing in %s', temp)
  console.log('# global prefix = %s', root)

  failures = 0

  process.chdir(testdir)
  var base = path.resolve(root, path.join('lib', 'node_modules'))

  // get the list of packages
  var packages = fs.readdirSync(path.resolve(testdir, 'packages'))
  packages = packages.filter(function (p) {
    return p && !p.match(/^\./)
  })

  installAllThenTestAll()

  function installAllThenTestAll () {
    var packagesToRm = packages.slice(0)
    if (!isWindows) {
      // Windows can't handle npm rm npm due to file-in-use issues.
      packagesToRm.push('npm')
    }

    chain(
      [
        setup,
        [exec, 'npm', ['install', '--ignore-scripts', npmpkg], testdir],
        [chain, packages.map(function (p) {
          return [exec, 'npm', ['install', 'packages/' + p], testdir]
        })],
        [chain, packages.map(function (p) {
          return [exec, 'npm', ['test', '-ddd'], path.resolve(base, p)]
        })],
        [chain, packagesToRm.map(function (p) {
          return [exec, 'npm', ['rm', p], root]
        })],
        installAndTestEach
      ],
      cb
    )
  }

  function installAndTestEach (cb) {
    var thingsToChain = [
      setup,
      [chain, flatten(packages.map(function (p) {
        return [
          [exec, 'npm', ['install', 'packages/' + p], testdir],
          [exec, 'npm', ['test'], path.resolve(base, p)],
          [exec, 'npm', ['rm', p], root]
        ]
      }))]
    ]
    if (!isWindows) {
      // Windows can't handle npm rm npm due to file-in-use issues.
      thingsToChain.push([exec, 'npm', ['rm', 'npm'], testdir])
    }

    chain(thingsToChain, cb)
  }
}

main(function (er) {
  console.log('1..' + execCount)
  if (er) throw er
})
