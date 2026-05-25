import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { callLLM } from '@/lib/llm';

/* ------------------------------------------------------------------ */
/*  CSV Parsing — supports Desjardins, TD, RBC, BMO Quebec formats    */
/* ------------------------------------------------------------------ */

interface ParsedRow {
  date_tx: string;
  description: string;
  montant: number;
  type: 'credit' | 'debit';
  reference: string | null;
}

function parseCsvLines(raw: string): string[][] {
  const lines = raw.trim().split(/\r?\n/);
  return lines.map((line) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
      if (ch === ';' && !inQuotes) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  });
}

/** Try to parse a date string into YYYY-MM-DD. Handles DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY, YYYYMMDD */
function parseDate(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYYMMDD
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  // DD/MM/YYYY or DD-MM-YYYY (Quebec default)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    // If day > 12, it must be DD/MM/YYYY
    if (parseInt(d) > 12) return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    // If month > 12, it must be MM/DD/YYYY
    if (parseInt(m) > 12) return `${y}-${d.padStart(2, '0')}-${m.padStart(2, '0')}`;
    // Ambiguous — default DD/MM/YYYY (Quebec convention)
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  // Handle French-style: 1 234,56 or 1234,56
  let s = raw.replace(/\s/g, '').replace(/\$/g, '');
  // If comma is the decimal separator (no dot present, or comma after dot)
  if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.');
  } else if (s.includes(',') && s.includes('.')) {
    // 1,234.56 — comma is thousands separator
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function detectBankFormat(headers: string[]): string {
  const h = headers.map((c) => c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

  if (h.some((c) => c.includes('numero de compte'))) return 'desjardins';
  if (h.some((c) => c.includes('account number'))) return 'td';
  if (h.some((c) => c.includes('rbc'))) return 'rbc';
  if (h.some((c) => c.includes('bmo'))) return 'bmo';

  // Fallback: generic Date, Description, Debit, Credit
  return 'generic';
}

function findColumnIndex(headers: string[], ...candidates: string[]): number {
  const norm = headers.map((h) => h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim());
  for (const c of candidates) {
    const idx = norm.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseCsvToRows(csv: string, bank?: string): ParsedRow[] {
  const lines = parseCsvLines(csv);
  if (lines.length < 2) return [];

  const headers = lines[0];
  const format = bank || detectBankFormat(headers);

  const dateCol = findColumnIndex(headers, 'date', 'date de transaction', 'transaction date', 'date de l\'operation');
  const descCol = findColumnIndex(headers, 'description', 'libelle', 'details', 'transaction description', 'memo');
  const debitCol = findColumnIndex(headers, 'debit', 'retrait', 'withdrawal', 'montant debit');
  const creditCol = findColumnIndex(headers, 'credit', 'depot', 'deposit', 'montant credit');
  const amountCol = findColumnIndex(headers, 'montant', 'amount', 'somme');
  const refCol = findColumnIndex(headers, 'reference', 'numero', 'ref', 'no.');

  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i];
    if (!cells || cells.length < 2) continue;

    const dateRaw = dateCol >= 0 ? cells[dateCol] : cells[0];
    const date = parseDate(dateRaw ?? '');
    if (!date) continue;

    const description = (descCol >= 0 ? cells[descCol] : cells[1]) ?? '';
    if (!description) continue;

    let montant = 0;
    let type: 'credit' | 'debit' = 'debit';

    if (debitCol >= 0 && creditCol >= 0) {
      // Separate debit/credit columns
      const dVal = parseAmount(cells[debitCol] ?? '');
      const cVal = parseAmount(cells[creditCol] ?? '');
      if (dVal > 0) { montant = dVal; type = 'debit'; }
      else if (cVal > 0) { montant = cVal; type = 'credit'; }
      else continue; // skip zero rows
    } else if (amountCol >= 0) {
      // Single amount column — negative = debit, positive = credit
      const val = parseAmount(cells[amountCol] ?? '');
      if (val === 0) continue;
      montant = Math.abs(val);
      type = val < 0 ? 'debit' : 'credit';
    } else {
      // Try columns 2 and 3
      const dVal = parseAmount(cells[2] ?? '');
      const cVal = parseAmount(cells[3] ?? '');
      if (dVal > 0) { montant = dVal; type = 'debit'; }
      else if (cVal > 0) { montant = cVal; type = 'credit'; }
      else continue;
    }

    const reference = refCol >= 0 ? (cells[refCol] || null) : null;

    rows.push({ date_tx: date, description: description.slice(0, 500), montant, type, reference });
  }

  // Suppress unused variable warning
  void format;

  return rows;
}

/* ------------------------------------------------------------------ */
/*  Auto-reconciliation with Claude Haiku fuzzy matching              */
/* ------------------------------------------------------------------ */

async function fuzzyMatchWithClaude(
  txDescription: string,
  candidates: { id: number; description: string; fournisseur?: string }[],
): Promise<number | null> {
  if (candidates.length === 0) return null;

  const candidateList = candidates
    .map((c) => `ID ${c.id}: "${c.fournisseur ? c.fournisseur + ' - ' : ''}${c.description ?? ''}"`)
    .join('\n');

  try {
    const text = await callLLM({
      messages: [{
        role: 'user',
        content: `Bank transaction description: "${txDescription}"

Which of these candidates is the most likely match? Only respond with the ID number if you are confident (>80% sure), otherwise respond with "NONE".

Candidates:
${candidateList}`,
      }],
      maxTokens: 100,
      tier: 'bulk',
    });
    const match = text.match(/\b(\d+)\b/);
    if (match && text.toUpperCase() !== 'NONE') {
      const matchedId = parseInt(match[1]);
      if (candidates.some((c) => c.id === matchedId)) return matchedId;
    }
    return null;
  } catch {
    return null;
  }
}

async function autoReconcile(txIds: number[]): Promise<number> {
  if (txIds.length === 0) return 0;

  const placeholders = txIds.map((_, i) => `$${i + 1}`).join(',');
  const unreconciledTx = await query(
    `SELECT * FROM bank_transactions WHERE id IN (${placeholders}) AND reconciled = false ORDER BY date_tx`,
    txIds,
  );

  let reconciled = 0;

  for (const tx of unreconciledTx) {
    const montant = Math.abs(Number(tx.montant));
    const type = tx.type as string;
    const dateTx = tx.date_tx as string;
    const txId = tx.id as number;
    const desc = tx.description as string;

    if (type === 'debit') {
      // Step 1: Exact amount + date match with expenses
      const exactMatch = await query(
        `SELECT * FROM expenses
         WHERE ABS(montant_ttc - $1) < 0.01
         AND date_depense BETWEEN ($2::date - INTERVAL '3 days') AND ($2::date + INTERVAL '3 days')
         AND reconciled = false
         LIMIT 1`,
        [montant, dateTx],
      );

      if (exactMatch[0]) {
        await query(
          'UPDATE bank_transactions SET reconciled = true, expense_id = $1 WHERE id = $2',
          [exactMatch[0].id, txId],
        );
        await query(
          'UPDATE expenses SET reconciled = true, transaction_id = $1 WHERE id = $2',
          [txId, exactMatch[0].id],
        );
        reconciled++;
        continue;
      }

      // Step 2: Amount matches within date range, fuzzy-match description with Claude
      const amountCandidates = await query(
        `SELECT id, description, fournisseur FROM expenses
         WHERE ABS(montant_ttc - $1) < 0.01
         AND reconciled = false
         LIMIT 5`,
        [montant],
      );

      if (amountCandidates.length > 0) {
        const matchedId = await fuzzyMatchWithClaude(
          desc,
          amountCandidates.map((r) => ({
            id: r.id as number,
            description: r.description as string,
            fournisseur: r.fournisseur as string,
          })),
        );
        if (matchedId) {
          await query(
            'UPDATE bank_transactions SET reconciled = true, expense_id = $1 WHERE id = $2',
            [matchedId, txId],
          );
          await query(
            'UPDATE expenses SET reconciled = true, transaction_id = $1 WHERE id = $2',
            [txId, matchedId],
          );
          reconciled++;
          continue;
        }
      }
    }

    if (type === 'credit') {
      // Step 1: Exact amount + date match with payments
      const exactMatch = await query(
        `SELECT p.id, p.invoice_id FROM payments p
         WHERE ABS(p.montant - $1) < 0.01
         AND p.paid_at::date BETWEEN ($2::date - INTERVAL '3 days') AND ($2::date + INTERVAL '3 days')
         AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.payment_id = p.id AND bt.reconciled = true)
         LIMIT 1`,
        [montant, dateTx],
      );

      if (exactMatch[0]) {
        await query(
          'UPDATE bank_transactions SET reconciled = true, payment_id = $1, invoice_id = $2 WHERE id = $3',
          [exactMatch[0].id, exactMatch[0].invoice_id, txId],
        );
        reconciled++;
        continue;
      }

      // Step 2: Amount matches, fuzzy-match with Claude
      const amountCandidates = await query(
        `SELECT p.id, p.invoice_id, i.numero AS description, '' AS fournisseur
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE ABS(p.montant - $1) < 0.01
         AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.payment_id = p.id AND bt.reconciled = true)
         LIMIT 5`,
        [montant],
      );

      if (amountCandidates.length > 0) {
        const matchedId = await fuzzyMatchWithClaude(
          desc,
          amountCandidates.map((r) => ({
            id: r.id as number,
            description: (r.description as string) ?? `Payment #${r.id}`,
          })),
        );
        if (matchedId) {
          const p = amountCandidates.find((r) => (r.id as number) === matchedId);
          await query(
            'UPDATE bank_transactions SET reconciled = true, payment_id = $1, invoice_id = $2 WHERE id = $3',
            [matchedId, p?.invoice_id ?? null, txId],
          );
          reconciled++;
          continue;
        }
      }
    }
  }

  return reconciled;
}

/* ------------------------------------------------------------------ */
/*  POST /api/bank/import — Import bank CSV                           */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { csv, bank, transactions } = body as {
    csv?: string;
    bank?: string;
    transactions?: ParsedRow[];
  };

  // Support both CSV string and pre-parsed transactions (backward compat)
  let rows: ParsedRow[];
  if (csv) {
    rows = parseCsvToRows(csv, bank);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Aucune transaction valide dans le CSV' }, { status: 400 });
    }
  } else if (Array.isArray(transactions) && transactions.length > 0) {
    rows = transactions;
  } else {
    return NextResponse.json({ error: 'csv ou transactions requis' }, { status: 400 });
  }

  let imported = 0;
  let duplicatesSkipped = 0;
  const importedIds: number[] = [];

  for (const row of rows) {
    const { date_tx, description, montant, type, reference } = row;
    if (!date_tx || !description || montant == null || !type) continue;

    // Check for duplicates (same date + description + amount)
    const existing = await query(
      `SELECT id FROM bank_transactions
       WHERE date_tx = $1 AND description = $2 AND ABS(montant - $3) < 0.01
       LIMIT 1`,
      [date_tx, description.slice(0, 500), Math.abs(montant)],
    );

    if (existing.length > 0) {
      duplicatesSkipped++;
      continue;
    }

    const insertResult = await query(
      `INSERT INTO bank_transactions (date_tx, description, montant, type, reference)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [date_tx, description.slice(0, 500), Math.abs(montant), type, reference ?? null],
    );

    if (insertResult[0]) {
      importedIds.push(insertResult[0].id as number);
      imported++;
    }
  }

  // Auto-reconcile imported transactions
  const reconciled = await autoReconcile(importedIds);

  return NextResponse.json({
    imported,
    duplicates_skipped: duplicatesSkipped,
    reconciled,
    unmatched: imported - reconciled,
  });
}

/* ------------------------------------------------------------------ */
/*  GET /api/bank/import — Reconciliation status                      */
/* ------------------------------------------------------------------ */

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const totalRows = await query('SELECT COUNT(*)::int AS count FROM bank_transactions', []);
  const reconciledRows = await query(
    'SELECT COUNT(*)::int AS count FROM bank_transactions WHERE reconciled = true',
    [],
  );
  const unreconciledRows = await query(
    `SELECT bt.*,
       e.fournisseur AS matched_expense_fournisseur,
       p.montant AS matched_payment_montant
     FROM bank_transactions bt
     LEFT JOIN expenses e ON e.id = bt.expense_id
     LEFT JOIN payments p ON p.id = bt.payment_id
     WHERE bt.reconciled = false
     ORDER BY bt.date_tx DESC
     LIMIT 100`,
    [],
  );

  return NextResponse.json({
    total: (totalRows[0]?.count as number) ?? 0,
    reconciled: (reconciledRows[0]?.count as number) ?? 0,
    unreconciled: unreconciledRows,
  });
}
