export async function GET() {
  // Sandbox proxy iframe — 使用 @modelcontextprotocol/ext-apps 协议
  // 充当宿主（parent）和 MCP App 视图（inner iframe）之间的 postMessage 中继
  // 协议常量见: SANDBOX_PROXY_READY_METHOD, SANDBOX_RESOURCE_READY_METHOD
  const html = `<!DOCTYPE html>
<html>
<head>
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

      // 所有 jsonrpc 2.0 消息统一处理：双向中继
      window.addEventListener('message', function(event) {
        var data = event.data;
        if (!data || data.jsonrpc !== '2.0') return;

        // sandbox-resource-ready（来自父窗口，渲染 app HTML）
        if (data.method === SANDBOX_RESOURCE_READY) {
          var params = data.params || {};
          renderResource(params.html, params.sandbox, params.csp, params.allow);
          return;
        }

        // 转发非 sandbox 前缀的消息：
        //   - 父窗口 → app iframe
        //   - app iframe → 父窗口
        if (event.source === window.parent || event.source == null) {
          postToApp(data);
          return;
        }
        if (appFrame && event.source === appFrame.contentWindow) {
          postToParent(data);
          return;
        }
      });

      function renderResource(html, sandboxAttr, csp, allow) {
        var root = document.getElementById('root');
        if (!html) {
          root.innerHTML = '<p style="color:red;padding:16px">No resource HTML</p>';
          return;
        }

        appFrame = document.createElement('iframe');
        var sandbox = sandboxAttr || 'allow-scripts allow-same-origin';
        appFrame.setAttribute('sandbox', sandbox);
        if (allow) appFrame.setAttribute('allow', allow);
        if (csp) appFrame.setAttribute('csp', csp);
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
