"""
Novus Epoxy — Scraping Service
FastAPI + Scrapling v0.4.5 for automated lead extraction and competitor monitoring.
"""

import hashlib
import json
import os
import re
import urllib.request
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from scrapling import Fetcher

app = FastAPI(title="Novus Epoxy Scraper", version="1.0.0")

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


# --- Auth ---

def verify_api_key(authorization: str = Header(None)):
    if not authorization or authorization.replace("Bearer ", "") != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


# --- Models ---

class ScrapeRequest(BaseModel):
    url: str
    selector: Optional[str] = None
    extract_leads: bool = False

class CompetitorRequest(BaseModel):
    urls: list[str]


# --- Helpers ---

PHONE_PATTERN = re.compile(
    r'(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}'
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

def extract_phones(text: str) -> list[str]:
    matches = PHONE_PATTERN.findall(text)
    cleaned = []
    for m in matches:
        digits = re.sub(r'\D', '', m)
        if len(digits) == 10 or (len(digits) == 11 and digits.startswith('1')):
            cleaned.append(m.strip())
    return list(set(cleaned))

def extract_emails(text: str) -> list[str]:
    matches = EMAIL_PATTERN.findall(text)
    return list({e for e in matches if not any(b in e.lower() for b in BLOCKED_EMAILS)})

def extract_cities(text: str) -> list[str]:
    text_lower = text.lower()
    return list({city.title() for city in QC_CITIES if city in text_lower})

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

def scrape_page(url: str):
    fetcher = Fetcher()
    return fetcher.get(url)


# --- Routes ---

@app.get("/health")
async def health():
    return {"status": "ok", "service": "novus-scraper", "version": "1.0.0"}


@app.post("/scrape")
async def scrape_url(req: ScrapeRequest, authorization: str = Header(None)):
    verify_api_key(authorization)
    response = scrape_page(req.url)

    title_els = response.css("title")
    result = {
        "url": req.url,
        "status": response.status,
        "title": title_els[0].text if title_els else None,
    }

    if req.selector:
        elements = response.css(req.selector)
        result["elements"] = [el.text for el in elements]

    if req.extract_leads:
        text = response.get_all_text()
        result["phones"] = extract_phones(text)
        result["emails"] = extract_emails(text)
        result["cities"] = extract_cities(text)

    return result


@app.post("/scrape/leads")
async def scrape_leads(req: ScrapeRequest, authorization: str = Header(None)):
    verify_api_key(authorization)
    response = scrape_page(req.url)
    text = response.get_all_text()

    phones = extract_phones(text)
    emails = extract_emails(text)
    cities = extract_cities(text)

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
    return {
        "url": req.url,
        "leads_found": len(leads),
        "leads": leads,
        "cities_detected": cities,
    }


@app.post("/scrape/competitors")
async def scrape_competitors(req: CompetitorRequest, authorization: str = Header(None)):
    verify_api_key(authorization)
    results = []

    for url in req.urls:
        try:
            response = scrape_page(url)
            text = response.get_all_text()
            title_els = response.css("title")

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

            results.append({
                "url": url,
                "nom": title_els[0].text.strip() if title_els else url,
                "services": found_services,
                "prix_visibles": prix_patterns[:10],
                "zone_service": extract_cities(text),
                "telephone": extract_phones(text)[0] if extract_phones(text) else None,
                "email": extract_emails(text)[0] if extract_emails(text) else None,
                "derniere_maj": datetime.now().isoformat(),
            })
        except Exception as e:
            results.append({
                "url": url,
                "nom": "Erreur",
                "services": [],
                "prix_visibles": [],
                "zone_service": [],
                "error": str(e),
                "derniere_maj": datetime.now().isoformat(),
            })

    return {"competitors": results, "total": len(results)}


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
            response = scrape_page(url)
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
    return {
        "region": region,
        "directories_scraped": len(directories),
        "leads_found": len(all_leads),
        "leads": all_leads,
    }


@app.post("/scrape/bulk-import")
async def scrape_and_import(req: ScrapeRequest, authorization: str = Header(None)):
    verify_api_key(authorization)
    response = scrape_page(req.url)
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

    return {
        "url": req.url,
        "leads_found": len(leads),
        "imported": imported,
        "errors": errors[:5],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8899)
