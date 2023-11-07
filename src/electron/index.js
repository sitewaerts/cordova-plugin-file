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

const {Buffer} = require('buffer');
const path = require('path');
const fs = require('fs-extra');
const {app, net, protocol} = require('electron');
const {pathToFileURL} = require('url')
const reEscape = require('regexp.escape');
const mime = require('mime');


/**
 * @typedef {Object} FileSystemInfo
 * @property {string} name
 * @property {EntryInfo} root
 */

/**
 * @typedef {Object} EntryInfo
 * @property {boolean} isFile
 * @property {boolean} isDirectory
 * @property {string} name
 * @property {string} fullPath
 * @property {string | null} [filesystemName]
 * @property {string} nativeURL
 */

/**
 * @typedef {Object} FileMetadata
 * @property {string}  name
 * @property {string}  localURL
 * @property {string}  nativeURL
 * @property {string}  type
 * @property {number}  lastModified
 * @property {number}  size
 * @property {number}  lastModifiedDate
 */

/**
 * @typedef {Object} DirectoryMetadata
 * @property {number}  size
 * @property {number}  modificationTime
 */


const PATH_SEP = '/';

const EFS_SCHEME = "efs"
const EFS_BASE = EFS_SCHEME + "://" // no host name
const EFS_PREFIX = EFS_BASE + PATH_SEP

const CDV_SCHEME = "cdvfile"
const CDV_HOST = "localhost"
const CDV_BASE = CDV_SCHEME + "://" + CDV_HOST
const CDV_PREFIX = CDV_BASE + PATH_SEP

/**
 * @type {Array<FileLocation>}
 */
const fileLocations = [];

/**
 * @type {Record<string, FileLocation>}
 */
const fileLocationsByName = {};

/**
 * @type {Record<string, FileSystemInfo>}
 */
const allFileSystems = {};

/**
 * @type {Record<string, string>}
 */
const allPaths = {};

/**
 * @type {Record<string, string>}
 */
const allUrls = {};

class FileLocation
{

    /**
     *
     * @param {string} name
     * @param {string} osDirPath
     * @param {boolean} modifiable
     */
    constructor(name, osDirPath, modifiable)
    {
        this.name = name;
        this.modifiable = modifiable;

        this.cdvUrlBase = CDV_PREFIX + name
        this.cdvUrlPrefix = this.cdvUrlBase + PATH_SEP
        this.equalsCDVUrlPrefixRE = new RegExp("^" + reEscape(this.cdvUrlBase) + reEscape(PATH_SEP) + '?$', "i"); // match ignoring case
        this.startsWithCDVUrlPrefixRE = new RegExp("^" + reEscape(this.cdvUrlPrefix), "i"); // match ignoring case

        this.efsUrlBase = EFS_PREFIX + name
        this.efsUrlPrefix = this.efsUrlBase + PATH_SEP
        this.equalsEFSUrlPrefixRE = new RegExp("^" + reEscape(this.efsUrlBase) + reEscape(PATH_SEP) + '?$', "i"); // match ignoring case
        this.startsWithEFSUrlPrefixRE = new RegExp("^" + reEscape(this.efsUrlPrefix), "i"); // match ignoring case

        this.osPathBase = osDirPath.endsWith(path.sep) ? osDirPath.substring(0, osDirPath.length - 1) : osDirPath;
        this.osPathPrefix = this.osPathBase + path.sep
        this.equalsOSPathPrefixRE = new RegExp("^" + reEscape(this.osPathBase) + reEscape(path.sep) + '?$', "i"); // match ignoring case
        this.startsWithOSPathPrefixRE = new RegExp("^" + reEscape(this.osPathPrefix), "i"); // match ignoring case

        fileLocations.push(this);
        fileLocationsByName[name] = this;
        allFileSystems[name] = {
            name: name,
            root: createEntryInfo(false, "root:" + name, "/", this)
        };
        allPaths[name + "Directory"] = this.osPathPrefix;
        allUrls[name + "Directory"] = this.efsUrlPrefix;
    }

    /**
     * @returns {Promise<void>}
     */
    init(){

        return fs.stat(this.osPathBase)
            .then((stats)=>{
                if(!stats.isDirectory())
                    return Promise.reject({message: this.osPathBase + ' exists but is not a directory', stats: stats});
            }, (error)=>{
                if(!isNotFoundError(error))
                    return Promise.reject({message: 'cannot stat ' + this.osPathBase, cause: error });
                return fs.mkdir(this.osPathBase, {recursive: true})
                    .catch((error)=>{
                        return Promise.reject({message: 'cannot create ' + this.osPathBase, cause: error });
                    })
            })
    }

