# Jira RSS Proxy

A lightweight local HTTP proxy that re-serves authenticated Jira Cloud RSS feeds as unauthenticated endpoints. Useful for RSS readers and browser features (e.g. Live Folders) that cannot handle HTTP Basic Auth.

## Requirements

- Node.js (no external dependencies)

## Setup

### 1. Get a Jira API Token

Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens) and create a new API token.

### 2. Find your Jira RSS URLs

For each saved filter you want to proxy:

1. Open the saved filter in Jira
2. Click **Export** in the top-right corner
3. Select **RSS (Issues)**
4. Copy the URL from your browser's address bar

It will look like:
```
https://yourcompany.atlassian.net/sr/jira.issueviews:searchrequest-rss/10225/SearchRequest-10225.xml?tempMax=1000
```

### 3. Configure the proxy

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
JIRA_FEEDS=bugs=https://yourcompany.atlassian.net/.../SearchRequest-111.xml?tempMax=1000,releases=https://yourcompany.atlassian.net/.../SearchRequest-222.xml?tempMax=1000
JIRA_EMAIL=you@example.com
JIRA_API_TOKEN=your_api_token_here
PORT=8088
CACHE_TTL_SECONDS=300
```

`JIRA_FEEDS` is a comma-separated list of `name=url` pairs. The name becomes the URL path on the local server. You can define as many feeds as you need.

## Running the server

```bash
node server.js
```

On startup the server logs each feed's local URL and its upstream target:

```
[2024-01-01T00:00:00.000Z] Jira RSS proxy listening on http://localhost:8088
[2024-01-01T00:00:00.000Z] Cache TTL: 300s
[2024-01-01T00:00:00.000Z]   http://localhost:8088/bugs      →  https://yourcompany.atlassian.net/.../SearchRequest-111.xml
[2024-01-01T00:00:00.000Z]   http://localhost:8088/releases  →  https://yourcompany.atlassian.net/.../SearchRequest-222.xml
```

## Using the feeds

Point any RSS reader or browser feature at the local URLs, for example:

- `http://localhost:8088/bugs`
- `http://localhost:8088/releases`

No authentication is required on the local side — the proxy handles it transparently using your credentials from `.env`.

If you request an unknown path, the server responds with `404` and lists the available feed paths.

## Configuration reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `JIRA_FEEDS` | Yes | — | Comma-separated `name=url` pairs, one per filter |
| `JIRA_EMAIL` | Yes | — | Atlassian account email |
| `JIRA_API_TOKEN` | Yes | — | Atlassian API token |
| `PORT` | No | `8088` | Local port to listen on |
| `CACHE_TTL_SECONDS` | No | `300` | Seconds to cache each upstream response before re-fetching |

## How it works

- Each feed has its own in-memory cache slot, keyed by its path
- Incoming GET requests are served from cache if within the TTL window
- On a cache miss, the server fetches the upstream Jira URL using HTTP Basic Auth, caches the result, and serves it
- If an upstream fetch fails, the server responds with `502 Bad Gateway` and a plain-text error message
- All requests and upstream fetches are logged to stdout with timestamps
