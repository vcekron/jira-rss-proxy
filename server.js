'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function loadEnv(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env not required if env vars are already set
  }
}

loadEnv(path.join(__dirname, '.env'));

const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const PORT = parseInt(process.env.PORT || '8088', 10);
const CACHE_TTL_SECONDS = parseInt(process.env.CACHE_TTL_SECONDS || '300', 10);

if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error('Missing required environment variables: JIRA_EMAIL, JIRA_API_TOKEN');
  process.exit(1);
}

function parseFeeds(raw) {
  if (!raw || !raw.trim()) return null;
  const feeds = new Map();
  for (const entry of raw.split(',')) {
    const entry_trimmed = entry.trim();
    const eqIndex = entry_trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const feedPath = '/' + entry_trimmed.slice(0, eqIndex).trim();
    const feedUrl = entry_trimmed.slice(eqIndex + 1).trim();
    if (feedPath && feedUrl) {
      feeds.set(feedPath, { url: feedUrl, body: null, timestamp: 0 });
    }
  }
  return feeds.size > 0 ? feeds : null;
}

const feeds = parseFeeds(process.env.JIRA_FEEDS);

if (!feeds) {
  console.error('Missing or invalid JIRA_FEEDS. Expected format: name1=https://...,name2=https://...');
  process.exit(1);
}

const authHeader = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

function isCacheFresh(feed) {
  return feed.body !== null && (Date.now() - feed.timestamp) < CACHE_TTL_SECONDS * 1000;
}

function ts() {
  return new Date().toISOString();
}

function fetchUpstream(feedUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(feedUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/rss+xml, application/xml, text/xml',
      },
    };

    const protocol = url.protocol === 'https:' ? https : http;

    const req = protocol.request(options, (res) => {
      console.log(`[${ts()}] Upstream fetch ${feedUrl} → HTTP ${res.statusCode}`);

      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Upstream returned HTTP ${res.statusCode}`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    req.on('error', reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  console.log(`[${ts()}] ${req.method} ${req.url}`);

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const feed = feeds.get(req.url);

  if (!feed) {
    const available = [...feeds.keys()].join(', ');
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`Not Found. Available feeds: ${available}`);
    return;
  }

  if (isCacheFresh(feed)) {
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(feed.body);
    return;
  }

  try {
    const body = await fetchUpstream(feed.url);
    feed.body = body;
    feed.timestamp = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
    res.end(body);
  } catch (err) {
    console.error(`[${ts()}] Upstream error for ${req.url}: ${err.message}`);
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Bad Gateway: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`[${ts()}] Jira RSS proxy listening on http://localhost:${PORT}`);
  console.log(`[${ts()}] Cache TTL: ${CACHE_TTL_SECONDS}s`);
  for (const [feedPath, feed] of feeds) {
    console.log(`[${ts()}]   http://localhost:${PORT}${feedPath}  →  ${feed.url}`);
  }
});
