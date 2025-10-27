#!/usr/bin/env ts-node

// Poll active contracts, refresh YouTube views, update submission earnings,
// recompute claimed_value, and when exhausted mark filled and queue payout.
import 'dotenv/config';
import {
  getActiveContracts,
  getApprovedSubmissionsByContract,
  updateSubmissionViewsAndEarnings,
  setContractClaimed,
  markContractFilledAndQueuePayout,
} from '../lib/contracts-util.js';

const LOG = '[contract-monitor]';
const POLL_MS = Number(process.env.CONTRACT_POLL_INTERVAL_MS || 30000);
const YT_KEY = process.env.YOUTUBE_API_KEY;

if (!YT_KEY) throw new Error('Missing YOUTUBE_API_KEY');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([^&]+)/,
    /youtu\.be\/([^?&]+)/,
    /\/embed\/([^?&]+)/,
    /\/v\/([^?&]+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function fetchYouTubeViewCounts(ids: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const u = new URL('https://www.googleapis.com/youtube/v3/videos');
    u.searchParams.set('part', 'statistics');
    u.searchParams.set('id', batch.join(','));
    u.searchParams.set('key', YT_KEY!);

    const resp = await fetch(u.toString());
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`YouTube API ${resp.status}: ${text || resp.statusText}`);
    }
    const j: any = await resp.json();
    for (const item of j.items ?? []) {
      const id = item.id;
      const vc = Number(item?.statistics?.viewCount ?? 0);
      out[id] = Number.isFinite(vc) ? vc : 0;
    }
  }
  return out;
}

const earned = (views: number, ratePer1k: number) => (views / 1000) * ratePer1k;

async function processContract(c: {
  id: string | number;
  total_value: number;
  claimed_value: number;
  rate_per_1k_views: number;
  title?: string;
}) {
  console.log(`${LOG} contract ${c.id} ...`);

  const subs = await getApprovedSubmissionsByContract(c.id);
  if (!subs.length) {
    console.log(`${LOG} no approved submissions`);
    return;
  }

  const ids: string[] = [];
  const map: Record<number, string | null> = {};
  for (const s of subs) {
    const vid = extractVideoId(s.video_url);
    map[s.id] = vid;
    if (vid) ids.push(vid);
  }
  if (!ids.length) {
    console.log(`${LOG} no valid video IDs`);
    return;
  }

  const viewCounts = await fetchYouTubeViewCounts(ids);

  let newTotal = 0;
  for (const s of subs) {
    const vid = map[s.id];
    const v = vid ? (viewCounts[vid] ?? s.view_count ?? 0) : (s.view_count ?? 0);
    const amt = earned(v, Number(c.rate_per_1k_views || 0));
    newTotal += amt;

    if (v !== s.view_count || amt !== s.earned_amount) {
      await updateSubmissionViewsAndEarnings(s.id, v, amt);
    }
  }

  await setContractClaimed(c.id, newTotal);

  if (newTotal >= Number(c.total_value || 0)) {
    await markContractFilledAndQueuePayout(c.id);
    console.log(`${LOG} filled → payout queued`);
  } else {
    const remaining = Number(c.total_value || 0) - newTotal;
    console.log(`${LOG} remaining ${remaining.toFixed(4)} SOL`);
  }
}

async function tick() {
  const active = await getActiveContracts();
  if (!active.length) {
    console.log(`${LOG} no active contracts`);
    return;
  }
  for (const c of active) await processContract(c as any);
}

(async function main() {
  console.log(`${LOG} starting; poll interval ${POLL_MS / 1000}s`);
  const ONCE = process.argv.includes('--once');
  do {
    try {
      await tick();
    } catch (e: any) {
      console.error(`${LOG} tick error:`, e?.message ?? e);
    }
    if (ONCE) break;
    await sleep(POLL_MS);
  } while (true);
  console.log(`${LOG} stopped`);
})();
