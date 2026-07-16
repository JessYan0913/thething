export async function GET() {
  // Sandbox proxy iframe — 使用 @modelcontextprotocol/ext-apps 协议
  // 充当宿主（parent）和 MCP App 视图（inner iframe）之间的 postMessage 中继
  //
  // F5: 放宽消息过滤，转发所有非 sandbox 内部消息（不限定 jsonrpc 格式）
  // F6: 支持 CSP 注入 — 根据资源元数据在 HTML 中注入 <meta> CSP 标签
  const html = `<!DOCTYPE html>
<html>
<head>
  <!--
    MCP Apps Sandbox Proxy
    ======================
    实现 MCP Apps 规范 (SEP-1865) 的双 iframe 沙箱架构：

    ┌─ Host (this app) ──────────────────────────────┐
    │  postMessage ↕                                  │
    │  ┌─ outer iframe (sandbox proxy) ─────────────┐ │
    │  │  postMessage ↕                              │ │
    │  │  ┌─ inner iframe (srcdoc = App HTML) ────┐ │ │
    │  │  │  MCP App View                          │ │ │
    │  │  └────────────────────────────────────────┘ │ │
    │  └─────────────────────────────────────────────┘ │
    └──────────────────────────────────────────────────┘

    Sandbox proxy 职责：
    1. 充当 Host ↔ App View 之间的 postMessage 中继
    2. 创建 inner iframe (srcdoc)，注入 HTML + CSP
    3. 转发所有非 sandbox 内部消息（不限制 jsonrpc 格式）
    4. CSP: 默认严格策略，由 App 声明的 csp 字段扩展
    5. Permission Policy: 根据 permissions 设置 allow 属性
  -->
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MCP App Sandbox</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; font-family: system-ui, sans-serif; }
    #root { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script>
    // MCP Apps 协议常量（sync with @modelcontextprotocol/ext-apps）
    var SANDBOX_PROXY_READY = "ui/notifications/sandbox-proxy-ready";
    var SANDBOX_RESOURCE_READY = "ui/notifications/sandbox-resource-ready";

    (function() {
      var appFrame = null;

      function postToParent(msg) {
        window.parent.postMessage(msg, '*');
      }

      function postToApp(msg) {
        if (appFrame && appFrame.contentWindow) {
          appFrame.contentWindow.postMessage(msg, '*');
        }
      }

      // F5: 统一消息处理 — 转发所有非 sandbox 内部消息
      // 不限定 jsonrpc 2.0 格式，确保生命周期消息不会在转发链中丢失
      window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data) return;

        // 检查是否是 sandbox 内部协议消息
        var method = data.method || '';
        var isSandboxMessage = method === SANDBOX_PROXY_READY || method === SANDBOX_RESOURCE_READY ||
                                method.indexOf('sandbox-') >= 0 || method.indexOf('sandbox/') >= 0;

        if (isSandboxMessage) {
          if (method === SANDBOX_RESOURCE_READY) {
            renderResource(data.params);
          }
          return; // 不转发 sandbox 内部消息
        }

        // 转发所有其他消息（不限制 jsonrpc 格式）
        if (event.source === window.parent || event.source == null) {
          postToApp(data);
          return;
        }
        if (appFrame && event.source === appFrame.contentWindow) {
          postToParent(data);
          return;
        }
      });

      // F6: 按指令名聚合 value 数组，最后输出每个指令一次。
      // CSP 规范里同名指令不会覆盖而是被浏览器忽略，因此不能简单 push 新的同名指令——
      // 否则 buildDefaultCSP 的 'none' 与资源声明的域名会同时存在，'none' 保留生效，域名失效。
      function buildDefaultCSP() {
        return {
          'default-src': ["'none'"],
          'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'media-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'none'"],
        };
      }

      function uniq(arr) {
        var seen = {};
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
        }
        return out;
      }

      // F6: 根据声明的 CSP 配置扩展默认策略
      function extendCSP(base, csp) {
        if (!csp) return base;
        if (csp.connectDomains && csp.connectDomains.length > 0) {
          // 覆盖 'none'：声明了 connectDomains 即代表放开网络访问
          base['connect-src'] = csp.connectDomains.slice();
        }
        if (csp.resourceDomains && csp.resourceDomains.length > 0) {
          var domains = csp.resourceDomains;
          // 追加到既有指令的 value 列表（去重），而非新增同名指令
          base['img-src'] = uniq(base['img-src'].concat(domains));
          base['script-src'] = uniq(base['script-src'].concat(domains));
          base['style-src'] = uniq(base['style-src'].concat(domains));
          base['font-src'] = uniq(base['font-src'].concat(domains));
        }
        if (csp.frameDomains && csp.frameDomains.length > 0) {
          base['frame-src'] = csp.frameDomains.slice();
        }
        return base;
      }

      function renderResource(params) {
        var html = params.html;
        var sandboxAttr = params.sandbox || 'allow-scripts allow-same-origin allow-forms';
        var csp = params.csp || null;
        var permissions = params.permissions || null;

        var root = document.getElementById('root');
        if (!html) {
          root.innerHTML = '<p style="color:red;padding:16px">No resource HTML</p>';
          return;
        }

        // F6: 始终注入默认 CSP，若资源声明了 csp 则在默认基础上扩展
        // srcdoc iframe 不支持 iframe[csp] 属性，必须用 meta 标签注入
        var directiveMap = buildDefaultCSP();
        if (csp) {
          directiveMap = extendCSP(directiveMap, csp);
        }
        var directiveStrs = Object.keys(directiveMap).map(function(k) {
          return k + ' ' + directiveMap[k].join(' ');
        });
        var cspMeta = '<meta http-equiv="Content-Security-Policy" content="' + directiveStrs.join('; ') + '">';
        html = html.replace('<head>', '<head>' + cspMeta);

        appFrame = document.createElement('iframe');
        appFrame.setAttribute('sandbox', sandboxAttr);
        // F6: 设置 Permission Policy (allow 属性)
        if (permissions) {
          var allowAttrs = [];
          if (permissions.camera) allowAttrs.push('camera');
          if (permissions.microphone) allowAttrs.push('microphone');
          if (permissions.geolocation) allowAttrs.push('geolocation');
          if (permissions.clipboardWrite) allowAttrs.push('clipboard-write');
          if (allowAttrs.length > 0) {
            appFrame.setAttribute('allow', allowAttrs.join('; '));
          }
        }
        appFrame.style.cssText = 'width:100%;height:100%;border:none;';
        appFrame.srcdoc = html;

        root.innerHTML = '';
        root.appendChild(appFrame);
      }

      // 通知父窗口 sandbox 已就绪
      postToParent({
        jsonrpc: '2.0',
        method: SANDBOX_PROXY_READY,
        params: {}
      });
    })();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
