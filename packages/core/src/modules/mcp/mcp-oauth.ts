// ============================================================
// MCP OAuth — OAuthClientProvider 实现 + 状态文件持久化
// ============================================================
// 基于 @ai-sdk/mcp 内置 OAuth 流程（auth()/authInternal）：
// 授权分两个分离调用完成，provider 必须在中间持久化
// state / codeVerifier / clientInformation / authorizationServerInformation，
// 全部落在 {dataDir}/mcp-auth/{hash}.json 单文件。
//
// 我们不写 OAuth 协议栈：issuer 验证（RFC 9207）、PKCE、CSRF state 校验
// 均由 SDK 内置（@ai-sdk/mcp ≥2.0.29 的 authInternal）。
//
// 设计文档：docs/mcp-oauth-design.md §5.2-5.3
// ============================================================

import { createHash, randomBytes } from 'node:crypto';
import { mkdir as fsMkdir, readFile as fsReadFile, rename as fsRename, writeFile as fsWriteFile, chmod as fsChmod } from 'node:fs/promises';
import { dirname, join as pathJoin } from 'node:path';
import {
  auth,
  type OAuthAuthorizationServerInformation,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from '@ai-sdk/mcp';
import { logger } from '../../primitives/logger';

/** 授权会话有效期（毫秒）：浏览器授权页打开后的最长等待 */
const PENDING_TTL_MS = 5 * 60 * 1000;

/** 状态文件目录名（位于 dataDir 之下） */
const OAUTH_STATE_DIR = 'mcp-auth';

// ============================================================
// 状态文件结构
// ============================================================

interface McpOAuthPending {
  state: string;                    // CSRF state
  codeVerifier: string;             // PKCE code verifier
  authorizationServerUrl: string;   // 发起时发现的授权服务器 URL
  createdAt: number;                // 发起时间戳
}

function emptyPending(createdAt: number): McpOAuthPending {
  return { state: '', codeVerifier: '', authorizationServerUrl: '', createdAt };
}

// ============================================================
// OAuth state 编码
// ============================================================
// 回调识别服务器的问题：授权服务器只把请求时的 redirect_uri 原样回跳，
// 再追加自己的 code/state，绝不会加 server 参数。因此服务器标识必须
// 编码进 state（state 本来就是每次授权的自由防 CSRF 值，SDK 对它做
// 完整字符串比对）。格式：encodeURIComponent(serverName) + '::' + 随机串。

const STATE_SEPARATOR = '::';

function makeOAuthState(serverName: string): string {
  return `${encodeURIComponent(serverName)}${STATE_SEPARATOR}${randomBytes(16).toString('hex')}`;
}

/**
 * 从回调 state 还原服务器名与 CSRF 部分。
 * 旧格式（无分隔符）时 serverName 为 undefined（保持向后兼容）。
 */
export function parseOAuthState(state: string): { serverName?: string; csrf: string } {
  const idx = state.indexOf(STATE_SEPARATOR);
  if (idx <= 0) return { csrf: state };
  return { serverName: decodeURIComponent(state.slice(0, idx)), csrf: state.slice(idx + STATE_SEPARATOR.length) };
}

interface McpOAuthStateFile {
  version: 1;
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  authorizationServerInformation?: OAuthAuthorizationServerInformation;
  pending?: McpOAuthPending;
}

// ============================================================
// Provider Options / Handle
// ============================================================

export interface McpOAuthProviderOptions {
  /** 持久化根目录（内部拼 mcp-auth/{hash}.json） */
  dataDir: string;
  /** 本地回调地址（localhost redirect 的 redirect_uri），如 http://127.0.0.1:3000/api/mcp/oauth/callback */
  redirectUrl: string;
  /** 请求的权限范围（可选） */
  scope?: string;
  /** 授权流程要求打开浏览器时回调（由集成方注入，负责把 URL 送到前端） */
  onAuthorizationRequested?: (authorizationUrl: URL) => void;
  /** 可注入时钟（测试用），默认 Date.now */
  now?: () => number;
}

/**
 * OAuth provider 句柄：OAuthClientProvider（SDK 消费）+ 供 registry 使用的辅助方法。
 */
export interface McpOAuthProviderHandle extends OAuthClientProvider {
  /** SDK 接口里 state/saveState/storedState 是可选方法，本实现总是提供；显式声明为必选 */
  state(): string;
  saveState(state: string): Promise<void>;
  storedState(): string | undefined | Promise<string | undefined>;
  saveClientInformation(clientInformation: OAuthClientInformation): Promise<void>;
  saveAuthorizationServerInformation(authorizationServerInformation: OAuthAuthorizationServerInformation): Promise<void>;
  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void>;
  /** 校验 pending 会话后用 authorizationCode 完成 token 交换；成功清除 pending */
  completeAuthorization(serverUrl: string, authorizationCode: string, callbackState: string): Promise<void>;
  /** 清除 token（重新授权 / 登出） */
  resetTokens(): Promise<void>;
  /** 是否已有有效 token（UI 判断是否需要授权） */
  hasValidTokens(): Promise<boolean>;
  /** 当前进行中的授权会话（UI 展示等待状态与倒计时），无则 undefined */
  getPendingState(): Promise<{ state: string; expiresAt: number } | undefined>;
}

// ============================================================
// 持久化辅助
// ============================================================

/** serverName → 安全文件名（SHA-256 短哈希，规避路径穿越与特殊字符） */
function stateFileName(serverName: string): string {
  return createHash('sha256').update(serverName).digest('hex').slice(0, 16);
}

/**
 * 串行化读写队列：OAuth 发起（start）与完成（callback）可能跨 HTTP 请求并发，
 * 同一文件不允许并行写（避免丢失对方刚写入的字段）。
 */
class StateFile {
  private _filePath: string;
  private _queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string, serverName: string) {
    this._filePath = pathJoin(dataDir, OAUTH_STATE_DIR, `${stateFileName(serverName)}.json`);
  }

  /** 读全部状态；文件不存在或损坏返回空状态 */
  read(): Promise<McpOAuthStateFile> {
    return this._enqueue(async () => {
      try {
        const raw = await fsReadFile(this._filePath, 'utf-8');
        const parsed = JSON.parse(raw) as McpOAuthStateFile;
        return parsed && typeof parsed === 'object' ? parsed : { version: 1 };
      } catch {
        return { version: 1 };
      }
    });
  }

  /** 原子写：tmp + rename + 0600 权限 */
  write(state: McpOAuthStateFile): Promise<void> {
    return this._enqueue(async () => {
      await fsMkdir(dirname(this._filePath), { recursive: true });
      const tmp = `${this._filePath}.tmp`;
      await fsWriteFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fsRename(tmp, this._filePath);
      await fsChmod(this._filePath, 0o600);
    });
  }

  /** 部分更新：读-改-写（原子，且不会丢并发写入的字段） */
  update(mutate: (state: McpOAuthStateFile) => void): Promise<McpOAuthStateFile> {
    return this._enqueue(async () => {
      const state = await this.readInner();
      mutate(state);
      await fsMkdir(dirname(this._filePath), { recursive: true });
      const tmp = `${this._filePath}.tmp`;
      await fsWriteFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
      await fsRename(tmp, this._filePath);
      await fsChmod(this._filePath, 0o600);
      return state;
    });
  }

  private async readInner(): Promise<McpOAuthStateFile> {
    try {
      const raw = await fsReadFile(this._filePath, 'utf-8');
      const parsed = JSON.parse(raw) as McpOAuthStateFile;
      return parsed && typeof parsed === 'object' ? parsed : { version: 1 };
    } catch {
      return { version: 1 };
    }
  }

  private _enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this._queue.then(op, op);
    this._queue = next.catch(() => {});
    return next;
  }
}

