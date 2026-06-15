# Novus Epoxy - Security Quick Fixes

## Critical Issues - Fix Immediately

### 1. XSS in Email Body (SEC-002)

**File:** `dashboard/app/dashboard/crm/[id]/conversations/page.tsx`  
**Line:** 153  
**Issue:** Email body rendered with `dangerouslySetInnerHTML` without sanitization  
**Impact:** Account takeover via malicious email content

**Fix:**
```bash
npm install dompurify @types/dompurify
```

Then update line 153:
```tsx
import DOMPurify from 'dompurify';

// Replace this:
<div dangerouslySetInnerHTML={{ __html: e.body ?? '' }} className="prose prose-invert max-w-none" />

// With this:
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(e.body ?? '') }} className="prose prose-invert max-w-none" />
```

**Test:** Inject `<svg onload="alert('xss')">` in email body - should NOT execute

---

### 2. IDOR - Missing Authorization (SEC-003)

**Files:** 
- `dashboard/app/api/quotes/[id]/route.ts` (line 6-18)
- `dashboard/app/api/invoices/[id]/route.ts`
- `dashboard/app/api/expenses/[id]/route.ts`

**Issue:** Resource endpoints don't verify user owns the resource  
**Impact:** Attackers can read/modify any quote, invoice, expense by changing ID

**Fix for quotes/[id]/route.ts:**
```typescript
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  // ADD THIS CHECK:
  // Verify ownership (assuming quotes belong to owner_id or user context)
  // if (rows[0].owner_id !== session.user.id) {
  //   return NextResponse.json({ error: 'Non autorisé' }, { status: 403 });
  // }

  const items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);
  const extras = await query('SELECT * FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);

  return NextResponse.json({ ...rows[0], items, extras });
}
```

**Test:** 
```bash
# Try to access quote 999 that doesn't belong to current user
curl -H "Cookie: <session>" https://novus-epoxy.vercel.app/api/quotes/999
# Should return 403 Forbidden, not the quote details
```

---

### 3. Secrets in Git (SEC-001)

**Files:** `.env.local`, `.env.vps` may be in git history

**Check if exposed:**
```bash
cd /Users/novusepoxy/novus-epoxy
git log --all -p -- .env.local | head -20
```

**If found in history:**
```bash
# Remove from history
git filter-branch --tree-filter 'rm -f .env.local' -- --all

# Force push to origin
git push origin --force --all
```

**Then immediately rotate these secrets:**
- ADMIN_API_KEY
- TWILIO_ACCOUNT_SID & TWILIO_AUTH_TOKEN
- TELEGRAM_BOT_TOKEN & TELEGRAM_WEBHOOK_SECRET
- ANTHROPIC_API_KEY
- OPENROUTER_API_KEY
- STRIPE_SECRET_KEY
- META_PAGE_TOKEN
- GOOGLE_CLIENT_SECRET
- VERCEL_TOKEN

---

### 4. Dependency Vulnerabilities (SEC-004, SEC-005, SEC-006)

**Fix:**
```bash
npm install ai@6.0.202+
npm install fast-uri@latest
npm audit fix
```

**Verify:**
```bash
npm audit --json | jq '.metadata | {vulnerable, total}'
# Should show 0 vulnerable
```

---

## High Priority Fixes

### 5. API Key Rate Limiting (SEC-007)

**File:** `dashboard/lib/auth.ts` (function `requireAdmin`)

Add rate limiting:
```bash
npm install rate-limiter-flexible
```

```typescript
import { RateLimiterMemory } from 'rate-limiter-flexible';

const rateLimiter = new RateLimiterMemory({
  points: 100, // 100 requests
  duration: 60, // per 60 seconds
});

export async function requireAdmin(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') ?? '';
  if (apiKey) {
    try {
      await rateLimiter.consume(apiKey, 1);
    } catch {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
    // ... rest of validation
  }
}
```

---

### 6. PDF Template Injection (SEC-009)

