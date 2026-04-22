import { lookup } from "dns/promises";
import { isIP } from "net";

/**
 * SSRF guard. Rejects requests whose hostname resolves to a private,
 * loopback, link-local, multicast, or broadcast address. Used by the link
 * unfurler to fetch arbitrary URLs safely.
 */

// IPv4 CIDR ranges we refuse to connect to.
const PRIVATE_V4: [number, number][] = [
  // [network, mask-bit-count]
  ipv4ToInt("0.0.0.0") >>> 0 as unknown as [number, number][][0] as any, // placeholder, filled below
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => isNaN(n) || n < 0 || n > 255)) {
    return -1;
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

interface CidrV4 {
  network: number;
  maskBits: number;
}

function cidr(ip: string, bits: number): CidrV4 {
  return { network: ipv4ToInt(ip), maskBits: bits };
}

// Reset PRIVATE_V4 with real data now that helpers exist.
(PRIVATE_V4 as unknown as CidrV4[]).length = 0;
(PRIVATE_V4 as unknown as CidrV4[]).push(
  cidr("0.0.0.0", 8), // "this network"
  cidr("10.0.0.0", 8), // private
  cidr("100.64.0.0", 10), // carrier-grade NAT
  cidr("127.0.0.0", 8), // loopback
  cidr("169.254.0.0", 16), // link-local (incl. 169.254.169.254 AWS metadata)
  cidr("172.16.0.0", 12), // private
  cidr("192.0.0.0", 24), // IETF protocol assignments
  cidr("192.0.2.0", 24), // TEST-NET-1
  cidr("192.168.0.0", 16), // private
  cidr("198.18.0.0", 15), // network interconnect benchmarks
  cidr("198.51.100.0", 24), // TEST-NET-2
  cidr("203.0.113.0", 24), // TEST-NET-3
  cidr("224.0.0.0", 4), // multicast
  cidr("240.0.0.0", 4), // reserved + broadcast (255.255.255.255)
);

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === -1) return true; // malformed → treat as unsafe
  for (const range of PRIVATE_V4 as unknown as CidrV4[]) {
    const mask = range.maskBits === 0 ? 0 : (~0 << (32 - range.maskBits)) >>> 0;
    if ((n & mask) === (range.network & mask)) return true;
  }
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true; // unspecified
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("ff")) return true; // multicast ff00::/8
  // IPv4-mapped: ::ffff:a.b.c.d
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP
}

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

/**
 * Check that `hostname` resolves to a public IP. Throws `SsrfError` otherwise.
 * If the hostname IS an IP literal, validates that directly.
 */
async function assertHostnameIsPublic(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new SsrfError(`Refusing to fetch private address: ${hostname}`);
    }
    return;
  }
  const results = await lookup(hostname, { all: true });
  if (!results.length) {
    throw new SsrfError(`Could not resolve hostname: ${hostname}`);
  }
  for (const r of results) {
    if (isPrivateAddress(r.address)) {
      throw new SsrfError(
        `Hostname ${hostname} resolves to private address ${r.address}`,
      );
    }
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Accept header to send (default: text/html). */
  accept?: string;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  body: string;
}

const DEFAULTS = {
  timeoutMs: 5000,
  maxBytes: 1_000_000, // 1 MB
  maxRedirects: 3,
};

/**
 * Fetch a URL with SSRF protection and hard limits on timeout, size, and
 * redirects. Follows redirects manually so the IP can be re-checked per hop.
 *
 * - https only (prevents plaintext MITM + cleartext metadata leakage)
 * - DNS-level private-address check on every hop
 * - Aborts after timeoutMs or when body exceeds maxBytes
 */
export async function safeFetch(
  urlString: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const opts = { ...DEFAULTS, ...options };
  const accept = options.accept ?? "text/html,application/xhtml+xml";

  let current: URL;
  try {
    current = new URL(urlString);
  } catch {
    throw new SsrfError("Invalid URL");
  }

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    if (current.protocol !== "https:") {
      throw new SsrfError(
        `Refusing non-https URL: ${current.protocol}//${current.hostname}`,
      );
    }
    await assertHostnameIsPublic(current.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    let response: Response;
    try {
      response = await fetch(current.toString(), {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          Accept: accept,
          "User-Agent": "AtriumLinkPreview/1.0 (+https://atrium.app)",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    // Redirects: re-check the next hop.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new SsrfError(`Redirect ${response.status} without Location`);
      }
      current = new URL(location, current);
      continue;
    }

    // Terminal response. Read body with a size cap.
    const contentType = response.headers.get("content-type");
    const body = await readCapped(response, opts.maxBytes);
    return {
      finalUrl: current.toString(),
      status: response.status,
      contentType,
      body,
    };
  }

  throw new SsrfError("Too many redirects");
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total > maxBytes ? maxBytes : total);
  let offset = 0;
  for (const c of chunks) {
    if (offset + c.byteLength > combined.byteLength) {
      combined.set(c.subarray(0, combined.byteLength - offset), offset);
      break;
    }
    combined.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}
