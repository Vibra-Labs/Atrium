import { describe, test, expect } from "bun:test";
import { isPrivateAddress, safeFetch, SsrfError } from "./safe-fetch";

describe("isPrivateAddress — IPv4", () => {
  test("flags 0.0.0.0", () => {
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
  });

  test("flags loopback (127.x.x.x)", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("127.1.2.3")).toBe(true);
  });

  test("flags the classic private ranges", () => {
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("172.16.5.5")).toBe(true);
    expect(isPrivateAddress("172.31.255.254")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  test("flags link-local incl. the AWS metadata address 169.254.169.254", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("169.254.0.1")).toBe(true);
  });

  test("flags carrier-grade NAT (100.64.0.0/10)", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("100.127.255.254")).toBe(true);
    // Just outside CGNAT is public.
    expect(isPrivateAddress("100.128.0.1")).toBe(false);
  });

  test("flags multicast and reserved", () => {
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("255.255.255.255")).toBe(true);
  });

  test("allows typical public addresses", () => {
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.15.0.1")).toBe(false); // just outside 172.16/12
    expect(isPrivateAddress("172.32.0.1")).toBe(false); // just outside 172.16/12
  });

  test("malformed input is treated as unsafe", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
  });
});

describe("isPrivateAddress — IPv6", () => {
  test("flags loopback ::1 and unspecified ::", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::")).toBe(true);
  });

  test("flags link-local (fe80::)", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
  });

  test("flags ULA (fc00::/7)", () => {
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("fd12:3456::1")).toBe(true);
  });

  test("flags multicast (ff00::/8)", () => {
    expect(isPrivateAddress("ff02::1")).toBe(true);
  });

  test("flags IPv4-mapped private addresses (::ffff:127.0.0.1)", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:192.168.1.1")).toBe(true);
    // IPv4-mapped public address is fine.
    expect(isPrivateAddress("::ffff:1.1.1.1")).toBe(false);
  });

  test("allows typical public IPv6", () => {
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
});

describe("safeFetch — pre-flight guards", () => {
  test("rejects non-https schemes before any I/O", async () => {
    await expect(safeFetch("http://example.com/")).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(safeFetch("ftp://example.com/")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  test("rejects IP literals in the private range", async () => {
    await expect(safeFetch("https://127.0.0.1/")).rejects.toBeInstanceOf(
      SsrfError,
    );
    await expect(safeFetch("https://169.254.169.254/")).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  test("rejects malformed URLs", async () => {
    await expect(safeFetch("not a url")).rejects.toBeInstanceOf(SsrfError);
  });
});