    /**
     *
     * @param {string} url
     * @param {boolean} [sanitized]
     * @returns {Entry | null}
     */
    getEntry(url, sanitized)
    {
        if (!sanitized)
            url = sanitizeUrl(url);
        if (!url)
            return null;
        else if (this.equalsEFSUrlPrefixRE.test(url))
            return new Entry(this, sanitizePath(url.replace(this.equalsEFSUrlPrefixRE, '')));
        else if (this.startsWithEFSUrlPrefixRE.test(url))
            return new Entry(this, sanitizePath(url.replace(this.startsWithEFSUrlPrefixRE, '')));
        else if (this.equalsCDVUrlPrefixRE.test(url))
            return new Entry(this, sanitizePath(url.replace(this.equalsCDVUrlPrefixRE, '')));
        else if (this.startsWithCDVUrlPrefixRE.test(url))
            return new Entry(this, sanitizePath(url.replace(this.startsWithCDVUrlPrefixRE, '')));
        return null;
    }

    /**
     *
     * @param {string} osPath
     * @returns {Entry | null}
     */
    getEntryForOSPath(osPath)
    {
        if (!osPath)
            return null;
        else if (this.equalsOSPathPrefixRE.test(osPath))
            return new Entry(this, sanitizePath(osPath.replace(this.equalsOSPathPrefixRE, '').replaceAll(path.sep, PATH_SEP)));
        else if (this.startsWithOSPathPrefixRE.test(url))
            return new Entry(this, sanitizePath(osPath.replace(this.startsWithOSPathPrefixRE, '').replaceAll(path.sep, PATH_SEP)));
        return null;
    }

    /**
     *
     * @param {string} osPath
     * @returns {boolean}
     */
    matchesOSPath(osPath)
    {
        return osPath &&
            (this.equalsOSPathPrefixRE.test(osPath) || this.startsWithOSPathPrefixRE.test(osPath))
    }

    /**
     *
     * @param {string} url
     * @returns {boolean}
     */
    matchesUrl(url)
    {
        return url && (this.matchesEFSUrl(url) || this.matchesCDVUrl(url))
    }

    /**
     *
     * @param {string} url
     * @returns {boolean}
     */
    matchesEFSUrl(url)
    {
        return url &&
            (this.equalsEFSUrlPrefixRE.test(url) || this.startsWithEFSUrlPrefixRE.test(url))
    }

    /**
     *
     * @param {string} url
     * @returns {boolean}
     */
    matchesCDVUrl(url)
    {
        return url &&
            (this.equalsCDVUrlPrefixRE.test(url) || this.startsWithCDVUrlPrefixRE.test(url))
    }
}

class Entry
{
    /**
     *
     * @param {FileLocation} root
     * @param {string} fullPath
     */
    constructor(root, fullPath)
    {
        this.root = root;
        if (fullPath[0] !== PATH_SEP)
            fullPath = PATH_SEP + fullPath;
        this.fullPath = fullPath;

        let osPath = fullPath;
        if (path.sep !== PATH_SEP)
            osPath = osPath.replaceAll(PATH_SEP, path.sep);
        this.osPath = osPath;

        this.name = path.basename(osPath);

    }


    /**
     * @returns {string}
     */
    getOSPath()
    {
        return this.root.osPathBase + this.osPath;
    }

    /**
     * @returns {string}
     */
    getEFSUrl()
    {
        return this.root.efsUrlBase + this.fullPath;
    }


    /**
     * @returns {string}
     */
    getFileUrl()
    {
        return pathToFileURL(this.getOSPath()).toString();
    }

    /**
     *
     * @param {boolean} isFile
     * @returns {EntryInfo}
     */
    getInfo(isFile)
    {
        return createEntryInfo(isFile, this.name, this.fullPath, this.root)
    }

    /**
     * @return {Entry}
     */
    getParent()
    {
        const fullPath = sanitizePath(this.fullPath + (this.fullPath.endsWith('/') ? '' : '/') + '..');
        return new Entry(this.root, fullPath);
    }

    /**
     * @param {string} name
     * @return {Entry}
     */
    getChild(name)
    {
        const fullPath = sanitizePath(this.fullPath + (this.fullPath.endsWith('/') ? '' : '/') + name);
        return new Entry(this.root, fullPath);
    }
}

const REPLACE_SLASHES_RE = new RegExp('/{2,}', 'g');
const SLASH_SPLIT_RE = new RegExp('/+');

/**
 *
 * @param {string} path
 * @returns {string}
 */
