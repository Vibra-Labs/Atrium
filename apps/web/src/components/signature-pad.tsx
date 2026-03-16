"use client";

import { useRef, useState, useEffect, useCallback } from "react";

interface SignaturePadProps {
  onSignatureChange: (dataUrl: string | null, method: "draw" | "type") => void;
}

export function SignaturePad({ onSignatureChange }: SignaturePadProps) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typedText, setTypedText] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const hasDrawn = useRef(false);

  const getCanvas = () => canvasRef.current;
  const getCtx = () => getCanvas()?.getContext("2d") ?? null;

  const clearCanvas = useCallback(() => {
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const emitSignature = useCallback(() => {
    const canvas = getCanvas();
    if (!canvas) return;
    onSignatureChange(canvas.toDataURL("image/png"), mode);
  }, [onSignatureChange, mode]);

  const handleClear = useCallback(() => {
    clearCanvas();
    hasDrawn.current = false;
    setTypedText("");
    onSignatureChange(null, mode);
  }, [clearCanvas, onSignatureChange, mode]);

  // Initialize canvas dimensions
  useEffect(() => {
    const canvas = getCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(2, 2);
    clearCanvas();
  }, [clearCanvas]);

  // Re-clear when mode switches
  useEffect(() => {
    handleClear();
  }, [mode, handleClear]);

  // Render typed text onto canvas
  useEffect(() => {
    if (mode !== "type") return;
    clearCanvas();
    const canvas = getCanvas();
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    if (!typedText.trim()) {
      onSignatureChange(null, "type");
      return;
    }
    const h = canvas.height / 2;
    const w = canvas.width / 2;
    ctx.font = `italic 32px "Georgia", "Times New Roman", serif`;
    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(typedText, w / 2, h / 2, w - 32);
    emitSignature();
  }, [typedText, mode, clearCanvas, emitSignature, onSignatureChange]);

  const getPos = (e: React.PointerEvent) => {
    const canvas = getCanvas()!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode !== "draw") return;
    isDrawing.current = true;
    hasDrawn.current = true;
    const ctx = getCtx();
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDrawing.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const onPointerUp = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (hasDrawn.current) emitSignature();
  };

  const btnBase =
    "px-3 py-1.5 text-sm rounded-lg border transition-colors cursor-pointer";
  const btnActive = `${btnBase} bg-[var(--primary)] text-white border-[var(--primary)]`;
  const btnInactive = `${btnBase} bg-[var(--background)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--muted)]`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className={mode === "draw" ? btnActive : btnInactive} onClick={() => setMode("draw")}>Draw</button>
        <button className={mode === "type" ? btnActive : btnInactive} onClick={() => setMode("type")}>Type</button>
        <button
          className="ml-auto px-3 py-1.5 text-sm rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors cursor-pointer"
          onClick={handleClear}
        >
          Clear
        </button>
      </div>

      {mode === "type" && (
        <input
          type="text"
          value={typedText}
          onChange={(e) => setTypedText(e.target.value)}
          placeholder="Type your signature..."
          autoFocus
          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]"
          style={{ fontFamily: `"Georgia", "Times New Roman", serif`, fontStyle: "italic", fontSize: "1.1rem" }}
        />
      )}

      <canvas
        ref={canvasRef}
        className="w-full rounded-lg border border-[var(--border)] bg-white touch-none"
        style={{ height: 160, cursor: mode === "draw" ? "crosshair" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
    </div>
  );
}
