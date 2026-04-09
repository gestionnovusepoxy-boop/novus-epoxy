"""
Novus Epoxy — Scraping Service
FastAPI + Scrapling v0.4.5 for automated lead extraction and competitor monitoring.
"""

import asyncio
import hashlib
import json
import os
import re
import time
import urllib.request
from collections import defaultdict
from datetime import datetime
from threading import Lock
from typing import Optional
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scrapling import Fetcher

app = FastAPI(title="Novus Epoxy Scraper", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://novus-epoxy.vercel.app",
        "http://localhost:3000",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("ADMIN_API_KEY", "65d5d80cca68d9b6161fe9b528465aba0a534be595434941")
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "https://novus-epoxy.vercel.app")

# --- Config ---
SCRAPE_TIMEOUT = int(os.getenv("SCRAPE_TIMEOUT", "15"))
CACHE_TTL_SECONDS = 3600  # 1 hour
MAX_RETRIES = 3
RATE_LIMIT_PER_DOMAIN = 2  # max requests per second per domain

# Novus Epoxy own phone numbers — always filtered from competitor/lead results
NOVUS_PHONES_DIGITS = {"5813075983", "5813072678", "15813075983", "15813072678"}


# --- TTL Cache ---

class TTLCache:
    """Simple in-memory cache with per-entry TTL expiration."""

    def __init__(self, ttl: int = CACHE_TTL_SECONDS):
        self._store: dict[str, tuple[float, dict]] = {}
        self._lock = Lock()
        self.ttl = ttl
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[dict]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.misses += 1
                return None
            timestamp, value = entry
            if time.time() - timestamp > self.ttl:
                del self._store[key]
                self.misses += 1
                return None
            self.hits += 1
            return value

    def set(self, key: str, value: dict):
        with self._lock:
            self._store[key] = (time.time(), value)

    def clear_expired(self):
        with self._lock:
            now = time.time()
            expired = [k for k, (ts, _) in self._store.items() if now - ts > self.ttl]
            for k in expired:
                del self._store[k]

    @property
    def size(self) -> int:
        return len(self._store)


scrape_cache = TTLCache()


# --- Rate Limiter ---

class DomainRateLimiter:
    """Rate limiter that enforces max N requests/sec per domain."""

    def __init__(self, max_per_sec: int = RATE_LIMIT_PER_DOMAIN):
        self._timestamps: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()
        self.max_per_sec = max_per_sec

    def _domain(self, url: str) -> str:
        return urlparse(url).netloc or url

    async def wait(self, url: str):
        domain = self._domain(url)
        while True:
            with self._lock:
                now = time.time()
                # Purge timestamps older than 1 second
                self._timestamps[domain] = [
                    t for t in self._timestamps[domain] if now - t < 1.0
                ]
                if len(self._timestamps[domain]) < self.max_per_sec:
                    self._timestamps[domain].append(now)
                    return
            # Wait a bit and retry
            await asyncio.sleep(0.1)


rate_limiter = DomainRateLimiter()


# --- Request Stats ---

class RequestStats:
    """Track request counts and errors."""

    def __init__(self):
        self._lock = Lock()
        self.total_requests = 0
        self.successful = 0
        self.failed = 0
        self.by_endpoint: dict[str, int] = defaultdict(int)
        self.started_at = datetime.now().isoformat()

    def record(self, endpoint: str, success: bool):
        with self._lock:
            self.total_requests += 1
            self.by_endpoint[endpoint] += 1
            if success:
                self.successful += 1
            else:
                self.failed += 1

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "total_requests": self.total_requests,
                "successful": self.successful,
                "failed": self.failed,
                "by_endpoint": dict(self.by_endpoint),
                "started_at": self.started_at,
                "cache_hits": scrape_cache.hits,
                "cache_misses": scrape_cache.misses,
                "cache_size": scrape_cache.size,
            }


stats = RequestStats()


# --- Monitor Store ---
# Stores previous scrape results for /scrape/monitor change detection
monitor_store: dict[str, dict] = {}
monitor_lock = Lock()


# --- Auth ---