function sanitizePath(path)
{
    if (!path || path === '')
        return '/';

    const components = path.replaceAll(REPLACE_SLASHES_RE, '/').split(SLASH_SPLIT_RE);
    // Remove double dots, use old school array iteration instead of RegExp
    // since it is impossible to debug them
    for (let index = 0; index < components.length; ++index)
    {
        if (components[index] === '..')
        {
            components.splice(index, 1);
            if (index > 0)
            {
                // if we're not in the start of array then remove preceding path component,
                // In case if relative path points above the root directory, just ignore double dots
                // See file.spec.111 should not traverse above the root directory for test case
                components.splice(index - 1, 1);
                --index;
            }
        }
    }
    return components.join('/');
}


const RE_ENCODED_URL = /%(5|20)/

/**
 *
 * @param {string} url
 * @returns {string | null}
 */
function sanitizeUrl(url)
{
    if (!url || url.length === 0)
        return null;

    if (RE_ENCODED_URL.test(url))
        url = decodeURI(url);

    return url;
}

/**
 * @param {string} url
 * @returns {Entry| null}
 */
function getEntry(url)
{
    url = sanitizeUrl(url);

    if (!url || url.length === 0)
        return null;

    for (const fl of fileLocations)
    {
        if (fl.matchesUrl(url))
            return fl.getEntry(url, true);
    }
    return null;
}

/**
 * @param {string} osPath
 * @returns {Entry| null}
 */
