"use client";

function textColorForBackground(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // W3C relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function LabelBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex px-1.5 py-px rounded-full text-[10px] font-medium leading-4"
      style={{ backgroundColor: color, color: textColorForBackground(color) }}
    >
      {name}
    </span>
  );
}