def verify_api_key(authorization: str = Header(None)):
    if not authorization or authorization.replace("Bearer ", "") != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# --- Models ---

class ScrapeRequest(BaseModel):
    url: str
    selector: Optional[str] = None
    extract_leads: bool = False

class BatchScrapeRequest(BaseModel):
    urls: list[str]
    extract_leads: bool = False

class CompetitorRequest(BaseModel):
    urls: list[str]

class MonitorRequest(BaseModel):
    urls: list[str]


# --- Helpers ---

# Quebec-specific area codes for better phone detection
QC_AREA_CODES = r'(?:418|581|819|450|438|514|579|873|367|354|468|263)'

PHONE_PATTERN = re.compile(
    r'(?:\+?1[-.\s]?)?'
    r'(?:\(?' + QC_AREA_CODES + r'\)?[-.\s]?\d{3}[-.\s]?\d{4}'
    r'|\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})'
)

# Additional pattern for Quebec formats like "581.307.5983" or "581 307 5983"
QC_PHONE_STRICT = re.compile(
    r'(?:\+?1[-.\s]?)?\(?' + QC_AREA_CODES + r'\)?[-.\s]?\d{3}[-.\s]?\d{4}'
)

EMAIL_PATTERN = re.compile(
    r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'
)

QC_CITIES = [
    "québec", "quebec", "lévis", "levis", "beauport", "charlesbourg",
    "sainte-foy", "cap-rouge", "shannon", "val-bélair", "val-belair",
    "l'ancienne-lorette", "saint-augustin", "boischatel", "lac-beauport",
    "stoneham", "wendake", "loretteville", "neufchâtel", "neufchatel",
    "montréal", "montreal", "laval", "gatineau", "sherbrooke", "trois-rivières",
    "saguenay", "drummondville", "granby", "saint-hyacinthe", "rimouski",
    "victoriaville", "shawinigan", "alma", "sept-îles", "baie-comeau",
    "thetford mines", "magog", "joliette", "sorel-tracy", "saint-georges",
    "dolbeau-mistassini", "matane", "lachute", "sainte-marie", "beauceville",
    "montmagny", "la malbaie", "portneuf", "donnacona", "pont-rouge",
    "saint-raymond", "saint-nicolas", "bernières", "breakeyville",
]

BLOCKED_EMAILS = [
    'example.com', 'email.com', 'domain.com', 'test.com',
    'sentry.io', 'vercel.app', 'google.com', 'facebook.com',
    'w3.org', 'schema.org', 'jquery.com', 'wordpress.org',
]


def _is_novus_phone(phone: str) -> bool:
    """Check if a phone number belongs to Novus Epoxy."""
    digits = re.sub(r'\D', '', phone)
    return digits in NOVUS_PHONES_DIGITS


def extract_phones(text: str, filter_novus: bool = True) -> list[str]:
    """Extract phone numbers, prioritizing Quebec area codes."""
    # First pass: Quebec-specific numbers
    qc_matches = QC_PHONE_STRICT.findall(text)
    # Second pass: all numbers
    all_matches = PHONE_PATTERN.findall(text)
    # Combine, QC first
    combined = list(dict.fromkeys(qc_matches + all_matches))

    cleaned = []
    for m in combined:
        digits = re.sub(r'\D', '', m)
        if len(digits) == 10 or (len(digits) == 11 and digits.startswith('1')):
            if filter_novus and _is_novus_phone(m):
                continue
            cleaned.append(m.strip())
    return list(dict.fromkeys(cleaned))


def extract_emails(text: str) -> list[str]:
    matches = EMAIL_PATTERN.findall(text)
    return list({e for e in matches if not any(b in e.lower() for b in BLOCKED_EMAILS)})


def extract_cities(text: str) -> list[str]:
    text_lower = text.lower()
    return list({city.title() for city in QC_CITIES if city in text_lower})