function getEntryForOSPath(osPath)
{
    if (!osPath || osPath.length === 0)
        return null;

    for (const fl of fileLocations)
    {
        if (fl.matchesOSPath(osPath))
            return fl.getEntry(osPath);
    }
    return null;
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
 * see https://stackoverflow.com/a/35016418/4094951
 * @param {any} error
 * @return {boolean}
 */
function isNotFoundError(error)
{
    return !!(error && error.code === 'ENOENT');
}

/**
 * @param {any} error
 * @param {string} [msg]
 * @return {Promise<never>}
 */
function notFoundOrError(error, msg)
{
    if (isNotFoundError(error))
        return Promise.reject(FileError.NOT_FOUND_ERR);
    if (msg)
        console.error(msg, error);
    else
        console.error(error);
    return Promise.reject(FileError.INVALID_STATE_ERR);
}

/**
 * Returns a transfer object that's converted by cordova to a FileEntry or a DirectoryEntry.
 * @param {boolean} isFile - is the object a file or a directory. true for file and false for directory.
 * @param {string} name - the name of the file/directory.
 * @param {string} fullPath - the full path to the file/directory (MUST NOT contain protocol and/or file system name)
 * @param {FileLocation} [fl] - the name of the filesystem.
 * @returns {EntryInfo}
 */
function createEntryInfo(isFile, name, fullPath, fl)
{
    if (!fullPath.startsWith(PATH_SEP))
        fullPath = PATH_SEP + fullPath;

    if (!isFile)
    {
        // add trailing slash if it is missing
        if (!fullPath.endsWith(PATH_SEP))
            fullPath += PATH_SEP;
    }
    else
    {
        // remove trailing slash if it is present
        if (fullPath.endsWith(PATH_SEP))
            fullPath = fullPath.substring(0, fullPath.length - 1);
    }

    return {
        isFile: !!isFile,
        isDirectory: !isFile,
        name,
        fullPath: fullPath,
        nativeURL: fl.efsUrlBase + fullPath,
        filesystemName: fl.name
    };
}

// public plugin api
const filePlugin = {
    /**
     * Read the file contents as text
     *
     * @param {string} uri - the full path of the directory to read entries from
     * @returns {Promise<Array<EntryInfo>>} - An array of Entries in that directory
     *
     */
    readEntries: function ([uri])
    {
        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return fs.readdir(entry.getOSPath(), {withFileTypes: true, recursive: false})
            .then((files) =>
            {
                return files.map(f =>
                {
                    return entry.getChild(f.name).getInfo(!f.isDirectory());
                });
            })
            .catch((error) =>
            {
                return notFoundOrError(error, "cannot read entries of " + entry.getOSPath());
            });
    },

    /**
     * Get the file given the path and fileName.
     *
     * @param {string} parentUri: The fullPath to the directory the file is in.
     * @param {string} dstName: The filename including the extension.
     * @param {{create?: boolean, exclusive?: boolean}} [options]: fileOptions .
     *
     * @returns {Promise<EntryInfo>} - The file object that is converted to FileEntry by cordova.
     */
    getFile: function ([parentUri, dstName, options])
    {
        return getFile(parentUri, dstName, options);
    },

    /**
     * get the file Metadata.
     *
     * @param {string} uri the full path of the file including the extension.
     * @returns {Promise<FileMetadata>} - An Object containing the file metadata.
     */
    getFileMetadata: function ([uri])
    {
        const entry = getEntry(uri)
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return fs.stat(entry.getOSPath())
            .then((stats) =>
            {
                if (stats.isDirectory())
                    return Promise.reject(FileError.TYPE_MISMATCH_ERR);

                const info = entry.getInfo(true);

                return {
                    name: info.name,
                    localURL: info.fullPath,
                    nativeURL: info.nativeURL,
                    type: mime.getType(entry.getOSPath()),
                    lastModified: stats.mtime,
                    size: stats.size,
                    lastModifiedDate: stats.mtime
                };
            }, (error) =>
            {
                return notFoundOrError(error, "cannot stat " + entry.getOSPath())
            })
    },

    /**
     * get the file or directory Metadata.
     *
     * @param {string} uri: the full path of the file or directory.
     * @returns {Promise<DirectoryMetadata>} - An Object containing the metadata.
     */
    getMetadata: function ([uri])
    {
        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return fs.stat(entry.getOSPath())
            .then((stats) =>
            {
                return {
                    modificationTime: stats.mtime,
                    size: stats.size
                };
            }, (error) =>
            {
                return notFoundOrError(error, 'cannot stat ' + entry.getOSPath())
            })
    },

    /**
     * set the file or directory Metadata.
     *
     * @param {string} uri: the full path of the file including the extension.
     * @param {{modificationTime:number}} metadataObject: the object containing metadataValues (currently only supports modificationTime)
     * @returns {Promise<void>}
     */
    setMetadata: function ([uri, metadataObject])
    {
        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        if(!entry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)

        return fs.utimes(entry.getOSPath(), modificationTime, modificationTime)
            .catch((error) =>
            {
                return notFoundOrError(error, 'cannot utimes ' + entry.getOSPath())
            })
    },

    /**
     * Read the file contents as text
     *
     * @param {string}  uri: The fullPath of the file to be read.
     * @param {string}  enc: The encoding to use to read the file.
     * @param {number}  startPos: The start position from which to begin reading the file.
     * @param {number}  endPos: The end position at which to stop reading the file.
     *
     * @returns {Promise<string>} The string value within the file.
     */
    readAsText: function ([uri, enc, startPos, endPos])
    {
        return readAs('text', uri, enc, startPos, endPos);
    },

    /**
     * Read the file as a data URL.
     *
     * @param {string}  uri: The fullPath of the file to be read.
     * @param {number}  startPos: The start position from which to begin reading the file.
     * @param {number}  endPos: The end position at which to stop reading the file.
     *
     * @returns {Promise<string>} the file as a dataUrl.
     */
    readAsDataURL: function ([uri, startPos, endPos])
    {
        return readAs('dataURL', uri, null, startPos, endPos);
    },

    /**
     * Read the file contents as binary string.
     *
     * @param {string}  uri: The fullPath of the file to be read.
     * @param {number}  startPos: The start position from which to begin reading the file.
     * @param {number}  endPos: The end position at which to stop reading the file.
     *
     * @returns {Promise<string>} The file as a binary string.
     */
    readAsBinaryString: function ([uri, startPos, endPos])
    {
        return readAs('binaryString', uri, null, startPos, endPos);
    },

    /**
     * Read the file contents as text
     *
     * @param {string}  uri: The fullPath of the file to be read.
     * @param {number}  startPos: The start position from which to begin reading the file.
     * @param {number}  endPos: The end position at which to stop reading the file.

     * @returns {Promise<Array>} The file as an arrayBuffer.
     */
    readAsArrayBuffer: function ([uri, startPos, endPos])
    {
        return readAs('arrayBuffer', uri, null, startPos, endPos);
    },

    /**
     * Remove the file or directory
     *
     * @param {string} uri The cdvFullPath of the file or directory.
     *
     * @returns {Promise<void>} resolves when file or directory is deleted.
     */
    remove: function ([uri])
    {
        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        if(!entry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)

        return fs.stat(entry.getOSPath())
            .then((stats) =>
            {
                if (stats.isDirectory() && fs.readdirSync(entry.getOSPath()).length !== 0)
                    return Promise.reject(FileError.INVALID_MODIFICATION_ERR);

                return fs.remove(entry.getOSPath())
                    .catch((error) =>
                    {
                        console.error("cannot remove " + entry.getOSPath(), error);
                        return Promise.reject(FileError.NO_MODIFICATION_ALLOWED_ERR);
                    });
            }, (error) =>
            {
                return notFoundOrError(error, "cannot stat " + entry.getOSPath())
            })
    },

    /**
     * Remove the file or directory
     *
     * @param {string} uri: The fullPath of the file or directory.
     *
     * @returns {Promise<void>} resolves when file or directory is deleted.
     */
    removeRecursively: function ([uri])
    {
        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        if(!entry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)

        return fs.stat(entry.getOSPath()).then((stats) =>
        {
            return fs.remove(entry.getOSPath())
                .catch((error) =>
                {
                    console.error("cannot remove " + entry.getOSPath(), error);
                    return Promise.reject(FileError.NO_MODIFICATION_ALLOWED_ERR);
                });
        }, (error) =>
        {
            return notFoundOrError(error, "cannot stat " + entry.getOSPath());
        })
    },

    /**
     * Get the directory given the path and directory name.
     *
     * @param {string} dstUri: The fullPath to the parent directory
     * @param {string} dstName: The name of the directory.
     * @param {{create?: boolean, exclusive?: boolean}} options: options
     *
     * @returns {Promise<EntryInfo>} The directory object that is converted to DirectoryEntry by cordova.
     */
    getDirectory: function ([dstUri, dstName, options])
    {
        return getDirectory(dstUri, dstName, options);
    },

    /**
     * Get the Parent directory
     *
     * @param {string} uri: The fullPath to the file or directory.
     *
     * @returns {Promise<EntryInfo>} The parent directory object that is converted to DirectoryEntry by cordova.
     */
    getParent: function ([uri])
    {
        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        const parentEntry = entry.getParent();
        return getDirectory(parentEntry.getEFSUrl(), parentEntry.name, {create: false});
    },

    /**
     * Copy File
     *
     * @param {string} srcUri: The fullPath to the file including extension.
     * @param {string} dstParentUri: The destination directory.
     * @param {string} dstName: The destination file name.
     *
     * @returns {Promise<EntryInfo>} The copied file.
     */
    copyTo: function ([srcUri, dstParentUri, dstName])
    {
        const srcEntry = getEntry(srcUri);
        if (!srcEntry)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        const dstParentEntry = getEntry(dstParentUri);
        if (!dstParentEntry)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        const dstEntry = dstParentEntry.getChild(dstName);
        if(!dstEntry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)


        if (path.resolve(srcEntry.getOSPath()) === path.resolve(dstEntry.getOSPath()))
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR);

        return fs.stat(srcEntry.getOSPath())
            .then((srcStats) =>
            {
                return fs.copy(srcEntry.getOSPath(), dstEntry.getOSPath(), {recursive: srcStats.isDirectory()})
                    .then(() =>
                    {
                        return dstEntry.getInfo(!srcStats.isDirectory())
                    })
                    .catch((e) =>
                    {
                        console.error("cannot copy " + srcEntry.getOSPath() + " -> " + dstEntry.getOSPath(), e);
                        return Promise.reject(FileError.ENCODING_ERR)
                    });
            }, (error) =>
            {
                return notFoundOrError(error, 'cannot stat ' + srcEntry.getOSPath())
            })
    },

    /**
     * Move File/Directory. Always Overwrites.
     *
     * @param {string} srcUri: The fullPath to the file including extension.
     * @param {string} dstParentUri: The destination directory.
     * @param {string} dstName: The destination file name.
     *
     * @returns {Promise<EntryInfo>} The moved file.
     */
    moveTo: function ([srcUri, dstParentUri, dstName])
    {
        const srcEntry = getEntry(srcUri);
        if (!srcEntry)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        if(!srcEntry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)

        const dstParentEntry = getEntry(dstParentUri);
        if (!dstParentEntry)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        const dstEntry = dstParentEntry.getChild(dstName);
        if(!dstEntry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)

        if (path.resolve(srcEntry.getOSPath()) === path.resolve(dstEntry.getOSPath()))
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR);

        return fs.stat(srcEntry.getOSPath())
            .then((srcStats) =>
            {
                fs.move(srcEntry.getOSPath(), dstEntry.getOSPath())
                    .then(() =>
                    {
                        return dstEntry.getInfo(!srcStats.isDirectory())
                    })
                    .catch((e) =>
                    {
                        console.error("cannot move " + srcEntry.getOSPath() + " -> " + dstEntry.getOSPath(), e);
                        return Promise.reject(FileError.ENCODING_ERR)
                    });
            }, (error) =>
            {
                return notFoundOrError(error, 'cannot stat ' + srcEntry.getOSPath())
            })

    },

    /**
     * Write to a file.
     *
     * @param {string} uri: the full path of the file including fileName and extension.
     * @param {string} data: the data to be written to the file.
     * @param {number} [position = 0]: the position offset to start writing from.
     * @returns {Promise<number>} An object with information about the amount of bytes written.
     */
    write: function ([uri, data, position = 0])
    {
        if (!data)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        if(!entry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)

        return new Promise((resolve, reject) =>
        {
            const buf = Buffer.from(data);
            let bytesWritten = 0;

            fs.open(entry.getOSPath(), 'a')
                .then(fd =>
                {
                    return fs.write(fd, buf, 0, buf.length, position)
                        .then(bw =>
                        {
                            bytesWritten = bw.bytesWritten;
                        })
                        .finally(() => fs.close(fd));
                })
                .then(() => resolve(bytesWritten))
                .catch(() => reject(FileError.INVALID_MODIFICATION_ERR));
        });
    },

    /**
     * Truncate the file.
     *
     * @param {string} uri: the full path of the file including file extension
     * @param {number} [size = 0]: the length of the file to truncate to.
     * @returns {Promise<number>}
     */
    truncate: function ([uri, size = 0])
    {
        const entry = getEntry(uri);
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)
        if(!entry.root.modifiable)
            return Promise.reject(FileError.INVALID_MODIFICATION_ERR)

        return fs.truncate(entry.getOSPath(), size)
            .then(()=>{
                return size
            }, (error)=>{
                return notFoundOrError(error, 'cannot truncate ' + entry.getOSPath())
            })
    },

    /**
     * resolve the File system URL as a FileEntry or a DirectoryEntry.
     *
     * @param {string} uri: The full path for the file.
     * @returns {Promise<EntryInfo>} The entry for the file or directory.
     */
    resolveLocalFileSystemURI: function ([uri])
    {
        const entry = getEntry(uri)
        if (!entry)
            return Promise.reject(FileError.NOT_FOUND_ERR)

        return fs.stat(entry.getOSPath())
            .then((stats) =>
            {
                return entry.getInfo(!stats.isDirectory());
            }, (error) =>
            {
                return notFoundOrError(error, 'cannot stat ' + entry.getOSPath())
            })
    },

    /**
     * Gets all the path URLs.
     *
     * @returns {Record<string, string>}
     */
    requestAllPaths: function ()
    {
        return allUrls;
    },


    /**
     * @returns {Record<string, FileSystemInfo>}
     */
    requestAllFileSystems: function ()
    {
        return allFileSystems;
    },

    /**
     *
     * @param {number} type
     * @param {number} [size]
     * @returns {FileSystemInfo}
     */
    requestFileSystem: function ([type, size])
    {
        if (type < 0 || type > 1)  // noinspection JSCheckFunctionSignatures
            throw new Error(FileError.NOT_FOUND_ERR);
        const fl = type === 0 ? FILE_LOCATION_TEMP : FILE_LOCATION_DATA;
        return allFileSystems[fl.name];
    },
};

