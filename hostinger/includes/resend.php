<?php

declare(strict_types=1);

class ResendMailer
{
    private string $apiKey;
    private string $fromEmail;
    private PDO $pdo;

    public function __construct(PDO $pdo)
    {
        $this->apiKey    = $_ENV['RESEND_API_KEY']    ?? getenv('RESEND_API_KEY')    ?: '';
        $this->fromEmail = $_ENV['RESEND_FROM_EMAIL'] ?? getenv('RESEND_FROM_EMAIL') ?: 'contact@novusepoxy.ca';
        $this->pdo       = $pdo;
    }

    public function send(
        string $to,
        string $subject,
        string $htmlBody,
        ?int $submissionId = null
    ): array {
        $payload = json_encode([
            'from'    => "Novus Epoxy <{$this->fromEmail}>",
            'to'      => [$to],
            'subject' => $subject,
            'html'    => $htmlBody,
        ]);

        $ch = curl_init('https://api.resend.com/emails');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                "Authorization: Bearer {$this->apiKey}",
                'Content-Type: application/json',
            ],
            CURLOPT_TIMEOUT        => 10,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $result = json_decode($response, true) ?? [];

        if ($httpCode === 200 && isset($result['id'])) {
            $this->logEmail($result['id'], $to, $subject, $submissionId);
            return ['id' => $result['id'], 'error' => null];
        }

        return ['id' => null, 'error' => $result['message'] ?? 'Erreur inconnue'];
    }

    private function logEmail(
        string $resendId,
        string $to,
        string $subject,
        ?int $submissionId
    ): void {
        $stmt = $this->pdo->prepare(
            'INSERT IGNORE INTO email_logs (resend_id, destinataire, sujet, submission_id)
             VALUES (:resend_id, :to, :subject, :sub_id)'
        );
        $stmt->execute([
            ':resend_id' => $resendId,
            ':to'        => $to,
            ':subject'   => mb_substr($subject, 0, 500),
            ':sub_id'    => $submissionId,
        ]);
    }
}
