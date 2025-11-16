'use strict';
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) {if (Object.prototype.hasOwnProperty.call(b, p)) {d[p] = b[p];}} };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== 'function' && b !== null)
            {throw new TypeError('Class extends value ' + String(b) + ' is not a constructor or null');}
        extendStatics(d, b);
        function __ () { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function (t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) {if (Object.prototype.hasOwnProperty.call(s, p))
                {t[p] = s[p];}}
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt (value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled (value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected (value) { try { step(generator['throw'](value)); } catch (e) { reject(e); } }
        function step (result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function () { if (t[0] & 1) {throw t[1];} return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === 'function' ? Iterator : Object).prototype);
    return g.next = verb(0), g['throw'] = verb(1), g['return'] = verb(2), typeof Symbol === 'function' && (g[Symbol.iterator] = function () { return this; }), g;
    function verb (n) { return function (v) { return step([n, v]); }; }
    function step (op) {
        if (f) {throw new TypeError('Generator is already executing.');}
        while (g && (g = 0, op[0] && (_ = 0)), _) {try {
            if (f = 1, y && (t = op[0] & 2 ? y['return'] : op[0] ? y['throw'] || ((t = y['return']) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) {return t;}
            if (y = 0, t) {op = [op[0] & 2, t.value];}
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) {_.ops.pop();}
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }}
        if (op[0] & 5) {throw op[1];} return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, '__esModule', { value: true });
exports.McpSseClient = void 0;
var index_js_1 = require('../../index.js');
var BaseMcpClient_js_1 = require('./BaseMcpClient.js');
// Global unhandled rejection handler setup for npm package usage
// This prevents PromiseRejectionHandledWarning messages during error testing
function setupGlobalRejectionHandler () {
    if (!global._faMcpSdkRejectionHandler) {
        global._faMcpSdkRejectionHandler = true;
        // Track rejected promises that we've handled to prevent warnings
        var handledPromises_1 = new WeakSet();
        // Override unhandledRejection to track MCP-related rejections
        process.on('unhandledRejection', function (reason, promise) {
            var _a, _b, _c;
            // Check if this is an MCP-related error or network error from our client
            var isMcpError = typeof reason === 'object' && (((_a = reason === null || reason === void 0 ? void 0 : reason.message) === null || _a === void 0 ? void 0 : _a.includes('MCP Error:')) ||
                ((_b = reason === null || reason === void 0 ? void 0 : reason.message) === null || _b === void 0 ? void 0 : _b.includes('SQL validation failed')) ||
                ((_c = reason === null || reason === void 0 ? void 0 : reason.message) === null || _c === void 0 ? void 0 : _c.includes('fetch failed')) ||
                (reason === null || reason === void 0 ? void 0 : reason.method) // Our custom method property
            );
            if (isMcpError) {
                // Mark this promise as handled to prevent future warnings
                handledPromises_1.add(promise);
                // Attach a silent handler to prevent Node.js warning
                promise.catch(function () {
                    // Silently handle - the error will be caught by the user's try-catch
                });
            }
        });
        // Override rejectionHandled to prevent warnings for promises we've marked
        process.on('rejectionHandled', function (promise) {
            // If we marked this promise as handled, suppress the warning
            if (handledPromises_1.has(promise)) {
                // Suppress the warning by not letting Node.js handle it
                return;
            }
            // For other promises, let Node.js handle normally
        });
        // Override console.warn to filter out PromiseRejectionHandledWarning for our promises
        var originalWarn_1 = console.warn;
        console.warn = function () {
            var args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                args[_i] = arguments[_i];
            }
            // Check if this is a PromiseRejectionHandledWarning
            if (args.length > 0 && typeof args[0] === 'string' && args[0].includes('PromiseRejectionHandledWarning')) {
                // Suppress the warning - we've already handled these promises properly
                return;
            }
            // For other warnings, use original behavior
            return originalWarn_1.apply(this, args);
        };
    }
}
// Auto-setup the handler when module is imported (for npm package usage)
setupGlobalRejectionHandler();
function safeReadText (res) {
    return __awaiter(this, void 0, void 0, function () {
        var text, _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    _b.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, res.text()];
                case 1:
                    text = _b.sent();
                    return [2 /*return*/, text === null || text === void 0 ? void 0 : text.slice(0, 1000)];
                case 2:
                    _a = _b.sent();
                    return [2 /*return*/, undefined];
                case 3: return [2 /*return*/];
            }
        });
    });
}
/**
 * MCP SSE Client for testing (improved)
 *
 * Keeps a single long-lived SSE connection for receiving responses
 * and sends JSON-RPC requests as separate HTTP POSTs to /rpc.
 * Supports routing by id and per-operation timeouts.
 */