// util api for use in dependent plugins
const filePluginUtil = {

    paths : ()=>{
        return allPaths;
    },
    urls : ()=>{
        return allUrls;
    },
    /**
     * get absolute file path for given url (cdvfile://, efs://)
     * @param {string} url
     * @returns {string | null}
     */
    urlToFilePath: (url)=>
    {
        const entry = getEntry(url);
        if (!entry)
            return null;
        return entry.getOSPath();
    },

    /**
     * get absolute url (cdvfile://, efs://) for given file path
     * @param {string} path
     * @returns {string | null}
     */
    filePathToUrl: (path)=>
    {
        const entry = getEntryForOSPath(path);
        if (!entry)
            return null;
        return entry.getEFSUrl();
    },

    /**
     * @param {string} url
     * @returns {Promise<EntryInfo>} The entry for the file or directory.
     */
    resolveLocalFileSystemURI: (url)=>{
        return filePlugin.resolveLocalFileSystemURI([url]);
    }
}

/**
 * cordova electron plugin api
 * @param {string} action
 * @param {Array<any>} args
 * @param {CallbackContext} callbackContext
 * @returns {boolean} indicating if action is available in plugin
 */
const plugin = function(action, args, callbackContext){
    if (!filePlugin[action])
        return false;
    try
    {
        Promise.resolve(filePlugin[action](args)).then(
            callbackContext.success.bind(callbackContext),
            callbackContext.error.bind(callbackContext)
        );
    }
    catch(e)
    {
        console.error(action + ' failed', e);
        callbackContext.error({message: action + ' failed', cause:e });
    }
    return true;
}

