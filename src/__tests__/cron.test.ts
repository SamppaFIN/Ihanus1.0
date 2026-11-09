import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dueRounds, parseOffsets, type OpenRound } from '../pipeline/cron-plan.js';
import { runCron, type CronEnv } from '../pipeline/cron-run.js';

const fx = (f: string) => readFileSync(new URL(`../../fixtures/${f}`, import.meta.url), 'utf8');
const MIN = 60_000;

describe('cron-plan: tunti ennen sulkeutumista', () => {
  const close = Date.parse('2026-11-08T12:58:00Z');
  const r: OpenRound[] = [{ key: 'a|45', title: 'Sunnuntaivakio 2', closesAtMs: close }];

  it('osuu täsmälleen yhdelle 10 min tikille, riippumatta tikin minuutista', () => {
    // simuloi cron-tikit 07:00–13:00 UTC, 10 min välein, eri vaiheistuksella
    for (const phase of [0, 3, 7, 9.5]) {
      let hits = 0;
      for (let t = Date.parse('2026-11-08T07:00:00Z') + phase * MIN; t < close; t += 10 * MIN) {
        hits += dueRounds(r, t, [60], 10).length;
      }
      expect(hits).toBe(1);
    }
  });

  it('ei laukea liian aikaisin eikä sulkeutumisen jälkeen', () => {
    expect(dueRounds(r, close - 70 * MIN, [60], 10)).toEqual([]);
    expect(dueRounds(r, close - 50 * MIN, [60], 10)).toEqual([]); // ikkunan alaraja on poissa
    expect(dueRounds(r, close - 60 * MIN, [60], 10)).toHaveLength(1); // yläraja mukana
    expect(dueRounds(r, close + MIN, [60], 10)).toEqual([]);
  });

  it('tukee useita siirtymiä (60 ja 10 min)', () => {
    const hits = [];
    for (let t = close - 90 * MIN; t < close; t += 10 * MIN) hits.push(...dueRounds(r, t, [60, 10], 10).map((d) => d.offsetMin));
    expect(hits.sort((a, b) => b - a)).toEqual([60, 10]);
  });

  it('parseOffsets: roskalla palautuu oletus', () => {
    expect(parseOffsets('60, 10')).toEqual([60, 10]);
    expect(parseOffsets('')).toEqual([60]);
    expect(parseOffsets('abc,-5')).toEqual([60]);
    expect(parseOffsets(undefined)).toEqual([60]);
  });
});

describe('cron-run: Teksti-TV → dispatch', () => {
  // Sama hetki, kolme alasivua: suljettu kierros (ei saa laukaista), kaksi avointa eri sulkeutumisajalla.
  const closed = fx('yle-479-sunnuntaivakio-2026-11-08.txt').replace('Sunnuntaivakio 2 KRS 45', 'Sunnuntaivakio 1 KRS 45');
  const pages: Record<string, string> = {
    '479_0001.htm': closed,
    '479_0002.htm': fx('yle-479-sunnuntaivakio-2-sub2-2026-11-08.txt'), // sulkeutuu su 14.58 (12:58Z)
    '479_0003.htm': fx('yle-479-sunnuntaivakio-3-sub3-2026-11-08.txt'), // sulkeutuu su 18.13 (16:13Z)
  };
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const stub: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith('https://api.github.com/')) return new Response(null, { status: 204 });
    const key = url.split('/').pop()!;
    const body = pages[key];
    return body ? new Response(`<html><pre>${body}</pre></html>`, { status: 200 }) : new Response('nope', { status: 404 });
  };
  const env = (o: Partial<CronEnv> = {}): CronEnv => ({ GITHUB_REPO: 'SamppaFIN/Ihanus1.0', WORKFLOW: 'percent-hourly.yml', REF: 'main', GITHUB_TOKEN: 'tok', REFRESH_BEFORE_MIN: '60', INTERVAL_MIN: '10', FETCH_DELAY_MS: '0', ...o });

  it('käynnistää workflow\'n kun tunti on jäljellä ja vain silloin', async () => {
    calls.length = 0;
    const early = await runCron(env(), stub, new Date('2026-11-08T11:00:00Z'));
    expect(early.rounds.map((x) => x.title)).toEqual(['Sunnuntaivakio 2', 'Sunnuntaivakio 3']);
    expect(early.due).toEqual([]);
    expect(early.dispatched).toBe(false);
    expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(false);

    calls.length = 0;
    const hit = await runCron(env(), stub, new Date('2026-11-08T12:02:00Z')); // 56 min jäljellä → osuu ikkunaan (50, 60]
    expect(hit.due.map((d) => d.title)).toEqual(['Sunnuntaivakio 2']);
    expect(hit.dispatched).toBe(true);
    const d = calls.find((c) => c.url.includes('/dispatches'))!;
    expect(d.url).toBe('https://api.github.com/repos/SamppaFIN/Ihanus1.0/actions/workflows/percent-hourly.yml/dispatches');
    expect(d.init?.method).toBe('POST');
    expect(JSON.parse(String(d.init?.body))).toEqual({ ref: 'main', inputs: { odds: 'true' } });
    expect((d.init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('ilman tokenia ei käynnistetä mitään mutta kerrotaan miksi', async () => {
    calls.length = 0;
    const r = await runCron(env({ GITHUB_TOKEN: undefined }), stub, new Date('2026-11-08T12:02:00Z'));
    expect(r.due).toHaveLength(1);
    expect(r.dispatched).toBe(false);
    expect(r.skipped).toMatch(/GITHUB_TOKEN/);
    expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(false);
  });

  it('GitHubin virhe näkyy tuloksessa eikä kaada ajoa', async () => {
    const bad: typeof fetch = async (i, o) => (String(i).includes('/dispatches') ? new Response('Bad credentials', { status: 401 }) : stub(i, o));
    const r = await runCron(env(), bad, new Date('2026-11-08T12:02:00Z'));
    expect(r.dispatched).toBe(false);
    expect(r.skipped).toBe('GitHub vastasi 401');
  });

  it('KV-tila estää saman kierroksen kaksoislaukaisun', async () => {
    const mem = new Map<string, string>();
    const STATE = { get: async (k: string) => mem.get(k) ?? null, put: async (k: string, v: string) => void mem.set(k, v) };
    const first = await runCron(env({ STATE }), stub, new Date('2026-11-08T12:02:00Z'));
    expect(first.dispatched).toBe(true);
    const again = await runCron(env({ STATE }), stub, new Date('2026-11-08T12:03:00Z'));
    expect(again.due).toEqual([]);
    expect(again.dispatched).toBe(false);
  });
});
