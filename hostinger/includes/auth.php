<?php

declare(strict_types=1);

function load_env(): void
{
    $envFile = dirname(__DIR__, 2) . '/.env';
    if (!file_exists($envFile)) {
        return;
    }

    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        if (str_starts_with(trim($line), '#')) {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        $key   = trim($key);
        $value = trim($value, " \t\n\r\0\x0B\"'");
        if (!isset($_ENV[$key])) {
            $_ENV[$key] = $value;
            putenv("{$key}={$value}");
        }
    }
}

function cors_headers(): void
{
    $allowed = $_ENV['DASHBOARD_URL'] ?? getenv('DASHBOARD_URL') ?: 'https://dashboard.novusepoxy.ca';

    header("Access-Control-Allow-Origin: {$allowed}");
    header('Access-Control-Allow-Methods: GET, POST, PATCH, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Content-Type: application/json; charset=utf-8');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function require_auth(): void
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';

    if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
        http_response_code(401);
        echo json_encode(['error' => 'Token manquant']);
        exit;
    }

    $provided = $matches[1];
    $expected = $_ENV['API_SECRET_TOKEN'] ?? getenv('API_SECRET_TOKEN') ?: '';

    if (!hash_equals($expected, $provided)) {
        http_response_code(401);
        echo json_encode(['error' => 'Token invalide']);
        exit;
    }
}

function json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