let FILE_LOCATION_APPLICATION;
let FILE_LOCATION_DATA;
let FILE_LOCATION_TEMP;
let FILE_LOCATION_CACHE;
let FILE_LOCATION_DOCUMENTS;


let _initialized = false;

/**
 * @param {Record<string, string>} variables
 * @param {(serviceName:string)=>Promise<any>} serviceLoader
 * @returns {Promise<void>}
 */
function init(variables, serviceLoader){
    if(_initialized)
        return Promise.reject(new Error("cordova-plugin-file already initialized"));
    _initialized = true;

    const appPackageName = variables['PACKAGE_NAME']
    if(!appPackageName || appPackageName.length<1)
        return Promise.reject(new Error("cordova-plugin-file cannot find PACKAGE_NAME"));

    FILE_LOCATION_APPLICATION = new FileLocation("application", app.getAppPath(), false);
    FILE_LOCATION_DATA = new FileLocation("data", path.join(app.getPath('userData'), appPackageName), true);
    FILE_LOCATION_TEMP = new FileLocation("temp", path.join(app.getPath('temp'), appPackageName), true);
//FILE_LOCATION_CACHE = new FileLocation("cache", path.join(app.getPath('cache'), appPackageName), true);
    FILE_LOCATION_DOCUMENTS = new FileLocation("documents", app.getPath('documents'), true);

    return app.whenReady().then(async () =>
    {

        await Promise.all(fileLocations.map((fl)=>{return fl.init()}));

        /**
         *
         * @param {GlobalRequest} req
         * @return {Response|Promise<GlobalResponse>}
         */
        function handleRequest(req)
        {
            const entry = getEntry(req.url);
            if (!entry)
                return new Response(null, {status: 404});
            const fileUrl = entry.getFileUrl();
            if (!fileUrl)
                return new Response(null, {status: 404});
            return net.fetch(fileUrl);
        }

        if(!protocol.isProtocolHandled(CDV_SCHEME))
            protocol.handle(CDV_SCHEME, handleRequest)
        if(!protocol.isProtocolHandled(EFS_SCHEME))
            protocol.handle(EFS_SCHEME, handleRequest)
    })


}
/**
 * @param {Record<string, string>} variables
 * @returns {Promise<void>}
 */
