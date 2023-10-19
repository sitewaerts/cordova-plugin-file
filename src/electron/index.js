/*
 *
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 *
 */

const { Buffer } = require('buffer');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

const rendererPathSep = '/';
const cdvPrefix = "cdvfile://localhost/"
const cdvPathsPrefix = {
    applicationDirectory: cdvPrefix + "application" + rendererPathSep,
    dataDirectory: cdvPrefix + "data" + rendererPathSep,
    cacheDirectory: cdvPrefix + "cache" + rendererPathSep,
    tempDirectory: cdvPrefix + "temp" + rendererPathSep,
    documentsDirectory: cdvPrefix + "documents" + rendererPathSep
};

const nativePathsPrefix = {
    applicationDirectory: path.dirname(app.getAppPath()) + path.sep,
    dataDirectory: app.getPath('userData') + path.sep,
    cacheDirectory: app.getPath('cache') + path.sep,
    tempDirectory: app.getPath('temp') + path.sep,
    documentsDirectory: app.getPath('documents') + path.sep
};

/**
 * @param {string} cdvUrl
 * @returns {string| null}
 */
function getCDVPathPrefix(cdvUrl){
    if(!cdvUrl || cdvUrl.length === 0)
        return null;

    if(cdvUrl.startsWith(cdvPathsPrefix.applicationDirectory))
        return cdvPathsPrefix.applicationDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.dataDirectory))
        return cdvPathsPrefix.dataDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.cacheDirectory))
        return cdvPathsPrefix.cacheDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.tempDirectory))
        return cdvPathsPrefix.tempDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.documentsDirectory))
        return cdvPathsPrefix.documentsDirectory

    return null;
}

/**
 * @param {string} cdvUrl
 * @returns {string| null}
 */
function getNativePathPrefix(cdvUrl){
    if(!cdvUrl || cdvUrl.length === 0)
        return null;

    if(cdvUrl.startsWith(cdvPathsPrefix.applicationDirectory))
        return nativePathsPrefix.applicationDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.dataDirectory))
        return nativePathsPrefix.dataDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.cacheDirectory))
        return nativePathsPrefix.cacheDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.tempDirectory))
        return nativePathsPrefix.tempDirectory

    if(cdvUrl.startsWith(cdvPathsPrefix.documentsDirectory))
        return nativePathsPrefix.documentsDirectory

    return null;
}

/**
 * @param {string} cdvUrl
 * @returns {string| null}
 */
function toNativePath(cdvUrl){
    if(!cdvUrl || cdvUrl.length === 0)
        return null;

    if(cdvUrl.indexOf('..')>=0)
        return null;

    if(cdvUrl.startsWith(cdvPathsPrefix.applicationDirectory))
        return cdvUrl.replace(cdvPathsPrefix.applicationDirectory, nativePathsPrefix.applicationDirectory )

    if(cdvUrl.startsWith(cdvPathsPrefix.dataDirectory))
        return cdvUrl.replace(cdvPathsPrefix.dataDirectory, nativePathsPrefix.dataDirectory )

    if(cdvUrl.startsWith(cdvPathsPrefix.cacheDirectory))
        return cdvUrl.replace(cdvPathsPrefix.cacheDirectory, nativePathsPrefix.cacheDirectory )

    if(cdvUrl.startsWith(cdvPathsPrefix.tempDirectory))
        return cdvUrl.replace(cdvPathsPrefix.tempDirectory, nativePathsPrefix.tempDirectory)

    if(cdvUrl.startsWith(cdvPathsPrefix.documentsDirectory))
        return cdvUrl.replace(cdvPathsPrefix.documentsDirectory, nativePathsPrefix.documentsDirectory )

    return null;
}

/**
 * @param {string} cdvBaseUrl
 * @param {string} nativeUrl
 * @returns {string| null}
 */
