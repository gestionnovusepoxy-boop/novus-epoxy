<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/db.php';

load_env();

// Track est public — pas d'auth Bearer, CORS ouvert
header('Access-Control-Allow-Origin: https://novusepoxy.ca');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

$body = file_get_contents('php://input');
$data = json_decode($body, true);

if (!$data || !isset($data['type'])) {
    http_response_code(400);
    exit;
}

// Construire les hashes privacy-friendly (pas de stockage d'IP)
$ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
$ip = explode(',', $ip)[0];
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';

$visitorHash = hash('sha256', $ip . $ua . date('Y-m-d'));
$sessionHash = hash('sha256', $ip . $ua . date('Y-m-d H') . floor((int)date('i') / 30));

$path    = isset($data['path']) ? mb_substr((string)$data['path'], 0, 500) : '/';
$type    = (string)$data['type'];

try {
    $pdo = db();

    if ($type === 'pageview') {
        $referrer  = isset($data['referrer'])  ? mb_substr((string)$data['referrer'], 0, 500)  : null;
        $userAgent = mb_substr($ua, 0, 500);
        $duree     = isset($data['duration'])  ? (int)$data['duration'] : null;

        $stmt = $pdo->prepare(
            'INSERT INTO page_views (url_path, referrer, user_agent, visitor_hash, session_hash, duree_sec)
             VALUES (:path, :referrer, :ua, :visitor, :session, :duree)'
        );
        $stmt->execute([
            ':path'    => $path,
            ':referrer'=> $referrer,
            ':ua'      => $userAgent,
            ':visitor' => $visitorHash,
            ':session' => $sessionHash,
            ':duree'   => $duree,
        ]);
    } elseif ($type === 'event') {
        $name   = isset($data['name'])  ? mb_substr((string)$data['name'], 0, 80)   : 'unknown';
        $valeur = isset($data['value']) ? mb_substr((string)$data['value'], 0, 255) : null;

        $stmt = $pdo->prepare(
            'INSERT INTO events (type, url_path, valeur, visitor_hash)
             VALUES (:type, :path, :valeur, :visitor)'
        );
        $stmt->execute([
            ':type'    => $name,
            ':path'    => $path,
            ':valeur'  => $valeur,
            ':visitor' => $visitorHash,
        ]);
    }
} catch (PDOException $e) {
    // Ne pas exposer les erreurs DB en production
    http_response_code(500);
    exit;
}

http_response_code(204);
exit;
