var uniqid = require('uniqid')
var async = require('async')
var exec = require('child_process').exec
var path = require('path')
var util = require('util')
var fs = require('fs')

function getNumber (str) {
	return Number(str.replace(/\D+/g, ''))
}

function processExists (baseGrepCommand, cb) {
	var cmd = baseGrepCommand + ' | wc -l'

	exec(cmd, (err, stdout, stderr) => {
		if (err) return cb(err)

		var p_numb = getNumber(stdout)
		var process_exists = ! isNaN(p_numb) && p_numb > 0

		cb(null, process_exists, p_numb)
	})
}

function listener (options) {
	var listener = {}
	listener.baseGrep = 'ps -aux | tr -s " " | grep -i "%s" | grep -v grep'
	listener.unoconvListenerProcessName = 'unoconv -l'
	listener.sofficeProcessName = 'soffice.bin'
	listener.createCbCalled = false
	listener.options = options || {}
	listener.options.createTimeout = listener.options.createTimeout || 20000
	listener.options.maxCreateTries = listener.options.maxCreateTries || 4
	listener.options.createTriesTimeout = listener.options.createTriesTimeout || 250

	listener._getListenerCommand = function () {
		return listener._getProcessCommand(listener.unoconvListenerProcessName)
	}

	listener._getSofficeCommand = function () {
		return listener._getProcessCommand(listener.sofficeProcessName)
	}

	listener._getProcessCommand = function (process) {
		var cmd = util.format(listener.baseGrep, process)
		return cmd
	}

	listener.exists = function (cb) {
		processExists(listener._getListenerCommand(), cb)
	}

	listener.sofficeExists = function (cb) {
		processExists(listener._getSofficeCommand(), cb)
	}

	listener.pid = function (cb) {
		var cmd = listener._getListenerCommand() + ' | cut -d " " -f 2'

		exec(cmd, (err, stdout, stderr) => {
			if (err) return cb(err)

			var outSplit = stdout.split(/\n/)
			
			if (outSplit.length > 2) stdout = outSplit[0]			

			var pid = getNumber(stdout)

			cb(null, pid)
		})
	}

	listener.kill = function (callback) {	
		var execSofficeKill = true

		function sofficeExists (cb) {
			listener.sofficeExists((err, exists) => {
				if (err) return cb(err)
				if (! exists) execSofficeKill = false
	
				cb()
			})
		}

		function execKillListener (err, pid, cb) {
			if (err) return cb(err)
			if (isNaN(pid) || pid === 0) return cb(new Error('Process do not exist'))	
			var cmd = 'kill %s'
			cmd = util.format(cmd, pid)		
	
			exec(cmd, err => {
				if (err) return cb(err)
				execKillSoffice(cb)
			})
		}
	
		function execKillSoffice (cb) {
			if ( ! execSofficeKill ) return cb()
			var cmd = 'killall -I soffice.bin'
	
			exec(cmd, cb)
		}
		
		function killProcesses(cb) {
			listener.pid((err, pid) => { 
				execKillListener(err, pid, cb)
			})
		}
	
		async.series([
			sofficeExists,
			killProcesses	
		], err => {
			if (err) return callback(err)

			callback()
		})
	}

	listener.create = function (cb, createTries) {	
		var cbWrapper = function (cb) {
			return (err, stdout, stderr) => { 
				if (listener.createCbCalled) return 

				listener.createCbCalled = true
				cb(err, stdout, stderr)
			}
		}(cb)
		var cmd = listener.unoconvListenerProcessName
		var endInit = setTimeout(cbWrapper, listener.options.createTimeout)
		
		createTries = createTries || 0
		
		function callbackCall (endInit, cbWrapper) {
			var cbWrapperEnd = (err, stdout, stderr) => {
				cbWrapper(err, stdout, stderr)

				listener.createCbCalled = false
			}

			return (err, stdout, stderr) => {
				clearTimeout(endInit)
				if (err) return cbWrapperEnd(err, null, stderr)

				function listenerExists (err, exists, p_numb) {
					if (err) return cbWrapperEnd(err)
					if (! exists && createTries < listener.options.maxCreateTries) { 
						return setTimeout(() => listener.create(cb, ++createTries), listener.options.createTriesTimeout)
					}
					if (! exists) return cbWrapperEnd(new Error('Unoconv listener not running.'))

					cbWrapper()
				}

				if (! listener.createCbCalled) return listener.exists(listenerExists)

				cbWrapperEnd(err, stdout, stderr)
			}
		}

		exec(cmd, callbackCall(endInit, cbWrapper))
	}

	return listener
}

