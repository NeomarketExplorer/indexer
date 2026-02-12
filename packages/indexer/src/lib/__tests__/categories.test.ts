/**
 * Unit tests for the regex-based event categorizer
 */

import { describe, it, expect } from 'vitest';
import {
  classifyEvent,
  getAllCategories,
  getCategoryLabel,
  getParentCategories,
  CATEGORY_RULES,
} from '../categories';

describe('classifyEvent', () => {
  // ── Sports ──────────────────────────────────────────────

  it('classifies NBA events from title', () => {
    const result = classifyEvent({ title: 'Will the Lakers win the NBA Finals?' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/nba');
  });

  it('classifies NFL events', () => {
    const result = classifyEvent({ title: 'Super Bowl LVIII winner' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/nfl');
  });

  it('classifies MLB events', () => {
    const result = classifyEvent({ title: 'Will the Yankees win the World Series?' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/mlb');
  });

  it('classifies NHL events', () => {
    const result = classifyEvent({ title: 'Stanley Cup 2025 winner' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/nhl');
  });

  it('classifies soccer events', () => {
    const result = classifyEvent({ title: 'Premier League winner 2025' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/soccer');
  });

  it('classifies MMA/boxing events', () => {
    const result = classifyEvent({ title: 'UFC 310 main event winner' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/mma-boxing');
  });

  it('classifies tennis events', () => {
    const result = classifyEvent({ title: 'Wimbledon 2025 champion' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/tennis');
  });

  it('classifies F1 events', () => {
    const result = classifyEvent({ title: 'Formula 1 World Championship winner' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/f1-motorsport');
  });

  it('classifies college sports', () => {
    const result = classifyEvent({ title: 'March Madness Final Four winner' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/college');
  });

  // ── Politics ────────────────────────────────────────────

  it('classifies US elections', () => {
    const result = classifyEvent({ title: 'Who will win the presidential election?' });
    expect(result).toContain('politics');
    expect(result).toContain('politics/us-elections');
  });

  it('classifies US policy', () => {
    const result = classifyEvent({ title: 'Will there be a government shutdown?' });
    expect(result).toContain('politics');
    expect(result).toContain('politics/us-policy');
  });

  it('classifies geopolitics', () => {
    const result = classifyEvent({ title: 'US-China trade war escalation' });
    expect(result).toContain('politics');
    expect(result).toContain('politics/geopolitics');
  });

  it('classifies regulation', () => {
    const result = classifyEvent({ title: 'SEC enforcement action against Coinbase' });
    expect(result).toContain('politics/regulation');
  });

  // ── Crypto ──────────────────────────────────────────────

  it('classifies Bitcoin events', () => {
    const result = classifyEvent({ title: 'Bitcoin ETF approval' });
    expect(result).toContain('crypto');
    expect(result).toContain('crypto/bitcoin');
  });

  it('classifies Ethereum events', () => {
    const result = classifyEvent({ title: 'ETH staking yield above 5%?' });
    expect(result).toContain('crypto');
    expect(result).toContain('crypto/ethereum');
  });

  it('classifies altcoin events', () => {
    const result = classifyEvent({ title: 'Solana SOL price above $200?' });
    expect(result).toContain('crypto');
    expect(result).toContain('crypto/altcoins');
  });

  it('classifies DeFi events', () => {
    const result = classifyEvent({ title: 'Total TVL in DeFi above $100B?' });
    expect(result).toContain('crypto');
    expect(result).toContain('crypto/defi');
  });

  it('classifies memecoin events', () => {
    const result = classifyEvent({ title: 'Dogecoin market cap above $50B?' });
    expect(result).toContain('crypto');
    expect(result).toContain('crypto/memecoins');
  });

  it('classifies exchange events', () => {
    const result = classifyEvent({ title: 'Binance trading volume record?' });
    expect(result).toContain('crypto');
    expect(result).toContain('crypto/exchanges');
  });

  // ── Finance ─────────────────────────────────────────────

  it('classifies stock market events', () => {
    const result = classifyEvent({ title: 'S&P 500 above 6000?' });
    expect(result).toContain('finance');
    expect(result).toContain('finance/stocks');
  });

  it('classifies Fed/rates events', () => {
    const result = classifyEvent({ title: 'Will the Fed cut interest rates?' });
    expect(result).toContain('finance');
    expect(result).toContain('finance/fed-rates');
  });

  it('classifies macro events', () => {
    const result = classifyEvent({ title: 'US GDP growth above 3%?' });
    expect(result).toContain('finance');
    expect(result).toContain('finance/macro');
  });

  // ── Entertainment ───────────────────────────────────────

  it('classifies movies/TV events', () => {
    const result = classifyEvent({ title: 'Top box office this weekend?' });
    expect(result).toContain('entertainment');
    expect(result).toContain('entertainment/movies-tv');
  });

  it('classifies awards events', () => {
    const result = classifyEvent({ title: 'Best Picture at the Oscars?' });
    expect(result).toContain('entertainment');
    expect(result).toContain('entertainment/awards');
  });

  // ── Science & Tech ──────────────────────────────────────

  it('classifies AI events', () => {
    const result = classifyEvent({ title: 'OpenAI GPT-5 release date' });
    expect(result).toContain('science-tech');
    expect(result).toContain('science-tech/ai');
  });

  it('classifies space events', () => {
    const result = classifyEvent({ title: 'SpaceX Starship successful launch' });
    expect(result).toContain('science-tech');
    expect(result).toContain('science-tech/space');
  });

  it('classifies biotech/health events', () => {
    const result = classifyEvent({ title: 'FDA approval of new Alzheimer drug?' });
    expect(result).toContain('science-tech');
    expect(result).toContain('science-tech/biotech-health');
  });

  // ── World Events ────────────────────────────────────────

  it('classifies conflict events', () => {
    const result = classifyEvent({ title: 'Russia-Ukraine ceasefire by end of year?' });
    expect(result).toContain('world-events');
    expect(result).toContain('world-events/conflicts');
  });

  it('classifies disaster events', () => {
    const result = classifyEvent({ title: 'Major earthquake in California this year?' });
    expect(result).toContain('world-events');
    expect(result).toContain('world-events/disasters');
  });

  // ── Legal ───────────────────────────────────────────────

  it('classifies lawsuit events', () => {
    const result = classifyEvent({ title: 'Class action settlement above $1B?' });
    expect(result).toContain('legal');
    expect(result).toContain('legal/lawsuits');
  });

  it('classifies criminal events', () => {
    const result = classifyEvent({ title: 'Will the defendant receive a guilty verdict?' });
    expect(result).toContain('legal');
    expect(result).toContain('legal/criminal');
  });

  // ── Weather ─────────────────────────────────────────────

  it('classifies storm events', () => {
    const result = classifyEvent({ title: 'Category 5 hurricane this season?' });
    expect(result).toContain('weather');
    expect(result).toContain('weather/storms');
  });

  it('classifies temperature events', () => {
    const result = classifyEvent({ title: 'Hottest day on record this summer?' });
    expect(result).toContain('weather');
    expect(result).toContain('weather/temperature');
  });

  // ── Pop Culture ─────────────────────────────────────────

  it('classifies social media events', () => {
    const result = classifyEvent({ title: 'TikTok ban in the US?' });
    expect(result).toContain('pop-culture');
    expect(result).toContain('pop-culture/social-media');
  });

  it('classifies personality events', () => {
    const result = classifyEvent({ title: 'Elon Musk tweet moves markets?' });
    expect(result).toContain('pop-culture');
    expect(result).toContain('pop-culture/personalities');
  });

  // ── Cross-cutting behavior ──────────────────────────────

  it('assigns multiple categories for cross-topic events', () => {
    const result = classifyEvent({
      title: 'SEC enforcement action against Bitcoin exchange',
    });
    // Should match both crypto/bitcoin and politics/regulation (SEC enforcement)
    expect(result).toContain('crypto/bitcoin');
    expect(result).toContain('politics/regulation');
  });

  it('includes both parent and child for each match', () => {
    const result = classifyEvent({ title: 'NBA Finals MVP winner' });
    expect(result).toContain('sports');
    expect(result).toContain('sports/nba');
    // parent appears exactly once
    expect(result.filter(s => s === 'sports').length).toBe(1);
  });

  it('returns sorted array', () => {
    const result = classifyEvent({ title: 'NBA Finals MVP winner' });
    const sorted = [...result].sort();
    expect(result).toEqual(sorted);
  });

  it('returns empty array for unmatched events', () => {
    const result = classifyEvent({ title: 'Something totally unrelated and vague' });
    expect(result).toEqual([]);
  });

  it('matches from description', () => {
    const result = classifyEvent({
      title: 'Big event prediction',
      description: 'Will the Lakers win the NBA championship this year?',
    });
    expect(result).toContain('sports/nba');
  });

  it('matches from gamma category', () => {
    const result = classifyEvent({
      title: 'Big event prediction',
      gammaCategory: 'NBA basketball finals',
    });
    expect(result).toContain('sports/nba');
  });

  it('matches from gamma tags', () => {
    const result = classifyEvent({
      title: 'Big event prediction',
      gammaTags: ['NBA', 'Basketball'],
    });
    expect(result).toContain('sports/nba');
  });

  it('deduplicates results', () => {
    // If title and description both mention NBA, still only one entry
    const result = classifyEvent({
      title: 'NBA Finals prediction',
      description: 'The NBA championship is coming up',
    });
    expect(result.filter(s => s === 'sports/nba').length).toBe(1);
  });
});

describe('getAllCategories', () => {
  it('returns an array of parent nodes', () => {
    const tree = getAllCategories();
    expect(tree.length).toBeGreaterThan(0);
    for (const node of tree) {
      expect(node).toHaveProperty('slug');
      expect(node).toHaveProperty('label');
      expect(node).toHaveProperty('children');
      expect(Array.isArray(node.children)).toBe(true);
      expect(node.children.length).toBeGreaterThan(0);
    }
  });

  it('is sorted by parent slug', () => {
    const tree = getAllCategories();
    const slugs = tree.map(n => n.slug);
    const sorted = [...slugs].sort();
    expect(slugs).toEqual(sorted);
  });

  it('includes expected parent categories', () => {
    const tree = getAllCategories();
    const slugs = tree.map(n => n.slug);
    expect(slugs).toContain('sports');
    expect(slugs).toContain('politics');
    expect(slugs).toContain('crypto');
    expect(slugs).toContain('finance');
    expect(slugs).toContain('entertainment');
    expect(slugs).toContain('science-tech');
  });
});

describe('getCategoryLabel', () => {
  it('returns label for a parent slug', () => {
    expect(getCategoryLabel('sports')).toBe('Sports');
    expect(getCategoryLabel('crypto')).toBe('Crypto');
  });

  it('returns label for a child slug', () => {
    expect(getCategoryLabel('sports/nba')).toBe('NBA');
    expect(getCategoryLabel('crypto/bitcoin')).toBe('Bitcoin');
  });

  it('returns undefined for unknown slug', () => {
    expect(getCategoryLabel('nonexistent/foo')).toBeUndefined();
  });
});

describe('getParentCategories', () => {
  it('returns top-level parents only', () => {
    const parents = getParentCategories();
    expect(parents.length).toBeGreaterThan(0);
    for (const p of parents) {
      expect(p.slug).not.toContain('/');
    }
  });

  it('is sorted by slug', () => {
    const parents = getParentCategories();
    const slugs = parents.map(p => p.slug);
    const sorted = [...slugs].sort();
    expect(slugs).toEqual(sorted);
  });
});

describe('CATEGORY_RULES integrity', () => {
  it('every rule has parent derived from slug', () => {
    for (const rule of CATEGORY_RULES) {
      expect(rule.slug).toContain('/');
      expect(rule.parent).toBe(rule.slug.split('/')[0]);
    }
  });

  it('every rule has at least one pattern', () => {
    for (const rule of CATEGORY_RULES) {
      expect(rule.patterns.length).toBeGreaterThan(0);
    }
  });

  it('no duplicate slugs', () => {
    const slugs = CATEGORY_RULES.map(r => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
