/**
 * 细分逻辑题材（topics）的回归测试。
 *
 * 重点：
 *   1. 题材单位是涨停原因标签，**不做同族合并**——否则「清洁机器人 + 机器人结构件 +
 *      环卫机器人」会被凑成「机器人 6 家」，等于在标签层再造一次宽概念；
 *   2. 业绩 / 定增 / 回购这类通用词不成题材；
 *   3. 同一只票同一标签只算一次；家数 <2 不成题；
 *   4. 持续性用各日自己的涨停原因，历史缺失记 null 不补 0。
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateTopics,
  buildTopicMetrics,
  classifyTopic,
  computeTopicDuration,
  pickTopicLeader,
  toTopicItem,
  TOPIC_MIN_COUNT,
  type TopicDay,
} from './topics.js';
import type { LimitUpPoolRow } from './tenjqka.js';

const row = (
  symbol: string,
  name: string,
  tags: string[],
  boardCount = 1,
  firstSealTime = '09:35:00',
): LimitUpPoolRow => ({
  symbol,
  name,
  price: 10,
  pct: 10,
  boardCount,
  highLabel: boardCount === 1 ? '首板' : `${boardCount}天${boardCount}板`,
  firstSealTime,
  lastSealTime: firstSealTime,
  sealType: '换手板',
  openCount: 0,
  sealAmount: 1e7,
  floatMarketCap: 5e9,
  turnoverRate: 8,
  reasonTags: tags,
  intraday: [],
});

const day = (date: string, rows: LimitUpPoolRow[], error = false): TopicDay => ({
  date,
  rows,
  error: error ? { symbol: date, message: '取数失败' } : null,
});

describe('aggregateTopics', () => {
  it('同一只票同一标签只算一次，重复写法不会重复计数', () => {
    const topics = aggregateTopics([
      day('20260918', [row('600001', '甲', ['光通信', '光通信', '业绩增长'])]),
    ]);
    expect(topics).toHaveLength(0); // 只 1 家，不成题
    const two = aggregateTopics([
      day('20260918', [
        row('600001', '甲', ['光通信', '光通信']),
        row('600002', '乙', ['光通信']),
      ]),
    ]);
    expect(two[0].todayCount).toBe(2);
    expect(two[0].members.map((member) => member.symbol)).toEqual(['600001', '600002']);
  });

  it('通用词（业绩 / 定增 / 回购 / 订单）不成题材', () => {
    const topics = aggregateTopics([
      day('20260918', [
        row('600001', '甲', ['业绩增长', '定增获批', '股份回购', '在手订单']),
        row('600002', '乙', ['半年报增长', '回购', '大额订单']),
      ]),
    ]);
    expect(topics).toHaveLength(0);
  });

  it('不做同族合并：清洁机器人 / 环卫机器人 不会被并进「机器人」', () => {
    const topics = aggregateTopics([
      day('20260918', [
        row('600001', '甲', ['机器人']),
        row('600002', '乙', ['机器人']),
        row('600003', '丙', ['清洁机器人']),
        row('600004', '丁', ['环卫机器人']),
      ]),
    ]);
    // 「机器人」只有 2 家自己带了这个标签；两个更细的写法各自只有 1 家，不成题
    expect(topics.map((topic) => topic.name)).toEqual(['机器人']);
    expect(topics[0].todayCount).toBe(2);
    expect(topics[0].members.map((member) => member.symbol)).toEqual(['600001', '600002']);
  });

  it('家数 <2 不成题材', () => {
    const topics = aggregateTopics([day('20260918', [row('600001', '甲', ['先进封装'])])]);
    expect(topics).toHaveLength(0);
    expect(TOPIC_MIN_COUNT).toBe(2);
  });

  it('历史家数按各日自己的涨停原因算；该日取数失败记 null 而不是 0', () => {
    const topics = aggregateTopics([
      day('20260918', [row('600001', '甲', ['光通信']), row('600002', '乙', ['光通信'])]),
      day('20260917', [row('600003', '丙', ['光通信'])]),
      day('20260916', [], true),
    ]);
    const topic = topics[0];
    expect(topic.days.map((item) => item.count)).toEqual([2, 1, null]);
    // 中间那天只有 1 家，连续计数在那里中断
    expect(topic.durationDays).toBe(1);
  });

  it('展示名取样本里出现最多的原始写法，变体不并成一家', () => {
    const topics = aggregateTopics([
      day('20260918', [
        row('600001', '甲', ['高端PCB']),
        row('600002', '乙', ['高端PCB']),
        row('600003', '丙', ['PCB']),
      ]),
    ]);
    expect(topics.map((topic) => topic.name)).toEqual(['高端PCB']);
    expect(topics[0].todayCount).toBe(2);
    expect(topics[0].variants).toEqual(['高端PCB']);
  });

  it('归一化：全角 / 空格写法归到同一题材', () => {
    const topics = aggregateTopics([
      day('20260918', [row('600001', '甲', ['ＡＩ眼镜']), row('600002', '乙', ['AI 眼镜'])]),
    ]);
    expect(topics).toHaveLength(1);
    expect(topics[0].todayCount).toBe(2);
  });
});

describe('computeTopicDuration', () => {
  it('从当日开始连续满足 ≥2 的天数', () => {
    expect(computeTopicDuration([3, 2, 5])).toBe(3);
    expect(computeTopicDuration([3, 1, 5])).toBe(1);
    expect(computeTopicDuration([1, 3, 5])).toBe(0);
    expect(computeTopicDuration([3, null, 5])).toBe(1);
    expect(computeTopicDuration([])).toBe(0);
  });
});

describe('classifyTopic', () => {
  const build = (counts: Array<number | null>) =>
    aggregateTopics(
      counts.map((count, index) =>
        day(
          `2026091${8 - index}`,
          Array.from({ length: count ?? 0 }, (_, i) => row(`6000${index}${i}`, `票${index}${i}`, ['光通信'])),
          count === null,
        ),
      ),
    )[0];

  it('当日 ≥5 且前两日各 ≥2 → 主线', () => {
    const result = classifyTopic(build([6, 2, 3]));
    expect(result.kind).toBe('main');
    expect(result.reasons.join(' ')).toContain('判主线');
  });

  it('当日 5 家但前两日不足 → 支线（首日爆发的题材不能直接叫主线）', () => {
    const result = classifyTopic(build([5, 0, 0]));
    expect(result.kind).toBe('branch');
    expect(result.reasons.join(' ')).toContain('不足以证明持续性');
  });

  it('当日不足 5 家 → 支线', () => {
    const result = classifyTopic(build([3, 3, 3]));
    expect(result.kind).toBe('branch');
    expect(result.reasons.join(' ')).toContain('不足主线门槛');
  });

  it('历史某日取数失败 → 支线并披露缺口，不补 0 假装不达标', () => {
    const result = classifyTopic(build([6, null, 4]));
    expect(result.kind).toBe('branch');
    expect(result.reasons.join(' ')).toContain('缺口');
  });

  it('家数序列写进理由，便于核查', () => {
    const result = classifyTopic(build([6, 2, 3]));
    expect(result.reasons[0]).toContain('6/2/3');
  });
});

describe('pickTopicLeader / buildTopicMetrics / toTopicItem', () => {
  const topics = aggregateTopics([
    day('20260918', [
      row('600001', '甲', ['光通信'], 2, '10:00:00'),
      row('600002', '乙', ['光通信'], 2, '09:31:00'),
      row('600003', '丙', ['光通信'], 1, '09:30:00'),
    ]),
  ]);
  const topic = topics[0];

  it('龙头取最高板，同高度取首封更早', () => {
    expect(pickTopicLeader(topic.members)?.symbol).toBe('600002');
  });

  it('成交额 / 市场影响力在题材口径下明确不可用，不拿别的数字顶', () => {
    const metrics = buildTopicMetrics(topic);
    for (const key of ['amount', 'influence'] as const) {
      const item = metrics.find((metric) => metric.key === key);
      expect(item?.hit).toBe(false);
      expect(item?.value).toBe('—');
    }
  });

  it('题材条目的标识是 TP: 前缀，并带 source=topic', () => {
    const item = toTopicItem(topic);
    expect(item.code).toBe('TP:光通信');
    expect(item.source).toBe('topic');
    expect(item.limitUpCount).toBe(3);
    expect(item.conceptLimitUpCount).toBe(3);
    expect(item.supportedLimitUpCount).toBeNull();
    expect(item.classificationReasons.length).toBeGreaterThan(0);
  });
});