def extract_business_names(response) -> list[str]:
    """Extract business names from h1, h2, and title tags."""
    names = []
    # Title tag
    title_els = response.css("title")
    if title_els:
        raw = title_els[0].text.strip()
        # Clean common suffixes like " | Home", " - Accueil"
        cleaned = re.split(r'\s*[|–—-]\s*', raw)[0].strip()
        if cleaned and len(cleaned) > 2:
            names.append(cleaned)

    # H1 tags
    for el in response.css("h1"):
        t = el.text.strip()
        if t and len(t) > 2 and len(t) < 120:
            names.append(t)

    # H2 tags (less reliable, only take first 3)
    for el in response.css("h2")[:3]:
        t = el.text.strip()
        if t and len(t) > 2 and len(t) < 80:
            names.append(t)

    return list(dict.fromkeys(names))


def dedupe_leads(leads: list[dict]) -> list[dict]:
    seen = set()
    unique = []
    for lead in leads:
        key = hashlib.md5(
            f"{lead.get('telephone', '')}{lead.get('email', '')}".encode()
        ).hexdigest()
        if key not in seen and (lead.get('telephone') or lead.get('email')):
            seen.add(key)
            unique.append(lead)
    return unique


def scrape_page_raw(url: str):
    """Raw scrape without cache or rate limiting."""
    fetcher = Fetcher()
    return fetcher.get(url, timeout=SCRAPE_TIMEOUT)


async def scrape_page(url: str, use_cache: bool = True):
    """Scrape a page with caching, rate limiting, and retry logic."""
    # Check cache first
    if use_cache:
        cached = scrape_cache.get(url)
        if cached is not None:
            return cached

    # Rate limit
    await rate_limiter.wait(url)

    # Retry with exponential backoff
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = scrape_page_raw(url)
            if use_cache:
                # Cache the response object (we can't easily serialize scrapling response,
                # so we cache at higher level in route handlers)
                pass
            return response
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                wait_time = (2 ** attempt) * 0.5  # 0.5s, 1s, 2s
                await asyncio.sleep(wait_time)

    raise HTTPException(
        status_code=502,
        detail=f"Failed to scrape {url} after {MAX_RETRIES} retries: {str(last_error)}"
    )


# --- Routes ---

@app.get("/health")
async def health():
    return {"status": "ok", "service": "novus-scraper", "version": "2.0.0"}


@app.get("/stats")
async def get_stats(authorization: str = Header(None)):
    verify_api_key(authorization)
    return stats.snapshot()


@app.post("/scrape")
async def scrape_url(req: ScrapeRequest, authorization: str = Header(None)):
    verify_api_key(authorization)

    # Check cache
    cache_key = f"scrape:{req.url}:{req.selector}:{req.extract_leads}"
    cached = scrape_cache.get(cache_key)
    if cached is not None:
        stats.record("/scrape", True)
        return cached

    try:
        response = await scrape_page(req.url)
        title_els = response.css("title")
        result = {
            "url": req.url,
            "status": response.status,
            "title": title_els[0].text if title_els else None,
            "business_names": extract_business_names(response),
        }

        if req.selector:
            elements = response.css(req.selector)
            result["elements"] = [el.text for el in elements]

        if req.extract_leads:
            text = response.get_all_text()
            result["phones"] = extract_phones(text)
            result["emails"] = extract_emails(text)
            result["cities"] = extract_cities(text)

        scrape_cache.set(cache_key, result)
        stats.record("/scrape", True)
        return result
    except Exception as e:
        stats.record("/scrape", False)
        raise


@app.post("/scrape/batch")
async def scrape_batch(req: BatchScrapeRequest, authorization: str = Header(None)):
    """Scrape multiple URLs concurrently."""
    verify_api_key(authorization)

    async def _scrape_one(url: str) -> dict:
        try:
            cache_key = f"batch:{url}:{req.extract_leads}"
            cached = scrape_cache.get(cache_key)
            if cached is not None:
                return cached

            response = await scrape_page(url)
            title_els = response.css("title")
            result = {
                "url": url,
                "status": response.status,
                "title": title_els[0].text if title_els else None,
                "business_names": extract_business_names(response),
            }
            if req.extract_leads:
                text = response.get_all_text()
                result["phones"] = extract_phones(text)
                result["emails"] = extract_emails(text)
                result["cities"] = extract_cities(text)

            scrape_cache.set(cache_key, result)
            return result
        except Exception as e:
            return {"url": url, "error": str(e)}

    results = await asyncio.gather(*[_scrape_one(url) for url in req.urls])
    successful = sum(1 for r in results if "error" not in r)
    stats.record("/scrape/batch", successful > 0)
    return {
        "results": results,
        "total": len(results),
        "successful": successful,
        "failed": len(results) - successful,
    }


