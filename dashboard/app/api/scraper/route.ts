import { NextRequest, NextResponse } from "next/server";

const SCRAPER_URL = process.env.SCRAPER_URL || "http://localhost:8899";
const API_KEY = process.env.ADMIN_API_KEY;

async function proxyToScraper(endpoint: string, body: any) {
  const res = await fetch(`${SCRAPER_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Scraper error: ${text}` },
      { status: res.status }
    );
  }

  return NextResponse.json(await res.json());
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("authorization")?.replace("Bearer ", "");
  if (apiKey !== API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { action, ...params } = body;

  switch (action) {
    case "scrape":
      return proxyToScraper("/scrape", params);
    case "leads":
      return proxyToScraper("/scrape/leads", params);
    case "competitors":
      return proxyToScraper("/scrape/competitors", params);
    case "directories":
      return proxyToScraper(`/scrape/directories?region=${params.region || "quebec"}`, {});
    case "bulk-import":
      return proxyToScraper("/scrape/bulk-import", params);
    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
}

export async function GET() {
  try {
    const res = await fetch(`${SCRAPER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return NextResponse.json({ ...data, connected: true });
  } catch {
    return NextResponse.json({ status: "offline", connected: false });
  }
}
