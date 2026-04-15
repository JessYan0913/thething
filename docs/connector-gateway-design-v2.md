# Connector Gateway 设计文档 v2

> 在 v1 基础上，补充微信、飞书、能管平台三类系统的完整接入设计
> 核心新增：Channel Inbound 架构（入站通道 + 对话闭环）
> 单租户架构（暂不考虑多租户）

---

## 一、架构全景（更新）

v1 的 Gateway 只处理"出站调用"（Agent → 外部系统）。  
微信和飞书的接入需要同时处理"入站事件"（外部系统 → Agent），因此架构扩展为双向。

```
                    ┌─────────────────────────────────┐
                    │           你的前端 UI             │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │           Agent Core             │
                    │       (LLM + 规划 + 记忆)         │
                    └──────┬─────────────────┬────────┘
                           │                 │
              工具调用（出站）│                 │消息事件（入站）
                           │                 │
          ┌────────────────▼─────────────────▼────────┐
          │              Connector Gateway              │
          │                                            │
          │  ┌─────────────────┐ ┌──────────────────┐ │
          │  │  Outbound Layer  │ │  Inbound Layer   │ │
          │  │  (工具调用出站)   │ │  (Webhook 入站)  │ │
          │  │                 │ │                  │ │
          │  │ Tool Router     │ │ Webhook Receiver  │ │
          │  │ Connector Runner│ │ Signature Verify  │ │
          │  │ Auth Manager    │ │ Message Decoder   │ │
          │  │ Executor Pool   │ │ Event Router      │ │
          │  └────────┬────────┘ └────────┬─────────┘ │
          │           │                   │            │
          │           └─────────┬─────────┘            │
          │                     │                      │
          │           ┌─────────▼──────────┐           │
          │           │  Connector Registry │           │
          │           │  Auth Manager      │           │
          │           │  Audit Logger      │           │
          │           └────────────────────┘           │
          └──────┬──────────┬──────────┬───────────────┘
                 │          │          │
           ┌─────▼───┐ ┌───▼───┐ ┌───▼──────┐
           │  微信    │ │ 飞书  │ │ 能管平台  │
           │Connector│ │Conn.  │ │Connector │
           └─────────┘ └───────┘ └──────────┘
```

---

## 二、新增核心概念：Channel Inbound

### 2.1 什么是 Inbound

微信/飞书的消息流向是：

```
用户发消息
   → 微信/飞书服务器
      → POST 到你的 Webhook URL
         → Gateway 接收、验签、解密
            → 路由给 Agent
               → Agent 生成回复
                  → Gateway 调微信/飞书 API 发送回复
                     → 用户看到回复
```

这是一个完整的**对话闭环**，Gateway 同时承担入站接收和出站回复两个角色。

### 2.2 Webhook URL 设计

```
POST /webhooks/{connector_type}
```

示例：
```
POST /webhooks/wecom              企业微信
POST /webhooks/wechat-mp          微信公众号
POST /webhooks/wechat-kf          微信客服
POST /webhooks/feishu             飞书
```

`connector_type` 决定用哪套验签和解密逻辑。

### 2.3 入站消息的统一事件格式

无论微信还是飞书，进入 Agent 的事件格式统一：

```typescript
interface InboundMessageEvent {
  event_id: string              // Gateway 生成的唯一 ID，用于幂等
  connector_type: string        // "wecom" | "wechat-mp" | "wechat-kf" | "feishu"
  channel_id: string            // 群聊 ID 或用户 ID，用于路由回复
  sender: {
    id: string                  // 发送者 ID（微信 openid / 飞书 open_id）
    name?: string
    type: "user" | "bot"
  }
  message: {
    id: string                  // 原始消息 ID，用于回复时引用
    type: "text" | "image" | "file" | "event"
    text?: string               // type=text 时的文本内容
    raw: unknown                // 原始消息体，保留备用
  }
  timestamp: number
  reply_context: ReplyContext   // 回复所需的上下文，Agent 回复时透传回来
}

// 回复上下文：Gateway 知道怎么把回复发回去，Agent 不需要感知
interface ReplyContext {
  connector_type: string
  channel_id: string
  reply_to_message_id?: string  // 飞书支持引用回复
}
```

### 2.4 对话闭环的时序

