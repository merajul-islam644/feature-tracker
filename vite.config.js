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
function createAnthropicChatProvider() {
    return {
        id: "anthropic",
        isConfigured: function (_a) {
            var url = _a.url, token = _a.token;
            return url.length > 0 && token.length > 0;
        },
        notConfiguredMessage: function () {
            return "AI gateway is not configured. Open Settings → AI Gateway and pick a provider, then enter the URL and token.";
        },
        sendChat: function (cfg, body, signal) {
            return __awaiter(this, void 0, void 0, function () {
                var upstream, text;
                return __generator(this, function (_a) {
                    switch (_a.label) {
                        case 0: return [4 /*yield*/, fetch("".concat(cfg.url.replace(/\/+$/, ""), "/v1/messages"), {
                                method: "POST",
                                headers: {
                                    "content-type": "application/json",
                                    authorization: "Bearer ".concat(cfg.token),
                                    "anthropic-version": "2023-06-01",
                                },
                                body: JSON.stringify(body),
                                signal: signal,
                            })];
                        case 1:
                            upstream = _a.sent();
                            if (!!upstream.ok) return [3 /*break*/, 3];
                            return [4 /*yield*/, upstream.text()];
                        case 2:
                            text = _a.sent();
                            throw new Error("upstream_".concat(upstream.status, ": ").concat(text.slice(0, 500)));
                        case 3: return [4 /*yield*/, upstream.json()];
                        case 4: return [2 /*return*/, (_a.sent())];
                    }
                });
            });
        },
    };
}
function createOpenAIChatProvider() {
    return {
        id: "openai",
        isConfigured: function (_a) {
            var url = _a.url, token = _a.token;
            return url.length > 0 && token.length > 0;
        },
        notConfiguredMessage: function () {
            return "OpenAI provider is not configured. Open Settings → AI Gateway, pick OpenAI, and enter the Base URL + API key.";
        },
        sendChat: function (cfg, body, signal) {
            return __awaiter(this, void 0, void 0, function () {
                var openaiMessages, openaiTools, upstream, text_1, json, choice, content, text, _i, _a, tc, input, parsed, stopReason;
                var _b, _c, _d, _e, _f, _g;
                return __generator(this, function (_h) {
                    switch (_h.label) {
                        case 0:
                            openaiMessages = body.system
                                ? __spreadArray([{ role: "system", content: body.system }], body.messages, true) : __spreadArray([], body.messages, true);
                            openaiTools = (_b = body.tools) === null || _b === void 0 ? void 0 : _b.map(function (t) {
                                var _a;
                                return ({
                                    type: "function",
                                    function: {
                                        name: t.name,
                                        description: (_a = t.description) !== null && _a !== void 0 ? _a : "",
                                        parameters: t.input_schema,
                                    },
                                });
                            });
                            return [4 /*yield*/, fetch("".concat(cfg.url.replace(/\/+$/, ""), "/v1/chat/completions"), {
                                    method: "POST",
                                    headers: {
                                        "content-type": "application/json",
                                        authorization: "Bearer ".concat(cfg.token),
                                    },
                                    body: JSON.stringify(__assign({ model: cfg.model, max_tokens: body.max_tokens, messages: openaiMessages }, (openaiTools ? { tools: openaiTools } : {}))),
                                    signal: signal,
                                })];
                        case 1:
                            upstream = _h.sent();
                            if (!!upstream.ok) return [3 /*break*/, 3];
                            return [4 /*yield*/, upstream.text()];
                        case 2:
                            text_1 = _h.sent();
                            throw new Error("upstream_".concat(upstream.status, ": ").concat(text_1.slice(0, 500)));
                        case 3: return [4 /*yield*/, upstream.json()];
                        case 4:
                            json = (_h.sent());
                            choice = (_c = json.choices) === null || _c === void 0 ? void 0 : _c[0];
                            content = [];
                            text = (_d = choice === null || choice === void 0 ? void 0 : choice.message) === null || _d === void 0 ? void 0 : _d.content;
                            if (typeof text === "string" && text.length > 0) {
                                content.push({ type: "text", text: text });
                            }
                            for (_i = 0, _a = (_f = (_e = choice === null || choice === void 0 ? void 0 : choice.message) === null || _e === void 0 ? void 0 : _e.tool_calls) !== null && _f !== void 0 ? _f : []; _i < _a.length; _i++) {
                                tc = _a[_i];
                                input = {};
                                try {
                                    parsed = JSON.parse(tc.function.arguments);
                                    if (parsed && typeof parsed === "object") {
                                        input = parsed;
                                    }
                                }
                                catch (_j) {
                                    input = {};
                                }
                                content.push({
                                    type: "tool_use",
                                    id: tc.id,
                                    name: tc.function.name,
                                    input: input,
                                });
                            }
                            stopReason = (choice === null || choice === void 0 ? void 0 : choice.finish_reason) === "tool_calls"
                                ? "tool_use"
                                : (choice === null || choice === void 0 ? void 0 : choice.finish_reason) === "length"
                                    ? "max_tokens"
                                    : "end_turn";
                            return [2 /*return*/, {
                                    id: "chatcmpl-".concat(Date.now()),
                                    type: "message",
                                    role: "assistant",
                                    model: (_g = json.model) !== null && _g !== void 0 ? _g : cfg.model,
                                    content: content,
                                    stop_reason: stopReason,
                                }];
                    }
                });
            });
        },
    };
}
var CHAT_PROVIDERS = {
    anthropic: createAnthropicChatProvider,
    openai: createOpenAIChatProvider,
};
function getChatProvider(id) {
    var factory = CHAT_PROVIDERS[id];
    if (factory)
        return factory();
    // Unknown / missing → default to anthropic. Matches the migration
    // choice: rows saved before the provider column existed (no header)
    // keep routing through the Anthropic provider until the user opens
    // Settings and picks OpenAI.
    return createAnthropicChatProvider();
}
// Server-side proxy for the Issue Tracker AI Assistant. The browser posts to
// `/api/ai/chat` on the Vite dev server; this middleware reads the
// per-user gateway config off `x-ai-gateway-{url,token,model}` and the
// provider id off `x-ai-chat-provider` (default "anthropic"), then asks
// `getChatProvider(providerId).sendChat(...)` to handle the upstream call
// and return Anthropic-format JSON. The Settings page is the SOLE source
// of truth for these values — see `src/pages/SettingsPage.tsx →
// AiGatewayConfigSection`.
//
// `env` is no longer consulted at runtime (the build-time param is kept
// so the call site stays unchanged). Add a new provider by writing a
// `createXxxChatProvider` factory above and adding it to `CHAT_PROVIDERS`.
function aiChatProxy(_env) {
    // The Settings page is the SOLE source of truth for AI gateway config —
    // there is intentionally no .env fallback. Each user saves their own
    // URL / model / token in Blocks Data; the SPA attaches them as
    // `x-ai-gateway-*` headers on every chat request. If a request arrives
    // without those headers, we 503 with `ai_not_configured` — the chat
    // panel surfaces that as "open Settings and fill in the form".
    return {
        name: "feature-tracker:ai-chat-proxy",
        apply: "serve",
        configureServer: function (server) {
            var _this = this;
            server.middlewares.use("/api/ai/chat", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var headerValue, providerId, cfg, provider, abort, disconnected, chunks, chunk, e_1_1, raw, parsed, userText, systemPrompt, tools, rawToolChoice, toolChoice, history_1, response, err_1;
                var _a, req_1, req_1_1;
                var _b, e_1, _c, _d;
                return __generator(this, function (_e) {
                    switch (_e.label) {
                        case 0:
                            if (req.method !== "POST") {
                                res.statusCode = 405;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({ error: "method_not_allowed" }));
                                return [2 /*return*/];
                            }
                            headerValue = function (name) {
                                var v = req.headers[name];
                                return typeof v === "string" ? v.trim() : "";
                            };
                            providerId = headerValue("x-ai-chat-provider") || "anthropic";
                            cfg = {
                                url: headerValue("x-ai-gateway-url"),
                                token: headerValue("x-ai-gateway-token"),
                                model: headerValue("x-ai-gateway-model") || "claude-sonnet-4-5",
                            };
                            provider = getChatProvider(providerId);
                            if (!provider.isConfigured(cfg)) {
                                res.statusCode = 503;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "ai_not_configured",
                                    message: provider.notConfiguredMessage(),
                                }));
                                return [2 /*return*/];
                            }
                            abort = new AbortController();
                            disconnected = false;
                            req.on("close", function () {
                                disconnected = true;
                                abort.abort();
                            });
                            _e.label = 1;
                        case 1:
                            _e.trys.push([1, 15, , 16]);
                            chunks = [];
                            _e.label = 2;
                        case 2:
                            _e.trys.push([2, 7, 8, 13]);
                            _a = true, req_1 = __asyncValues(req);
                            _e.label = 3;
                        case 3: return [4 /*yield*/, req_1.next()];
                        case 4:
                            if (!(req_1_1 = _e.sent(), _b = req_1_1.done, !_b)) return [3 /*break*/, 6];
                            _d = req_1_1.value;
                            _a = false;
                            chunk = _d;
                            chunks.push(chunk);
                            _e.label = 5;
                        case 5:
                            _a = true;
                            return [3 /*break*/, 3];
                        case 6: return [3 /*break*/, 13];
                        case 7:
                            e_1_1 = _e.sent();
                            e_1 = { error: e_1_1 };
                            return [3 /*break*/, 13];
                        case 8:
                            _e.trys.push([8, , 11, 12]);
                            if (!(!_a && !_b && (_c = req_1.return))) return [3 /*break*/, 10];
                            return [4 /*yield*/, _c.call(req_1)];
                        case 9:
                            _e.sent();
                            _e.label = 10;
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
                            rawToolChoice = parsed === null || parsed === void 0 ? void 0 : parsed.tool_choice;
                            toolChoice = rawToolChoice &&
                                typeof rawToolChoice === "object" &&
                                typeof rawToolChoice.type === "string" &&
                                ["any", "auto", "tool"].includes(rawToolChoice.type)
                                ? rawToolChoice
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
                            return [4 /*yield*/, provider.sendChat(cfg, __assign(__assign({ model: cfg.model, 
                                    // 4096 — agentic browser walkthroughs end with a long
                                    // evidence report (findings tables + next-step narration),
                                    // which overflowed the older 2048 cap mid-sentence.
                                    max_tokens: 4096, system: systemPrompt, messages: __spreadArray(__spreadArray([], history_1, true), [{ role: "user", content: userText }], false) }, (tools ? { tools: tools } : {})), (toolChoice ? { tool_choice: toolChoice } : {})), abort.signal)];
                        case 14:
                            response = _e.sent();
                            if (disconnected || abort.signal.aborted) {
                                // Browser went away mid-call; nothing to send back.
                                res.end();
                                return [2 /*return*/];
                            }
                            res.statusCode = 200;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify(response));
                            return [3 /*break*/, 16];
                        case 15:
                            err_1 = _e.sent();
                            if (disconnected || abort.signal.aborted) {
                                res.end();
                                return [2 /*return*/];
                            }
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_1 instanceof Error ? err_1.message : String(err_1),
                            }));
                            return [3 /*break*/, 16];
                        case 16: return [2 /*return*/];
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
                var pathOnly, qs, runId, chunks, chunk, e_3_1, raw, upstream, text, err_3, upstream, text, err_4;
                var _a, req_3, req_3_1;
                var _b, e_3, _c, _d;
                var _e, _f, _g, _h;
                return __generator(this, function (_j) {
                    switch (_j.label) {
                        case 0:
                            pathOnly = ((_e = req.url) !== null && _e !== void 0 ? _e : "/").split("?")[0];
                            qs = ((_f = req.url) !== null && _f !== void 0 ? _f : "").split("?")[1];
                            if (pathOnly !== "/" && pathOnly !== "") {
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
                            _j.label = 1;
                        case 1:
                            _j.trys.push([1, 16, , 17]);
                            chunks = [];
                            _j.label = 2;
                        case 2:
                            _j.trys.push([2, 7, 8, 13]);
                            _a = true, req_3 = __asyncValues(req);
                            _j.label = 3;
                        case 3: return [4 /*yield*/, req_3.next()];
                        case 4:
                            if (!(req_3_1 = _j.sent(), _b = req_3_1.done, !_b)) return [3 /*break*/, 6];
                            _d = req_3_1.value;
                            _a = false;
                            chunk = _d;
                            chunks.push(chunk);
                            _j.label = 5;
                        case 5:
                            _a = true;
                            return [3 /*break*/, 3];
                        case 6: return [3 /*break*/, 13];
                        case 7:
                            e_3_1 = _j.sent();
                            e_3 = { error: e_3_1 };
                            return [3 /*break*/, 13];
                        case 8:
                            _j.trys.push([8, , 11, 12]);
                            if (!(!_a && !_b && (_c = req_3.return))) return [3 /*break*/, 10];
                            return [4 /*yield*/, _c.call(req_3)];
                        case 9:
                            _j.sent();
                            _j.label = 10;
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
                            upstream = _j.sent();
                            return [4 /*yield*/, upstream.text()];
                        case 15:
                            text = _j.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_g = upstream.headers.get("content-type")) !== null && _g !== void 0 ? _g : "application/json");
                            res.end(text);
                            return [3 /*break*/, 17];
                        case 16:
                            err_3 = _j.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_3 instanceof Error ? err_3.message : String(err_3),
                            }));
                            return [3 /*break*/, 17];
                        case 17: return [2 /*return*/];
                        case 18:
                            if (!(req.method === "GET")) return [3 /*break*/, 24];
                            if (!backendUrl) {
                                notConfigured(res);
                                return [2 /*return*/];
                            }
                            _j.label = 19;
                        case 19:
                            _j.trys.push([19, 22, , 23]);
                            return [4 /*yield*/, fetch("".concat(backendUrl, "/verify/runs").concat(qs ? "?".concat(qs) : ""), { headers: { accept: "application/json" } })];
                        case 20:
                            upstream = _j.sent();
                            return [4 /*yield*/, upstream.text()];
                        case 21:
                            text = _j.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_h = upstream.headers.get("content-type")) !== null && _h !== void 0 ? _h : "application/json");
                            res.end(text);
                            return [3 /*break*/, 23];
                        case 22:
                            err_4 = _j.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_4 instanceof Error ? err_4.message : String(err_4),
                            }));
                            return [3 /*break*/, 23];
                        case 23: return [2 /*return*/];
                        case 24:
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
                var pathAfterPrefix, qs, runId, writeEvent_1, timer_1, upstream, reader_1, pump, err_5;
                var _this = this;
                var _a, _b, _c, _d, _e;
                return __generator(this, function (_f) {
                    switch (_f.label) {
                        case 0:
                            pathAfterPrefix = (_b = ((_a = req.url) !== null && _a !== void 0 ? _a : "/").split("?")[0]) !== null && _b !== void 0 ? _b : "/";
                            qs = ((_c = req.url) !== null && _c !== void 0 ? _c : "").split("?")[1];
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
                                (_d = res.flushHeaders) === null || _d === void 0 ? void 0 : _d.call(res);
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
                            _f.label = 1;
                        case 1:
                            _f.trys.push([1, 3, , 4]);
                            return [4 /*yield*/, fetch("".concat(backendUrl, "/verify/runs/").concat(encodeURIComponent(runId), "/events").concat(qs ? "?".concat(qs) : ""), { headers: { accept: "text/event-stream" } })];
                        case 2:
                            upstream = _f.sent();
                            res.statusCode = upstream.status;
                            res.setHeader("content-type", (_e = upstream.headers.get("content-type")) !== null && _e !== void 0 ? _e : "text/event-stream");
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
                            err_5 = _f.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_5 instanceof Error ? err_5.message : String(err_5),
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
                var upstreamPath, upstream, _a, _b, _c, ct, cc, buf, _d, _e, err_6;
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
                            err_6 = _h.sent();
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
            // ──────────────────────────────────────────────────────────────────
            //  /api/playwright — bridge to the OFFICIAL Playwright MCP server.
            //  GET  /api/playwright/tools → tool catalog (spawned via the
            //                             mcp-server backend on :8787)
            //  POST /api/playwright/call  → forward one browser tool call.
            //  The catalog is read live from `npx @playwright/mcp@latest`, so
            //  the chatbot's browser tools always match the official server.
            // ──────────────────────────────────────────────────────────────────
            server.middlewares.use("/api/playwright", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var upstreamPath, upstream, _a, _b, _c, _d, _e, err_7;
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
                            err_7 = _j.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_7 instanceof Error ? err_7.message : String(err_7),
                            }));
                            return [3 /*break*/, 8];
                        case 8: return [2 /*return*/];
                    }
                });
            }); });
            server.middlewares.use("/api/secrets", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var isDelete, targetPath, upstream, _a, _b, _c, raw, parsed, stripPassword, _i, _d, s, text, err_8;
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
                            err_8 = _j.sent();
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_8 instanceof Error ? err_8.message : String(err_8),
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
// ── Replicate ───────────────────────────────────────────────────────────────
function createReplicateProvider(env) {
    var _a, _b, _c;
    var token = (_a = env.REPLICATE_API_TOKEN) !== null && _a !== void 0 ? _a : "";
    var model = (_b = env.REPLICATE_AVATAR_MODEL) !== null && _b !== void 0 ? _b : "fofr/face-to-many";
    var explicitVersion = (_c = env.REPLICATE_AVATAR_MODEL_VERSION) !== null && _c !== void 0 ? _c : "";
    // Resolve the model's latest version lazily + cache it. Replicate's
    // create-prediction API rejects bare model names with `422 — version is
    // required` — `version` (or `model:hash`) is mandatory. The model owner
    // bumping the version is rare; a slightly stale hash is acceptable.
    var resolvedVersion = null;
    var resolveAttempted = false;
    function resolveLatestVersion(useToken) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, owner, name, res, data, id, _b;
            var _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (resolvedVersion || resolveAttempted)
                            return [2 /*return*/, resolvedVersion];
                        resolveAttempted = true;
                        _a = model.split("/"), owner = _a[0], name = _a[1];
                        if (!owner || !name)
                            return [2 /*return*/, null];
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 4, , 5]);
                        return [4 /*yield*/, fetch("https://api.replicate.com/v1/models/".concat(owner, "/").concat(name), { headers: { authorization: "Token ".concat(useToken) } })];
                    case 2:
                        res = _d.sent();
                        if (!res.ok)
                            return [2 /*return*/, null];
                        return [4 /*yield*/, res.json()];
                    case 3:
                        data = (_d.sent());
                        id = (_c = data.latest_version) === null || _c === void 0 ? void 0 : _c.id;
                        if (typeof id === "string" && id.length > 0) {
                            resolvedVersion = id;
                            return [2 /*return*/, id];
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        _b = _d.sent();
                        return [3 /*break*/, 5];
                    case 5: return [2 /*return*/, null];
                }
            });
        });
    }
    return {
        id: "replicate",
        isConfigured: function () { return token.length > 0; },
        notConfiguredMessage: function () {
            return "REPLICATE_API_TOKEN is not set on the Vite server. Set it (and optionally REPLICATE_AVATAR_MODEL / REPLICATE_AVATAR_MODEL_VERSION) to enable AI avatar generation.";
        },
        generate: function (req, signal, userOverride) {
            return __awaiter(this, void 0, void 0, function () {
                var effectiveToken, effectiveVersion, inputImage, pinnedVersion, _a, createBody, start, create, text, prediction, predictionId, final, poll, output, firstUrl, dl, ab, mime, dataUrl;
                var _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            effectiveToken = (userOverride === null || userOverride === void 0 ? void 0 : userOverride.token) || token;
                            effectiveVersion = (userOverride === null || userOverride === void 0 ? void 0 : userOverride.modelVersion) || explicitVersion;
                            if (!effectiveToken) {
                                throw new Error("Replicate token is missing — set Personal AI key in Settings → Account, or configure REPLICATE_API_TOKEN on the server.");
                            }
                            inputImage = req.imageBase64.startsWith("data:")
                                ? req.imageBase64
                                : "data:image/jpeg;base64,".concat(req.imageBase64);
                            _a = effectiveVersion;
                            if (_a) return [3 /*break*/, 2];
                            return [4 /*yield*/, resolveLatestVersion(effectiveToken)];
                        case 1:
                            _a = (_c.sent());
                            _c.label = 2;
                        case 2:
                            pinnedVersion = _a;
                            if (!pinnedVersion) {
                                throw new Error("Could not resolve the Replicate model version. Set REPLICATE_AVATAR_MODEL_VERSION in .env to pin a specific hash, or check the API token / network connectivity.");
                            }
                            createBody = {
                                version: pinnedVersion,
                                input: {
                                    image: inputImage,
                                    style: req.style,
                                    prompt: "",
                                    prompt_strength: 0.9,
                                    number_of_images: 1,
                                    disable_safety_checker: true,
                                },
                            };
                            start = Date.now();
                            return [4 /*yield*/, fetch("https://api.replicate.com/v1/predictions", {
                                    method: "POST",
                                    headers: {
                                        "content-type": "application/json",
                                        authorization: "Token ".concat(effectiveToken),
                                    },
                                    body: JSON.stringify(createBody),
                                })];
                        case 3:
                            create = _c.sent();
                            if (!!create.ok) return [3 /*break*/, 5];
                            return [4 /*yield*/, create.text()];
                        case 4:
                            text = _c.sent();
                            throw new Error("Replicate create failed: ".concat(text.slice(0, 500)));
                        case 5: return [4 /*yield*/, create.json()];
                        case 6:
                            prediction = (_c.sent());
                            predictionId = prediction.id;
                            if (!predictionId) {
                                throw new Error("Replicate returned no prediction id");
                            }
                            final = prediction;
                            _c.label = 7;
                        case 7:
                            if (!true) return [3 /*break*/, 12];
                            if (signal.aborted) {
                                fetch("https://api.replicate.com/v1/predictions/".concat(predictionId, "/cancel"), {
                                    method: "POST",
                                    headers: { authorization: "Token ".concat(effectiveToken) },
                                }).catch(function () { });
                                throw new Error("aborted");
                            }
                            if (final.status === "succeeded" ||
                                final.status === "failed" ||
                                final.status === "canceled") {
                                return [3 /*break*/, 12];
                            }
                            return [4 /*yield*/, new Promise(function (r) { return setTimeout(r, 2000); })];
                        case 8:
                            _c.sent();
                            return [4 /*yield*/, fetch("https://api.replicate.com/v1/predictions/".concat(predictionId), { headers: { authorization: "Token ".concat(effectiveToken) } })];
                        case 9:
                            poll = _c.sent();
                            if (!poll.ok) return [3 /*break*/, 11];
                            return [4 /*yield*/, poll.json()];
                        case 10:
                            final = (_c.sent());
                            _c.label = 11;
                        case 11: return [3 /*break*/, 7];
                        case 12:
                            if (final.status !== "succeeded") {
                                throw new Error(typeof final.error === "string"
                                    ? final.error
                                    : "prediction ".concat(final.status));
                            }
                            output = final.output;
                            firstUrl = Array.isArray(output)
                                ? output.find(function (v) { return typeof v === "string"; })
                                : typeof output === "string"
                                    ? output
                                    : null;
                            if (!firstUrl)
                                throw new Error("Replicate returned no output URL");
                            return [4 /*yield*/, fetch(firstUrl)];
                        case 13:
                            dl = _c.sent();
                            if (!dl.ok) {
                                throw new Error("Failed to download avatar (".concat(dl.status, ")"));
                            }
                            return [4 /*yield*/, dl.arrayBuffer()];
                        case 14:
                            ab = _c.sent();
                            mime = (_b = dl.headers.get("content-type")) !== null && _b !== void 0 ? _b : "image/png";
                            dataUrl = "data:".concat(mime, ";base64,").concat(Buffer.from(ab).toString("base64"));
                            return [2 /*return*/, {
                                    avatarDataUrl: dataUrl,
                                    contentType: mime,
                                    durationMs: Date.now() - start,
                                }];
                    }
                });
            });
        },
    };
}
// ── Hugging Face Inference router ───────────────────────────────────────────
//
// Uses the unified router (`router.huggingface.co`) with an image-to-image
// model by default. The default model `timbrooks/instruct-pix2pix` is a
// well-known free option that preserves the input subject's structure
// while applying a text instruction — perfect for "turn this face into X"
// style transfers. Override `HF_AVATAR_MODEL` to swap.
//
// Style → prompt map is a stand-in for Replicate's built-in style enum:
// each preset becomes a natural-language instruction. Missing styles fall
// back to a generic stylization prompt.
var HF_STYLE_PROMPTS = {
    "3D": "turn this person into a 3D rendered character",
    Anime: "turn this person into anime",
    Cartoon: "turn this person into a cartoon",
    Emoji: "turn this person into an emoji",
    "Video game": "turn this person into a video game character",
    "Pixel art": "convert this person into pixel art",
    Clay: "make this person look like a clay sculpture",
    Illustration: "make this person a hand drawn illustration",
    Toy: "turn this person into a toy figure",
};
var HF_DEFAULT_PROMPT = "stylize this person as a creative portrait";
function createHuggingFaceProvider(env) {
    var _a, _b;
    var token = (_a = env.HF_TOKEN) !== null && _a !== void 0 ? _a : "";
    var model = (_b = env.HF_AVATAR_MODEL) !== null && _b !== void 0 ? _b : "timbrooks/instruct-pix2pix";
    return {
        id: "huggingface",
        isConfigured: function () { return token.length > 0; },
        notConfiguredMessage: function () {
            return "HF_TOKEN is not set on the Vite server. Get a free token at https://huggingface.co/settings/tokens (Make calls to Inference Providers permission) and set HF_TOKEN + AI_AVATAR_PROVIDER=huggingface in .env.";
        },
        generate: function (req, signal, userOverride) {
            return __awaiter(this, void 0, void 0, function () {
                var effectiveToken, prompt, inputImage, start, res, text, ab, mime, text, dataUrl;
                var _a, _b;
                return __generator(this, function (_c) {
                    switch (_c.label) {
                        case 0:
                            effectiveToken = (userOverride === null || userOverride === void 0 ? void 0 : userOverride.token) || token;
                            if (!effectiveToken) {
                                throw new Error("Hugging Face token is missing — set Personal AI key in Settings → Account, or configure HF_TOKEN on the server.");
                            }
                            prompt = (_a = HF_STYLE_PROMPTS[req.style]) !== null && _a !== void 0 ? _a : HF_DEFAULT_PROMPT;
                            inputImage = req.imageBase64.startsWith("data:")
                                ? req.imageBase64
                                : "data:image/jpeg;base64,".concat(req.imageBase64);
                            start = Date.now();
                            return [4 /*yield*/, fetch("https://router.huggingface.co/hf-inference/models/".concat(model), {
                                    method: "POST",
                                    headers: {
                                        authorization: "Bearer ".concat(effectiveToken),
                                        "content-type": "application/json",
                                    },
                                    body: JSON.stringify({
                                        inputs: inputImage,
                                        parameters: {
                                            prompt: prompt,
                                            num_inference_steps: 25,
                                            image_guidance_scale: 1.5,
                                        },
                                    }),
                                    signal: signal,
                                })];
                        case 1:
                            res = _c.sent();
                            if (!!res.ok) return [3 /*break*/, 3];
                            return [4 /*yield*/, res.text()];
                        case 2:
                            text = _c.sent();
                            throw new Error("Hugging Face failed (".concat(res.status, "): ").concat(text.slice(0, 500)));
                        case 3: return [4 /*yield*/, res.arrayBuffer()];
                        case 4:
                            ab = _c.sent();
                            mime = (_b = res.headers.get("content-type")) !== null && _b !== void 0 ? _b : "image/png";
                            if (!mime.startsWith("image/")) {
                                text = Buffer.from(ab).toString("utf8");
                                throw new Error("Hugging Face returned non-image response: ".concat(text.slice(0, 500)));
                            }
                            dataUrl = "data:".concat(mime, ";base64,").concat(Buffer.from(ab).toString("base64"));
                            return [2 /*return*/, {
                                    avatarDataUrl: dataUrl,
                                    contentType: mime,
                                    durationMs: Date.now() - start,
                                }];
                    }
                });
            });
        },
    };
}
// ── Mock provider (no external API) ─────────────────────────────────────────
//
// Returns the input image unchanged. Useful for:
//   - offline development (no API key required),
//   - UI / wire-shape testing without burning API credits,
//   - as a placeholder when no real provider is configured.
//
// Always "configured" — no credentials to set. Override
// `AI_AVATAR_PROVIDER=mock` in `.env` to enable.
function createMockProvider() {
    return {
        id: "mock",
        isConfigured: function () { return true; },
        notConfiguredMessage: function () {
            return "Mock provider is always configured — no credentials required.";
        },
        generate: function (req, _signal, _userOverride) {
            return __awaiter(this, void 0, void 0, function () {
                var inputImage;
                return __generator(this, function (_a) {
                    inputImage = req.imageBase64.startsWith("data:")
                        ? req.imageBase64
                        : "data:image/jpeg;base64,".concat(req.imageBase64);
                    return [2 /*return*/, {
                            avatarDataUrl: inputImage,
                            contentType: "image/png",
                            durationMs: 0,
                        }];
                });
            });
        },
    };
}
// Per-style provider override. Parses `AI_AVATAR_PROVIDER_BY_STYLE` from the
// env into a `{ style → providerId }` map so the same app can route, say,
// "Anime" through Hugging Face (free) and "3D" through Replicate (paid).
//
// Format: semicolon-separated `Style:providerId` pairs.
//   AI_AVATAR_PROVIDER_BY_STYLE=Anime:mock;3D:replicate;Emoji:huggingface
// Whitespace is trimmed; unknown style keys are ignored. A style that's
// listed here takes precedence over the global `AI_AVATAR_PROVIDER`.
var AVATAR_PROVIDERS = {
    replicate: createReplicateProvider,
    huggingface: createHuggingFaceProvider,
    mock: createMockProvider,
};
function parseStyleProviders(value) {
    if (!value)
        return {};
    var map = {};
    for (var _i = 0, _a = value.split(/[;,]/); _i < _a.length; _i++) {
        var pair = _a[_i];
        var _b = pair.split(":").map(function (s) { var _a; return (_a = s === null || s === void 0 ? void 0 : s.trim()) !== null && _a !== void 0 ? _a : ""; }), k = _b[0], v = _b[1];
        if (k && v)
            map[k] = v.toLowerCase();
    }
    return map;
}
function getAvatarProvider(env, style) {
    var _this = this;
    var _a;
    // Per-style override wins, then global, then default "replicate".
    var styleOverrides = parseStyleProviders(env.AI_AVATAR_PROVIDER_BY_STYLE);
    var override = style ? styleOverrides[style] : undefined;
    var id = ((_a = override !== null && override !== void 0 ? override : env.AI_AVATAR_PROVIDER) !== null && _a !== void 0 ? _a : "replicate").toLowerCase();
    var factory = AVATAR_PROVIDERS[id];
    if (!factory) {
        var known_1 = Object.keys(AVATAR_PROVIDERS).join(", ");
        return {
            id: id,
            isConfigured: function () { return false; },
            notConfiguredMessage: function () {
                return "AI_AVATAR_PROVIDER=\"".concat(id, "\" is not recognized. Known providers: ").concat(known_1, ".");
            },
            generate: function () { return __awaiter(_this, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    throw new Error("Unknown AI avatar provider: ".concat(id));
                });
            }); },
        };
    }
    return factory(env);
}
// Server-side proxy for the AI avatar generator. The browser POSTs
// `{ imageBase64, style }` to `/api/ai/avatar`; this middleware dispatches
// to the provider selected by `AI_AVATAR_PROVIDER` and returns a `data:`
// URL the client can render in <img src> without a second round-trip.
//
// Body cap, timeout, and req-close handling live here (centralized) so
// every provider gets the same guarantees. Each provider only owns the
// vendor-specific call shape.
function aiAvatarProxy(env) {
    // Provider selection happens per-request inside the middleware so
    // per-style overrides can route different styles to different upstreams.
    // `getAvatarProvider` only reads env, which is constant between
    // requests in dev (and only changes on process restart in prod).
    return {
        name: "feature-tracker:ai-avatar-proxy",
        apply: "serve",
        configureServer: function (server) {
            var _this = this;
            // Body cap. Source photo is 4 MB max at the picker; base64 inflates
            // to ~5.3 MB on the wire; 6 MB is generous headroom for the form
            // envelope. Trips early via Content-Length before we start streaming.
            var AVATAR_MAX_BODY_BYTES = 6 * 1024 * 1024;
            // Wall-clock timeout. Generous so a single retry's worth of slack
            // fits before we cancel and (where applicable) bill-stop.
            var AVATAR_TIMEOUT_MS = 65000;
            server.middlewares.use("/api/ai/avatar", function (req, res) { return __awaiter(_this, void 0, void 0, function () {
                var declared, imageBase64, style, chunks, received, chunk, e_4_1, raw, parsed, _a, provider, headerValue, userToken, userModelVersion, abort, timer, disconnected, result, err_9;
                var _b, req_4, req_4_1;
                var _c, e_4, _d, _e;
                var _f;
                return __generator(this, function (_g) {
                    switch (_g.label) {
                        case 0:
                            if (req.method !== "POST") {
                                res.statusCode = 405;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({ error: "method_not_allowed" }));
                                return [2 /*return*/];
                            }
                            declared = Number((_f = req.headers["content-length"]) !== null && _f !== void 0 ? _f : 0);
                            if (declared > AVATAR_MAX_BODY_BYTES) {
                                res.statusCode = 413;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({ error: "payload_too_large" }));
                                return [2 /*return*/];
                            }
                            imageBase64 = "";
                            style = "3D";
                            _g.label = 1;
                        case 1:
                            _g.trys.push([1, 14, , 15]);
                            chunks = [];
                            received = 0;
                            _g.label = 2;
                        case 2:
                            _g.trys.push([2, 7, 8, 13]);
                            _b = true, req_4 = __asyncValues(req);
                            _g.label = 3;
                        case 3: return [4 /*yield*/, req_4.next()];
                        case 4:
                            if (!(req_4_1 = _g.sent(), _c = req_4_1.done, !_c)) return [3 /*break*/, 6];
                            _e = req_4_1.value;
                            _b = false;
                            chunk = _e;
                            received += chunk.length;
                            if (received > AVATAR_MAX_BODY_BYTES) {
                                res.statusCode = 413;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({ error: "payload_too_large" }));
                                return [2 /*return*/];
                            }
                            chunks.push(chunk);
                            _g.label = 5;
                        case 5:
                            _b = true;
                            return [3 /*break*/, 3];
                        case 6: return [3 /*break*/, 13];
                        case 7:
                            e_4_1 = _g.sent();
                            e_4 = { error: e_4_1 };
                            return [3 /*break*/, 13];
                        case 8:
                            _g.trys.push([8, , 11, 12]);
                            if (!(!_b && !_c && (_d = req_4.return))) return [3 /*break*/, 10];
                            return [4 /*yield*/, _d.call(req_4)];
                        case 9:
                            _g.sent();
                            _g.label = 10;
                        case 10: return [3 /*break*/, 12];
                        case 11:
                            if (e_4) throw e_4.error;
                            return [7 /*endfinally*/];
                        case 12: return [7 /*endfinally*/];
                        case 13:
                            raw = Buffer.concat(chunks).toString("utf8");
                            if (raw) {
                                parsed = JSON.parse(raw);
                                if (typeof parsed.imageBase64 === "string") {
                                    imageBase64 = parsed.imageBase64;
                                }
                                if (typeof parsed.style === "string") {
                                    style = parsed.style;
                                }
                            }
                            return [3 /*break*/, 15];
                        case 14:
                            _a = _g.sent();
                            res.statusCode = 400;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "bad_request",
                                message: "Invalid JSON body.",
                            }));
                            return [2 /*return*/];
                        case 15:
                            if (!imageBase64) {
                                res.statusCode = 400;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "bad_request",
                                    message: "imageBase64 is required",
                                }));
                                return [2 /*return*/];
                            }
                            provider = getAvatarProvider(env, style);
                            headerValue = function (name) {
                                var v = req.headers[name];
                                return typeof v === "string" ? v.trim() : "";
                            };
                            userToken = headerValue("x-ai-avatar-token");
                            userModelVersion = headerValue("x-ai-avatar-model");
                            if (!userToken) {
                                res.statusCode = 503;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "avatar_not_configured",
                                    message: "Personal AI key is not set. Open Settings → Account → Personal AI Key and add your provider token to enable AI avatar generation.",
                                }));
                                return [2 /*return*/];
                            }
                            // `provider.isConfigured()` is still checked so a future env-only
                            // vendor (e.g. a HF-only deployment) can refuse to run when the
                            // env token is missing — Replicate + HF both honor the override,
                            // but the underlying model id may be hardcoded for env-only modes.
                            if (!provider.isConfigured()) {
                                res.statusCode = 503;
                                res.setHeader("content-type", "application/json");
                                res.end(JSON.stringify({
                                    error: "avatar_not_configured",
                                    message: provider.notConfiguredMessage(),
                                }));
                                return [2 /*return*/];
                            }
                            abort = new AbortController();
                            timer = setTimeout(function () { return abort.abort(); }, AVATAR_TIMEOUT_MS);
                            disconnected = false;
                            req.on("close", function () {
                                disconnected = true;
                                abort.abort();
                            });
                            _g.label = 16;
                        case 16:
                            _g.trys.push([16, 18, , 19]);
                            return [4 /*yield*/, provider.generate({ imageBase64: imageBase64, style: style }, abort.signal, {
                                    token: userToken,
                                    modelVersion: userModelVersion || undefined,
                                })];
                        case 17:
                            result = _g.sent();
                            clearTimeout(timer);
                            if (disconnected) {
                                // Browser went away; nothing to send back.
                                res.end();
                                return [2 /*return*/];
                            }
                            res.statusCode = 200;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify(result));
                            return [3 /*break*/, 19];
                        case 18:
                            err_9 = _g.sent();
                            clearTimeout(timer);
                            if (disconnected || abort.signal.aborted) {
                                res.end();
                                return [2 /*return*/];
                            }
                            res.statusCode = 502;
                            res.setHeader("content-type", "application/json");
                            res.end(JSON.stringify({
                                error: "upstream_failure",
                                message: err_9 instanceof Error ? err_9.message : String(err_9),
                            }));
                            return [3 /*break*/, 19];
                        case 19: return [2 /*return*/];
                    }
                });
            }); });
        },
    };
}
export default defineConfig(function (_a) {
    var mode = _a.mode, command = _a.command;
    // Load .env (all vars, not just VITE_* — the prefixes arg "" disables
    // prefix filtering) merged with process.env (process.env wins), so the
    // proxy plugins below see AI_GATEWAY_* / VERIFY_BACKEND_URL from .env
    // without the shell exporting them. Server-side secrets like
    // AI_GATEWAY_TOKEN still never reach the client bundle — they're only
    // read here in config-land; VITE_* exposure rules are unchanged.
    var env = loadEnv(mode, process.cwd(), "");
    // Skip reading the local mkcert TLS files when building for production —
    // the Docker build context doesn't carry `./cert/`, and Vite still
    // evaluates the entire config object (including the `server.https`
    // block) during `vite build`. Without this guard the build fails with
    // `ENOENT: no such file or directory, open '.../cert/...-key.pem'`.
    var isDev = command !== "build";
    return {
        plugins: [
            react(),
            aiChatProxy(env),
            aiAvatarProxy(env),
            verifyProxy(env),
            customUrlBanner("https://dbeegi.slsblx.com:5173/projects"),
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
        server: __assign({ port: 5173, strictPort: true, 
            // Bind to the registered Blocks dev domain (not `host: true`) so
            // Vite's banner prints https://dbeegi.slsblx.com:5173/ and the OIDC
            // session cookie IAM sets on /login/callback lands on the same host
            // that initiated the redirect. `localhost` (which resolves to a
            // different cookie origin) is no longer served, intentionally.
            host: "dbeegi.slsblx.com", 
            // Without `allowedHosts`, Vite's DNS-rebinding guard 404s requests to
            // hosts other than localhost with "Blocked request. This host is not
            // allowed." — fatal when serving on a custom Blocks dev domain.
            allowedHosts: ["dbeegi.slsblx.com", "localhost"] }, (isDev
            ? {
                // mkcert-generated: SAN covers dbeegi.slsblx.com, localhost, 127.0.0.1
                // (CA is already trusted on this machine — see `mkcert -install`).
                https: {
                    key: fs.readFileSync(path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2-key.pem")),
                    cert: fs.readFileSync(path.resolve(__dirname, "./cert/dbeegi.slsblx.com+2.pem")),
                },
            }
            : {})),
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