function toCDVPath(cdvBaseUrl, nativeUrl){
    if(!cdvBaseUrl || cdvBaseUrl.length === 0)
        return null;

    if(!nativeUrl || nativeUrl.length === 0)
        return null;

    const cdvPathPrefix = getCDVPathPrefix(cdvBaseUrl);
    if(!cdvPathPrefix)
        return null;
    const nativePathPrefix = getNativePathPrefix(cdvBaseUrl);
    return nativeUrl.replace(nativePathPrefix, cdvPathPrefix);
}

const FileError = {
    // Found in DOMException
    NOT_FOUND_ERR: 1,
    SECURITY_ERR: 2,
    ABORT_ERR: 3,

    // Added by File API specification
    NOT_READABLE_ERR: 4,
    ENCODING_ERR: 5,
    NO_MODIFICATION_ALLOWED_ERR: 6,
    INVALID_STATE_ERR: 7,
    SYNTAX_ERR: 8,
    INVALID_MODIFICATION_ERR: 9,
    QUOTA_EXCEEDED_ERR: 10,
    TYPE_MISMATCH_ERR: 11,
    PATH_EXISTS_ERR: 12

};

/**
 * Returns an an object that's converted by cordova to a FileEntry or a DirectoryEntry.
 * @param {boolean} isFile - is the object a file or a directory. true for file and false for directory.
 * @param {String} name - the name of the file.
 * @param {String} fullPath - the full path to the file.
 * @param {String} [filesystem = null] - the filesystem.
 * @param {String} [nativeURL = null] - the native URL of to the file.
 * @returns {Object} - An object containing Entry information.
*/
function returnEntry (isFile, name, fullPath, filesystem = null, nativeURL = null) {
    return {
        isFile,
        isDirectory: !isFile,
        name,
        fullPath,
        filesystem,
        nativeURL: nativeURL ?? fullPath
    };
}

