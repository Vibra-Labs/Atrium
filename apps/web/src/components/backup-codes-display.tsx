"use client";

import { useState } from "react";

interface Props {
  codes: string[];
  onAcknowledge: () => void;
}

export function BackupCodesDisplay({ codes, onAcknowledge }: Props) {
  const [copied, setCopied] = useState(false);

  const text = codes.join("\n");

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "atrium-2fa-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-lg border bg-amber-50 p-4">
      <h3 className="font-semibold text-amber-900">Save your recovery codes</h3>
      <p className="mt-1 text-sm text-amber-800">
        These one-time codes let you sign in if you lose access to your authenticator app.
        They are shown only once.
      </p>
      <pre className="mt-3 rounded bg-white p-3 font-mono text-sm">
        {codes.map((c) => `${c}\n`).join("")}
      </pre>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded border px-3 py-1.5 text-sm hover:bg-white"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          onClick={download}
          className="rounded border px-3 py-1.5 text-sm hover:bg-white"
        >
          Download .txt
        </button>
        <button
          type="button"
          onClick={onAcknowledge}
          className="ml-auto rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800"
        >
          I've saved these
        </button>
      </div>
    </div>
  );
}
