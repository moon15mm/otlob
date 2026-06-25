import http from 'http';
import https from 'https';
import net from 'net';
import dns from 'dns';

/**
 * SSRF protection for outbound requests to shop-controlled URLs (POS webhook,
 * Foodics base URL). On a shared VPS, an unguarded fetch lets a tenant point us
 * at internal services (localhost, other apps, cloud metadata 169.254.169.254).
 *
 * Defense: a custom DNS lookup that rejects private/loopback/link-local/reserved
 * addresses AT CONNECT TIME — this also defeats DNS-rebinding, because validation
 * happens on the actual socket connection, not on a pre-flight resolve.
 */

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 0) return true;                          // 0.0.0.0/8
  if (a === 10) return true;                         // 10/8 private
  if (a === 127) return true;                        // loopback
  if (a === 169 && b === 254) return true;           // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12 private
  if (a === 192 && b === 168) return true;           // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0) return true;             // 192.0.0/24 + 192.0.2 (test-net)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a >= 224) return true;                         // 224/4 multicast + 240/4 reserved
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (/^fe[89ab]/.test(lower)) return true;          // fe80::/10 link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  if (lower.startsWith('ff')) return true;           // ff00::/8 multicast
  return false;
}

/** True if an IP literal must never be reached by an external integration URL. */
export function isBlockedAddress(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return isBlockedIPv4(ip);
  if (type === 6) return isBlockedIPv6(ip);
  return true; // unparseable → block to be safe
}

function guardedLookup(hostname: string, options: any, callback: any): void {
  const cb = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { all: true }, (err, addresses: any[]) => {
    if (err) return cb(err, '', 0);
    const safe = (addresses || []).filter((a) => !isBlockedAddress(a.address));
    if (safe.length === 0) {
      return cb(new Error(`SSRF blocked: ${hostname} resolves to a private/blocked address`), '', 0);
    }
    cb(null, safe[0].address, safe[0].family);
  });
}

export const ssrfSafeHttpAgent = new http.Agent({ lookup: guardedLookup as any });
export const ssrfSafeHttpsAgent = new https.Agent({ lookup: guardedLookup as any });

/** Validate scheme + (for literal IPs) the address before an outbound request. */
export function assertSafeOutboundUrl(rawUrl: string): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('رابط غير صالح.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('يجب أن يبدأ الرابط بـ http:// أو https://');
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip [] from IPv6 literals
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new Error('الرابط يشير إلى عنوان داخلي غير مسموح به.');
  }
  return u;
}
