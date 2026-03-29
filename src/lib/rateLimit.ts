/**
 * 간단한 메모리 기반 Rate Limiter
 * Vercel 서버리스 환경에서는 인스턴스 간 상태 공유가 안 되므로
 * 완벽한 제한은 아니지만 단일 인스턴스 내 기본 DoS 방어에 유효
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/** 만료된 항목 정리 (메모리 누수 방지) */
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}

/**
 * @param key     식별자 (IP 주소 등)
 * @param limit   허용 횟수
 * @param windowMs 시간 창 (밀리초)
 * @returns { allowed, remaining, resetAt }
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count += 1;

  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}
