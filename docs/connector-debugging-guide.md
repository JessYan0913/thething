# Connector 调试指南

本文档说明如何在应用上调试 Connector Gateway 功能，包括工具调用测试、日志查看、Webhook 调试等方法。

---

## 一、调试 API 接口

Connector Gateway 提供以下调试 API 接口：

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/connector/test` | GET | 快速测试所有 Connector 功能（一键检测） |
| `/api/connector/admin/test-tool` | POST | 测试单个工具调用 |
| `/api/connector/admin/connectors` | GET | 列出所有已加载的 Connector |
| `/api/connector/admin/connectors/[id]` | GET | 获取单个 Connector 详情 |
| `/api/connector/admin/tools` | GET | 列出所有可用工具 |
| `/api/connector/admin/logs` | GET | 查看调用日志和统计 |
| `/api/connector/tools` | GET/POST | 生产调用接口 |

---

## 二、快速功能检测

访问 `/api/connector/test` 可快速检测 Connector Gateway 是否正常工作：

```bash
curl http://localhost:3000/api/connector/test
```

返回示例：
```json
{
  "summary": {
    "total": 3,
    "passed": 3,
    "failed": 0
  },
  "results": [
    {
      "step": "1-list-connectors",
      "success": true,
      "data": { "connectors": ["test-service"] }
    },
    {
      "step": "2-test-echo-http",
      "success": true,
      "data": { "success": true, "result": { ... } }
    },
    {
      "step": "3-test-ip-info",
      "success": true,
      "data": { "success": true, "result": { "origin": "x.x.x.x" } }
    }
  ]
}
```

---

## 三、测试单个工具调用

### 3.1 使用 curl 测试

```bash
curl -X POST http://localhost:3000/api/connector/admin/test-tool \
  -H "Content-Type: application/json" \
  -d '{
    "connector_id": "test-service",
    "tool_name": "test_echo",
    "tool_input": {
      "message": "Hello Connector Gateway!"
    }
  }'
```

返回示例：
```json
{
  "success": true,
  "data": {
    "success": true,
    "result": {
      "data": {
        "echo": "Hello Connector Gateway!",
        "metadata": {
          "include": true,
          "request_id": "xxx",
          "timestamp": "2024-01-01T00:00:00.000Z"
        }
      }
    },
    "timing": {
      "duration_ms": 234,
      "timestamp": "2024-01-01T00:00:00.000Z"
    },
    "request": {
      "connector_id": "test-service",
      "tool_name": "test_echo",
      "tool_input": { "message": "Hello Connector Gateway!" }
    }
  }
}
```

### 3.2 测试延迟响应（超时测试）

```bash
curl -X POST http://localhost:3000/api/connector/admin/test-tool \
  -H "Content-Type: application/json" \
  -d '{
    "connector_id": "test-service",
    "tool_name": "test_delay",
    "tool_input": { "delay_seconds": 3 }
  }'
```

### 3.3 测试错误状态码

```bash
# 测试 500 错误（触发重试）
curl -X POST http://localhost:3000/api/connector/admin/test-tool \
  -H "Content-Type: application/json" \
  -d '{
    "connector_id": "test-service",
    "tool_name": "test_status",
    "tool_input": { "status_code": 500 }
  }'
```

---

## 四、查看调用日志

### 4.1 获取日志列表

```bash
curl http://localhost:3000/api/connector/admin/logs
```

返回示例：
```json
{
  "success": true,
  "data": {
    "logs": [
      {
        "id": "log-xxx",
        "timestamp": "2024-01-01T00:00:00.000Z",
        "connector_id": "test-service",
        "tool_name": "test_echo",
        "success": true,
        "duration_ms": 234,
        "input": { "message": "Hello" },
        "result": { ... }
      }
    ],
    "pagination": { "total": 10, "limit": 50, "offset": 0, "has_more": false },
    "stats": {
      "total_calls": 10,
      "success_rate": "90.00%",
      "avg_duration_ms": 150,
      "by_connector": {
        "test-service": { "total": 10, "success": 9, "avg_ms": 150 }
      }
    }
  }
}
```

### 4.2 按 Connector 筛选

```bash
curl "http://localhost:3000/api/connector/admin/logs?connector_id=test-service&limit=10"
```

---

## 五、查看 Connector 和工具配置

### 5.1 列出所有 Connector

```bash
curl http://localhost:3000/api/connector/admin/connectors
```

返回示例：
```json
{
  "success": true,
  "data": {
    "connectors": [
      {
        "id": "test-service",
        "name": "测试服务",
        "version": "1.0.0",
        "enabled": true,
        "tool_count": 6,
        "inbound_enabled": true,
        "inbound_webhook": "/api/connector/webhooks/test-service",
        "auth_type": "api_key"
      }
    ]
  }
}
```

### 5.2 获取单个 Connector 详情

```bash
curl http://localhost:3000/api/connector/admin/connectors/test-service
```

### 5.3 列出所有工具

```bash
curl http://localhost:3000/api/connector/admin/tools
```

---

## 六、Webhook 调试

### 6.1 Webhook URL 验证

微信/飞书在配置 Webhook 时会发送验证请求，可手动模拟：

```bash
# 微信 URL 验证（GET 请求）
curl "http://localhost:3000/api/connector/webhooks/wecom?signature=xxx&timestamp=xxx&nonce=xxx&echostr=test"

