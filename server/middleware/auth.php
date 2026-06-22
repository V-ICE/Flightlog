<?php
// UAVLogBook — JWT Authentication Middleware
require_once __DIR__ . '/../config/config.php';

class Auth {

    public static function generateToken(array $payload): string {
        $header  = self::base64url(json_encode(['alg'=>'HS256','typ'=>'JWT']));
        $payload['iat'] = time();
        $payload['exp'] = time() + (JWT_EXPIRY_HOURS * 3600);
        $payloadEnc = self::base64url(json_encode($payload));
        $sig = hash_hmac('sha256', "$header.$payloadEnc", JWT_SECRET, true);
        return "$header.$payloadEnc." . self::base64url($sig);
    }

    public static function verifyToken(string $token): ?array {
        $parts = explode('.', $token);
        if (count($parts) !== 3) return null;
        [$header, $payload, $sig] = $parts;
        $expectedSig = self::base64url(
            hash_hmac('sha256', "$header.$payload", JWT_SECRET, true)
        );
        if (!hash_equals($expectedSig, $sig)) return null;
        $data = json_decode(self::base64urlDecode($payload), true);
        if (!$data || ($data['exp'] ?? 0) < time()) return null;
        return $data;
    }

    public static function requireAuth(): array {
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? $_SERVER['HTTP_X_AUTH_TOKEN'] ?? getallheaders()['Authorization'] ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
            $token = $m[1];
        } else {
            $token = '';
        }
        $user = self::verifyToken($token);
        if (!$user) {
            http_response_code(401);
            die(json_encode(['error' => 'Unauthorized']));
        }
        return $user;
    }

    private static function base64url(string $data): string {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64urlDecode(string $data): string {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', 3 - (3 + strlen($data)) % 4));
    }

    public static function hashPassword(string $password): string {
        return password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    public static function verifyPassword(string $password, string $hash): bool {
        return password_verify($password, $hash);
    }

    public static function generateUUID(): string {
        return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
            mt_rand(0, 0xffff), mt_rand(0, 0xffff),
            mt_rand(0, 0xffff),
            mt_rand(0, 0x0fff) | 0x4000,
            mt_rand(0, 0x3fff) | 0x8000,
            mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
        );
    }
}