function converter (filePath, options) {
	var converter = {}

	converter.options = options || {}
	converter.filePath = filePath
	converter.timeout = converter.options.timeout || 500

	if ( ! converter.filePath ) throw new Error('filePath is required')	
	
	converter.inputExt = path.extname(converter.filePath)
	converter.inputFilename = path.basename(converter.filePath, converter.inputExt)
	converter.inputDirname = path.dirname(converter.filePath)
	
	converter.outputFilename = converter.inputFilename

	converter.inputFileExists = function (callback) {
		converter.fileExists(converter.filePath, callback)
	}

	converter.outputFileExists = function (callback) {
		converter.fileExists(converter.getOutputFilePath(), callback)
	}

	
	converter.finalOutputFileExists = function (callback) {
		converter.fileExists(converter.getFinalOutputFilePath(), callback)
	}


	converter.fileExists = function (filePath, callback) {
		fs.access(filePath, fs.F_OK, callback)
	}

	converter.addUniqueidToOutputFilename = function () {
		converter.outputFilename += util.format('_%s', uniqid())
	}

	converter.setOutputOptions = function (outputOptions) {
		if ( ! converter.outputOptions || ( outputOptions && Object.keys(outputOptions).length )) {
			converter.outputOptions = outputOptions
		}
	}

	converter.convert = function (callback, outputOptions) {
		converter.setOutputOptions(outputOptions)

		if ( ! converter.outputOptions || ! converter.outputOptions.outputFormat ) throw new Error('outputFormat option is required')	

		function finalOutputFileExists (cb) {
			var callback = function (err) {
				if ( ! err) converter.addUniqueidToOutputFilename()
				
				cb()
			}

			converter.finalOutputFileExists(callback)
		}

		function convertProcess (cb) {
			var convertCommand = converter.getConvertCommand()

			exec(convertCommand, (err, stdout, stderr) => {
				if (err) return cb(err)

				cb()
			})
		} 

		function outputFileExists (cb) {
			converter.outputFileExists(err => {
				if (err) return cb(err)

				cb()
			})
		}

		function moveFile (cb) {
			converter.moveFileToOutput(err => {
				if (err) return cb(err)

				cb()
			})
		}

		async.series([
			finalOutputFileExists,
			convertProcess,
			outputFileExists,
			moveFile
		], err => {
			if (err) return callback(err)
			
			callback(null, converter.getFinalOutputFilePath())
		})
	}

	converter.getFinalOutputFilePath = function () {
		var oldPath = converter.getOutputFilePath()
		if ( ! converter.outputOptions.outputDir ) return oldPath
		
		return path.join(converter.outputOptions.outputDir, converter.outputFilename + '.' + converter.outputOptions.outputFormat)	
	} 

	converter.getOutputFilePath = function () {
		converter.outputFilePath = path.join(converter.inputDirname, converter.inputFilename + '.' + converter.outputOptions.outputFormat )
		
		return converter.outputFilePath
	}

	converter.moveFileToOutput = function (callback) {
		if ( ! converter.outputOptions.outputDir ) return callback()

		var oldPath = converter.getOutputFilePath()
		var newPath = converter.getFinalOutputFilePath()

		converter.outputFilePath = newPath
	
		fs.rename(oldPath, newPath, callback)
	}

	converter.getConvertCommand = function () {
		var command = 'unoconv -f %s %s' 
		return util.format(command, converter.outputOptions.outputFormat, converter.filePath)
	}

	return converter
}

module.exports = {
	'converter': converter,
	'listener': listener
}
