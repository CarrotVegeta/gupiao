import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ROTATION_DAYS,
  fetchSectorRotation,
  parseRotationDays,
  toSectorRotationResponse,
} from './sectorRotation';

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body));

const item = {
  plateCode: 'cls80457',
  plateName: '芯片产业链',
  latestChange: 2.77,
  appearCount: 17,
  maxChange: 3.7,
  avgChange: 2.1,
  firstSeen: '20260812',
  lastSeen: '20260918',
  days: ['20260812', '20260918'],
};

const validPayload = {
  days: 30,
  tradeDates: ['20260810', '20260918'],
  items: [item],
  fetchedAt: '2026-09-18T07:00:00.000Z',
  source: 'cls',
  status: 'fresh',
  error: null,
};

describe('parseRotationDays', () => {
  it('accepts only the two windows the upstream supports', () => {
    expect(parseRotationDays(4)).toBe(4);
    expect(parseRotationDays(30)).toBe(30);
    // 15 会被后端回 400，非法值一律退回默认
    expect(parseRotationDays(15)).toBe(DEFAULT_ROTATION_DAYS);
    expect(parseRotationDays('30')).toBe(DEFAULT_ROTATION_DAYS);
    expect(parseRotationDays(null)).toBe(DEFAULT_ROTATION_DAYS);
  });
});

describe('toSectorRotationResponse', () => {
  it('accepts a well-formed payload', () => {
    const parsed = toSectorRotationResponse(validPayload, 4);
    expect(parsed.status).toBe('fresh');
    expect(parsed.days).toBe(30);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.error).toBeNull();
  });

  it('degrades to unavailable on malformed payloads', () => {
    expect(toSectorRotationResponse(null, 4).status).toBe('unavailable');
    expect(toSectorRotationResponse({ ...validPayload, source: 'eastmoney' }, 4).status).toBe(
      'unavailable',
    );
    // 上游只认 4 / 30，别把别的天数当成有效响应
    expect(toSectorRotationResponse({ ...validPayload, days: 15 }, 4).status).toBe('unavailable');
    expect(toSectorRotationResponse({ ...validPayload, items: 'nope' }, 4).status).toBe(
      'unavailable',
    );
    expect(toSectorRotationResponse({ ...validPayload, tradeDates: [1, 2] }, 4).status).toBe(
      'unavailable',
    );
  });

  it('keeps the response usable but drops items that fail validation', () => {
    const parsed = toSectorRotationResponse(
      { ...validPayload, items: [item, { plateCode: 'broken' }] },
      4,
    );
    expect(parsed.status).toBe('fresh');
    expect(parsed.items).toHaveLength(1);
  });
});

describe('fetchSectorRotation', () => {
  it('requests the selected window and parses the response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(validPayload));
    const result = await fetchSectorRotation(DEFAULT_ROTATION_DAYS, fetchImpl);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/themes/rotation?days=30');
    expect(result.items[0]?.plateName).toBe('芯片产业链');
  });

  it('returns an unavailable response instead of throwing when the request fails', async () => {
    const failing = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 400 }));
    const failed = await fetchSectorRotation(4, failing);
    expect(failed.status).toBe('unavailable');
    expect(failed.error).toContain('400');

    const rejected = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const offline = await fetchSectorRotation(4, rejected);
    expect(offline.status).toBe('unavailable');
    expect(offline.items).toEqual([]);
  });

  it('degrades when the body is not JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>', { status: 200 }));
    const result = await fetchSectorRotation(4, fetchImpl);
    expect(result.status).toBe('unavailable');
  });
});