plugin.init = init;

plugin.util = filePluginUtil;

// backwards compatibility: attach api methods for direct access from old cordova-electron platform impl
Object.keys(filePlugin).forEach((apiMethod)=>{
    plugin[apiMethod] = async ()=>{
        if(!_initialized)
        {
            // HACK to get VARIABLES for plugin. TODO: verify if this works in released/packaged app
            const pluginId = require('../../package.json').cordova.id
            const pluginVariables = require(path.join(app.getAppPath(), '..', 'electron.json'))['installed_plugins'][pluginId] || {};

            await init(pluginVariables);
        }
        return filePlugin[apiMethod].apply(arguments);
    }
});

module.exports = plugin;

/** * Helpers ***/

/**
 * Read the file contents as specified.
 * @template R
 *
 * @param  {string} outputFormat: what to read the file as. accepts 'text', 'dataURL', 'arrayBuffer' and 'binaryString'
 * @param  {string} uri: The fullPath of the file to be read.
 * @param  {string | null} encoding: The encoding to use to read the file.
 * @param  {number} startPos: The start position from which to begin reading the file.
 * @param  {number} endPos: The end position at which to stop reading the file.
 *
 * @returns {Promise<R>} The string value within the file.
 */
function readAs(outputFormat, uri, encoding, startPos, endPos)
{
    const entry = getEntry(uri);
    if (!entry)
        return Promise.reject(FileError.NOT_FOUND_ERR)

    return new Promise((resolve, reject) =>
    {
        fs.open(entry.getOSPath(), 'r', (err, fd) =>
        {
            if (err)
            {
                reject(FileError.NOT_FOUND_ERR);
                return;
            }

            const buf = Buffer.alloc(endPos - startPos);

            fs.read(fd, buf, 0, buf.length, startPos)
                .then(() =>
                {
                    switch (outputFormat)
                    {
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
 * @param {string} parentUri: The fullPath to the directory the file is in.
 * @param {string} fileName: The filename including the extension.
 * @param {{create?:boolean, exclusive?:boolean}} [options]: fileOptions
 *
 * @returns {Promise<EntryInfo>} The file object that is converted to FileEntry by cordova.
 */
function getFile(parentUri, fileName, options)
{
    const parentEntry = getEntry(parentUri);
    if (!parentEntry)
        return Promise.reject(FileError.NOT_FOUND_ERR)
    const entry = parentEntry.getChild(fileName);

    options = options || {};
    return new Promise((resolve, reject) =>
    {
        fs.stat(entry.getOSPath(), (err, stats) =>
        {
            if (err && !isNotFoundError(err))
                return reject(FileError.NOT_FOUND_ERR);

            const exists = !err;

            function createFile()
            {
                if(!entry.root.modifiable)
                    return reject(FileError.INVALID_MODIFICATION_ERR)

                fs.open(entry.getOSPath(), 'w', (err, fd) =>
                {
                    if (err)
                    {
                        reject(FileError.INVALID_STATE_ERR);
                        return;
                    }

                    fs.close(fd, (err) =>
                    {
                        if (err)
                        {
                            reject(FileError.INVALID_STATE_ERR);
                            return;
                        }
                        resolve(entry.getInfo(true));
                    });
                });
            }

            if (options.create === true && options.exclusive === true && exists)
            {
                // If create and exclusive are both true, and the path already exists,
                // getFile must fail.
                reject(FileError.PATH_EXISTS_ERR);
            }
            else if (options.create === true && !exists)
            {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getFile must create it as a zero-length file and return a corresponding
                // FileEntry.
                createFile();
            }
            else if (options.create === true && exists)
            {
                if (stats.isFile())
                {
                    // Overwrite file, delete then create new.
                    createFile();
                }
                else
                {
                    reject(FileError.INVALID_MODIFICATION_ERR);
                }
            }
            else if (!options.create && !exists)
            {
                // If create is not true and the path doesn't exist, getFile must fail.
                reject(FileError.NOT_FOUND_ERR);
            }
            else if (!options.create && exists && stats.isDirectory())
            {
                // If create is not true and the path exists, but is a directory, getFile
                // must fail.
                reject(FileError.TYPE_MISMATCH_ERR);
            }
            else
            {
                // Otherwise, if no other error occurs, getFile must return a FileEntry
                // corresponding to path.
                resolve(entry.getInfo(true));
            }
        });
    });
}

/**
 * Get the directory given the path and directory name.
 *
 * @param {string} parentUri The fullPath to the parent directory
 * @param {string} dirName The name of the directory.
 * @param {{create?: boolean, exclusive?: boolean}} [options] options .
 *
 * @returns {Promise<EntryInfo>} The directory object that is converted to DirectoryEntry by cordova.
 */
function getDirectory(parentUri, dirName, options)
{
    const parentEntry = getEntry(parentUri);
    if (!parentEntry)
        return Promise.reject(FileError.NOT_FOUND_ERR)
    const entry = parentEntry.getChild(dirName);

    options = options || {};
    return new Promise((resolve, reject) =>
    {
        fs.stat(entry.getOSPath(), (err, stats) =>
        {
            if (err && !isNotFoundError(err))
                return reject(FileError.INVALID_STATE_ERR);

            const exists = !err;
            if (options.create === true && options.exclusive === true && exists)
            {
                // If create and exclusive are both true, and the path already exists,
                // getDirectory must fail.
                reject(FileError.PATH_EXISTS_ERR);
            }
            else if (options.create === true && !exists)
            {
                // If create is true, the path doesn't exist, and no other error occurs,
                // getDirectory must create it as a zero-length file and return a corresponding
                // MyDirectoryEntry.
                if(!entry.root.modifiable)
                    return reject(FileError.INVALID_MODIFICATION_ERR)

                fs.mkdir(entry.getOSPath(), (err) =>
                {
                    if (err)
                    {
                        reject(FileError.PATH_EXISTS_ERR);
                        return;
                    }
                    resolve(entry.getInfo(false));
                });
            }
            else if (options.create === true && exists)
            {
                if (stats.isDirectory())
                {
                    resolve(entry.getInfo(false));
                }
                else
                {
                    reject(FileError.INVALID_MODIFICATION_ERR);
                }
            }
            else if (!options.create && !exists)
            {
                // If create is not true and the path doesn't exist, getDirectory must fail.
                reject(FileError.NOT_FOUND_ERR);
            }
            else if (!options.create && exists && stats.isFile())
            {
                // If create is not true and the path exists, but is a file, getDirectory
                // must fail.
                reject(FileError.TYPE_MISMATCH_ERR);
            }
            else
            {
                // Otherwise, if no other error occurs, getDirectory must return a
                // DirectoryEntry corresponding to path.
                resolve(entry.getInfo(false));
            }
        });
    });
}
