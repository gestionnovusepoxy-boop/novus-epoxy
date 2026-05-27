<?php

// LEGACY — not deployed. Kept as reference only. See CLAUDE.md.

declare(strict_types=1);

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/db.php';

load_env();
cors_headers();
require_auth();

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $page   = max(1, (int)($_GET['page']   ?? 1));
    $limit  = min(100, max(1, (int)($_GET['limit'] ?? 25)));
    $offset = ($page - 1) * $limit;
    $statut = $_GET['statut'] ?? null;
    $search = $_GET['search'] ?? null;

    $where  = [];
    $params = [];

    if ($statut && in_array($statut, ['nouveau','lu','en_traitement','ferme'], true)) {
        $where[]          = 'statut = :statut';
        $params[':statut'] = $statut;
    }

    if ($search) {
        $where[]          = '(nom LIKE :search OR email LIKE :search)';
        $params[':search'] = '%' . $search . '%';
    }

    $whereClause = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $pdo = db();

    $totalStmt = $pdo->prepare("SELECT COUNT(*) FROM submissions {$whereClause}");
    $totalStmt->execute($params);
    $total = (int)$totalStmt->fetchColumn();

    $stmt = $pdo->prepare(
        "SELECT id, nom, email, telephone, service, statut, created_at, updated_at
         FROM submissions {$whereClause}
         ORDER BY created_at DESC
         LIMIT :limit OFFSET :offset"
    );
    foreach ($params as $key => $val) {
        $stmt->bindValue($key, $val);
    }
    $stmt->bindValue(':limit',  $limit,  PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();

    json_response([
        'data'  => $stmt->fetchAll(),
        'total' => $total,
        'page'  => $page,
        'limit' => $limit,
    ]);
}

if ($method === 'PATCH') {
    $id   = (int)($_GET['id'] ?? 0);
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    if (!$id) {
        json_response(['error' => 'ID manquant'], 400);
    }

    $statut = $body['statut'] ?? null;
    if (!in_array($statut, ['nouveau','lu','en_traitement','ferme'], true)) {
        json_response(['error' => 'Statut invalide'], 400);
    }

    $pdo  = db();
    $stmt = $pdo->prepare('UPDATE submissions SET statut = :statut WHERE id = :id');
    $stmt->execute([':statut' => $statut, ':id' => $id]);

    json_response(['ok' => true]);
}

json_response(['error' => 'Méthode non autorisée'], 405);
