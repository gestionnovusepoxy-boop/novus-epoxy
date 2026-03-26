import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const maxDuration = 120;
export const runtime = 'nodejs';

interface CommandSpec {
  cmd: string;
  args: string[];
  cwd: string;
  label: string;
}

const ALLOWED_COMMANDS: Record<string, CommandSpec> = {
  'deploy':     { cmd: 'vercel', args: ['deploy', '--prod'], cwd: '/Users/novusepoxy/novus-epoxy', label: '🚀 Deploy Production' },
  'git-status': { cmd: 'git',    args: ['status'],            cwd: '/Users/novusepoxy/novus-epoxy', label: '📊 Git Status' },
  'git-log':    { cmd: 'git',    args: ['log', '--oneline', '-15'], cwd: '/Users/novusepoxy/novus-epoxy', label: '📋 Git Log' },
  'git-diff':   { cmd: 'git',    args: ['diff', '--stat'],    cwd: '/Users/novusepoxy/novus-epoxy', label: '🔍 Git Diff' },
  'ts-check':   { cmd: 'npx',    args: ['tsc', '--noEmit'],   cwd: '/Users/novusepoxy/novus-epoxy/dashboard', label: '✅ TypeScript Check' },
  'node-ver':   { cmd: 'node',   args: ['--version'],         cwd: '/Users/novusepoxy/novus-epoxy', label: '📦 Node Version' },
  'git-branch': { cmd: 'git',    args: ['branch', '-a'],      cwd: '/Users/novusepoxy/novus-epoxy', label: '🌿 Git Branches' },
};

function buildFullCommand(spec: CommandSpec): string {
  const escaped = spec.args.map(a => a.includes(' ') ? `"${a}"` : a);
  return `${spec.cmd} ${escaped.join(' ')}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse('Non autorisé', { status: 401 });

  const body = await req.json() as { command: string };
  const commandKey = body.command;

  if (!commandKey || !ALLOWED_COMMANDS[commandKey]) {
    return NextResponse.json(
      { error: 'Commande non autorisée', allowed: Object.keys(ALLOWED_COMMANDS) },
      { status: 400 }
    );
  }

  const spec = ALLOWED_COMMANDS[commandKey];
  const fullCmd = buildFullCommand(spec);
  const encoder = new TextEncoder();

  // Dynamic import to avoid Turbopack static analysis
  const cp = await import(/* webpackIgnore: true */ 'child_process');

  const stream = new ReadableStream({
    start(controller) {
      const child = cp.spawn('sh', ['-c', fullCmd], {
        cwd: spec.cwd,
        env: { ...process.env, PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (data: Buffer) => {
        controller.enqueue(encoder.encode(data.toString()));
      });

      child.stderr.on('data', (data: Buffer) => {
        controller.enqueue(encoder.encode(data.toString()));
      });

      child.on('close', (code: number | null) => {
        controller.enqueue(encoder.encode(`\n[exit code: ${code ?? 0}]\n`));
        controller.close();
      });

      child.on('error', (err: Error) => {
        controller.enqueue(encoder.encode(`\nErreur: ${err.message}\n`));
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    },
  });
}

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse('Non autorisé', { status: 401 });

  const commands = Object.entries(ALLOWED_COMMANDS).map(([key, spec]) => ({
    key,
    label: spec.label,
  }));

  return NextResponse.json({ commands });
}
