# Connector YAML 配置设计回顾

## 设计回顾背景

在引入了 `variables` 变量声明区域、移除环境变量 `${VAR_NAME}` 支持、并在管理 UI 中增加了可视化变量配置表单后，对当前 Connector YAML 的整体设计进行了一次梳理。以下是在设计和实现过程中暴露出的几个值得改进的问题。

---

## 1. YAML 保存时丢失注释和格式

**问题**：`PUT /api/connectors` 使用 `yaml.dump()` 重写整个文件，导致：
- 所有 `# 注释` 消失
- 引号风格、缩进被统一
- 内联格式被展开（如 `transports: [http, websocket]` → 多行列表）

飞书配置中的 `# 入站配置（Webhook 接收消息）`、`# 认证配置` 等引导注释都在保存后被抹去，降低了 YAML 的可读性。

**建议**：改用基于字符串/正则的替换，只更新 `variables:` 区域的值，不动文件其余部分。或者引入更智能的 YAML AST 编辑器（如 `yaml` 包的 `Document` 级别操作），在不破坏格式的前提下修改变量值。

---

## 2. `credentials` 与 `variables` 功能重叠

**问题**：引入 `variables` 后，飞书配置中出现了冗余：

```yaml
variables:
  app_id: "cli_a9771..."
  app_secret: "x4xAmmk..."

credentials:
  app_id: "${{ app_id }}"
  app_secret: "${{ app_secret }}"
```

`credentials` 纯粹是 `variables` 的转发。而 `credentials` 当初是为 `${VAR_NAME}` 环境变量注入设计的。现在环境变量已从 connector YAML 移除，`credentials` 显得多余——变量解析后的值可以直接传递到 executor。

**建议**：去掉 `credentials` 字段，让 `variables` 直接作为凭证和配置的统一来源。执行器需要凭证明，直接从解析后的 ConnectorDefinition 的 `variables` 字段读取。

---

## 3. `scopes` 字段被 Zod 静默丢弃

**问题**：飞书 YAML 中的 `scopes` 字段（权限范围声明）不在 `ConnectorFrontmatterSchema` 中。加载时 zod 默认 `.strip()` 未知字段，`scopes` 被静默丢弃。

写了但代码读不到，纯装饰。用户在 YAML 中维护了一大段权限列表，实际毫无作用。

**建议**：要么将 `scopes` 加入 Zod schema 并暴露给运行时使用（如用于权限校验），要么从 YAML 中删除以免误导。

---

## 4. 引用不存在的变量时静默通过

**问题**：当前 `resolveConnectorVars` 对未匹配的引用保持原样：

```yaml
url: "${{ typo_var }}/endpoint"
# 解析后仍然是 "${{ typo_var }}/endpoint"
```

不会报错，不会警告。用户以为变量生效了，实际上值被当作字面量字符串传到 runtime，可能以静默的方式失败。

**建议**：在 `resolveConnectorVars` 和 `walkAndReplace` 中增加 `logger.warn`，当发现未被替换的 `${{ ... }}` 引用时发出警告，提示用户检查变量名。

---

## 5. 变量值只有字符串类型

**问题**：`variables` 的值为 `Record<string, string>`，所有变量值都是字符串。需要传入数字或布尔值时需要用户在引用处手动处理：

```yaml
variables:
  timeout: "5000"

tools:
  - name: my_tool
    timeout_ms: "${{ timeout }}"  # 字符串 "5000"，不是数字 5000
```

**影响**：目前实际影响有限——HTTP executor 等使用 `timeout_ms` 时做了自动转换（`||` 和 `Number()`），模板引擎也隐式转换。但如果后期做 schema 校验会出问题。

**建议**：优先级低。有实际需求时再改为 `Record<string, unknown>` 或在 schema 中支持按变量标记类型。

---

## 优先级总结

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 🔴 P0 | YAML 保存丢失注释/格式 | 每次保存破坏手写 YAML |
| 🟡 P1 | `credentials` vs `variables` 重叠 | 冗余配置，增加认知负担 |
| 🟡 P1 | `scopes` 被静默丢弃 | 写了等于没写，误导用户 |
| 🟡 P2 | 未匹配变量静默通过 | 调试困难 |
| 🔵 P3 | 变量值类型单一 | 暂无明显问题，未来留意 |
