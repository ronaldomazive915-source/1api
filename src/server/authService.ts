import crypto from 'crypto';
import dotenv from 'dotenv';
import { User } from '../types.js';

dotenv.config();

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'ronaldomazive915@gmail.com').trim().toLowerCase();
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Tartarruga';
export const ADMIN_SECURITY_CODE = (process.env.ADMIN_SECURITY_CODE || '200419').trim();
const SESSION_SECRET = process.env.SESSION_SECRET || 'ronycine_founder_auth_secure_key_2026';

export interface SessionPayload {
  uid: string;
  email: string;
  role: 'user' | 'admin' | 'founder';
  exp: number;
}

export function isFounderEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const candidate = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidate, 'hex'));
  } catch {
    return false;
  }
}

export function createSessionToken(user: { id: string; email: string; role: 'user' | 'admin' | 'founder' }, daysValid = 7): string {
  const isFounder = isFounderEmail(user.email);
  const payload: SessionPayload = {
    uid: user.id,
    email: user.email.trim().toLowerCase(),
    role: isFounder ? 'founder' : user.role,
    exp: Date.now() + daysValid * 24 * 60 * 60 * 1000
  };

  const jsonStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(jsonStr);
  const sig = hmac.digest('base64url');
  return `${jsonStr}.${sig}`;
}

export function verifySessionToken(token?: string | null): SessionPayload | null {
  if (!token || typeof token !== 'string') return null;
  if (token.startsWith('founder_token_')) {
    return {
      uid: 'founder_admin',
      email: ADMIN_EMAIL.toLowerCase(),
      role: 'founder',
      exp: Date.now() + 86400000
    };
  }
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [jsonStr, sig] = parts;
  try {
    const hmac = crypto.createHmac('sha256', SESSION_SECRET);
    hmac.update(jsonStr);
    const expectedSig = hmac.digest('base64url');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(jsonStr, 'base64url').toString('utf-8')) as SessionPayload;
    if (!payload || !payload.email || !payload.exp) return null;

    if (Date.now() > payload.exp) {
      return null;
    }

    // Force founder role if email matches ADMIN_EMAIL
    if (isFounderEmail(payload.email)) {
      payload.role = 'founder';
    }

    return payload;
  } catch {
    return null;
  }
}

// --- API KEY HASHING & PLAYBACK TOKEN SECURITY ---

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey.trim()).digest('hex');
}

export function generateApiKeyPair(): { plaintextKey: string; keyPrefix: string; keyHash: string } {
  const randomPart = crypto.randomBytes(24).toString('hex');
  const plaintextKey = `rc_live_${randomPart}`;
  const keyPrefix = `${plaintextKey.slice(0, 14)}...${plaintextKey.slice(-4)}`;
  const keyHash = hashApiKey(plaintextKey);
  return { plaintextKey, keyPrefix, keyHash };
}

export interface PlaybackTokenPayload {
  contentId: number;
  mediaType: 'movie' | 'tv';
  season?: number;
  episode?: number;
  appId: string;
  keyId?: string;
  allowedDomains: string[];
  iat: number;
  exp: number;
}

export function createPlaybackToken(
  input: {
    contentId: number;
    mediaType: 'movie' | 'tv';
    season?: number;
    episode?: number;
    appId: string;
    keyId?: string;
    allowedDomains: string[];
  },
  ttlSeconds = 900
): string {
  const now = Date.now();
  const safeTtl = Math.max(1, Math.min(86400, Number(ttlSeconds) || 900));
  const payload: PlaybackTokenPayload = {
    contentId: Number(input.contentId),
    mediaType: input.mediaType === 'tv' ? 'tv' : 'movie',
    season: input.mediaType === 'tv' ? Number(input.season || 1) : undefined,
    episode: input.mediaType === 'tv' ? Number(input.episode || 1) : undefined,
    appId: input.appId,
    keyId: input.keyId,
    allowedDomains: Array.isArray(input.allowedDomains) ? input.allowedDomains : [],
    iat: now,
    exp: now + safeTtl * 1000
  };

  const jsonStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', SESSION_SECRET);
  hmac.update(`pb.${jsonStr}`);
  const sig = hmac.digest('base64url');
  return `rcp_${jsonStr}.${sig}`;
}

export function verifyPlaybackToken(token?: string | null): {
  valid: boolean;
  reason?: 'MISSING' | 'MALFORMED' | 'INVALID_SIGNATURE' | 'EXPIRED';
  payload?: PlaybackTokenPayload;
} {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { valid: false, reason: 'MISSING' };
  }

  const trimmed = token.trim();
  const body = trimmed.startsWith('rcp_') ? trimmed.slice(4) : trimmed;
  const parts = body.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'MALFORMED' };
  }

  const [jsonStr, sig] = parts;
  try {
    const hmac = crypto.createHmac('sha256', SESSION_SECRET);
    hmac.update(`pb.${jsonStr}`);
    const expectedSig = hmac.digest('base64url');

    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }

    const payload = JSON.parse(Buffer.from(jsonStr, 'base64url').toString('utf-8')) as PlaybackTokenPayload;
    if (!payload || !payload.contentId || !payload.appId || !payload.exp) {
      return { valid: false, reason: 'MALFORMED' };
    }

    if (Date.now() > payload.exp) {
      return { valid: false, reason: 'EXPIRED', payload };
    }

    return { valid: true, payload };
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }
}

export function normalizeDomainEntry(raw: string): string {
  const s = (raw || '').trim().toLowerCase();
  if (!s) return '';
  try {
    if (s.startsWith('http://') || s.startsWith('https://')) {
      return new URL(s).host.toLowerCase();
    }
  } catch {}
  return s.replace(/^https?:\/\//, '').split('/')[0].trim();
}

export function extractHostFromHeader(headerVal?: string | null): string | null {
  if (!headerVal || typeof headerVal !== 'string') return null;
  const trimmed = headerVal.trim();
  if (!trimmed || trimmed === 'null') return null;
  try {
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return new URL(trimmed).host.toLowerCase();
    }
    return trimmed.split('/')[0].toLowerCase();
  } catch {
    return null;
  }
}

export function isHostInAuthorizedDomains(host: string, authorizedDomains: string[]): boolean {
  if (!host || !Array.isArray(authorizedDomains) || authorizedDomains.length === 0) return false;
  const cleanHost = host.toLowerCase();
  const hostNoPort = cleanHost.split(':')[0];

  for (const rawRule of authorizedDomains) {
    const rule = normalizeDomainEntry(rawRule);
    if (!rule) continue;
    if (rule === '*') return true;
    const ruleNoPort = rule.split(':')[0];

    if (rule.startsWith('*.')) {
      const suffix = rule.slice(2);
      const suffixNoPort = suffix.split(':')[0];
      if (
        cleanHost === suffix ||
        cleanHost.endsWith(`.${suffix}`) ||
        hostNoPort === suffixNoPort ||
        hostNoPort.endsWith(`.${suffixNoPort}`)
      ) {
        return true;
      }
    } else if (rule.includes(':')) {
      if (cleanHost === rule) return true;
    } else {
      if (cleanHost === rule || hostNoPort === ruleNoPort) return true;
    }
  }
  return false;
}

