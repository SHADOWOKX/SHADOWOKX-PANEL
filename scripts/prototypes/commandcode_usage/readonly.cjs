'use strict';
// Experimental instrumentation for the reviewed 1.74.0 Node CLI, not an OS sandbox.
// Never record URLs, headers, request bodies, response bodies or exception strings.
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const child = require('node:child_process');
const workers = require('node:worker_threads');
const {syncBuiltinESMExports} = require('node:module');
const report = process.env.COMMANDCODE_PROBE_REPORT;
const counts = {get: 0, blockedWrites: 0, blockedChildren: 0, failedReads: 0, blockedInference: 0};
function save() {
    fs.writeFileSync(report + '.pending', JSON.stringify(counts), {mode: 0o600});
    fs.renameSync(report + '.pending', report);
}
function check(method, input) {
    if (String(method || 'GET').toUpperCase() !== 'GET') {
        counts.blockedWrites++;
        if (/\/(generate|completions|responses|messages|systemone)(?:[/?]|$)/.test(String(input?.url || input || '')))
            counts.blockedInference++;
        save();
        throw new Error('Read-only usage probe blocked a non-GET request');
    }
    counts.get++;
    save();
}
const fetch = globalThis.fetch;
globalThis.fetch = async function(input, options) {
    check(options?.method || input?.method, input);
    try {
        // Prevent a read redirect from escaping this instrumentation unnoticed.
        const response = await fetch.call(this, input, {...options, redirect: 'error'});
        if (!response.ok) { counts.failedReads++; save(); }
        return response;
    } catch (error) { counts.failedReads++; save(); throw error; }
};
const decodeJson = Response.prototype.json;
Response.prototype.json = async function() {
    try { return await decodeJson.call(this); }
    catch (error) { counts.failedReads++; save(); throw error; }
};
for (const module of [http, https]) {
    const request = module.request;
    module.request = function(...args) {
        const options = typeof args[0] === 'object' && !(args[0] instanceof URL) ? args[0] : args[1];
        check(options?.method, args[0]);
        const result = request.apply(this, args);
        result.on('response', response => {
            if (response.statusCode < 200 || response.statusCode >= 300) { counts.failedReads++; save(); }
        });
        result.on('error', () => { counts.failedReads++; save(); });
        return result;
    };
    // Native get() otherwise closes over the original, uninstrumented request().
    module.get = function(...args) { const result = module.request(...args); result.end(); return result; };
}
function blockChild() {
    counts.blockedChildren++;
    save();
    throw new Error('Usage probe does not launch subprocesses or workers');
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) child[name] = blockChild;
workers.Worker = class { constructor() { blockChild(); } };
globalThis.WebSocket = class {
    constructor() { counts.blockedWrites++; save(); throw new Error('Usage probe does not open WebSockets'); }
};
syncBuiltinESMExports();
save();