**Files:** 
- `dashboard/lib/render-pdf.ts`
- `dashboard/lib/invoice-pdf.ts`
- `dashboard/lib/contract-pdf.ts`

**Issue:** User input (client names, etc.) injected into PDF template without escaping

**Fix:**
```typescript
// Add HTML escaping function
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}

// Use when building template:
const clientName = escapeHtml(quote.client_nom);
const description = escapeHtml(quote.description_travaux);
```

---

### 7. Tokens in URL (SEC-010)

**File:** `dashboard/app/api/invoices/[id]/send/route.ts` (line 69)

**Issue:** Payment link contains token in URL query string (exposed in browser history, logs, referrers)

**Fix: Change from GET parameter to POST body**
```typescript
// Instead of:
// https://novus-epoxy.vercel.app/paiement/{id}?token={token}

// Use POST request with token in body:
const response = await fetch(`https://novus-epoxy.vercel.app/api/payments/${id}`, {
  method: 'POST',
  body: JSON.stringify({ token: secret_token }),
  headers: { 'Content-Type': 'application/json' }
});
```

---

## Medium Priority Fixes

### 8. Error Message Info Disclosure (SEC-011)

Search and fix error returns:
```bash
grep -r "String(err)" dashboard/app/api/ --include="*.ts"
```

Replace all instances:
```typescript
// BAD:
return NextResponse.json({ error: `Erreur: ${String(err)}` }, { status: 500 });

// GOOD:
console.error('Detailed error:', err);
return NextResponse.json({ error: 'Une erreur est survenue. Veuillez réessayer.' }, { status: 500 });
```

---

### 9. Missing Security Headers (SEC-017)

**File:** `dashboard/middleware.ts`

Add these headers:
```typescript
res.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; object-src 'none'");
res.headers.set('X-Content-Type-Options', 'nosniff');
res.headers.set('X-Frame-Options', 'DENY');
res.headers.set('X-XSS-Protection', '1; mode=block');
res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
```

---

## Testing Checklist

After fixes, verify:
- [ ] `npm audit` shows 0 HIGH/CRITICAL vulnerabilities
- [ ] `npm test` passes
- [ ] XSS test: email with `<svg onload="alert('xss')">` doesn't execute
- [ ] IDOR test: unauthorized user gets 403 when accessing quote/invoice/expense they don't own
- [ ] Rate limit test: 101 API key requests in 1 minute returns 429
- [ ] Error handling: no stack traces or sensitive info in error responses

---

## Files to Review

1. **Authentication:** `dashboard/lib/auth.ts`
2. **IDOR Issues:** `dashboard/app/api/quotes/[id]/route.ts`, `dashboard/app/api/invoices/[id]/route.ts`
3. **XSS:** `dashboard/app/dashboard/crm/[id]/conversations/page.tsx`
4. **Template Injection:** `dashboard/lib/render-pdf.ts`
5. **Middleware/Headers:** `dashboard/middleware.ts`

---

## Reference Documents

- Full Report: `/Users/novusepoxy/novus-epoxy/SECURITY_SCAN_COMPREHENSIVE.json`
- Summary: `/Users/novusepoxy/novus-epoxy/SECURITY_SCAN_SUMMARY.txt`
- Previous Audits:
  - `SECURITY_AUDIT_2024.json`
  - `SECURITY_AUDIT_REPORT.json`
  - `SECURITY_AUDIT_SENSITIVE_DATA_2026.json`

---

## Timeline

**Today:** 
- Fix XSS (SEC-002) - 15 min
- Fix IDOR (SEC-003) - 1 hour
- Update dependencies (SEC-004) - 30 min

**This Week:**
- Rotate secrets (SEC-001) - 2 hours
- API key rate limiting (SEC-007) - 1 hour
- PDF template injection (SEC-009) - 1 hour

**Next 2 Weeks:**
- Security headers (SEC-017)
- Audit logging (SEC-016)
- Remaining medium/low issues

---

**Generated:** 2026-06-14  
**Status:** CRITICAL - ACTION REQUIRED