```
微信/飞书服务器
  │ POST /webhooks/wecom
  │
  ▼
Gateway Inbound Layer
  │ 1. 验签（HMAC-SHA256）
  │ 2. 解密消息体（AES-256-CBC，微信/飞书专有格式）
  │ 3. 幂等检查（同一 message_id 不重复处理）
  │ 4. 构建 InboundMessageEvent
  │ 5. 立即返回 HTTP 200（必须在 5 秒内，否则平台重试）
  │
  ▼ （异步）
Agent Core
  │ 6. 收到事件，进入对话逻辑
  │ 7. 调用工具（可能包括查询能管平台数据）
  │ 8. 生成回复文本
  │ 9. 调用 Gateway 出站接口发送回复
  │    POST /gateway/tools/call
  │    { tool_name: "wecom_send_message", tool_input: { text, reply_context } }
  │
  ▼
Gateway Outbound Layer
  │ 10. 调微信/飞书 API 发送消息
  │
  ▼
用户收到回复
```

**关键点**：步骤 5 必须立即返回 200，否则微信/飞书会认为 Webhook 失败并重试。Agent 的处理必须异步进行。

---

## 三、微信接入设计

微信有三种形态，按配置选择，核心差异如下：

| 形态 | 典型场景 | 认证方式 | 消息加密 | 主要 API |
|---|---|---|---|---|
| 企业微信（WeCom）| 内部员工使用 | corpid + corpsecret | 支持明文/加密两种 | 应用消息、群机器人 |
| 微信公众号（MP）| 面向终端用户 | AppID + AppSecret | 必须加密 | 客服消息、模板消息 |
| 微信客服（KF）| 企业对外客服 | AppID + AppSecret | 必须加密 | 客服消息接口 |

### 3.1 ConnectorManifest 示例（企业微信）

```yaml
id: wecom
name: 企业微信
version: "1.0.0"
description: 企业微信，支持应用消息、群机器人消息收发

# 入站配置
inbound:
  enabled: true
  webhook_path: /webhooks/wecom
  # 验签和解密由 Gateway 内置的 WeCom 处理器负责
  handler: wecom

auth:
  type: custom              # 不是标准 OAuth2，Token 获取方式特殊
  config:
    token_url: "https://qyapi.weixin.qq.com/cgi-bin/gettoken"
    token_params:
      corpid: "{{credentials.corp_id}}"
      corpsecret: "{{credentials.corp_secret}}"
    token_field: "access_token"
    expires_in_field: "expires_in"   # 7200 秒，Gateway 自动在到期前刷新

tools:
  - name: wecom_send_message
    description: 向企业微信用户或群发送消息
    input_schema:
      type: object
      properties:
        reply_context:
          type: object
          description: 从 InboundMessageEvent 中透传的回复上下文
        text:
          type: string
          description: 要发送的文本内容
        msgtype:
          type: string
          enum: ["text", "markdown"]
          default: "text"
      required: [reply_context, text]
    retryable: true
    timeout_ms: 5000
    executor: http
    executor_config:
      method: POST
      url: "https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token={{token}}"
      body:
        touser: "{{input.reply_context.channel_id}}"
        msgtype: "{{input.msgtype}}"
        agentid: "{{credentials.agent_id}}"
        text:
          content: "{{input.text}}"

  - name: wecom_get_user_info
    description: 根据 userid 查询企业微信用户信息
    input_schema:
      type: object
      properties:
        userid:
          type: string
      required: [userid]
    retryable: true
    timeout_ms: 5000
    executor: http
    executor_config:
      method: GET
      url: "https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token={{token}}&userid={{input.userid}}"
```

### 3.2 ConnectorConfig 示例（企业微信）

```json
{
  "connector_id": "wecom",
  "enabled": true,
  "subtype": "wecom",
  "credentials": {
    "corp_id": "<加密存储>",
    "corp_secret": "<加密存储>",
    "agent_id": "<加密存储>",
    "encoding_aes_key": "<加密存储>",
    "token": "<加密存储>"
  }
}
```

### 3.3 微信消息加解密

微信的消息加密是专有格式，需要内置实现，不能用通用 HTTP Executor 处理：

```typescript
class WechatMessageCrypto {
  // 验证请求来自微信服务器
  verifySignature(params: {
    signature: string
    timestamp: string
    nonce: string
    token: string              // 配置的 Token
  }): boolean {
    const str = [params.token, params.timestamp, params.nonce]
      .sort()
      .join("")
    const hash = sha1(str)
    return hash === params.signature
  }

  // 解密消息体（AES-256-CBC，微信专有 padding）
  decrypt(encryptedMsg: string, aesKey: string, appId: string): string {
    const key = Buffer.from(aesKey + "=", "base64")
    const iv = key.slice(0, 16)
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv)
    // 微信使用 PKCS7 padding，需手动处理
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedMsg, "base64")),
      decipher.final()
    ])
    // 解析微信专有的消息格式（前4字节为随机串长度...）
    return this.parseMsgFormat(decrypted, appId)
  }

  // 加密回复（部分场景需要）
  encrypt(replyMsg: string, aesKey: string, appId: string): string {
    // 反向操作
  }
}
```