@app.post("/scrape/leads")
async def scrape_leads(req: ScrapeRequest, authorization: str = Header(None)):
    verify_api_key(authorization)

    try:
        response = await scrape_page(req.url)
        text = response.get_all_text()

        phones = extract_phones(text)
        emails = extract_emails(text)
        cities = extract_cities(text)
        business_names = extract_business_names(response)

        leads = []
        for i, phone in enumerate(phones):
            leads.append({
                "telephone": phone,
                "email": emails[i] if i < len(emails) else None,
                "ville": cities[0] if cities else None,
                "source": "scraper",
                "url_source": req.url,
            })
        for i, email in enumerate(emails):
            if i >= len(phones):
                leads.append({
                    "telephone": None,
                    "email": email,
                    "ville": cities[0] if cities else None,
                    "source": "scraper",
                    "url_source": req.url,
                })

        leads = dedupe_leads(leads)
        stats.record("/scrape/leads", True)
        return {
            "url": req.url,
            "leads_found": len(leads),
            "leads": leads,
            "cities_detected": cities,
            "business_names": business_names,
        }
    except Exception as e:
        stats.record("/scrape/leads", False)
        raise


@app.post("/scrape/competitors")
async def scrape_competitors(req: CompetitorRequest, authorization: str = Header(None)):
    verify_api_key(authorization)
    results = []

    for url in req.urls:
        try:
            response = await scrape_page(url)
            text = response.get_all_text()
            title_els = response.css("title")
            business_names = extract_business_names(response)

            services_keywords = [
                "époxy", "epoxy", "polyuréa", "polyurea", "plancher",
                "garage", "sous-sol", "commercial", "industriel",
                "béton", "beton", "résidentiel", "residentiel",
                "antidérapant", "antiderapant", "métallique", "metallique",
                "flocons", "flake", "quartz", "meulage", "polissage",
            ]
            found_services = list({s for s in services_keywords if s.lower() in text.lower()})

            prix_patterns = re.findall(
                r'(?:\$\s?\d+[.,]?\d*|\d+[.,]?\d*\s?(?:\$|dollars?|pi2|pi²|p\.c\.|pied|sq\.?\s?ft))',
                text, re.IGNORECASE
            )

            phones = extract_phones(text, filter_novus=True)
            emails = extract_emails(text)

            results.append({
                "url": url,
                "nom": business_names[0] if business_names else (title_els[0].text.strip() if title_els else url),
                "business_names": business_names,
                "services": found_services,
                "prix_visibles": prix_patterns[:10],
                "zone_service": extract_cities(text),
                "telephone": phones[0] if phones else None,
                "email": emails[0] if emails else None,
                "derniere_maj": datetime.now().isoformat(),
            })
        except Exception as e:
            results.append({
                "url": url,
                "nom": "Erreur",
                "business_names": [],
                "services": [],
                "prix_visibles": [],
                "zone_service": [],
                "error": str(e),
                "derniere_maj": datetime.now().isoformat(),
            })

    stats.record("/scrape/competitors", True)
    return {"competitors": results, "total": len(results)}