# 飞书 URL 验证（POST 请求，返回 challenge）
curl -X POST http://localhost:3000/api/connector/webhooks/feishu \
  -H "Content-Type: application/json" \
  -d '{"type": "url_verification", "challenge": "test-challenge"}'
```

### 6.2 模拟入站消息

```bash
# 测试服务 Webhook（模拟入站消息）
curl -X POST http://localhost:3000/api/connector/webhooks/test-service \
  -H "Content-Type: application/json" \
  -d '{
    "sender_id": "user-001",
    "sender_name": "测试用户",
    "channel_id": "channel-001",
    "content": "这是一条测试消息",
    "message_type": "text"
  }'
```

### 6.3 查看入站事件队列

入站事件处理状态可通过日志查看：

```bash
curl http://localhost:3000/api/connector/admin/logs?connector_id=feishu
```

---

## 七、常见问题排查

### 7.1 Connector 未加载

**现象**：`/api/connector/admin/connectors` 返回空列表或缺少预期的 Connector。

**排查步骤**：
1. 检查 YAML 配置文件是否在 `connectors/` 目录
2. 检查 YAML 文件语法是否正确
3. 检查 `enabled: true` 是否设置
4. 检查环境变量是否正确配置（如 `${EMS_API_KEY}`）

```bash
# 查看配置文件
ls -la connectors/

# 验证 YAML 语法（使用 yq 或其他工具）
yq connectors/test-service.yaml
```

### 7.2 工具调用失败

**现象**：调用工具返回 `success: false`。

**排查步骤**：
1. 检查 `error` 字段的具体错误信息
2. 检查 `input` 参数是否符合 `input_schema` 定义
3. 检查目标服务是否可访问（网络、认证）
4. 检查熔断器状态（连续失败会触发熔断）

```bash
# 测试基础连通性
curl https://httpbin.org/ip

# 检查熔断器状态（通过日志）
curl http://localhost:3000/api/connector/admin/logs
```

### 7.3 认证失败

**现象**：返回 401/403 错误。

**排查步骤**：
1. 检查 `credentials` 配置是否正确
2. 检查环境变量是否设置
3. 检查 Token 是否过期（自定义认证）

```bash
# 检查环境变量
echo $EMS_API_KEY

# 手动测试认证
curl -H "X-API-Token: your-token" https://ems.example.com/api/v1/devices
```

### 7.4 超时或延迟过高

**现象**：`duration_ms` 过高或返回超时错误。

**排查步骤**：
1. 检查 `timeout_ms` 配置是否合理
2. 检查目标服务响应时间
3. 检查网络延迟
4. 对于数据库查询，检查 SQL 执行效率

### 7.5 SQL 查询失败

**现象**：SQL Executor 返回错误。

**排查步骤**：
1. 检查 SQL 语法是否符合目标数据库
2. 检查参数绑定是否正确（`:param_name` 格式）
3. 检查是否触发了只读检查（不允许写操作）
4. 检查数据库连接配置

```bash
# 检查数据库环境变量
echo $DB_EMS_PG_HOST
echo $DB_EMS_PG_DATABASE
```

---

## 八、调试技巧

### 8.1 使用 test-service 进行链路检测

`test-service` Connector 配置了多个测试工具，可用于检测 Connector Gateway 各环节：

| 工具 | 用途 |
|------|------|
| `test_echo` | 检测 HTTP Executor 是否正常 |
| `test_delay` | 检测超时处理和重试机制 |
| `test_status` | 检测错误状态码处理 |
| `test_headers` | 检测请求头和认证传递 |
| `test_ip_info` | 检测网络连通性 |

### 8.2 启用详细日志

在开发环境可启用更详细的日志输出：

```bash
# 设置调试环境变量
export DEBUG=connector:*
export LOG_LEVEL=debug

# 启动应用
npm run dev
```

### 8.3 使用浏览器开发者工具

在浏览器中访问 API 接口，使用开发者工具查看：
- Network 面板：请求/响应详情
- Console 面板：错误信息
- Headers：认证信息传递

### 8.4 检查 Token 管理

对于微信/飞书等需要 Token 的 Connector，检查 Token 刷新状态：

```bash
# 查看审计日志中的 Token 刷新记录
curl http://localhost:3000/api/connector/admin/logs
# 筛选 type=token_refresh 的记录
```

---

## 九、生产环境调试

生产环境建议：

1. **使用日志服务**：将 `/api/connector/admin/logs` 的数据持久化到数据库或日志服务
2. **配置告警**：对熔断器触发、连续失败等设置告警
3. **监控面板**：集成 Grafana 等监控工具展示调用统计
4. **限流保护**：避免调试请求过多影响正常业务

---

## 十、相关文档

- [Connector Gateway 设计文档 v2](./connector-gateway-design-v2.md)
- [能管平台模板使用说明](../connectors/templates/README.md)
- [Connector 配置示例](../connectors/test-service.yaml)