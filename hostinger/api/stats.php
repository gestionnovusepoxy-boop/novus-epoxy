<?php

// LEGACY — not deployed. Kept as reference only. See CLAUDE.md.

declare(strict_types=1);

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/db.php';

load_env();
cors_headers();
require_auth();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    json_response(['error' => 'Méthode non autorisée'], 405);
}

$periode = $_GET['periode'] ?? '30d';
$jours   = match ($periode) {
    '7d'  => 7,
    '90d' => 90,
    default => 30,
};

$pdo     = db();
$depuis  = date('Y-m-d H:i:s', strtotime("-{$jours} days"));
$precedent = date('Y-m-d H:i:s', strtotime("-" . ($jours * 2) . " days"));

// --- Visites et visiteurs uniques ---
$stmt = $pdo->prepare(
    'SELECT COUNT(*) as visites, COUNT(DISTINCT visitor_hash) as visiteurs_uniques
     FROM page_views WHERE created_at >= :depuis'
);
$stmt->execute([':depuis' => $depuis]);
$visitesRow = $stmt->fetch();

// Période précédente pour calcul de variation
$stmtPrev = $pdo->prepare(
    'SELECT COUNT(*) as visites, COUNT(DISTINCT visitor_hash) as visiteurs_uniques
     FROM page_views WHERE created_at >= :precedent AND created_at < :depuis'
);
$stmtPrev->execute([':precedent' => $precedent, ':depuis' => $depuis]);
$visitesPrev = $stmtPrev->fetch();

// --- Soumissions (leads) ---
$stmt = $pdo->prepare('SELECT COUNT(*) FROM submissions WHERE created_at >= :depuis');
$stmt->execute([':depuis' => $depuis]);
$leads = (int)$stmt->fetchColumn();

$stmt = $pdo->prepare('SELECT COUNT(*) FROM submissions WHERE created_at >= :precedent AND created_at < :depuis');
$stmt->execute([':precedent' => $precedent, ':depuis' => $depuis]);
$leadsPrev = (int)$stmt->fetchColumn();

// --- Taux de conversion ---
$visiteurs = (int)$visitesRow['visiteurs_uniques'];
$taux      = $visiteurs > 0 ? round($leads / $visiteurs * 100, 2) : 0;

$visiteursPrev  = (int)$visitesPrev['visiteurs_uniques'];
$tauxPrev       = $visiteursPrev > 0 ? round($leadsPrev / $visiteursPrev * 100, 2) : 0;

// --- Emails ouverts ---
$stmt = $pdo->prepare(
    "SELECT COUNT(*) FROM email_logs WHERE statut IN ('opened','clicked') AND created_at >= :depuis"
);
$stmt->execute([':depuis' => $depuis]);
$emailsOuverts = (int)$stmt->fetchColumn();

// --- Pages les plus visitées ---
$stmt = $pdo->prepare(
    'SELECT url_path, COUNT(*) as vues
     FROM page_views WHERE created_at >= :depuis
     GROUP BY url_path ORDER BY vues DESC LIMIT 10'
);
$stmt->execute([':depuis' => $depuis]);
$topPages = $stmt->fetchAll();

// --- Série temporelle (visites par jour) ---
$stmt = $pdo->prepare(
    'SELECT DATE(created_at) as date, COUNT(*) as visites, COUNT(DISTINCT visitor_hash) as visiteurs
     FROM page_views WHERE created_at >= :depuis
     GROUP BY DATE(created_at) ORDER BY date ASC'
);
$stmt->execute([':depuis' => $depuis]);
$serie = $stmt->fetchAll();

// --- Soumissions par semaine ---
$stmt = $pdo->prepare(
    'SELECT YEARWEEK(created_at, 1) as semaine, COUNT(*) as leads
     FROM submissions WHERE created_at >= :depuis
     GROUP BY YEARWEEK(created_at, 1) ORDER BY semaine ASC'
);
$stmt->execute([':depuis' => $depuis]);
$serieLeads = $stmt->fetchAll();

function variation(int|float $actuel, int|float $precedent): float
{
    if ($precedent === 0) {
        return $actuel > 0 ? 100.0 : 0.0;
    }
    return round(($actuel - $precedent) / $precedent * 100, 1);
}

json_response([
    'periode'    => $periode,
    'metriques'  => [
        'visites'           => (int)$visitesRow['visites'],
        'visites_variation' => variation((int)$visitesRow['visites'], (int)$visitesPrev['visites']),
        'visiteurs_uniques' => $visiteurs,
        'visiteurs_variation' => variation($visiteurs, $visiteursPrev),
        'leads'             => $leads,
        'leads_variation'   => variation($leads, $leadsPrev),
        'taux_conversion'   => $taux,
        'taux_variation'    => $tauxPrev > 0 ? round($taux - $tauxPrev, 2) : 0,
        'emails_ouverts'    => $emailsOuverts,
    ],
    'top_pages'  => $topPages,
    'serie_visites' => $serie,
    'serie_leads'   => $serieLeads,
]);
