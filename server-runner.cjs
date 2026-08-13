const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const sourcePath = path.join(__dirname, "server.js");
const source = fs.readFileSync(sourcePath, "utf8");
const serverModule = new Module(sourcePath, module);
serverModule.filename = sourcePath;
serverModule.paths = Module._nodeModulePaths(__dirname);
serverModule._compile(source, sourcePath);
serverModule.exports.startServer();
