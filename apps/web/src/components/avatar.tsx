"use client";

interface AvatarProps {
  name: string;
  image?: string | null;
  size?: number;
  className?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

export function Avatar({ name, image, size = 24, className = "" }: AvatarProps) {
  const style: React.CSSProperties = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={name}
        style={style}
        className={`rounded-full object-cover shrink-0 ${className}`}
      />
    );
  }
  return (
    <span
      style={{ ...style, backgroundColor: colorFromName(name) }}
      className={`inline-flex items-center justify-center rounded-full text-white font-medium shrink-0 select-none ${className}`}
      title={name}
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}