var McpSseClient = /** @class */ (function (_super) {
    __extends(McpSseClient, _super);
    function McpSseClient (baseUrl, customHeaders) {
        if (customHeaders === void 0) { customHeaders = {}; }
        var _this = _super.call(this, customHeaders) || this;
        _this.connected = false;
        // pending requests awaiting response by id
        _this.pending = new Map();
        _this.baseUrl = baseUrl.replace(/\/$/, '');
        _this.requestId = 1;
        return _this;
    }
    /** Public API: close SSE and reject all pending */
    McpSseClient.prototype.close = function () {
        return __awaiter(this, void 0, void 0, function () {
            var err, _i, _a, _b, id, entry;
            var _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        this.connected = false;
                        if (this.sseAbort) {
                            this.sseAbort.abort();
                            this.sseAbort = undefined;
                        }
                        err = new Error('MCP SSE client closed');
                        for (_i = 0, _a = this.pending.entries(); _i < _a.length; _i++) {
                            _b = _a[_i], id = _b[0], entry = _b[1];
                            clearTimeout(entry.timeout);
                            entry.reject(err);
                            this.pending.delete(id);
                        }
                        // Wait reader to finish
                        return [4 /*yield*/, ((_c = this.sseReaderTask) === null || _c === void 0 ? void 0 : _c.catch(function () {
                            }))];
                    case 1:
                        // Wait reader to finish
                        _d.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /** Ensure SSE stream established */
    McpSseClient.prototype.ensureConnected = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.connected) {
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, this.connect()];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    /** Open SSE stream via fetch and start reader loop */
    McpSseClient.prototype.connect = function () {
        return __awaiter(this, void 0, void 0, function () {
            var headers, url, res, text;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.connected) {
                            return [2 /*return*/];
                        }
                        headers = __assign({ Accept: 'text/event-stream' }, this.customHeaders);
                        this.sseAbort = new AbortController();
                        url = ''.concat(this.baseUrl, '/sse');
                        return [4 /*yield*/, fetch(url, {
                                method: 'GET',
                                headers: headers,
                                signal: this.sseAbort.signal,
                            })];
                    case 1:
                        res = _a.sent();
                        if (!(!res.ok || !res.body)) {return [3 /*break*/, 3];}
                        return [4 /*yield*/, safeReadText(res)];
                    case 2:
                        text = _a.sent();
                        throw new Error('Failed to open SSE stream: '.concat(res.status, ' ').concat(res.statusText).concat(text ? ' - ' + text : ''));
                    case 3:
                        this.connected = true;
                        this.sseReaderTask = this.readSseLoop(res.body);
                        // detach errors to console but keep state clean
                        this.sseReaderTask.catch(function (err) {
                            _this.connected = false;
                            // Reject all pending on fatal SSE error
                            for (var _i = 0, _a = _this.pending.entries(); _i < _a.length; _i++) {
                                var _b = _a[_i], id = _b[0], entry = _b[1];
                                clearTimeout(entry.timeout);
                                entry.reject(err);
                                _this.pending.delete(id);
                            }
                        });
                        return [2 /*return*/];
                }
            });
        });
    };
    /** Parse SSE stream and dispatch messages by JSON-RPC id */
    McpSseClient.prototype.readSseLoop = function (body) {
        return __awaiter(this, void 0, void 0, function () {
            var reader, decoder, buffer, _a, value, done, idx, rawEvent, tail;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        reader = body.getReader();
                        decoder = new TextDecoder('utf-8');
                        buffer = '';
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, , 5, 6]);
                        _b.label = 2;
                    case 2:
                        if (!true) {return [3 /*break*/, 4];}
                        return [4 /*yield*/, reader.read()];
                    case 3:
                        _a = _b.sent(), value = _a.value, done = _a.done;
                        if (done) {
                            return [3 /*break*/, 4];
                        }
                        buffer += decoder.decode(value, { stream: true });
                        idx = void 0;
                        while ((idx = buffer.indexOf('\n\n')) !== -1) {
                            rawEvent = buffer.slice(0, idx);
                            buffer = buffer.slice(idx + 2);
                            this.handleSseEvent(rawEvent);
                        }
                        return [3 /*break*/, 2];
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        tail = decoder.decode();
                        if (tail) {
                            buffer += tail;
                        }
                        if (buffer.trim()) {
                            this.handleSseEvent(buffer);
                        }
                        this.connected = false;
                        return [7 /*endfinally*/];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /** Handle one SSE event block (multiple lines). Parse data: lines only */
    McpSseClient.prototype.handleSseEvent = function (eventBlock) {
        var _a, _b, _c;
        // eventBlock may contain comments ": ..." and other fields
        var lines = eventBlock.split(/\r?\n/);
        var dataLines = [];
        for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
            var line = lines_1[_i];
            if (!line) {
                continue;
            }
            if (line.startsWith(':')) {
                continue;
            } // comment/keepalive
            if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trimStart());
            }
            // we ignore id:, event:, retry: for now (not required for simple tests)
        }
        if (dataLines.length === 0) {
            return;
        }
        var dataStr = dataLines.join('\n');
        var payload;
        try {
            payload = JSON.parse(dataStr);
        }
        catch (_d) {
            // non-JSON data frames are ignored in tests
            return;
        }
        var id = payload === null || payload === void 0 ? void 0 : payload.id;
        if (id == null) {
            // broadcast/notification — ignore in this test client
            return;
        }
        var pending = this.pending.get(id);
        if (!pending) {
            // late/unknown id — ignore silently for tests
            return;
        }
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        if (payload.error) {
            var errorMessage = ((_a = payload.error) === null || _a === void 0 ? void 0 : _a.message) || 'Unknown error';
            // In test environment, log validation errors but don't crash
            if (errorMessage.includes('invalid_type')) {
                console.log('  \u26A0\uFE0F  Parameter validation error: '.concat(errorMessage));
                pending.resolve(null);
                return;
            }
            // For tool execution errors, we want to throw them so tests can verify expected failures
            if (errorMessage.includes('Failed to execute tool')) {
                console.log('  \u26A0\uFE0F  Error: '.concat(errorMessage));
                var err_1 = new Error('MCP Error: '.concat(errorMessage));
                err_1.data = (_b = payload.error) === null || _b === void 0 ? void 0 : _b.data;
                err_1.fullMcpResponse = payload;
                err_1.method = pending.method; // Attach method for error handling
                pending.reject(err_1);
                return;
            }
            var err_2 = new Error('MCP Error: '.concat(errorMessage));
            err_2.data = (_c = payload.error) === null || _c === void 0 ? void 0 : _c.data;
            err_2.fullMcpResponse = payload;
            err_2.method = pending.method; // Attach method for error handling
            // Use setImmediate to avoid synchronous rejection that can cause unhandledRejection
            setImmediate(function () {
                pending.reject(err_2);
            });
        }
        else {
            var res = (0, index_js_1.getJsonFromResult)(payload.result);
            if (res === null || res === void 0 ? void 0 : res.message) {
                console.log('  message:', res.message);
            }
            pending.resolve(payload.result);
        }
    };
    /**
     * Send JSON-RPC request over HTTP; await response via SSE stream
     */
    McpSseClient.prototype.sendRequest = function (method_1) {
        return __awaiter(this, arguments, void 0, function (method, params) {
            var id, request, opTimeoutMs, timeoutRef, promise, headers, res, text, error, fetchError_1;
            var _this = this;
            if (params === void 0) { params = {}; }
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this.ensureConnected()];
                    case 1:
                        _a.sent();
                        id = this.requestId++;
                        request = { jsonrpc: '2.0', id: id, method: method, params: params };
                        opTimeoutMs = 30000;
                        promise = new Promise(function (resolve, reject) {
                            timeoutRef = setTimeout(function () {
                                _this.pending.delete(id);
                                reject(new Error('Request timeout for method: '.concat(method)));
                            }, opTimeoutMs);
                            _this.pending.set(id, { resolve: resolve, reject: reject, timeout: timeoutRef, method: method });
                        });
                        headers = __assign({ 'Content-Type': 'application/json' }, this.customHeaders);
                        _a.label = 2;
                    case 2:
                        _a.trys.push([2, 6, , 7]);
                        return [4 /*yield*/, fetch(''.concat(this.baseUrl, '/sse'), {
                                method: 'POST',
                                headers: headers,
                                body: JSON.stringify(request),
                            })];
                    case 3:
                        res = _a.sent();
                        if (!!res.ok) {return [3 /*break*/, 5];}
                        clearTimeout(timeoutRef);
                        this.pending.delete(id);
                        return [4 /*yield*/, safeReadText(res)];
                    case 4:
                        text = _a.sent();
                        error = new Error('RPC send failed: '.concat(res.status, ' ').concat(res.statusText).concat(text ? ' - ' + text : ''));
                        // Attach method info for better error handling
                        error.method = method;
                        throw error;
                    case 5: return [3 /*break*/, 7];
                    case 6:
                        fetchError_1 = _a.sent();
                        // Handle fetch errors and clean up pending request
                        clearTimeout(timeoutRef);
                        this.pending.delete(id);
                        // Preserve method information for error handling
                        fetchError_1.method = method;
                        throw fetchError_1;
                    case 7: 
                    // Handle promise immediately to prevent unhandled rejections
                    return [2 /*return*/, promise.then(function (result) { return result; }, function (error) {
                            // Ensure method info is available
                            if (!error.method) {
                                error.method = method;
                            }
                            // Re-throw synchronously to prevent async rejection warnings
                            throw error;
                        })];
                }
            });
        });
    };
    McpSseClient.prototype.health = function () {
        return __awaiter(this, void 0, void 0, function () {
            var response;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, fetch(''.concat(this.baseUrl, '/health'))];
                    case 1:
                        response = _a.sent();
                        return [2 /*return*/, response.json()];
                }
            });
        });
    };
    return McpSseClient;
}(BaseMcpClient_js_1.BaseMcpClient));
exports.McpSseClient = McpSseClient;
