"use strict";

const paths = require('./fileSystemPaths').file;

/**
 *
 * @constructor
 * @implements FilePlugin
 */
function FilePluginImpl() {
    this.paths = paths;
}

module.exports = new FilePluginImpl();