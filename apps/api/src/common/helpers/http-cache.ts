import compression from "compression";
import type { Request, Response } from "express";

/** File and update-attachment bytes never change for a given id. */
export const DOWNLOAD_CACHE = "private, max-age=3600";

/**
 * A logo URL with `?k=<storageKey>` changes whenever the logo does (every
 * upload gets a fresh key), so it can be cached forever. Without the key the
 * URL is not content-addressed.
 */
export function logoCacheControl(key: string | undefined): string {
  return key ? "public, max-age=31536000, immutable" : "public, max-age=60";
}

const DOWNLOAD_PATH = /^\/api\/(files\/[^/]+\/download|updates\/[^/]+\/attachment)$/;

/** Compression filter: downloads are streamed as-is, everything else uses the default. */
export function shouldCompress(req: Request, res: Response): boolean {
  const path: string = req.originalUrl.split("?")[0];
  if (DOWNLOAD_PATH.test(path)) return false;
  return compression.filter(req, res);
}
