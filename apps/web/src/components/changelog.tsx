import fs from "fs";
import path from "path";

function parseChangelog(raw: string) {
  const sections: { version: string; date: string; content: string }[] = [];
  const lines = raw.split("\n");
  let current: { version: string; date: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = line.match(/^## \[(.+?)\]\s*—?\s*([\d-]+)?/);
    if (match) {
      if (current) sections.push({ version: current.version, date: current.date, content: current.lines.join("\n") });
      current = { version: match[1], date: match[2] || "", lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ version: current.version, date: current.date, content: current.lines.join("\n") });
  return sections;
}

function readChangelog(): string {
  const candidates = [
    path.join(process.cwd(), "CHANGELOG.md"),
    path.join(process.cwd(), "../../CHANGELOG.md"),
    path.join(process.cwd(), "../../../CHANGELOG.md"),
  ];
  for (const p of candidates) {
    try {
      return fs.readFileSync(p, "utf-8");
    } catch {
      // try next
    }
  }
  return "";
}

function renderLine(line: string, i: number) {
  if (line.startsWith("#### ")) {
    return <h4 key={i} className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mt-3 mb-1.5">{line.replace("#### ", "")}</h4>;
  }
  if (line.startsWith("### ")) {
    return <h3 key={i} className="text-sm font-semibold mt-4 mb-2">{line.replace("### ", "")}</h3>;
  }
  if (line.startsWith("- **")) {
    const match = line.match(/^- \*\*(.+?)\*\*\s*—?\s*(.*)/);
    if (match) {
      return (
        <div key={i} className="ml-2 mb-1.5">
          <span className="text-sm font-medium">{match[1]}</span>
          {match[2] && <span className="text-sm text-[var(--muted-foreground)]"> — {match[2]}</span>}
        </div>
      );
    }
  }
  if (line.startsWith("- ")) {
    return <li key={i} className="text-sm text-[var(--muted-foreground)] ml-4 mb-0.5">{line.replace("- ", "")}</li>;
  }
  if (line.trim() === "") return null;
  return <p key={i} className="text-sm text-[var(--muted-foreground)] mb-1">{line}</p>;
}

export function Changelog() {
  const raw = readChangelog();
  const sections = parseChangelog(raw);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Changelog</h1>
      <p className="text-sm text-[var(--muted-foreground)] mb-6">What&apos;s new in Atrium</p>

      {sections.length === 0 && (
        <p className="text-sm text-[var(--muted-foreground)]">No changelog available.</p>
      )}

      <div className="space-y-8">
        {sections.map((section) => (
          <div key={section.version}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-[var(--primary)] text-white">
                v{section.version}
              </span>
              {section.date && (
                <span className="text-xs text-[var(--muted-foreground)]">{section.date}</span>
              )}
            </div>
            <div className="border-l-2 border-[var(--border)] pl-4">
              {section.content.split("\n").map((line, i) => renderLine(line, i)).filter(Boolean)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