### 3.4 三种微信形态的差异处理

```typescript
class WechatInboundHandler {
  async handle(req: Request, config: ConnectorConfig): Promise<void> {
    const subtype = config.subtype  // "wecom" | "wechat-mp" | "wechat-kf"

    // 验签（三种形态逻辑相同）
    const verified = this.crypto.verifySignature({
      signature: req.query.msg_signature,
      timestamp: req.query.timestamp,
      nonce: req.query.nonce,
      token: config.credentials.token
    })
    if (!verified) throw new Error("SIGNATURE_INVALID")

    // 解密（微信公众号和客服必须加密，企业微信可选）
    const msgXml = config.credentials.encoding_aes_key
      ? this.crypto.decrypt(req.body.Encrypt, config.credentials.encoding_aes_key, config.credentials.app_id)
      : req.body

    // 解析 XML → 统一事件格式
    const event = this.parseToUnifiedEvent(msgXml, subtype)

    // 幂等：同一 MsgId 只处理一次（微信会重试3次）
    if (await this.isDuplicate(event.message.id)) return

    // 异步推给 Agent，立即返回
    await this.eventQueue.push(event)
  }

  private parseToUnifiedEvent(msgXml: string, subtype: string): InboundMessageEvent {
    // 不同形态的 XML 字段名略有差异，统一映射
    const fieldMap = {
      "wecom":      { sender: "FromUserName", content: "Content" },
      "wechat-mp":  { sender: "FromUserName", content: "Content" },
      "wechat-kf":  { sender: "open_kfid",    content: "text.content" }
    }
    // ...映射逻辑
  }
}
```

---

## 四、飞书接入设计

飞书的接入逻辑与微信相似，但有以下差异：

| 对比项 | 微信 | 飞书 |
|---|---|---|
| 消息格式 | XML | JSON |
| 加密算法 | AES-256-CBC（专有 padding）| AES-256-CBC（标准 PKCS5）|
| 验签方式 | SHA1(token+ts+nonce) | HMAC-SHA256(ts+body) |
| 回复方式 | 调 sendMessage API | 调 reply API（支持引用原消息）|
| 富文本 | 有限支持 | 支持卡片消息（交互能力强）|
| Token | access_token（2h）| tenant_access_token（2h）|

### 4.1 ConnectorManifest 示例（飞书）

```yaml
id: feishu
name: 飞书
version: "1.0.0"

inbound:
  enabled: true
  webhook_path: /webhooks/feishu
  handler: feishu

auth:
  type: custom
  config:
    token_url: "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    token_body:
      app_id: "{{credentials.app_id}}"
      app_secret: "{{credentials.app_secret}}"
    token_field: "tenant_access_token"
    expires_in_field: "expire"

tools:
  - name: feishu_reply_message
    description: 回复飞书消息，支持引用原消息
    input_schema:
      type: object
      properties:
        reply_context:
          type: object
        text:
          type: string
        msg_type:
          type: string
          enum: ["text", "interactive"]  # interactive 为飞书卡片消息
          default: "text"
      required: [reply_context, text]
    retryable: true
    timeout_ms: 5000
    executor: http
    executor_config:
      method: POST
      url: "https://open.feishu.cn/open-apis/im/v1/messages/{{input.reply_context.reply_to_message_id}}/reply"
      headers:
        Authorization: "Bearer {{token}}"
      body:
        msg_type: "{{input.msg_type}}"
        content:
          text: "{{input.text}}"

  - name: feishu_send_message
    description: 主动向飞书用户或群发送消息（非回复场景）
    input_schema:
      type: object
      properties:
        receive_id:
          type: string
          description: 接收者 open_id 或 chat_id
        receive_id_type:
          type: string
          enum: ["open_id", "chat_id"]
        text:
          type: string
      required: [receive_id, receive_id_type, text]
    retryable: true
    timeout_ms: 5000
    executor: http
    executor_config:
      method: POST
      url: "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type={{input.receive_id_type}}"
      headers:
        Authorization: "Bearer {{token}}"
      body:
        receive_id: "{{input.receive_id}}"
        msg_type: "text"
        content:
          text: "{{input.text}}"

  - name: feishu_get_user_info
    description: 查询飞书用户信息
    input_schema:
      type: object
      properties:
        user_id:
          type: string
      required: [user_id]
    retryable: true
    timeout_ms: 5000
    executor: http
    executor_config:
      method: GET
      url: "https://open.feishu.cn/open-apis/contact/v3/users/{{input.user_id}}"
      headers:
        Authorization: "Bearer {{token}}"
```

