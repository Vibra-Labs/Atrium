"use client";

import { useState } from "react";

interface RecoveryCodesProps {
  codes: string[];
}

/** The 10 one-time recovery codes, with ways to keep them. */
export function RecoveryCodes({ codes }: RecoveryCodesProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const text: string = codes.join("\n");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      console.error("Copy failed", err);
    }
  };

  const download = (): void => {
    const url: string = URL.createObjectURL(new Blob([`Atrium recovery codes\n\n${text}\n`], { type: "text/plain" }));
    const a: HTMLAnchorElement = document.createElement("a");
    a.href = url;
    a.download = "atrium-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-lg border border-[var(--border)] p-4 font-mono text-sm">
        {codes.map((code: string) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={copy} className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--muted)]">
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={download} className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--muted)]">
          Download
        </button>
        <button type="button" onClick={() => window.print()} className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:bg-[var(--muted)]">
          Print
        </button>
      </div>
      <p className="text-xs text-[var(--muted-foreground)]">
        Each code works once. Keep them somewhere safe, away from your phone.
      </p>
    </div>
  );
}
