import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { put } from '@vercel/blob';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  const rows = await query(
    `SELECT receipt_url, receipt_filename FROM expenses WHERE id = $1`,
    [parseInt(id)],
  );

  const exp = rows[0];
  if (!exp || !exp.receipt_url) {
    return NextResponse.json({ error: 'Aucun recu' }, { status: 404 });
  }

  return NextResponse.redirect(exp.receipt_url as string);
}

// POST — upload a receipt photo to an existing expense
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  const expenseId = parseInt(id);
  if (isNaN(expenseId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'Fichier requis' }, { status: 400 });

  // Upload to Vercel Blob
  const ext = file.name.split('.').pop() || 'jpg';
  const filename = `receipts/expense-${expenseId}-${Date.now()}.${ext}`;
  const blob = await put(filename, file, {
    access: 'public',
    contentType: file.type || 'image/jpeg',
  });

  // Update the expense row
  await query(
    `UPDATE expenses SET receipt_url = $1, receipt_filename = $2, updated_at = NOW() WHERE id = $3`,
    [blob.url, file.name, expenseId],
  );

  return NextResponse.json({ ok: true, receipt_url: blob.url, receipt_filename: file.name });
}

// DELETE — remove the receipt from an expense
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  await query(
    `UPDATE expenses SET receipt_url = NULL, receipt_filename = NULL, updated_at = NOW() WHERE id = $1`,
    [parseInt(id)],
  );

  return NextResponse.json({ ok: true });
}