### 4.2 飞书验签与解密

```typescript
class FeishuMessageHandler {
  verifySignature(params: {
    timestamp: string
    nonce: string
    body: string
    encrypt_key: string
  }): boolean {
    // 飞书验签：HMAC-SHA256(timestamp + nonce + encrypt_key + body)
    const content = params.timestamp + params.nonce + params.encrypt_key + params.body
    const hash = crypto.createHash("sha256").update(content).digest("hex")
    return hash === params.signature
  }

  decrypt(encrypted: string, encryptKey: string): object {
    // 飞书加密：AES-256-CBC，Key = SHA256(encryptKey)，标准 PKCS5 padding
    const key = crypto.createHash("sha256").update(encryptKey).digest()
    const buf = Buffer.from(encrypted, "base64")
    const iv = buf.slice(0, 16)
    const content = buf.slice(16)
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv)
    const decrypted = Buffer.concat([decipher.update(content), decipher.final()])
    return JSON.parse(decrypted.toString())
  }

  parseToUnifiedEvent(body: object): InboundMessageEvent {
    // 飞书事件结构
    const msg = body["event"]["message"]
    return {
      event_id: body["header"]["event_id"],
      connector_type: "feishu",
      channel_id: msg["chat_id"],
      sender: {
        id: body["event"]["sender"]["sender_id"]["open_id"],
        type: "user"
      },
      message: {
        id: msg["message_id"],
        type: msg["message_type"],
        text: JSON.parse(msg["content"])["text"],
        raw: body
      },
      timestamp: parseInt(body["header"]["create_time"]),
      reply_context: {
        connector_type: "feishu",
        channel_id: msg["chat_id"],
        reply_to_message_id: msg["message_id"]  // 飞书支持引用回复
      }
    }
  }
}
```

---

## 五、能管平台接入设计

能管平台是客户自建系统，最大挑战是**接口各不相同**。Gateway 的策略是：提供足够灵活的接入机制，让差异在配置层面吸收，而不是在代码层面。

### 5.1 两种接入路径

**路径 A：客户有 REST API**

直接用 HTTP Executor，管理员填写 Manifest 配置，零代码接入。

```yaml
id: ems-xyz               # 每个能管平台一个独立的 Connector ID
name: XYZ能管平台
version: "1.0.0"

auth:
  type: api_key
  config:
    header: X-API-Token

tools:
  - name: ems_get_energy_usage
    description: 查询指定设备或区域的能耗数据
    input_schema:
      type: object
      properties:
        device_id:
          type: string
          description: 设备 ID 或区域 ID
        start_time:
          type: string
          description: 开始时间，ISO 8601 格式
        end_time:
          type: string
          description: 结束时间，ISO 8601 格式
        metric:
          type: string
          enum: ["electricity", "water", "gas", "heat"]
          description: 能耗类型
      required: [device_id, start_time, end_time, metric]
    retryable: true
    timeout_ms: 10000
    executor: http
    executor_config:
      method: GET
      url: "{{base_url}}/api/v1/energy/usage"
      query_params:
        device_id: "{{input.device_id}}"
        start: "{{input.start_time}}"
        end: "{{input.end_time}}"
        type: "{{input.metric}}"

  - name: ems_get_alarm_list
    description: 查询当前未处理的告警列表
    input_schema:
      type: object
      properties:
        severity:
          type: string
          enum: ["critical", "warning", "info"]
        limit:
          type: integer
          default: 20
    retryable: true
    timeout_ms: 5000
    executor: http
    executor_config:
      method: GET
      url: "{{base_url}}/api/v1/alarms"
      query_params:
        severity: "{{input.severity}}"
        limit: "{{input.limit}}"
```

**路径 B：客户只有数据库**

使用 SQL Executor，直接查询能管数据库。这是 v1 中放在第二阶段的能力，**对于能管平台场景必须提前到第一阶段实现**。

