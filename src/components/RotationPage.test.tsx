import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MarketEmotion, SectorRotationResponse } from '../types';
import { RotationPage } from './RotationPage';

vi.mock('../lib/sectorRotation', async () => {
  const actual = await vi.importActual<typeof import('../lib/sectorRotation')>(
    '../lib/sectorRotation',
  );
  return { ...actual, fetchSectorRotation: vi.fn() };
});

vi.mock('../lib/market', async () => {
  const actual = await vi.importActual<typeof import('../lib/market')>('../lib/market');
  return { ...actual, fetchMarketOverview: vi.fn() };
});

const { fetchSectorRotation } = await import('../lib/sectorRotation');
const { fetchMarketOverview } = await import('../lib/market');

const rotation: SectorRotationResponse = {
  days: 30,
  tradeDates: ['20260810', '20260918'],
  items: [
    {
      plateCode: 'cls80457',
      plateName: '芯片产业链',
      latestChange: 2.77,
      appearCount: 17,
      maxChange: 3.7,
      avgChange: 2.1,
      firstSeen: '20260812',
      lastSeen: '20260918',
      days: ['20260812', '20260918'],
    },
  ],
  fetchedAt: '2026-09-18T07:00:00.000Z',
  source: 'cls',
  status: 'fresh',
  error: null,
};

const emotion: MarketEmotion = {
  source: 'cls',
  tradeDate: '20260918',
  marketDegree: 70,
  sealRate: 76,
  sealCount: 78,
  brokenCount: 25,
  openRate: 62,
  profitRate: 68,
  yesterdayLimitUpPerformance: 2.81,
  turnover: 2_080_000_000_000,
  ladder: [
    { key: 'yiban', name: '一板', count: 66, promotionRate: 21 },
    { key: 'gaoduban', name: '高度板', count: 2, promotionRate: null },
  ],
  status: 'fresh',
};

/** 每次用例前重置并按需设定两个上游 */
const mockUpstreams = (
  rotationResult: unknown,
  emotionResult: unknown,
): { rotation: ReturnType<typeof vi.fn>; market: ReturnType<typeof vi.fn> } => {
  const rotationMock = vi.mocked(fetchSectorRotation);
  const marketMock = vi.mocked(fetchMarketOverview);
  rotationMock.mockReset();
  marketMock.mockReset();
  rotationMock.mockResolvedValue(rotationResult as never);
  marketMock.mockResolvedValue(emotionResult as never);
  return { rotation: rotationMock, market: marketMock };
};

describe('RotationPage', () => {
  it('renders the rotation board and the emotion metrics together', async () => {
    mockUpstreams(rotation, { emotion });

    render(<RotationPage />);

    // 轮动：板块名 + 上榜次数（用 b 元素里的数字定位，避免命中 title 文案）
    expect(await screen.findByText('芯片产业链')).toBeInTheDocument();
    expect(screen.getByTitle(/进入涨幅 top10 的次数/)).toHaveTextContent('上榜 17/30');
    // 情绪：封板率 76.0% 与连板梯队的两档
    expect(await screen.findByText('封板率')).toBeInTheDocument();
    expect(screen.getByText('76.0%')).toBeInTheDocument();
    expect(screen.getByText('62.0%')).toBeInTheDocument();
    expect(screen.getByText('68.0%')).toBeInTheDocument();
    expect(screen.getByText(/一板 66（21%）/)).toBeInTheDocument();
    // 高度板没有连板率 → 只显示家数，不能显示 0%
    expect(screen.getByText(/高度板 2/)).toBeInTheDocument();
  });

  it('reports the plate count through onSummary for the nav badge', async () => {
    mockUpstreams(rotation, { emotion });
    const onSummary = vi.fn();

    render(<RotationPage onSummary={onSummary} />);

    await waitFor(() => {
      expect(onSummary).toHaveBeenCalledWith(
        expect.objectContaining({ hasData: true, plateCount: 1 }),
      );
    });
  });

  it('degrades both cards independently instead of throwing', async () => {
    const { rotation: rotationMock, market: marketMock } = mockUpstreams(rotation, { emotion });
    // 轮动挂了、情绪还在 → 情绪照常显示，轮动显示空状态
    rotationMock.mockResolvedValue({
      days: 30,
      tradeDates: [],
      items: [],
      fetchedAt: '2026-09-18T07:00:00.000Z',
      source: 'cls',
      status: 'unavailable',
      error: '财联社板块轮动暂不可用',
    } as never);
    marketMock.mockResolvedValue({ emotion: null } as never);

    render(<RotationPage />);

    expect(await screen.findByText(/板块轮动暂不可用/)).toBeInTheDocument();
    expect(await screen.findByText(/市场情绪暂不可用/)).toBeInTheDocument();
  });
});
