import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const start = Date.now();
  let db_ok = false;

  try {
    const sql = neon(process.env.DATABASE_URL!);
    await sql`SELECT 1`;
    db_ok = true;
  } catch {
    db_ok = false;
  }

  const latency = Date.now() - start;
  const status = db_ok ? 'ok' : 'degraded';

  return NextResponse.json(
    { status, db: db_ok, latency_ms: latency, ts: new Date().toISOString() },
    { status: db_ok ? 200 : 503 }
  );
}
