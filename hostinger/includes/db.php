<?php

declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;

    if ($pdo !== null) {
        return $pdo;
    }

    $host = $_ENV['DB_HOST'] ?? getenv('DB_HOST') ?: 'localhost';
    $name = $_ENV['DB_NAME'] ?? getenv('DB_NAME') ?: '';
    $user = $_ENV['DB_USER'] ?? getenv('DB_USER') ?: '';
    $pass = $_ENV['DB_PASS'] ?? getenv('DB_PASS') ?: '';

    $pdo = new PDO(
        "mysql:host={$host};dbname={$name};charset=utf8mb4",
        $user,
        $pass,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );

    return $pdo;
}