// ============================================================
// Provider 工厂
// ============================================================

/**
 * 创建绑定到单个 MCP 服务器的 OAuth provider。
 * 每个服务器独立状态文件；tokens 不落日志、不打印。
 */
export function createMcpOAuthProvider(serverName: string, options: McpOAuthProviderOptions): McpOAuthProviderHandle {
  const file = new StateFile(options.dataDir, serverName);
  const now = options.now ?? Date.now;

  const provider: McpOAuthProviderHandle = {
    // ── token ──────────────────────────────────────────────
    async tokens() {
      const state = await file.read();
      return state.tokens;
    },
    async saveTokens(tokens) {
      await file.update((s) => { s.tokens = tokens; });
    },

    // ── client 注册持久化 ─────────────────────────────────
    async clientInformation() {
      const state = await file.read();
      return state.clientInformation;
    },
    async saveClientInformation(clientInformation) {
      await file.update((s) => { s.clientInformation = clientInformation; });
    },
    async authorizationServerInformation() {
      const state = await file.read();
      return state.authorizationServerInformation;
    },
    async saveAuthorizationServerInformation(authorizationServerInformation) {
      await file.update((s) => { s.authorizationServerInformation = authorizationServerInformation; });
    },

    // ── CSRF state（发起时生成，回调时校验）──────────────
    state() {
      // 服务器标识编码进 state：回调侧据此还原 server 名（见 parseOAuthState）
      return makeOAuthState(serverName);
    },
    async saveState(state) {
      await file.update((s) => { s.pending = { ...(s.pending ?? emptyPending(now())), state }; });
    },
    async storedState() {
      const state = await file.read();
      const value = state.pending?.state;
      // 单次有效：读取后立即清除，防 CSRF state 回放
      if (value !== undefined) {
        await file.update((s) => {
          if (s.pending && s.pending.state === value) s.pending.state = '';
        });
      }
      return value;
    },

    // ── PKCE code verifier（发起与交换之间必须持久化）───
    async codeVerifier() {
      const state = await file.read();
      if (!state.pending?.codeVerifier) {
        throw new Error('MCP OAuth: missing code verifier — 授权会话不完整，请重新发起');
      }
      return state.pending.codeVerifier;
    },
    async saveCodeVerifier(codeVerifier) {
      await file.update((s) => { s.pending = { ...(s.pending ?? emptyPending(now())), codeVerifier }; });
    },

    // ── 回调地址与客户端元数据 ───────────────────────────
    get redirectUrl() {
      return options.redirectUrl;
    },
    get clientMetadata(): OAuthClientMetadata {
      const metadata: OAuthClientMetadata = {
        client_name: 'The Thing',
        redirect_uris: [options.redirectUrl],
        // 2026-07-28 auth 加固要求桌面/CLI 声明 application_type: 'native'
        // 以允许 localhost redirect；@ai-sdk/mcp 2.0.29 的 OAuthClientMetadata
        // 类型暂未包含该字段，SDK 跟进后补上
        // PKCE（无 client secret）桌面应用标准
        token_endpoint_auth_method: 'none',
      };
      if (options.scope) metadata.scope = options.scope;
      return metadata;
    },

    // ── 授权发起 → 前端打开浏览器 ────────────────────────
    async redirectToAuthorization(authorizationUrl) {
      options.onAuthorizationRequested?.(authorizationUrl);
      logger.debug('MCP', `OAuth: authorization requested for ${serverName}`);
    },

    // ── 凭据失效自动清理（服务器判失效时，避免用户手动干预）──
    async invalidateCredentials(scope) {
      await file.update((s) => {
        if (scope === 'all' || scope === 'tokens') s.tokens = undefined;
        if (scope === 'client') s.clientInformation = undefined;
        if (scope === 'verifier' || scope === 'all') s.pending = undefined;
      });
      logger.debug('MCP', `OAuth: credentials invalidated (${scope}) for ${serverName}`);
    },

    // ── registry 辅助方法 ─────────────────────────────────
    async completeAuthorization(serverUrl, authorizationCode, callbackState) {
      const state = await file.read();
      const pending = state.pending;
      if (!pending) {
        throw new Error('MCP OAuth: 没有进行中的授权请求，请先在设置页发起授权');
      }
      if (now() - pending.createdAt > PENDING_TTL_MS) {
        await file.update((s) => { s.pending = undefined; });
        throw new Error('MCP OAuth: 授权会话已过期，请重新发起');
      }

      // SDK 内部：校验 storedState（CSRF）→ codeVerifier 换 token → saveTokens
      const result = await auth(this, {
        serverUrl,
        authorizationCode,
        callbackState,
        scope: options.scope,
      });
      if (result !== 'AUTHORIZED') {
        throw new Error(`MCP OAuth: 授权未完成（SDK 返回 ${result}）`);
      }
      await file.update((s) => { s.pending = undefined; });
      logger.debug('MCP', `OAuth: authorized for ${serverName}`);
    },
    async resetTokens() {
      await file.update((s) => {
        s.tokens = undefined;
        s.pending = undefined;
      });
    },
    async hasValidTokens() {
      const state = await file.read();
      return Boolean(state.tokens?.access_token);
    },
    async getPendingState() {
      const state = await file.read();
      if (!state.pending) return undefined;
      return { state: state.pending.state, expiresAt: state.pending.createdAt + PENDING_TTL_MS };
    },
  };

  return provider;
}
