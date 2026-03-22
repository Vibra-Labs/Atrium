"use client";

import { useRef } from "react";
import { Plus } from "lucide-react";

export const PRESET_COLORS = [
  { hex: "#ef4444", name: "Red" },
  { hex: "#3b82f6", name: "Blue" },
  { hex: "#006b68", name: "Atrium" },
  { hex: "#22c55e", name: "Green" },
  { hex: "#f59e0b", name: "Amber" },
  { hex: "#8b5cf6", name: "Violet" },
] as const;

export function ColorPatchGrid({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isCustom = !PRESET_COLORS.some((c) => c.hex === value);

  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Label color">
      {PRESET_COLORS.map((color) => {
        const selected = value === color.hex;
        return (
          <button
            key={color.hex}
            type="button"
            role="radio"
            aria-checked={selected}
            title={color.name}
            aria-label={color.name}
            onClick={() => onChange(color.hex)}
            className={`rounded-full transition-transform hover:scale-110 active:scale-95 ${
              selected ? "scale-110" : ""
            }`}
            style={{
              width: "18px",
              height: "18px",
              backgroundColor: color.hex,
              boxShadow: selected
                ? `0 0 0 2px var(--background), 0 0 0 3.5px ${color.hex}`
                : "inset 0 0 0 1px rgba(0,0,0,0.08)",
            }}
          />
        );
      })}
      <div className="relative">
        <button
          type="button"
          title="Custom color"
          aria-label="Custom color"
          onClick={() => inputRef.current?.click()}
          className={`rounded-full flex items-center justify-center transition-transform hover:scale-110 active:scale-95 ${
            isCustom ? "scale-110" : "border border-[var(--border)] bg-[var(--background)]"
          }`}
          style={{
            width: "18px",
            height: "18px",
            ...(isCustom ? {
              backgroundColor: value,
              boxShadow: `0 0 0 2px var(--background), 0 0 0 3.5px ${value}`,
            } : {}),
          }}
        >
          {!isCustom && <Plus size={10} className="text-[var(--muted-foreground)]" />}
        </button>
        <input
          ref={inputRef}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          tabIndex={-1}
        />
      </div>
    </div>
  );
}