```yaml
id: ems-abc-db
name: ABC能管平台（数据库直连）
version: "1.0.0"

auth:
  type: none                  # 认证在数据库连接串里

tools:
  - name: ems_query_energy
    description: 查询能耗历史数据
    input_schema:
      type: object
      properties:
        device_id:
          type: string
        start_time:
          type: string
        end_time:
          type: string
        metric_type:
          type: string
      required: [device_id, start_time, end_time]
    retryable: true
    timeout_ms: 15000
    executor: sql
    executor_config:
      connection_id: "{{credentials.db_connection_id}}"  # 指向加密存储的连接串
      allow_write: false                                  # 强制只读
      max_rows: 500
      query_template: |
        SELECT
          device_id,
          metric_type,
          value,
          unit,
          recorded_at
        FROM energy_readings
        WHERE device_id = :device_id
          AND metric_type = :metric_type
          AND recorded_at BETWEEN :start_time AND :end_time
        ORDER BY recorded_at DESC
        LIMIT :max_rows
      # 参数名和 input schema 字段名对应，由 SQL Executor 自动绑定
      # 使用参数化查询，防止 SQL 注入

  - name: ems_get_device_status
    description: 查询设备当前状态
    input_schema:
      type: object
      properties:
        device_ids:
          type: array
          items:
            type: string
      required: [device_ids]
    retryable: true
    timeout_ms: 5000
    executor: sql
    executor_config:
      connection_id: "{{credentials.db_connection_id}}"
      allow_write: false
      max_rows: 100
      query_template: |
        SELECT
          device_id,
          device_name,
          status,
          last_reading,
          last_updated_at
        FROM devices
        WHERE device_id = ANY(:device_ids)
```

### 5.2 SQL Executor 完整设计

由于能管场景必须支持，这里补充完整设计：

```typescript
class SqlExecutor {
  private connectionPool: Map<string, DatabasePool> = new Map()

  async execute(config: SqlExecutorConfig, input: unknown): Promise<unknown> {
    const pool = await this.getConnection(config.connection_id)

    // 安全检查：强制只读
    if (!config.allow_write) {
      this.assertReadOnly(config.query_template)
    }

    // 参数化查询，防止 SQL 注入
    const { sql, params } = this.bindParameters(config.query_template, input)

    const result = await pool.query(sql, params)

    // 限制返回行数，防止 context 爆炸
    const rows = result.rows.slice(0, config.max_rows ?? 100)

    return {
      rows,
      row_count: rows.length,
      total_count: result.rowCount,
      truncated: result.rowCount > (config.max_rows ?? 100)
    }
  }

  private assertReadOnly(sql: string): void {
    const normalized = sql.trim().toUpperCase()
    const writeKeywords = ["INSERT", "UPDATE", "DELETE", "DROP", "CREATE", "ALTER", "TRUNCATE"]
    for (const kw of writeKeywords) {
      if (normalized.includes(kw)) {
        throw new Error(`SQL_WRITE_NOT_ALLOWED: 检测到写操作关键字 ${kw}`)
      }
    }
  }

  private bindParameters(template: string, input: unknown): { sql: string; params: unknown[] } {
    // 将 :param_name 替换为 $1, $2... 并收集参数值
    // 防止 SQL 注入：只做参数绑定，不做字符串拼接
    const params: unknown[] = []
    const sql = template.replace(/:(\w+)/g, (_, name) => {
      params.push(input[name])
      return `$${params.length}`
    })
    return { sql, params }
  }

  // 数据库连接配置加密存储
  private async getConnection(connectionId: string): Promise<DatabasePool> {
    if (!this.connectionPool.has(connectionId)) {
      const connConfig = await this.credentialStore.getDbConfig(connectionId)
      // 支持 PostgreSQL / MySQL / ClickHouse
      const pool = createPool(connConfig)
      this.connectionPool.set(connectionId, pool)
    }
    return this.connectionPool.get(connectionId)!
  }
}
```

### 5.3 能管平台的 Connector 管理策略

由于不同能管平台接口不同，建议：

**每个能管平台 = 一个独立的 Connector ID**

```
ems-xxx-api    # 有 API 的平台
ems-xxx-db     # 只有数据库的平台
```

提供**能管平台 Manifest 模板**，接入新平台时从模板开始修改，而不是从零编写：

```
templates/
  ems-rest-api.yaml      # REST API 模板，填 base_url + 工具配置
  ems-database.yaml      # 数据库模板，填 connection_id + SQL 查询
```

