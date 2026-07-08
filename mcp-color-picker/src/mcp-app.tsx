/**
 * Color Picker MCP App
 *
 * Interactive color picker with saturation/value canvas, hue/alpha sliders,
 * and color value display (HEX, RGB, HSL, HSV).
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./mcp-app.module.css";

// ─── Color Conversion Utilities ──────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)      { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ─── Canvas Drawing ──────────────────────────────────────────────────────────

function drawSvPicker(
  canvas: HTMLCanvasElement,
  hue: number,
  svX: number,
  svY: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  const [hr, hg, hb] = hsvToRgb(hue, 1, 1);

  const gradH = ctx.createLinearGradient(0, 0, w, 0);
  gradH.addColorStop(0, `rgb(${255},${255},${255})`);
  gradH.addColorStop(1, `rgb(${hr},${hg},${hb})`);
  ctx.fillStyle = gradH;
  ctx.fillRect(0, 0, w, h);

  const gradV = ctx.createLinearGradient(0, 0, 0, h);
  gradV.addColorStop(0, "rgba(0,0,0,0)");
  gradV.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = gradV;
  ctx.fillRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(svX * w, svY * h, 8, 0, Math.PI * 2);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(svX * w, svY * h, 7, 0, Math.PI * 2);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawHueSlider(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 360; i += 30) {
    const [r, g, b] = hsvToRgb(i, 1, 1);
    grad.addColorStop(i / 360, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, h / 2);
  ctx.fill();
}

// ─── Main App ────────────────────────────────────────────────────────────────

function ColorPickerApp() {
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Color Picker App", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (createdApp: App) => {
      createdApp.onteardown = async () => ({});
      createdApp.ontoolinput = () => {};
      createdApp.ontoolresult = () => {};
      createdApp.onerror = console.error;
      createdApp.onhostcontextchanged = (params: McpUiHostContext) => {
        setHostContext((prev: McpUiHostContext | undefined) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <div><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div>Connecting...</div>;

  return <ColorPickerInner app={app} hostContext={hostContext} />;
}

interface ColorPickerInnerProps {
  app: App;
  hostContext?: McpUiHostContext;
}

function ColorPickerInner({ app, hostContext }: ColorPickerInnerProps) {
  const [hue, setHue] = useState(210);
  const [sat, setSat] = useState(0.65);
  const [val, setVal] = useState(0.9);
  const [alpha, setAlpha] = useState(1);

  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const hueCanvasRef = useRef<HTMLCanvasElement>(null);
  const [svDragging, setSvDragging] = useState(false);
  const [hueDragging, setHueDragging] = useState(false);

  const [toastMsg, setToastMsg] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const [r, g, b] = hsvToRgb(hue, sat, val);
  const hex = rgbToHex(r, g, b);
  const [hslH, hslS, hslL] = rgbToHsl(r, g, b);

  useEffect(() => {
    if (svCanvasRef.current) drawSvPicker(svCanvasRef.current, hue, sat, val);
  }, [hue, sat, val]);

  useEffect(() => {
    if (hueCanvasRef.current) drawHueSlider(hueCanvasRef.current);
  }, []);

  useEffect(() => {
    if (app) {
      app.updateModelContext({
        content: [
          {
            type: "text",
            text: `User selected color: ${hex} (RGB: ${r},${g},${b} | HSL: ${hslH},${hslS}%,${hslL}% | Alpha: ${Math.round(alpha * 100)}%)`,
          },
        ],
      });
    }
  }, [hex, r, g, b, hslH, hslS, hslL, alpha, app]);

  const getSvFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      setSat(x);
      setVal(1 - y);
    },
    [],
  );

  const handleSvPointerDown = useCallback(
    (e: React.PointerEvent) => {
      setSvDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      getSvFromEvent(e.clientX, e.clientY);
    },
    [getSvFromEvent],
  );

  const handleSvPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (svDragging) getSvFromEvent(e.clientX, e.clientY);
    },
    [svDragging, getSvFromEvent],
  );

  const handleSvPointerUp = useCallback(() => setSvDragging(false), []);

  const getHueFromEvent = useCallback((clientX: number) => {
    const canvas = hueCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHue(x * 360);
  }, []);

  const handleHuePointerDown = useCallback(
    (e: React.PointerEvent) => {
      setHueDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      getHueFromEvent(e.clientX);
    },
    [getHueFromEvent],
  );

  const handleHuePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (hueDragging) getHueFromEvent(e.clientX);
    },
    [hueDragging, getHueFromEvent],
  );

  const handleHuePointerUp = useCallback(() => setHueDragging(false), []);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1500);
  }, []);

  const copyValue = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => showToast(`Copied: ${text}`));
    },
    [showToast],
  );

  const hexAlpha = alpha < 1
    ? hex + Math.round(alpha * 255).toString(16).padStart(2, "0")
    : hex;
  const rgbaStr = alpha < 1
    ? `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`
    : `rgb(${r}, ${g}, ${b})`;
  const hslaStr = `hsla(${hslH}, ${hslS}%, ${hslL}%, ${alpha.toFixed(2)})`;
  const hsvStr = `hsv(${Math.round(hue)}, ${Math.round(sat * 100)}%, ${Math.round(val * 100)}%)`;

  // 向 agent 发送选中的颜色，触发 agent 回复
  const confirmColor = useCallback(() => {
    const colorSummary = `用户选择了颜色 ${hexAlpha} (RGB: ${r},${g},${b} | HSL: ${hslH},${hslS}%,${hslL}% | Alpha: ${Math.round(alpha * 100)}%)`;
    app.sendMessage({
      role: "user",
      content: [{ type: "text", text: colorSummary }],
    });
    showToast(`已发送: ${hexAlpha}`);
  }, [hexAlpha, r, g, b, hslH, hslS, hslL, alpha, app, showToast]);

  return (
    <main
      className={styles.main}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <h2 className={styles.title}>🎨 Color Picker</h2>

      <div
        className={styles.preview}
        style={{ backgroundColor: `rgba(${r},${g},${b},${alpha})` }}
      >
        <div className={styles.previewOverlay}>
          {hexAlpha}
        </div>
      </div>

      <div
        className={styles.svPicker}
        onPointerDown={handleSvPointerDown}
        onPointerMove={handleSvPointerMove}
        onPointerUp={handleSvPointerUp}
      >
        <canvas
          ref={svCanvasRef}
          width={400}
          height={200}
          style={{ width: "100%", height: "100%", display: "block" }}
        />
        <div
          className={styles.svCursor}
          style={{
            left: `${sat * 100}%`,
            top: `${(1 - val) * 100}%`,
          }}
        />
      </div>

      <div className={styles.hueSection}>
        <span className={styles.sliderLabel}>Hue: {Math.round(hue)}°</span>
        <canvas
          ref={hueCanvasRef}
          width={400}
          height={24}
          className={styles.hueSlider}
          style={{ width: "100%", cursor: "pointer" }}
          onPointerDown={handleHuePointerDown}
          onPointerMove={handleHuePointerMove}
          onPointerUp={handleHuePointerUp}
        />
      </div>

      <div className={styles.hueSection}>
        <span className={styles.sliderLabel}>Alpha: {Math.round(alpha * 100)}%</span>
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: 2,
              left: 2,
              right: 2,
              height: 16,
              borderRadius: 8,
              background: `linear-gradient(to right, transparent, rgb(${r},${g},${b}))`,
              pointerEvents: "none",
            }}
          />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={alpha}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAlpha(parseFloat(e.target.value))}
            className={styles.alphaSlider}
          />
        </div>
      </div>

      <div className={styles.valuesSection}>
        <span className={styles.sliderLabel}>Click to copy</span>
        <div className={styles.valuesGrid}>
          <div className={styles.valueCard} onClick={() => copyValue(hexAlpha)}>
            <span className={styles.valueLabel}>HEX</span>
            <span className={styles.valueText}>{hexAlpha}</span>
          </div>
          <div className={styles.valueCard} onClick={() => copyValue(rgbaStr)}>
            <span className={styles.valueLabel}>RGB</span>
            <span className={styles.valueText}>{rgbaStr}</span>
          </div>
          <div className={styles.valueCard} onClick={() => copyValue(hslaStr)}>
            <span className={styles.valueLabel}>HSL</span>
            <span className={styles.valueText}>{hslaStr}</span>
          </div>
          <div className={styles.valueCard} onClick={() => copyValue(hsvStr)}>
            <span className={styles.valueLabel}>HSV</span>
            <span className={styles.valueText}>{hsvStr}</span>
          </div>
        </div>
      </div>

      <button className={styles.confirmButton} onClick={confirmColor}>
        ✓ 确认选择并发送给 Agent
      </button>

      <div className={`${styles.toast} ${toastVisible ? styles.toastVisible : ""}`}>
        {toastMsg}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<ColorPickerApp />);
