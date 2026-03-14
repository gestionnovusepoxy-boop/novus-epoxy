<?php

declare(strict_types=1);

require_once __DIR__ . '/../includes/auth.php';
require_once __DIR__ . '/../includes/db.php';

load_env();

$method = $_SERVER['REQUEST_METHOD'];

// POST = webhook Resend (pas de Bearer, vérification signature Svix)
// GET  = liste des emails (Bearer requis)
if ($method === 'GET') {
    cors_headers();
    require_auth();

    $page   = max(1, (int)($_GET['page']   ?? 1));
    $limit  = min(100, max(1, (int)($_GET['limit'] ?? 25)));
    $offset = ($page - 1) * $limit;

    $pdo = db();

    $total = (int)$pdo->query('SELECT COUNT(*) FROM email_logs')->fetchColumn();

    $stmt = $pdo->prepare(
        'SELECT id, resend_id, destinataire, sujet, statut, opened_at, clicked_at, created_at
         FROM email_logs ORDER BY created_at DESC LIMIT :limit OFFSET :offset'
    );
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

if ($method === 'POST') {
    // Webhook Resend — vérification signature Svix
    $webhookSecret = $_ENV['RESEND_WEBHOOK_SECRET'] ?? getenv('RESEND_WEBHOOK_SECRET') ?: '';
    $body          = file_get_contents('php://input');

    $svixId        = $_SERVER['HTTP_SVIX_ID']        ?? '';
    $svixTimestamp = $_SERVER['HTTP_SVIX_TIMESTAMP']  ?? '';
    $svixSignature = $_SERVER['HTTP_SVIX_SIGNATURE']  ?? '';

    if ($webhookSecret && $svixId && $svixTimestamp && $svixSignature) {
        $signedContent = "{$svixId}.{$svixTimestamp}.{$body}";
        $secret        = base64_decode(str_replace('whsec_', '', $webhookSecret));
        $expectedSig   = 'v1,' . base64_encode(hash_hmac('sha256', $signedContent, $secret, true));

        // Svix peut envoyer plusieurs signatures séparées par des espaces
        $signatures = explode(' ', $svixSignature);
        $valid       = false;
        foreach ($signatures as $sig) {
            if (hash_equals($expectedSig, $sig)) {
                $valid = true;
                break;
            }
        }

        if (!$valid) {
            http_response_code(401);
            echo json_encode(['error' => 'Signature invalide']);
            exit;
        }
    }

    $event = json_decode($body, true);
    if (!$event || !isset($event['type'], $event['data'])) {
        http_response_code(400);
        exit;
    }

    $pdo      = db();
    $type     = $event['type'];
    $data     = $event['data'];
    $resendId = $data['email_id'] ?? null;

    if (!$resendId) {
        http_response_code(204);
        exit;
    }

    $statutMap = [
        'email.sent'        => 'sent',
        'email.delivered'   => 'delivered',
        'email.opened'      => 'opened',
        'email.clicked'     => 'clicked',
        'email.bounced'     => 'bounced',
        'email.complained'  => 'complained',
    ];

    $statut = $statutMap[$type] ?? null;
    if (!$statut) {
        http_response_code(204);
        exit;
    }

    $now = date('Y-m-d H:i:s');

    if ($statut === 'sent') {
        // Créer ou ignorer si déjà existant
        $stmt = $pdo->prepare(
            'INSERT IGNORE INTO email_logs (resend_id, destinataire, sujet, statut)
             VALUES (:id, :to, :subject, :statut)'
        );
        $stmt->execute([
            ':id'     => $resendId,
            ':to'     => $data['to'][0] ?? '',
            ':subject'=> mb_substr($data['subject'] ?? '', 0, 500),
            ':statut' => $statut,
        ]);
    } else {
        $extra = '';
        $params = [':id' => $resendId, ':statut' => $statut];

        if ($statut === 'opened' || $statut === 'clicked') {
            $col    = $statut === 'opened' ? 'opened_at' : 'clicked_at';
            $extra  = ", {$col} = COALESCE({$col}, :ts)";
            $params[':ts'] = $now;
        }

        $stmt = $pdo->prepare(
            "UPDATE email_logs SET statut = :statut{$extra} WHERE resend_id = :id"
        );
        $stmt->execute($params);
    }

    http_response_code(204);
    exit;
}

if ($method === 'OPTIONS') {
    cors_headers();
    exit;
}

http_response_code(405);
exit;