module.exports = {
    /**
     * Read the file contents as text
     *
     * @param {[cdvFullPath: String]} params
     *      fullPath - the full path of the directory to read entries from
     * @returns {Promise<Array>} - An array of Entries in that directory
     *
     */
    readEntries: function ([cdvFullPath]) {
        const nativeFullPath = toNativePath(cdvFullPath);
        if(!nativeFullPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        return new Promise((resolve, reject) => {
            fs.readdir(nativeFullPath, { withFileTypes: true }, (err, files) => {
                if (err) {
                    reject(FileError.NOT_FOUND_ERR);
                    return;
                }

                const result = [];

                files.forEach(d => {
                    let absolutePath = nativeFullPath + d.name;

                    if (d.isDirectory()) {
                        absolutePath += path.sep;
                    }

                    result.push({
                        isDirectory: d.isDirectory(),
                        isFile: d.isFile(),
                        name: d.name,
                        fullPath: toCDVPath(cdvFullPath, absolutePath),
                        filesystemName: 'temporary',
                        nativeURL: absolutePath
                    });
                });

                resolve(result);
            });
        });
    },

    /**
     * Get the file given the path and fileName.
     *
     * @param {[dstDir: String, dstName: String, options: Object]} param
     *   dstDir: The fullPath to the directory the file is in.
     *   dstName: The filename including the extension.
     *   options: fileOptions {create: boolean, exclusive: boolean}.
     *
     * @returns {Promise<Object>} - The file object that is converted to FileEntry by cordova.
     */
    getFile,

    /**
     * get the file Metadata.
     *
     * @param {[cdvFullPath: String]} param
     *  fullPath: the full path of the file including the extension.
     * @returns {Promise<Object>} - An Object containing the file metadata.
     */
    getFileMetadata: function ([cdvFullPath]) {
        const nativeFullPath = toNativePath(cdvFullPath);
        if(!nativeFullPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        return new Promise((resolve, reject) => {
            fs.stat(nativeFullPath, (err, stats) => {
                if (err) {
                    reject(FileError.NOT_FOUND_ERR);
                    return;
                }

                resolve({
                    name: path.basename(nativeFullPath),
                    localURL: toCDVPath(cdvFullPath, nativeFullPath),
                    nativeURL: nativeFullPath,
                    type: '',
                    lastModified: stats.mtime,
                    size: stats.size,
                    lastModifiedDate: stats.mtime
                });
            });
        });
    },

    /**
     * get the file or directory Metadata.
     *
     * @param {[cdvFullPath: string]} param
     *      cdvFullPath: the full path of the file or directory.
     * @returns {Promise<Object>} - An Object containing the metadata.
     */
    getMetadata: function ([cdvFullPath]) {
        const nativeFullPath = toNativePath(cdvFullPath);
        if(!nativeFullPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        return new Promise((resolve, reject) => {
            fs.stat(nativeFullPath, (err, stats) => {
                if (err) {
                    reject(FileError.NOT_FOUND_ERR);
                    return;
                }

                resolve({
                    modificationTime: stats.mtime,
                    size: stats.size
                });
            });
        });
    },

    /**
     * set the file or directory Metadata.
     *
     * @param {[cdvFullPath: string, metadataObject: Object]} param
     *      cdvFullPath: the full path of the file including the extension.
     *      metadataObject: the object containing metadataValues (currently only supports modificationTime)
     * @returns {Promise<Object>} - An Object containing the file metadata.
     */
    setMetadata: function ([cdvFullPath, metadataObject]) {
        const nativeFullPath = toNativePath(cdvFullPath);
        if(!nativeFullPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        return new Promise((resolve, reject) => {
            const modificationTime = metadataObject.modificationTime;
            const utimesError = function (err) {
                if (err) {
                    reject(FileError.NOT_FOUND_ERR);
                    return;
                }
                resolve();
            };

            fs.utimes(nativeFullPath, modificationTime, modificationTime, utimesError);
        });
    },

    /**
     * Read the file contents as text
     *
     * @param {[fileName: String, enc: String, startPos: number, endPos: number]} param
     *   fileName: The fullPath of the file to be read.
     *   enc: The encoding to use to read the file.
     *   startPos: The start position from which to begin reading the file.
     *   endPos: The end position at which to stop reading the file.
     *
     * @returns {Promise<String>} The string value within the file.
     */
    readAsText: function ([fileName, enc, startPos, endPos]) {
        return readAs('text', fileName, enc, startPos, endPos);
    },

    /**
     * Read the file as a data URL.
     *
     * @param {[fileName: String, startPos: number, endPos: number]} param
     *   fileName: The fullPath of the file to be read.
     *   startPos: The start position from which to begin reading the file.
     *   endPos: The end position at which to stop reading the file.
     *
     * @returns {Promise<String>} the file as a dataUrl.
     */
    readAsDataURL: function ([fileName, startPos, endPos]) {
        return readAs('dataURL', fileName, null, startPos, endPos);
    },

    /**
     * Read the file contents as binary string.
     *
     * @param {[fileName: String, startPos: number, endPos: number]} param
     *   fileName: The fullPath of the file to be read.
     *   startPos: The start position from which to begin reading the file.
     *   endPos: The end position at which to stop reading the file.
     *
     * @returns {Promise<String>} The file as a binary string.
     */
    readAsBinaryString: function ([fileName, startPos, endPos]) {
        return readAs('binaryString', fileName, null, startPos, endPos);
    },

    /**
     * Read the file contents as text
     *
     * @param {[fileName: String, startPos: number, endPos: number]} param
     *   fileName: The fullPath of the file to be read.
     *   startPos: The start position from which to begin reading the file.
     *   endPos: The end position at which to stop reading the file.
     *
     * @returns {Promise<Array>} The file as an arrayBuffer.
     */
    readAsArrayBuffer: function ([fileName, startPos, endPos]) {
        return readAs('arrayBuffer', fileName, null, startPos, endPos);
    },

    /**
     * Remove the file or directory
     *
     * @param {[cdvFullPath: String]} param
     *   cdvFullPath: The cdvFullPath of the file or directory.
     *
     * @returns {Promise<void>} resolves when file or directory is deleted.
     */
    remove: function ([cdvFullPath]) {
        const nativeFullPath = toNativePath(cdvFullPath);
        if(!nativeFullPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return new Promise((resolve, reject) => {
            fs.stat(nativeFullPath, (err, stats) => {
                if (err) {
                    reject(FileError.NOT_FOUND_ERR);
                    return;
                }
                if (stats.isDirectory() && fs.readdirSync(nativeFullPath).length !== 0) {
                    reject(FileError.INVALID_MODIFICATION_ERR);
                    return;
                }
                fs.remove(nativeFullPath)
                    .then(() => resolve())
                    .catch(() => {
                        reject(FileError.NO_MODIFICATION_ALLOWED_ERR);
                    });
            });
        });
    },

    /**
     * Remove the file or directory
     *
     * @param {[cdvFullPath: String]} param
     *   cdvFullPath: The fullPath of the file or directory.
     *
     * @returns {Promise<void>} resolves when file or directory is deleted.
     */
    removeRecursively: function ([cdvFullPath]) {
        const nativeFullPath = toNativePath(cdvFullPath);
        if(!nativeFullPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return new Promise((resolve, reject) => {
            fs.stat(nativeFullPath, (err, stats) => {
                if (err) {
                    reject(FileError.NOT_FOUND_ERR);
                    return;
                }

                fs.remove(nativeFullPath, (err) => {
                    if (err) {
                        reject(FileError.NO_MODIFICATION_ALLOWED_ERR);
                        return;
                    }
                    resolve();
                });
            });
        });
    },

    /**
     * Get the directory given the path and directory name.
     *
     * @param {[dstDir: String, dstName: String, options: Object]} param
     *   dstDir: The fullPath to the directory the directory is in.
     *   dstName: The name of the directory.
     *   options: options {create: boolean, exclusive: boolean}.
     *
     * @returns {Promise<Object>} The directory object that is converted to DirectoryEntry by cordova.
     */
    getDirectory: getDirectory,

    /**
     * Get the Parent directory
     *
     * @param {[cdvUrl: String]} param
     *   cdvUrl: The fullPath to the directory the directory is in.
     *
     * @returns {Promise<Object>} The parent directory object that is converted to DirectoryEntry by cordova.
     */
    getParent: function ([cdvUrl]) {
        const parentPath = path.dirname(cdvUrl);
        const parentName = path.basename(parentPath);
        const fullPath = path.dirname(parentPath) + path.sep;

        return getDirectory([fullPath, parentName, { create: false }]);
    },

    /**
     * Copy File
     *
     * @param {[cdvSrcPath: String, cdvDstDir: String, dstName: String]} param
     *      cdvSrcPath: The fullPath to the file including extension.
     *      cdvDstDir: The destination directory.
     *      dstName: The destination file name.
     *
     * @returns {Promise<Object>} The copied file.
     */
    copyTo: function ([cdvSrcPath, cdvDstDir, dstName]) {

        const nativeSrcPath = toNativePath(cdvSrcPath);
        if(!nativeSrcPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        const nativeDstDir = toNativePath(cdvDstDir);
        if(!nativeDstDir)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return new Promise((resolve, reject) => {
            if (path.resolve(nativeSrcPath) === path.resolve(nativeDstDir + dstName)) {
                reject(FileError.INVALID_MODIFICATION_ERR);
                return;
            }
            fs.stat(nativeSrcPath)
                .then((srcStats) => {
                    fs.copy(nativeSrcPath, nativeDstDir + dstName, { recursive: srcStats.isDirectory() })
                        .then((stats)=>{
                            resolve(stats.isDirectory() ?
                                getDirectory([cdvDstDir, dstName]) :
                                getFile([cdvDstDir, dstName]))
                        })
                        .catch(() => reject(FileError.ENCODING_ERR));
                })
                .catch(() => reject(FileError.NOT_FOUND_ERR));
        });
    },

    /**
     * Move File. Always Overwrites.
     *
     * @param {[cdvSrcPath: String, cdvDstDir: String, dstName: String]} param
     *      cdvSrcPath: The fullPath to the file including extension.
     *      dstDir: The destination directory.
     *      dstName: The destination file name.
     *
     * @returns {Promise<Object>} The moved file.
     */
    moveTo: function ([cdvSrcPath, cdvDstDir, dstName]) {
        const nativeSrcPath = toNativePath(cdvSrcPath);
        if(!nativeSrcPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        const nativeDstDir = toNativePath(cdvDstDir);
        if(!nativeDstDir)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return new Promise((resolve, reject) => {
            if (path.resolve(nativeSrcPath) === path.resolve(nativeDstDir + dstName)) {
                reject(FileError.INVALID_MODIFICATION_ERR);
                return;
            }
            fs.stat(nativeSrcPath)
                .then((srcStats) => {
                    fs.move(nativeSrcPath, nativeDstDir + dstName)
                        .then((stats)=>{
                            resolve(stats.isDirectory() ?
                                getDirectory([cdvDstDir, dstName]) :
                                getFile([cdvDstDir, dstName]))
                        })
                        .catch(() => reject(FileError.ENCODING_ERR));
                })
                .catch(() => reject(FileError.NOT_FOUND_ERR));
        });
    },

    /**
     * resolve the File system URL as a FileEntry or a DirectoryEntry.
     *
     * @param {[cdvUri: string]} param
     *      cdvUri: The full path for the file.
     * @returns {Promise<Object>} The entry for the file or directory.
     */
    resolveLocalFileSystemURI: function ([cdvUri]) {
        //let cdvUri = args[0];
        console.log("resolveLocalFileSystemURI(" + JSON.stringify(arguments) + ")", arguments);
        console.log("resolveLocalFileSystemURI(" + cdvUri + ")");

        if (/\%5/g.test(cdvUri) || /\%20/g.test(cdvUri)) { // eslint-disable-line no-useless-escape
            cdvUri = decodeURI(cdvUri);
            console.log("resolveLocalFileSystemURI(" + cdvUri + ") decoded");
        }

        let nativeUri = toNativePath(cdvUri);
        if(!nativeUri)
            return Promise.reject(FileError.NOT_FOUND_ERR)


        return new Promise((resolve, reject) => {
            // support for encodeURI

            console.log("resolveLocalFileSystemURI(" + nativeUri + ") stat");

            fs.stat(nativeUri, (err, stats) => {
                if (err) {
                    console.error(nativeUri + " not found ", err, stats);
                    reject(FileError.NOT_FOUND_ERR);
                    return;
                }

                const baseName = path.basename(nativeUri);
                if (stats.isDirectory()) {
                    // add trailing slash if it is missing
                    if ((nativeUri) && !/\/$/.test(nativeUri)) {
                        nativeUri += '/';
                    }
                    if ((cdvUri) && !/\/$/.test(cdvUri)) {
                        cdvUri += '/';
                    }

                    resolve(returnEntry(false, baseName, cdvUri, null, nativeUri));
                } else {
                    // remove trailing slash if it is present
                    if (nativeUri && /\/$/.test(nativeUri)) {
                        nativeUri = nativeUri.substring(0, nativeUri.length - 1);
                    }
                    if (cdvUri && /\/$/.test(cdvUri)) {
                        cdvUri = cdvUri.substring(0, cdvUri.length - 1);
                    }

                    resolve(returnEntry(true, baseName, cdvUri, null, nativeUri));
                }
            });
        });
    },

    /**
     * Gets all the path URLs.
     *
     * @returns {Object} returns an object with all the paths.
     */
    requestAllPaths: function () {
        return cdvPathsPrefix;
    },

    /**
     * Write to a file.
     *
     * @param {[cdvFileName: string, data: string, position: number]} param
     *      cdvFileName: the full path of the file including fileName and extension.
     *      data: the data to be written to the file.
     *      position: the position offset to start writing from.
     * @returns {Promise<Object>} An object with information about the amount of bytes written.
     */
    write: function ([cdvFileName, data, position]) {

        const nativeFileName = toNativePath(cdvFileName);
        if(!nativeFileName)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return new Promise((resolve, reject) => {
            if (!data) {
                reject(FileError.INVALID_MODIFICATION_ERR);
                return;
            }

            const buf = Buffer.from(data);
            let bytesWritten = 0;

            fs.open(nativeFileName, 'a')
                .then(fd => {
                    return fs.write(fd, buf, 0, buf.length, position)
                        .then(bw => { bytesWritten = bw.bytesWritten; })
                        .finally(() => fs.close(fd));
                })
                .then(() => resolve(bytesWritten))
                .catch(() => reject(FileError.INVALID_MODIFICATION_ERR));
        });
    },

    /**
     * Truncate the file.
     *
     * @param {[cdvFullPath: string, size: number]} param
     *      cdvFullPath: the full path of the file including file extension
     *      size: the length of the file to truncate to.
     * @returns {Promise}
     */
    truncate: function ([cdvFullPath, size]) {
        const nativeFullPath = toNativePath(cdvFullPath);
        if(!nativeFullPath)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return new Promise((resolve, reject) => {
            fs.truncate(nativeFullPath, size, err => {
                if (err) {
                    reject(FileError.INVALID_STATE_ERR);
                    return;
                }

                resolve(size);
            });
        });
    },

    requestFileSystem: function ([type, size]) {
        if (type !== 0 && type !== 1) {
            throw new Error(FileError.INVALID_MODIFICATION_ERR);
        }

        const name = type === 0 ? 'temporary' : 'persistent';
        return {
            name,
            root: returnEntry(false, name, '/')
        };
    }
};

/** * Helpers ***/

/**
 * Read the file contents as specified.
 *
 * @param {[what: string, cdvFileName: string, encoding: string, startPos: number, endPos: number]} param
 *      what: what to read the file as. accepts 'text', 'dataURL', 'arrayBuffer' and 'binaryString'
 *      cdvFileName: The fullPath of the file to be read.
 *      encoding: The encoding to use to read the file.
 *      startPos: The start position from which to begin reading the file.
 *      endPos: The end position at which to stop reading the file.
 *
 * @returns {Promise<String>} The string value within the file.
 */
function readAs (what, cdvFileName, encoding, startPos, endPos) {

    const nativeFileName = toNativePath(cdvFileName);
    if(!nativeFileName)
        return Promise.reject(FileError.NOT_FOUND_ERR)

    return new Promise((resolve, reject) => {
        fs.open(nativeFileName, 'r', (err, fd) => {
            if (err) {
                reject(FileError.NOT_FOUND_ERR);
                return;
            }

            const buf = Buffer.alloc(endPos - startPos);

            fs.read(fd, buf, 0, buf.length, startPos)
                .then(() => {
                    switch (what) {
                    case 'text':
                        resolve(buf.toString(encoding));
                        break;
                    case 'dataURL':
                        resolve('data:;base64,' + buf.toString('base64'));
                        break;
                    case 'arrayBuffer':
                        resolve(buf);
                        break;
                    case 'binaryString':
                        resolve(buf.toString('binary'));
                        break;
                    }
                })
                .catch(() => reject(FileError.NOT_READABLE_ERR))
                .then(() => fs.close(fd));
        });
    });
}

/**
 * Get the file given the path and fileName.
 *
 * @param {[cdvDstDir: string, dstName: string, options?: Object]} param
 *   cdvDstDir: The fullPath to the directory the file is in.
 *   dstName: The filename including the extension.
 *   options: fileOptions {create: boolean, exclusive: boolean}.
 *
 * @returns {Promise<Object>} The file object that is converted to FileEntry by cordova.
 */
function getFile ([cdvDstDir, dstName, options]) {
    const absoluteCDVPath = path.join(cdvDstDir, dstName);
    const absoluteNativePath = toNativePath(absoluteCDVPath);
    if(!absoluteNativePath)
        return Promise.reject(FileError.NOT_FOUND_ERR)
    options = options || {};
    return new Promise((resolve, reject) => {
        fs.stat(absoluteNativePath, (err, stats) => {
            if (err && err.message && err.message.indexOf('ENOENT') !== 0) {
                reject(FileError.INVALID_STATE_ERR);
                return;
            }

            const exists = !err;
            const baseName = path.basename(absoluteNativePath);

            function createFile () {
                fs.open(absoluteNativePath, 'w', (err, fd) => {
                    if (err) {
                        reject(FileError.INVALID_STATE_ERR);
                        return;
                    }

                    fs.close(fd, (err) => {
                        if (err) {
                            reject(FileError.INVALID_STATE_ERR);
                            return;
                        }
                        resolve(returnEntry(true, baseName, absoluteCDVPath, null, absoluteNativePath));
                    });
                });
            }

            if (options.create === true && options.exclusive === true && exists) {
                // If create and exclusive are both true, and the path already exists,
                // getFile must fail.
                reject(FileError.PATH_EXISTS_ERR);
            } else if (options.create === true && !exists) {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getFile must create it as a zero-length file and return a corresponding
                // FileEntry.
                createFile();
            } else if (options.create === true && exists) {
                if (stats.isFile()) {
                    // Overwrite file, delete then create new.
                    createFile();
                } else {
                    reject(FileError.INVALID_MODIFICATION_ERR);
                }
            } else if (!options.create && !exists) {
                // If create is not true and the path doesn't exist, getFile must fail.
                reject(FileError.NOT_FOUND_ERR);
            } else if (!options.create && exists && stats.isDirectory()) {
                // If create is not true and the path exists, but is a directory, getFile
                // must fail.
                reject(FileError.TYPE_MISMATCH_ERR);
            } else {
                // Otherwise, if no other error occurs, getFile must return a FileEntry
                // corresponding to path.
                resolve(returnEntry(true, baseName, absoluteCDVPath, null, absoluteNativePath));
            }
        });
    });
}

/**
 * Get the directory given the path and directory name.
 *
 * @param {[cdvDstDir: string, dstName: string, options?: Object]} param
 *   cdvDstDir: The fullPath to the directory the directory is in.
 *   dstName: The name of the directory.
 *   options: options {create: boolean, exclusive: boolean}.
 *
 * @returns {Promise<Object>} The directory object that is converted to DirectoryEntry by cordova.
 */
function getDirectory ([cdvDstDir, dstName, options]) {
    const absoluteCDVPath = cdvDstDir + dstName;
    const absoluteNativePath = toNativePath(absoluteCDVPath);
    if(!absoluteNativePath)
        return Promise.reject(FileError.NOT_FOUND_ERR)

    options = options || {};
    return new Promise((resolve, reject) => {
        fs.stat(absoluteNativePath, (err, stats) => {
            if (err && err.message && err.message.indexOf('ENOENT') !== 0) {
                reject(FileError.INVALID_STATE_ERR);
                return;
            }

            const exists = !err;
            const baseName = path.basename(absoluteNativePath);
            if (options.create === true && options.exclusive === true && exists) {
                // If create and exclusive are both true, and the path already exists,
                // getDirectory must fail.
                reject(FileError.PATH_EXISTS_ERR);
            } else if (options.create === true && !exists) {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getDirectory must create it as a zero-length file and return a corresponding
                // MyDirectoryEntry.
                fs.mkdir(absoluteNativePath, (err) => {
                    if (err) {
                        reject(FileError.PATH_EXISTS_ERR);
                        return;
                    }
                    resolve(returnEntry(false, baseName, absoluteCDVPath, null, absoluteNativePath));
                });
            } else if (options.create === true && exists) {
                if (stats.isDirectory()) {
                    resolve(returnEntry(false, baseName, absoluteCDVPath, null, absoluteNativePath));
                } else {
                    reject(FileError.INVALID_MODIFICATION_ERR);
                }
            } else if (!options.create && !exists) {
                // If create is not true and the path doesn't exist, getDirectory must fail.
                reject(FileError.NOT_FOUND_ERR);
            } else if (!options.create && exists && stats.isFile()) {
                // If create is not true and the path exists, but is a file, getDirectory
                // must fail.
                reject(FileError.TYPE_MISMATCH_ERR);
            } else {
                // Otherwise, if no other error occurs, getDirectory must return a
                // DirectoryEntry corresponding to path.
                resolve(returnEntry(false, baseName, absoluteCDVPath, null, absoluteNativePath));
            }
        });
    });
}
