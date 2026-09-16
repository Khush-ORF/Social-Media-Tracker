import { parseCompactNumber } from './utils.mjs';

const entityMap = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeHtml(value) {
  return String(value ?? '').replace(/&(amp|quot|#39|apos|nbsp);/g, token => entityMap[token] ?? token);
}

function stripTags(value) {
  return decodeHtml(String(value ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function metaContent(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i');
  return decodeHtml(html.match(re)?.[1] ?? '');
}

function metric(raw, label) {
  const parsed = parseCompactNumber(raw);
  return parsed && { ...parsed, metric_label: label };
}

function exactMetric(raw, label) {
  const clean = String(raw ?? '').replace(/,/g, '').trim();
  if (!/^[0-9]+$/.test(clean)) return null;
  return {
    count: Number(clean),
    raw_display_text: raw,
    count_precision: 'exact_public',
    metric_label: label,
  };
}

function firstJsonNumber(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return '';
}

function findNearLabel(text, labels) {
  for (const label of labels) {
    const after = new RegExp(`([0-9][0-9.,]*\\s*[KMB]?)\\s+${label}\\b`, 'i').exec(text);
    if (after) return metric(after[1], label[0].toUpperCase() + label.slice(1));
    const before = new RegExp(`${label}\\b[^0-9]{0,60}([0-9][0-9.,]*\\s*[KMB]?)`, 'i').exec(text);
    if (before) return metric(before[1], label[0].toUpperCase() + label.slice(1));
  }
  return null;
}

export function parseMetric(platform, html) {
  const metaDescription = metaContent(html, 'og:description') || metaContent(html, 'description');
  const text = `${metaDescription} ${stripTags(html)}`;

  if (platform === 'YouTube') {
    const exact = firstJsonNumber(html, [
      /"subscriberCount"\s*:\s*"([0-9]+)"/i,
      /"subscriber_count"\s*:\s*([0-9]+)/i,
      /"subscriberCount"\s*:\s*([0-9]+)/i,
    ]);
    if (exact) return exactMetric(exact, 'Subscribers');
    const jsonCount = html.match(/"subscriberCountText"\s*:\s*\{\s*"simpleText"\s*:\s*"([^"]+)"/i)?.[1]
      ?? html.match(/"subscriberCountText"\s*:\s*\{\s*"runs"\s*:\s*\[\s*\{\s*"text"\s*:\s*"([^"]+)"/i)?.[1]
      ?? html.match(/"headerLinks"\s*:[\s\S]{0,1200}?"title"\s*:\s*"([^"]*subscribers?)"/i)?.[1];
    if (jsonCount) {
      const value = jsonCount.replace(/\s*subscribers?.*/i, '');
      return metric(value, 'Subscribers');
    }
    return findNearLabel(text, ['subscribers', 'subscriber']);
  }

  if (platform === 'X') {
    const exact = html.match(/relationship_counts[\s\S]{0,1200}?followers\s*:\s*([0-9]+)/i)
      ?? html.match(/\bfollowers\s*:\s*([0-9]+)/i);
    if (exact) return metric(exact[1], 'Followers');
    return findNearLabel(text, ['followers']);
  }

  if (platform === 'LinkedIn') {
    const linkedin = text.match(/\|\s*([0-9][0-9,]*)\s+followers on LinkedIn/i)
      ?? text.match(/\b([0-9][0-9,]*)\s+followers\b/i);
    if (linkedin) return metric(linkedin[1], 'Followers');
    return null;
  }

  if (platform === 'Instagram') {
    const exact = firstJsonNumber(html, [
      /"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*([0-9]+)/i,
      /"follower_count"\s*:\s*([0-9]+)/i,
      /"followers_count"\s*:\s*([0-9]+)/i,
      /"count"\s*:\s*([0-9]+)\s*,\s*"page_info"[\s\S]{0,400}?"edge_followed_by"/i,
    ]);
    if (exact) return exactMetric(exact, 'Followers');
    const instagram = metaDescription.match(/([0-9][0-9.,]*\s*[KMB]?)\s+Followers\b/i)
      ?? text.match(/([0-9][0-9.,]*\s*[KMB]?)\s+Followers\s*,\s*[0-9.,KMB]+\s+Following/i);
    if (instagram) return metric(instagram[1], 'Followers');
    return findNearLabel(text, ['followers']);
  }

  if (platform === 'Facebook') {
    const followers = metaDescription.match(/([0-9][0-9.,]*\s*[KMB]?)\s+followers\b/i)
      ?? text.match(/([0-9][0-9.,]*\s*[KMB]?)\s+followers\b/i);
    if (followers) return metric(followers[1], 'Followers');
    const likes = metaDescription.match(/([0-9][0-9.,]*\s*[KMB]?)\s+likes\b/i)
      ?? text.match(/([0-9][0-9.,]*\s*[KMB]?)\s+likes\b/i);
    if (likes) return metric(likes[1], 'Page likes');
  }

  return null;
}

export function parseFromText(platform, text) {
  return findNearLabel(stripTags(text), platform === 'YouTube' ? ['subscribers'] : platform === 'Facebook' ? ['followers', 'likes'] : ['followers']);
}
