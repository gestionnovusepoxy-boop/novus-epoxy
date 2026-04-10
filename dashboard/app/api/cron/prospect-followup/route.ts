import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// DISABLED — Consolidated into /api/cron/relance-prospect to avoid double emails.
// This route is kept because it is referenced in vercel.json.
export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: true,
    skipped: true,
    message: 'Consolidated into /api/cron/relance-prospect — this route is disabled to prevent duplicate follow-up emails.',
  });
}