@app.post("/scrape/monitor")
async def scrape_monitor(req: MonitorRequest, authorization: str = Header(None)):
    """Monitor competitor URLs and return changes since last check."""
    verify_api_key(authorization)
    results = []

    for url in req.urls:
        try:
            response = await scrape_page(url, use_cache=False)
            text = response.get_all_text()
            title_els = response.css("title")
            business_names = extract_business_names(response)
            phones = extract_phones(text, filter_novus=True)
            emails = extract_emails(text)
            services_keywords = [
                "époxy", "epoxy", "polyuréa", "polyurea", "plancher",
                "garage", "sous-sol", "commercial", "industriel",
                "béton", "beton", "résidentiel", "residentiel",
            ]
            found_services = sorted({s for s in services_keywords if s.lower() in text.lower()})

            current = {
                "url": url,
                "title": title_els[0].text.strip() if title_els else None,
                "business_names": business_names,
                "phones": phones,
                "emails": emails,
                "services": found_services,
                "cities": extract_cities(text),
                "content_hash": hashlib.md5(text.encode()).hexdigest(),
                "checked_at": datetime.now().isoformat(),
            }

            changes = []
            with monitor_lock:
                previous = monitor_store.get(url)
                if previous:
                    # Detect changes
                    if current["content_hash"] != previous.get("content_hash"):
                        changes.append("content_changed")
                    if set(current["phones"]) != set(previous.get("phones", [])):
                        changes.append("phones_changed")
                    if set(current["emails"]) != set(previous.get("emails", [])):
                        changes.append("emails_changed")
                    if set(current["services"]) != set(previous.get("services", [])):
                        changes.append("services_changed")
                    if current["title"] != previous.get("title"):
                        changes.append("title_changed")

                    current["previous_check"] = previous.get("checked_at")
                    current["changes"] = changes
                    current["has_changes"] = len(changes) > 0
                else:
                    current["previous_check"] = None
                    current["changes"] = ["first_check"]
                    current["has_changes"] = True

                # Store current as the new baseline
                monitor_store[url] = current

            results.append(current)
        except Exception as e:
            results.append({
                "url": url,
                "error": str(e),
                "has_changes": False,
                "changes": [],
                "checked_at": datetime.now().isoformat(),
            })

    urls_with_changes = sum(1 for r in results if r.get("has_changes"))
    stats.record("/scrape/monitor", True)
    return {
        "results": results,
        "total": len(results),
        "urls_with_changes": urls_with_changes,
    }


@app.post("/scrape/directories")
async def scrape_directories(
    authorization: str = Header(None),
    region: str = "quebec",
):
    verify_api_key(authorization)

    directories = [
        f"https://www.pagesjaunes.ca/search/si/1/epoxy+plancher/{region}+QC",
        f"https://www.houzz.com/professionals/flooring-contractors/{region}-qc",
    ]

    all_leads = []
    for url in directories:
        try:
            response = await scrape_page(url)
            text = response.get_all_text()
            phones = extract_phones(text)
            emails = extract_emails(text)
            cities = extract_cities(text)

            for i, phone in enumerate(phones):
                all_leads.append({
                    "telephone": phone,
                    "email": emails[i] if i < len(emails) else None,
                    "ville": cities[0] if cities else region.title(),
                    "source": "directory-scraper",
                    "url_source": url,
                })
        except Exception:
            continue

    all_leads = dedupe_leads(all_leads)
    stats.record("/scrape/directories", True)
    return {
        "region": region,
        "directories_scraped": len(directories),
        "leads_found": len(all_leads),
        "leads": all_leads,
    }


@app.post("/scrape/bulk-import")
async def scrape_and_import(req: ScrapeRequest, authorization: str = Header(None)):
    verify_api_key(authorization)
    response = await scrape_page(req.url)
    text = response.get_all_text()

    phones = extract_phones(text)
    emails = extract_emails(text)
    cities = extract_cities(text)

    leads = dedupe_leads([
        {
            "telephone": phones[i] if i < len(phones) else None,
            "email": emails[i] if i < len(emails) else None,
            "ville": cities[0] if cities else None,
            "source": "scraper",
            "url_source": req.url,
            "temperature": "froid",
        }
        for i in range(max(len(phones), len(emails)))
    ])

    imported = 0
    errors = []
    for lead in leads:
        try:
            data = json.dumps(lead).encode()
            r = urllib.request.Request(
                f"{DASHBOARD_URL}/api/crm/leads",
                data=data,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {API_KEY}",
                },
                method="POST",
            )
            urllib.request.urlopen(r, timeout=10)
            imported += 1
        except Exception as e:
            errors.append(str(e))

    stats.record("/scrape/bulk-import", imported > 0)
    return {
        "url": req.url,
        "leads_found": len(leads),
        "imported": imported,
        "errors": errors[:5],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8899)
