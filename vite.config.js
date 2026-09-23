var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
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
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";
// Server-side proxy for the Issue Tracker AI Assistant. The browser posts to
// `/api/ai/chat` on the Vite dev server; this middleware forwards to the
// upstream gateway at `${AI_GATEWAY_URL}/v1/messages`, attaching the bearer
// token from server-side env vars. The token is intentionally NEVER prefixed
// with `VITE_` so it cannot be imported by the client bundle — only the Vite
// Node process reads it.
//
// Falls back to the `ANTHROPIC_*` aliases (`ANTHROPIC_BASE_URL`,
// `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`) when the canonical names are
// unset, so `setx ANTHROPIC_AUTH_TOKEN "..."` on Windows Just Works.
//
// `env` is the loadEnv() record built in defineConfig — it merges .env file
// values with the shell's process.env (process.env wins), so the server
// picks up AI_GATEWAY_MODEL etc. from .env without the shell exporting them.
// Without this, a dev server started from a shell without these vars fell
// back to the default model and the gateway routed it to the wrong
// (quota-exhausted) model group.
function aiChatProxy(env) {
    var _a, _b, _c, _d, _e, _f;
    var gatewayUrl = (_b = (_a = env.AI_GATEWAY_URL) !== null && _a !== void 0 ? _a : env.ANTHROPIC_BASE_URL) !== null && _b !== void 0 ? _b : "";
    var token = (_d = (_c = env.AI_GATEWAY_TOKEN) !== null && _c !== void 0 ? _c : env.ANTHROPIC_AUTH_TOKEN) !== null && _d !== void 0 ? _d : "";
    var model = (_f = (_e = env.AI_GATEWAY_MODEL) !== null && _e !== void 0 ? _e : env.ANTHROPIC_MODEL) !== null && _f !== void 0 ? _f : "claude-sonnet-4-5";
    return {
        name: "feature-tracker:ai-chat-proxy",
        apply: "serve",
        configureServer: function (server) {
            var _this = this;
            server.middlewares.use("/api/ai/chat", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var chunks, chunk, e_1_1, raw, parsed, userText, systemPrompt, tools, history_1, upstreamUrl, upstream, upstreamText, err_1;
                var _a, req_1, req_1_1;
                var _b, e_1, _c, _d;
                var _e;
                return __generator(this, function (_f) {
                    switch (_f.label) {
                        case 0:
                            if (req.method !== "POST") {
                                res.statusCode = 405;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({ error: "method_not_allowed" }));
                                return [2 /*return*/];
                            }
                            if (!gatewayUrl || !token) {
                                res.statusCode = 503;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "ai_not_configured",
                                    message: "AI_GATEWAY_URL (or ANTHROPIC_BASE_URL) and AI_GATEWAY_TOKEN (or ANTHROPIC_AUTH_TOKEN) must be set on the Vite server process.",
                                }));
                                return [2 /*return*/];
                            }
                            _f.label = 1;
                        case 1:
                            _f.trys.push([1, 16, , 17]);
                            chunks = [];
                            _f.label = 2;
                        case 2:
                            _f.trys.push([2, 7, 8, 13]);
                            _a = true, req_1 = __asyncValues(req);
                            _f.label = 3;
                        case 3: return [4 /*yield*/, req_1.next()];
                        case 4:
                            if (!(req_1_1 = _f.sent(), _b = req_1_1.done, !_b)) return [3 /*break*/, 6];
                            _d = req_1_1.value;
                            _a = false;
                            chunk = _d;
                            chunks.push(chunk);
                            _f.label = 5;
                        case 5:
                            _a = true;
                            return [3 /*break*/, 3];
                        case 6: return [3 /*break*/, 13];
                        case 7:
                            e_1_1 = _f.sent();
                            e_1 = { error: e_1_1 };
                            return [3 /*break*/, 13];
                        case 8:
                            _f.trys.push([8, , 11, 12]);
                            if (!(!_a && !_b && (_c = req_1.return))) return [3 /*break*/, 10];
                            return [4 /*yield*/, _c.call(req_1)];
                        case 9:
                            _f.sent();
                            _f.label = 10;
                        case 10: return [3 /*break*/, 12];
                        case 11:
                            if (e_1) throw e_1.error;
                            return [7 /*endfinally*/];
                        case 12: return [7 /*endfinally*/];
                        case 13:
                            raw = Buffer.concat(chunks).toString("utf8");
                            parsed = raw ? JSON.parse(raw) : {};
                            userText = typeof (parsed === null || parsed === void 0 ? void 0 : parsed.text) === "string" ? parsed.text : "";
                            systemPrompt = typeof (parsed === null || parsed === void 0 ? void 0 : parsed.system) === "string"
                                ? parsed.system
                                : "You are the AI Assistant inside an Issue Tracker. Help the user understand their verification runs, issues, and configuration. Be concise. Two URL-handling paths exist: (1) if the user names a URL that is NOT in their configured targets and wants it VERIFIED (checks run, issues recorded), call verify_live_url; (2) if the user wants to SEE or INTERACT with a page live (open, show, click, snapshot, screenshot, inspect), call the browser_* tools — they drive a real headed Playwright browser through the official Playwright MCP server, and their results include element refs you can click next turn. When the user mentions Playwright explicitly, always prefer the browser_* tools.";
                            tools = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.tools)
                                ? parsed.tools
                                : undefined;
                            history_1 = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.history)
                                ? parsed.history
                                    .filter(function (m) {
                                    return !!m &&
                                        (m.role === "user" || m.role === "assistant") &&
                                        typeof m.content === "string" &&
                                        m.content.trim() !== "";
                                })
                                    .slice(-8)
                                    .map(function (m) { return ({
                                    role: m.role,
                                    content: m.content.slice(0, 2000),
                                }); })
                                : [];
                            upstreamUrl = gatewayUrl.replace(/\/+$/, "") + "/v1/messages";
                            return [4 /*yield*/, fetch(upstreamUrl, {
                                    method: "POST",
                                    headers: {
                                        "content-type": "application/json",
                                        authorization: "Bearer ".concat(token),
                                        "anthropic-version": "2023-06-01",
                                    },
                                    body: JSON.stringify(__assign({ model: model,
                                        // 4096 — agentic browser walkthroughs end with a long
                                        // evidence report (findings tables + next-step narration),
                                        // which overflowed the older 2048 cap mid-sentence.
                                        max_tokens: 4096, system: systemPrompt, messages: __spreadArray(__spreadArray([], history_1, true), [{ role: "user", content: userText }], false) }, (tools ? { tools: tools } : {}))),
                                })];
                        case 14:
                            upstream = _f.sent();
                            return [4 /*yield*/, upstream.text()];
                        case 15:
                            upstreamText = _f.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_e = upstream.headers.get("content-type")) !== null && _e !== void 0 ? _e : "application/json");
                            res.end(upstreamText);
                            return [3 /*break*/, 17];
                        case 16:
                            err_1 = _f.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_1 instanceof Error ? err_1.message : String(err_1),
                            }));
                            return [3 /*break*/, 17];
                        case 17: return [2 /*return*/];
                    }
                });
            }); });
        },
    };
}
// Server-side proxy for the Issue Tracker verification endpoints (MCP).
// Same shape as aiChatProxy: when VERIFY_BACKEND_URL is unset the proxy
// returns 503, and the client falls back to the in-browser mock so the UI
// keeps working in dev without a backend running. Today's flow (Test
// Connection against a fake URL) is fully preserved when
// `VITE_USE_REAL_VERIFY` is unset on the client.
function verifyProxy(env) {
    // Default to the local MCP server (mcp-server/ sub-folder). When the
    // env var is set to an empty string explicitly, the proxy keeps the
    // previous in-process stub behaviour (503). Set it to any other URL
    // to forward to that backend. `env` comes from loadEnv() so a value
    // in .env works without the shell exporting it.
    var backendUrl = (env.VERIFY_BACKEND_URL !== undefined
        ? env.VERIFY_BACKEND_URL
        : "http://localhost:8787").replace(/\/+$/, "");
    return {
        name: "feature-tracker:verify-proxy",
        apply: "serve",
        configureServer: function (server) {
            var _this = this;
            var notConfigured = function (res) {
                res.statusCode = 503;
                res.setHeader("content-type", "application/json");
                res.end(JSON.stringify({
                    error: "verify_not_configured",
                    message: "VERIFY_BACKEND_URL is not set on the Vite server. Set it (and VITE_USE_REAL_VERIFY=1 on the client) to enable real verification.",
                }));
            };
            // POST /api/verify/test — single-target probe. The backend is expected
            // to do a headless HTTP check (and, when a credential is bound, a
            // login attempt) and return { urlReachable, loginSuccessful }.
            server.middlewares.use("/api/verify/test", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var chunks, chunk, e_2_1, raw, upstream, text, err_2;
                var _a, req_2, req_2_1;
                var _b, e_2, _c, _d;
                var _e;
                return __generator(this, function (_f) {
                    switch (_f.label) {
                        case 0:
                            if (req.method !== "POST") {
                                res.statusCode = 405;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({ error: "method_not_allowed" }));
                                return [2 /*return*/];
                            }
                            if (!backendUrl) {
                                notConfigured(res);
                                return [2 /*return*/];
                            }
                            _f.label = 1;
                        case 1:
                            _f.trys.push([1, 16, , 17]);
                            chunks = [];
                            _f.label = 2;
                        case 2:
                            _f.trys.push([2, 7, 8, 13]);
                            _a = true, req_2 = __asyncValues(req);
                            _f.label = 3;
                        case 3: return [4 /*yield*/, req_2.next()];
                        case 4:
                            if (!(req_2_1 = _f.sent(), _b = req_2_1.done, !_b)) return [3 /*break*/, 6];
                            _d = req_2_1.value;
                            _a = false;
                            chunk = _d;
                            chunks.push(chunk);
                            _f.label = 5;
                        case 5:
                            _a = true;
                            return [3 /*break*/, 3];
                        case 6: return [3 /*break*/, 13];
                        case 7:
                            e_2_1 = _f.sent();
                            e_2 = { error: e_2_1 };
                            return [3 /*break*/, 13];
                        case 8:
                            _f.trys.push([8, , 11, 12]);
                            if (!(!_a && !_b && (_c = req_2.return))) return [3 /*break*/, 10];
                            return [4 /*yield*/, _c.call(req_2)];
                        case 9:
                            _f.sent();
                            _f.label = 10;
                        case 10: return [3 /*break*/, 12];
                        case 11:
                            if (e_2) throw e_2.error;
                            return [7 /*endfinally*/];
                        case 12: return [7 /*endfinally*/];
                        case 13:
                            raw = Buffer.concat(chunks).toString("utf8");
                            return [4 /*yield*/, fetch("".concat(backendUrl, "/verify/test"), {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: raw,
                                })];
                        case 14:
                            upstream = _f.sent();
                            return [4 /*yield*/, upstream.text()];
                        case 15:
                            text = _f.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_e = upstream.headers.get("content-type")) !== null && _e !== void 0 ? _e : "application/json");
                            res.end(text);
                            return [3 /*break*/, 17];
                        case 16:
                            err_2 = _f.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_2 instanceof Error ? err_2.message : String(err_2),
                            }));
                            return [3 /*break*/, 17];
                        case 17: return [2 /*return*/];
                    }
                });
            }); });
            // POST /api/verify/runs and GET /api/verify/runs/:id/events — the
            // run lifecycle. The stub backend (when VERIFY_BACKEND_URL is unset)
            // returns a fake run id and emits a single run_completed SSE event
            // 5s later, just enough to prove the wire-up works. Real progress
            // emissions land in MCP step 5.
            //
            // Note on Connect middleware prefix matching: `/api/verify/runs`
            // matches BOTH the bare path AND `/api/verify/runs/<id>/events`.
            // When the prefix matches a sub-path, we call `next()` so the
            // trailing-slash handler below can take over. Without this the
            // GET SSE stream would hit the bare handler's 405 fallback.
            server.middlewares.use("/api/verify/runs", function (req, res, next) { return __awaiter(_this, void 0, void 0, function () {
                var url, runId, chunks, chunk, e_3_1, raw, upstream, text, err_3;
                var _a, req_3, req_3_1;
                var _b, e_3, _c, _d;
                var _e, _f;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            url = (_e = req.url) !== null && _e !== void 0 ? _e : "/";
                            if (url !== "/" && url !== "") {
                                return [2 /*return*/, next === null || next === void 0 ? void 0 : next()];
                            }
                            if (!(req.method === "POST")) return [3 /*break*/, 18];
                            if (!backendUrl) {
                                runId = "run-".concat(Math.random().toString(36).slice(2, 10));
                                res.statusCode = 200;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    id: runId,
                                    status: "running",
                                    totalTargets: 0,
                                    completedTargets: 0,
                                    failedTargets: 0,
                                    startedAt: new Date().toISOString(),
                                    perApp: [],
                                    currentActivity: [],
                                    scope: [],
                                }));
                                return [2 /*return*/];
                            }
                            _g.label = 1;
                        case 1:
                            _g.trys.push([1, 16, , 17]);
                            chunks = [];
                            _g.label = 2;
                        case 2:
                            _g.trys.push([2, 7, 8, 13]);
                            _a = true, req_3 = __asyncValues(req);
                            _g.label = 3;
                        case 3: return [4 /*yield*/, req_3.next()];
                        case 4:
                            if (!(req_3_1 = _g.sent(), _b = req_3_1.done, !_b)) return [3 /*break*/, 6];
                            _d = req_3_1.value;
                            _a = false;
                            chunk = _d;
                            chunks.push(chunk);
                            _g.label = 5;
                        case 5:
                            _a = true;
                            return [3 /*break*/, 3];
                        case 6: return [3 /*break*/, 13];
                        case 7:
                            e_3_1 = _g.sent();
                            e_3 = { error: e_3_1 };
                            return [3 /*break*/, 13];
                        case 8:
                            _g.trys.push([8, , 11, 12]);
                            if (!(!_a && !_b && (_c = req_3.return))) return [3 /*break*/, 10];
                            return [4 /*yield*/, _c.call(req_3)];
                        case 9:
                            _g.sent();
                            _g.label = 10;
                        case 10: return [3 /*break*/, 12];
                        case 11:
                            if (e_3) throw e_3.error;
                            return [7 /*endfinally*/];
                        case 12: return [7 /*endfinally*/];
                        case 13:
                            raw = Buffer.concat(chunks).toString("utf8");
                            return [4 /*yield*/, fetch("".concat(backendUrl, "/verify/runs"), {
                                    method: "POST",
                                    headers: { "content-type": "application/json" },
                                    body: raw,
                                })];
                        case 14:
                            upstream = _g.sent();
                            return [4 /*yield*/, upstream.text()];
                        case 15:
                            text = _g.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_f = upstream.headers.get("content-type")) !== null && _f !== void 0 ? _f : "application/json");
                            res.end(text);
                            return [3 /*break*/, 17];
                        case 16:
                            err_3 = _g.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_3 instanceof Error ? err_3.message : String(err_3),
                            }));
                            return [3 /*break*/, 17];
                        case 17: return [2 /*return*/];
                        case 18:
                            res.statusCode = 405;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({ error: "method_not_allowed" }));
                            return [2 /*return*/];
                    }
                });
            }); });
            // GET /api/verify/runs/:id/events — Server-Sent Events stream.
            // Stub behaviour (no backend): write the standard SSE preamble,
            // schedule a run_completed event 5s later, then close. Real
            // behaviour: pipe the upstream SSE response straight through.
            //
            // The in-app preview overlay was removed — the headed Playwright
            // browser window is the only preview surface, so there is no
            // `/interact` forwarding endpoint any more.
            server.middlewares.use("/api/verify/runs/", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var pathAfterPrefix, runId, writeEvent_1, timer_1, upstream, reader_1, pump, err_4;
                var _this = this;
                var _a, _b, _c, _d;
                return __generator(this, function (_e) {
                    switch (_e.label) {
                        case 0:
                            pathAfterPrefix = (_b = ((_a = req.url) !== null && _a !== void 0 ? _a : "/").split("?")[0]) !== null && _b !== void 0 ? _b : "/";
                            if (req.method !== "GET" || !pathAfterPrefix.includes("/events")) {
                                res.statusCode = 404;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({ error: "not_found" }));
                                return [2 /*return*/];
                            }
                            runId = decodeURIComponent(pathAfterPrefix.replace(/^\//, "").replace(/\/events$/, ""));
                            if (!backendUrl) {
                                // Stub SSE: declare the stream, then emit one event after a
                                // delay. EventSource on the client side auto-reconnects on
                                // drop, so closing the connection is the cleanest signal that
                                // the run finished.
                                res.statusCode = 200;
                                res.setHeader("content-type", "text/event-stream");
                                res.setHeader("cache-control", "no-cache");
                                res.setHeader("connection", "keep-alive");
                                res.setHeader("x-accel-buffering", "no");
                                (_c = res.flushHeaders) === null || _c === void 0 ? void 0 : _c.call(res);
                                writeEvent_1 = function (event) {
                                    res.write("data: ".concat(JSON.stringify(event), "\n\n"));
                                };
                                // Greet with a target_started so the client has something to
                                // react to before the 5s elapse. Step 5 will replace this with
                                // real per-target progress.
                                writeEvent_1({
                                    kind: "target_started",
                                    runId: runId,
                                    targetId: "stub",
                                    applicationName: "stub target",
                                });
                                timer_1 = setTimeout(function () {
                                    writeEvent_1({
                                        kind: "run_completed",
                                        runId: runId,
                                        completedAt: new Date().toISOString(),
                                        failedTargets: 0,
                                    });
                                    res.end();
                                }, 5000);
                                req.on("close", function () { return clearTimeout(timer_1); });
                                return [2 /*return*/];
                            }
                            _e.label = 1;
                        case 1:
                            _e.trys.push([1, 3, , 4]);
                            return [4 /*yield*/, fetch("".concat(backendUrl, "/verify/runs/").concat(encodeURIComponent(runId), "/events"), { headers: { accept: "text/event-stream" } })];
                        case 2:
                            upstream = _e.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_d = upstream.headers.get("content-type")) !== null && _d !== void 0 ? _d : "text/event-stream");
                            res.setHeader("cache-control", "no-cache");
                            res.setHeader("connection", "keep-alive");
                            if (upstream.body) {
                                reader_1 = upstream.body.getReader();
                                pump = function () { return __awaiter(_this, void 0, void 0, function () {
                                    var _a, done, value, _b;
                                    return __generator(this, function (_c) {
                                        switch (_c.label) {
                                            case 0:
                                                _c.trys.push([0, 4, , 5]);
                                                _c.label = 1;
                                            case 1:
                                                if (!true) return [3 /*break*/, 3];
                                                return [4 /*yield*/, reader_1.read()];
                                            case 2:
                                                _a = _c.sent(), done = _a.done, value = _a.value;
                                                if (done)
                                                    return [3 /*break*/, 3];
                                                res.write(Buffer.from(value));
                                                return [3 /*break*/, 1];
                                            case 3:
                                                res.end();
                                                return [3 /*break*/, 5];
                                            case 4:
                                                _b = _c.sent();
                                                res.end();
                                                return [3 /*break*/, 5];
                                            case 5: return [2 /*return*/];
                                        }
                                    });
                                }); };
                                pump();
                            }
                            else {
                                res.end();
                            }
                            return [3 /*break*/, 4];
                        case 3:
                            err_4 = _e.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_4 instanceof Error ? err_4.message : String(err_4),
                            }));
                            return [3 /*break*/, 4];
                        case 4: return [2 /*return*/];
                    }
                });
            }); });
            // ──────────────────────────────────────────────────────────────────
            //  POST/GET/DELETE /api/secrets — credential storage round-trip
            //  (MCP step 6). Real backend will encrypt at rest; the proxy
            //  itself masks the password before responding so the wire shape
            //  matches and so a misconfigured backend can never leak plaintext
            //  into the browser bundle. Without a backend the proxy responds
            //  503 (matches the other /api/verify/* endpoints) and the client
            //  falls back to its in-browser mock.
            // ──────────────────────────────────────────────────────────────────
            var maskSecret = function (pw) {
                return "•".repeat(Math.min(12, Math.max(6, pw.length)));
            };
            // ──────────────────────────────────────────────────────────────────
            //  GET/POST /api/evidence — artifact storage (MCP step 7). The
            //  browser resolves `Evidence.storageRef` via `/api/evidence/:ref`,
            //  which the proxy forwards. The GET response is streamed raw so
            //  the original content-type (image/png, text/plain) reaches the
            //  <img> tag without being re-encoded as JSON.
            // ──────────────────────────────────────────────────────────────────
            server.middlewares.use("/api/evidence", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var upstreamPath, upstream, _a, _b, _c, ct, cc, buf, _d, _e, err_5;
                var _f;
                var _g;
                return __generator(this, function (_h) {
                    switch (_h.label) {
                        case 0:
                            if (!backendUrl) {
                                res.statusCode = 503;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "verify_not_configured",
                                    message: "VERIFY_BACKEND_URL is not set on the Vite server. Evidence streaming is unavailable.",
                                }));
                                return [2 /*return*/];
                            }
                            _h.label = 1;
                        case 1:
                            _h.trys.push([1, 7, , 8]);
                            upstreamPath = ((_g = req.url) !== null && _g !== void 0 ? _g : "/").replace(/^\/api/, "");
                            _a = fetch;
                            _b = ["".concat(backendUrl).concat(upstreamPath)];
                            _f = {
                                method: req.method,
                                headers: { "content-type": "application/json" }
                            };
                            if (!(req.method === "POST")) return [3 /*break*/, 3];
                            return [4 /*yield*/, readBody(req)];
                        case 2:
                            _c = _h.sent();
                            return [3 /*break*/, 4];
                        case 3:
                            _c = undefined;
                            _h.label = 4;
                        case 4: return [4 /*yield*/, _a.apply(void 0, _b.concat([(_f.body = _c,
                                    _f)]))];
                        case 5:
                            upstream = _h.sent();
                            // Stream the response so the browser sees the real
                            // content-type. Don't try to JSON-parse — screenshots are
                            // binary and would corrupt on the round trip.
                            res.statusCode = upstream.status;
                            ct = upstream.headers.get("content-type");
                            if (ct)
                                res.setHeader("content-type", ct);
                            cc = upstream.headers.get("cache-control");
                            if (cc)
                                res.setHeader("cache-control", cc);
                            _e = (_d = Buffer).from;
                            return [4 /*yield*/, upstream.arrayBuffer()];
                        case 6:
                            buf = _e.apply(_d, [_h.sent()]);
                            res.end(buf);
                            return [3 /*break*/, 8];
                        case 7:
                            err_5 = _h.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_5 instanceof Error ? err_5.message : String(err_5),
                            }));
                            return [3 /*break*/, 8];
                        case 8: return [2 /*return*/];
                    }
                });
            }); });
            // ──────────────────────────────────────────────────────────────────
            //  /api/playwright — bridge to the OFFICIAL Playwright MCP server.
            //  GET  /api/playwright/tools → tool catalog (spawned via the
            //                             mcp-server backend on :8787)
            //  POST /api/playwright/call  → forward one browser tool call.
            //  The catalog is read live from `npx @playwright/mcp@latest`, so
            //  the chatbot's browser tools always match the official server.
            // ──────────────────────────────────────────────────────────────────
            server.middlewares.use("/api/playwright", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var upstreamPath, upstream, _a, _b, _c, _d, _e, err_6;
                var _f;
                var _g, _h;
                return __generator(this, function (_j) {
                    switch (_j.label) {
                        case 0:
                            if (!backendUrl) {
                                res.statusCode = 503;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "verify_not_configured",
                                    message: "VERIFY_BACKEND_URL is not set — the Playwright MCP bridge is unavailable.",
                                }));
                                return [2 /*return*/];
                            }
                            _j.label = 1;
                        case 1:
                            _j.trys.push([1, 7, , 8]);
                            upstreamPath = ((_g = req.url) !== null && _g !== void 0 ? _g : "/").replace(/^\/api/, "");
                            _a = fetch;
                            _b = ["".concat(backendUrl, "/playwright").concat(upstreamPath)];
                            _f = {
                                method: req.method,
                                headers: { "content-type": "application/json" }
                            };
                            if (!(req.method === "POST")) return [3 /*break*/, 3];
                            return [4 /*yield*/, readBody(req)];
                        case 2:
                            _c = _j.sent();
                            return [3 /*break*/, 4];
                        case 3:
                            _c = undefined;
                            _j.label = 4;
                        case 4: return [4 /*yield*/, _a.apply(void 0, _b.concat([(_f.body = _c,
                                    _f)]))];
                        case 5:
                            upstream = _j.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_h = upstream.headers.get("content-type")) !== null && _h !== void 0 ? _h : "application/json");
                            _e = (_d = res).end;
                            return [4 /*yield*/, upstream.text()];
                        case 6:
                            _e.apply(_d, [_j.sent()]);
                            return [3 /*break*/, 8];
                        case 7:
                            err_6 = _j.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_6 instanceof Error ? err_6.message : String(err_6),
                            }));
                            return [3 /*break*/, 8];
                        case 8: return [2 /*return*/];
                    }
                });
            }); });
            server.middlewares.use("/api/secrets", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var isDelete, targetPath, upstream, _a, _b, _c, raw, parsed, stripPassword, _i, _d, s, text, err_7;
                var _e;
                var _f, _g, _h;
                return __generator(this, function (_j) {
                    switch (_j.label) {
                        case 0:
                            if (!backendUrl) {
                                res.statusCode = 503;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "verify_not_configured",
                                    message: "VERIFY_BACKEND_URL is not set on the Vite server. Real secret storage is unavailable.",
                                }));
                                return [2 /*return*/];
                            }
                            _j.label = 1;
                        case 1:
                            _j.trys.push([1, 9, , 10]);
                            isDelete = req.method === "DELETE";
                            targetPath = isDelete && req.url && req.url !== "/"
                                ? "/secrets".concat(req.url)
                                : "/secrets";
                            _a = fetch;
                            _b = ["".concat(backendUrl).concat(targetPath)];
                            _e = {
                                method: req.method,
                                headers: { "content-type": "application/json" }
                            };
                            if (!["POST", "PUT", "PATCH"].includes((_f = req.method) !== null && _f !== void 0 ? _f : "")) return [3 /*break*/, 3];
                            return [4 /*yield*/, readBody(req)];
                        case 2:
                            _c = _j.sent();
                            return [3 /*break*/, 4];
                        case 3:
                            _c = undefined;
                            _j.label = 4;
                        case 4: return [4 /*yield*/, _a.apply(void 0, _b.concat([(_e.body = _c,
                                    _e)]))];
                        case 5:
                            upstream = _j.sent();
                            if (!((req.method === "GET" || req.method === "POST") && upstream.ok)) return [3 /*break*/, 7];
                            return [4 /*yield*/, upstream.text()];
                        case 6:
                            raw = _j.sent();
                            parsed = void 0;
                            try {
                                parsed = JSON.parse(raw);
                            }
                            catch (_k) {
                                parsed = null;
                            }
                            stripPassword = function (s) {
                                if (typeof s.password === "string") {
                                    s.passwordMasked = maskSecret(s.password);
                                    delete s.password;
                                }
                            };
                            if (Array.isArray(parsed)) {
                                for (_i = 0, _d = parsed; _i < _d.length; _i++) {
                                    s = _d[_i];
                                    stripPassword(s);
                                }
                            }
                            else if (parsed &&
                                typeof parsed === "object" &&
                                "password" in parsed) {
                                stripPassword(parsed);
                            }
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_g = upstream.headers.get("content-type")) !== null && _g !== void 0 ? _g : "application/json");
                            res.end(JSON.stringify(parsed));
                            return [2 /*return*/];
                        case 7: return [4 /*yield*/, upstream.text()];
                        case 8:
                            text = _j.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_h = upstream.headers.get("content-type")) !== null && _h !== void 0 ? _h : "application/json");
                            res.end(text);
                            return [3 /*break*/, 10];
                        case 9:
                            err_7 = _j.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_7 instanceof Error ? err_7.message : String(err_7),
                            }));
                            return [3 /*break*/, 10];
                        case 10: return [2 /*return*/];
                    }
                });
            }); });
        },
    };
}
// Read request body as a string — used by the secrets proxy when
// forwarding POST/PUT/PATCH so the upstream sees the original payload.
function readBody(req) {
    return new Promise(function (resolve) {
        var chunks = [];
        req.on("data", function (c) { return chunks.push(c); });
        req.on("end", function () { return resolve(Buffer.concat(chunks).toString("utf8")); });
        req.on("error", function () { return resolve(""); });
    });
}
export default defineConfig(function (_a) {
    var mode = _a.mode;
    // Load .env (all vars, not just VITE_* — the prefixes arg "" disables
    // prefix filtering) merged with process.env (process.env wins), so the
    // proxy plugins below see AI_GATEWAY_* / VERIFY_BACKEND_URL from .env
    // without the shell exporting them. Server-side secrets like
    // AI_GATEWAY_TOKEN still never reach the client bundle — they're only
    // read here in config-land; VITE_* exposure rules are unchanged.
    var env = loadEnv(mode, process.cwd(), "");
    return {
        plugins: [
            react(),
            aiChatProxy(env),
            verifyProxy(env),
            customUrlBanner("https://dbeegi.slsblx.com:5173/projects"),
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
        server: {
            port: 5173,
            strictPort: true,
            // Bind to the registered Blocks dev domain (not `host: true`) so
            // Vite's banner prints https://dbeegi.slsblx.com:5173/ and the OIDC
            // session cookie IAM sets on /login/callback lands on the same host
            // that initiated the redirect. `localhost` (which resolves to a
            // different cookie origin) is no longer served, intentionally.
            host: "dbeegi.slsblx.com",
            // Without `allowedHosts`, Vite's DNS-rebinding guard 404s requests to
            // hosts other than localhost with "Blocked request. This host is not
            // allowed." — fatal when serving on a custom Blocks dev domain.
            allowedHosts: ["dbeegi.slsblx.com", "localhost"],
            https: {
                // mkcert-generated: SAN covers dbeegi.slsblx.com, localhost, 127.0.0.1
                // (CA is already trusted on this machine — see `mkcert -install`).
                key: fs.readFileSync(path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2-key.pem")),
                cert: fs.readFileSync(path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2.pem")),
            },
        },
    };
});
// Vite's banner always prints `https://localhost:5173/` because it
// detects the loopback bind. Since we run on the registered Blocks
// dev domain (so OIDC cookies scope correctly), print the canonical
// custom-URL line right after Vite's banner so the operator sees it
// in the same color block — no one has to remember to substitute.
function customUrlBanner(customUrl) {
    return {
        name: "feature-tracker:custom-url-banner",
        apply: "serve",
        configureServer: function (server) {
            // Vite prints `➜  Local: ...` from `printUrls()`, which fires
            // once after the server starts listening. We can't reliably
            // attach an extra `listening` listener before then because
            // `server.httpServer` may not exist yet at the moment this hook
            // runs. Monkey-patch `printUrls` instead — it's a guaranteed
            // synchronous seam that runs exactly once per `vite` invocation,
            // right after the server is up. Wrap the original so our
            // `Custom:` line appears immediately below Vite's own banner.
            var dim = function (s) { return "\u001B[2m".concat(s, "\u001B[22m"); };
            var bold = function (s) { return "\u001B[1m".concat(s, "\u001B[22m"); };
            var cyan = function (s) { return "\u001B[36m".concat(s, "\u001B[39m"); };
            var customLine = "  ".concat(dim("➜"), "  ").concat(bold("Custom:"), "  ").concat(cyan(customUrl), "/");
            var printUrlsFn = server.printUrls;
            if (typeof printUrlsFn !== "function")
                return;
            var originalPrintUrls = printUrlsFn.bind(server);
            server.printUrls =
                function patchedPrintUrls() {
                    originalPrintUrls();
                    // eslint-disable-next-line no-console
                    console.log(customLine);
                };
        },
    };
}
