const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export async function downloadFile(fileId: string, filename: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/files/${fileId}/download`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