---

## 六、Token 管理专项设计

微信和飞书都有 access_token（2小时有效期），需要专门的 Token Manager：

```typescript
class TokenManager {
  private tokenCache: Map<string, CachedToken> = new Map()

  async getToken(connectorId: string): Promise<string> {
    const cacheKey = connectorId
    const cached = this.tokenCache.get(cacheKey)

    // 提前 5 分钟刷新，避免 Token 在使用中过期
    if (cached && cached.expires_at > Date.now() + 5 * 60 * 1000) {
      return cached.token
    }

    // 重新获取 Token
    return this.refreshToken(connectorId, cacheKey)
  }

  private async refreshToken(connectorId: string, cacheKey: string): Promise<string> {
    // 防止并发请求同时刷新（使用分布式锁或 Promise 合并）
    if (this.refreshingPromises.has(cacheKey)) {
      return this.refreshingPromises.get(cacheKey)!
    }

    const refreshPromise = this.doRefresh(connectorId)
      .then(token => {
        this.tokenCache.set(cacheKey, token)
        this.refreshingPromises.delete(cacheKey)
        return token.token
      })

    this.refreshingPromises.set(cacheKey, refreshPromise)
    return refreshPromise
  }

  private async doRefresh(connectorId: string): Promise<CachedToken> {
    const manifest = await this.registry.getManifest(connectorId)
    const creds = await this.authManager.getDecryptedCredentials(connectorId)
    const authConfig = manifest.auth.config

    const response = await fetch(authConfig.token_url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.renderTemplate(authConfig.token_body, creds))
    })

    const data = await response.json()
    return {
      token: data[authConfig.token_field],
      expires_at: Date.now() + data[authConfig.expires_in_field] * 1000
    }
  }
}
```

---

## 七、幂等性与消息去重

微信和飞书在 Webhook 未收到 200 响应时会重试，Gateway 必须做幂等处理：

```typescript
class IdempotencyGuard {
  // 使用 Redis 记录已处理的消息 ID，TTL = 24 小时
  async isDuplicate(messageId: string): Promise<boolean> {
    const key = `inbound:processed:${messageId}`
    // SET key 1 EX 86400 NX（仅当不存在时设置）
    const result = await this.redis.set(key, "1", { EX: 86400, NX: true })
    return result === null  // null 表示 key 已存在，即重复消息
  }
}
```

---

## 八、更新后的 MVP 优先级

结合三个系统的接入需求，调整优先级如下：

**第一阶段（核心跑通，包含三个系统）：**
- [ ] Connector Registry
- [ ] HTTP Executor（覆盖企业微信、飞书出站 + 有 API 的能管平台）
- [ ] SQL Executor（覆盖只有数据库的能管平台，从第二阶段提前）
- [ ] Auth Manager（API Key + 微信/飞书专用 Token 管理）
- [ ] Token Manager（自动刷新，防并发）
- [ ] Inbound Layer（Webhook 接收端点）
- [ ] 微信消息加解密（企业微信 + 公众号 + 微信客服三种形态）
- [ ] 飞书消息加解密
- [ ] 统一 InboundMessageEvent 格式
- [ ] 幂等去重（Redis）
- [ ] 基础 Audit Log

**第二阶段（稳定性）：**
- [ ] 重试 + 指数退避
- [ ] 熔断器
- [ ] Circuit Breaker 监控告警
- [ ] 能管平台 Manifest 模板库

**第三阶段（扩展性）：**
- [ ] Script Executor
- [ ] MCP Executor
- [ ] 飞书卡片消息（交互式回复）
- [ ] 管理面 UI（Connector 注册、配置、连接测试）

---

## 九、三个系统对比总结

| 维度 | 企业微信 | 飞书 | 能管平台 |
|---|---|---|---|
| 接入方向 | 双向 | 双向 | 单向（出站）|
| Executor | HTTP | HTTP | HTTP 或 SQL |
| 消息格式 | XML | JSON | N/A |
| 加解密 | AES-256-CBC 专有 padding | AES-256-CBC 标准 | N/A |
| Token | 2h，AppID+Secret 获取 | 2h，AppID+Secret 获取 | API Key 或无 |
| 最大挑战 | 三种子形态兼容 | 较标准，实现最简单 | 每个平台接口不同 |
| 配置差异 | subtype 字段区分形态 | 无差异 | 每个平台独立 Connector |

---

*文档版本：v2.0 | 最后更新：2026-04*
