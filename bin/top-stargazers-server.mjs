#!/usr/bin/env node

import { createServer } from "node:http";
import { buildSuperstarsSvg, buildTopStargazersSvg, DEFAULTS, parseRepo } from "./top-stargazers-card.mjs";

const DEFAULT_PORT = Number.parseInt(process.env.PORT || "3000", 10);
const DEFAULT_CACHE_TTL_SECONDS = Number.parseInt(process.env.CACHE_TTL_SECONDS || "21600", 10);
const cache = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method not allowed");
      return;
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      sendText(response, 200, usageText(request));
      return;
    }

    const route = parseSvgRoute(url.pathname);
    if (!route) {
      sendText(response, 404, "Expected /owner/repo.svg");
      return;
    }

    const options = optionsFromSearchParams(url.searchParams);
    if (route.mode) {
      options.mode = route.mode;
    }
    const cacheKey = JSON.stringify({ ...route, ...options });
    const cached = getCached(cacheKey);

    if (cached) {
      sendSvg(response, cached.svg, cached.ageSeconds, request.method);
      return;
    }

    const input = {
      ...options,
      repo: `${route.owner}/${route.name}`,
      token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    };
    const svg = options.mode === "superstars"
      ? await buildSuperstarsSvg(input)
      : await buildTopStargazersSvg(input);

    cache.set(cacheKey, { svg, expiresAt: Date.now() + DEFAULT_CACHE_TTL_SECONDS * 1000, createdAt: Date.now() });
    sendSvg(response, svg, 0, request.method);
  } catch (error) {
    const svg = renderErrorSvg(error);
    response.writeHead(400, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(svg);
  }
});

server.listen(DEFAULT_PORT, () => {
  console.log(`Top Stargazers Card listening on http://localhost:${DEFAULT_PORT}`);
  console.log(`Try http://localhost:${DEFAULT_PORT}/owner/repo.svg?demo=1`);
});

function parseSvgRoute(pathname) {
  if (!pathname.endsWith(".svg")) {
    return null;
  }

  const parts = pathname.slice(1, -4).split("/").map(decodeURIComponent);
  if (parts.length !== 2 && !(parts.length === 3 && parts[2] === "superstars")) {
    return null;
  }

  const [owner, name] = parts;
  const mode = parts[2] || null;
  parseRepo(`${owner}/${name}`);
  return { owner, name, mode };
}

function optionsFromSearchParams(searchParams) {
  return {
    limit: readInt(searchParams, "limit", DEFAULTS.limit),
    maxStargazers: readInt(searchParams, "maxStargazers", readInt(searchParams, "max_stargazers", DEFAULTS.maxStargazers)),
    minFollowers: readInt(searchParams, "minFollowers", readInt(searchParams, "min_followers", DEFAULTS.minFollowers)),
    concurrency: readInt(searchParams, "concurrency", DEFAULTS.concurrency),
    theme: searchParams.get("theme") || DEFAULTS.theme,
    excludeBots: readBool(searchParams, "excludeBots") || readBool(searchParams, "exclude_bots"),
    demo: readBool(searchParams, "demo"),
    mode: searchParams.get("mode") || DEFAULTS.mode,
  };
}

function readInt(searchParams, key, fallback) {
  const value = searchParams.get(key);
  if (value === null || value === "") {
    return fallback;
  }

  return Number.parseInt(value, 10);
}

function readBool(searchParams, key) {
  const value = searchParams.get(key);
  return value === "1" || value === "true" || value === "yes";
}

function getCached(key) {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return {
    svg: cached.svg,
    ageSeconds: Math.floor((Date.now() - cached.createdAt) / 1000),
  };
}

function sendSvg(response, svg, ageSeconds, method) {
  response.writeHead(200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": `public, max-age=${Math.min(DEFAULT_CACHE_TTL_SECONDS, 3600)}, stale-while-revalidate=${DEFAULT_CACHE_TTL_SECONDS}`,
    Age: String(ageSeconds),
    "Access-Control-Allow-Origin": "*",
  });

  if (method === "HEAD") {
    response.end();
    return;
  }

  response.end(svg);
}

function sendText(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function usageText(request) {
  const host = request.headers.host || "localhost:3000";
  return `Top Stargazers Card

Embed:
![Top stargazers](https://${host}/owner/repo.svg)

Local demo:
http://${host}/owner/repo.svg?demo=1

Options:
limit=6
maxStargazers=500
minFollowers=0
theme=light|dark
excludeBots=1
`;
}

function renderErrorSvg(error) {
  const message = escapeXml(error.message || "Unknown error");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="720" height="120" viewBox="0 0 720 120" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Top stargazers error">
  <rect x="0.5" y="0.5" width="719" height="119" rx="10" fill="#fff8f8" stroke="#ffb3b3"/>
  <text x="24" y="40" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#b42318">Top stargazers unavailable</text>
  <text x="24" y="70" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="#57606a">${message}</text>
</svg>
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
