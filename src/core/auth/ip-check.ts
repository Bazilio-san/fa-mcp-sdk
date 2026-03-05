/**
 * IP address parsing and CIDR matching utilities for JWT IP checking.
 * Pure TypeScript implementation — no external dependencies.
 */

/**
 * Parses IP string (comma/semicolon/space-separated) into array of trimmed non-empty entries.
 * Each entry is either a plain IP or a CIDR notation (e.g., "10.0.0.0/24").
 */
export function parseIpList (ipStr: string): string[] {
  if (!ipStr) {
    return [];
  }
  return ipStr
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalizes an IP address string:
 * - Strips IPv4-mapped IPv6 prefix (::ffff:x.x.x.x → x.x.x.x)
 * - Trims whitespace
 */
function normalizeIp (ip: string): string {
  ip = ip.trim();
  // Strip IPv4-mapped IPv6 prefix
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (mapped?.[1]) {
    return mapped[1];
  }
  return ip;
}

/**
 * Parses an IPv4 address string into a 32-bit number.
 * Returns null if the string is not a valid IPv4 address.
 */
function parseIpv4 (ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) {
    return null;
  }
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return null;
    }
    result = (result << 8) | n;
  }
  return result >>> 0; // ensure unsigned
}

/**
 * Parses an IPv6 address string into a BigInt (128-bit).
 * Supports full and abbreviated (::) notation.
 * Returns null if the string is not a valid IPv6 address.
 */
function parseIpv6 (ip: string): bigint | null {
  // Handle IPv4-mapped IPv6
  const v4mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  if (v4mapped?.[1]) {
    const v4 = parseIpv4(v4mapped[1]);
    if (v4 === null) {
      return null;
    }
    return BigInt(0xFFFF00000000n) | BigInt(v4);
  }

  const halves = ip.split('::');
  if (halves.length > 2) {
    return null;
  }

  let groups: string[] = [];
  if (halves.length === 2) {
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    if (missing < 0) {
      return null;
    }
    groups = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    groups = ip.split(':');
  }

  if (groups.length !== 8) {
    return null;
  }

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return null;
    }
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }
  return result;
}

/**
 * Checks if a client IP matches a single allowed entry (exact IP or CIDR).
 */
function matchEntry (clientIp: string, entry: string): boolean {
  const cidrMatch = /^(.+)\/(\d+)$/.exec(entry);

  if (cidrMatch?.[1] && cidrMatch[2]) {
    const subnet = normalizeIp(cidrMatch[1]);
    const prefixLen = Number(cidrMatch[2]);
    const clientNorm = normalizeIp(clientIp);

    // Try IPv4
    const subnetV4 = parseIpv4(subnet);
    const clientV4 = parseIpv4(clientNorm);
    if (subnetV4 !== null && clientV4 !== null) {
      if (prefixLen < 0 || prefixLen > 32) {
        return false;
      }
      if (prefixLen === 0) {
        return true;
      }
      const mask = (~0 << (32 - prefixLen)) >>> 0;
      return (subnetV4 & mask) === (clientV4 & mask);
    }

    // Try IPv6
    const subnetV6 = parseIpv6(subnet);
    const clientV6 = parseIpv6(clientNorm);
    if (subnetV6 !== null && clientV6 !== null) {
      if (prefixLen < 0 || prefixLen > 128) {
        return false;
      }
      if (prefixLen === 0) {
        return true;
      }
      const shift = BigInt(128 - prefixLen);
      return (subnetV6 >> shift) === (clientV6 >> shift);
    }

    return false;
  }

  // Exact match
  return normalizeIp(clientIp) === normalizeIp(entry);
}

/**
 * Checks if clientIp matches any entry in allowedIps.
 * Supports:
 *   - Exact match (IPv4 and IPv6)
 *   - CIDR subnet match (e.g., 10.0.0.0/24)
 *   - IPv4-mapped IPv6 normalization (::ffff:x.x.x.x → x.x.x.x)
 */
export function isIpAllowed (clientIp: string, allowedIps: string[]): boolean {
  if (!clientIp || !allowedIps.length) {
    return false;
  }
  return allowedIps.some((entry) => matchEntry(clientIp, entry));
}
