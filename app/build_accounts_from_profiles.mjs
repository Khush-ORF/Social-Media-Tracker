import fs from 'node:fs/promises';
import { ACCOUNTS_FILE, ROOT, toCsv } from './utils.mjs';
import path from 'node:path';

const platforms = ['YouTube', 'X', 'LinkedIn', 'Instagram', 'Facebook'];
const columns = ['id', 'name', 'website', 'platform', 'handle', 'profile_url', 'active', 'notes'];
const manualProfiles = {
  3: {
    LinkedIn: {
      url: 'https://www.linkedin.com/company/aljazeera',
      handle: 'company/aljazeera',
      source: 'https://www.linkedin.com/company/aljazeera',
      status: 'Parent organization page — centre-specific LinkedIn not found',
      note: 'Al Jazeera Centre for Studies is established under Al Jazeera Media Network; use with caution for centre-level follower tracking.',
    },
  },
  16: {
    LinkedIn: {
      url: 'https://www.linkedin.com/company/cbgaindia',
      handle: 'company/cbgaindia',
      source: 'https://www.linkedin.com/company/cbgaindia',
      status: 'Corroborated — LinkedIn organization page',
      note: 'LinkedIn page website matches cbgaindia.org.',
    },
  },
  23: {
    LinkedIn: {
      url: 'https://www.linkedin.com/company/cpp-iimb',
      handle: 'company/cpp-iimb',
      source: 'https://www.linkedin.com/company/cpp-iimb',
      status: 'Corroborated — LinkedIn organization page',
      note: 'Centre for Public Policy, IIM Bangalore LinkedIn page.',
    },
  },
  41: {
    LinkedIn: {
      url: 'https://www.linkedin.com/company/east-asia-institute',
      handle: 'company/east-asia-institute',
      source: 'https://www.linkedin.com/company/east-asia-institute',
      status: 'Corroborated — LinkedIn organization page',
      note: 'LinkedIn page website matches eai.or.kr.',
    },
  },
  60: {
    LinkedIn: {
      url: 'https://www.linkedin.com/school/institute-of-peace-and-conflict-studies/',
      handle: 'school/institute-of-peace-and-conflict-studies',
      source: 'https://www.linkedin.com/school/institute-of-peace-and-conflict-studies/',
      status: 'Corroborated — LinkedIn organization page',
      note: 'LinkedIn school-style page for Institute of Peace and Conflict Studies; website matches ipcs.org.',
    },
  },
  67: {
    LinkedIn: {
      url: 'https://www.linkedin.com/company/jiia%E3%80%80center-for-global-outreach-cgo',
      handle: 'company/jiia-center-for-global-outreach-cgo',
      source: 'https://www.linkedin.com/company/jiia%E3%80%80center-for-global-outreach-cgo',
      status: 'Sub-unit page — main organization LinkedIn not found',
      note: 'JIIA Center for Global Outreach page; use with caution for full JIIA follower tracking.',
    },
  },
  75: {
    LinkedIn: {
      url: 'https://www.linkedin.com/school/national-institute-of-advanced-studies/',
      handle: 'school/national-institute-of-advanced-studies',
      source: 'https://www.linkedin.com/school/national-institute-of-advanced-studies/',
      status: 'Corroborated — LinkedIn organization page',
      note: 'LinkedIn school-style page; website matches nias.res.in.',
    },
  },
};

function accountId(orgId, platform) {
  return `${String(orgId).padStart(3, '0')}-${platform.toLowerCase()}`;
}

function noteFor(profile) {
  return [
    profile.status,
    profile.source ? `Source: ${profile.source}` : '',
    profile.note,
  ].filter(Boolean).join(' | ');
}

const orgs = JSON.parse(await fs.readFile(path.join(ROOT, 'research', 'organizations.json'), 'utf8'));
const profiles = JSON.parse(await fs.readFile(path.join(ROOT, 'research', 'profiles_prepared.json'), 'utf8'));
const officialScan = await fs.readFile(path.join(ROOT, 'research', 'official_social_scan.json'), 'utf8')
  .then(text => JSON.parse(text).results)
  .catch(() => []);
const officialScanById = new Map(officialScan.map(result => [result.id, result]));
const rows = [];

function usableOfficialScanLink(link) {
  const url = String(link.url ?? '').toLowerCase();
  const handle = String(link.handle ?? '').toLowerCase();
  if (!url || !link.platform) return false;
  if (url.includes('youtu.be/')) return false;
  if (link.platform === 'Facebook' && ['home.php', 'share.php', 'sharer.php'].includes(handle)) return false;
  if (['YouTube', 'X', 'LinkedIn', 'Instagram', 'Facebook'].includes(link.platform) === false) return false;
  return true;
}

for (const org of orgs) {
  const orgProfiles = { ...(profiles[String(org.id)] ?? {}), ...(manualProfiles[org.id] ?? {}) };
  const scan = officialScanById.get(org.id);
  for (const link of scan?.links ?? []) {
    if (!usableOfficialScanLink(link) || orgProfiles[link.platform]) continue;
    orgProfiles[link.platform] = {
      url: link.url,
      handle: link.handle,
      source: scan.final_url || org.url,
      status: 'Verified — discovered on official website scan',
      note: `Discovered from ${org.url} via ${scan.method || 'website scan'}.`,
    };
  }
  for (const platform of platforms) {
    const profile = orgProfiles[platform];
    if (!profile?.url) continue;
    rows.push({
      id: accountId(org.id, platform),
      name: org.name,
      website: org.url,
      platform,
      handle: profile.handle ?? '',
      profile_url: profile.url,
      active: 'true',
      notes: noteFor(profile),
    });
  }
}

await fs.writeFile(ACCOUNTS_FILE, toCsv(rows, columns), 'utf8');

const byPlatform = Object.fromEntries(platforms.map(platform => [
  platform,
  rows.filter(row => row.platform === platform).length,
]));
const missingOrganizations = orgs
  .filter(org => {
    const orgProfiles = { ...(profiles[String(org.id)] ?? {}), ...(manualProfiles[org.id] ?? {}) };
    return !platforms.some(platform => orgProfiles[platform]?.url);
  })
  .map(org => ({ id: org.id, name: org.name }));

console.log(JSON.stringify({
  accounts_csv: ACCOUNTS_FILE,
  organizations: orgs.length,
  rows: rows.length,
  by_platform: byPlatform,
  missing_organizations: missingOrganizations,
}, null, 2));
