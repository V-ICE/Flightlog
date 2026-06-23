<?php
// Flightlog — Database Connection (PDO)
require_once __DIR__ . '/config.php';

class DB {
    private static ?PDO $instance = null;

    public static function get(): PDO {
        if (self::$instance === null) {
            $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s',
                DB_HOST, DB_NAME, DB_CHARSET);
            $opts = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
            ];
            self::$instance = new PDO($dsn, DB_USER, DB_PASS, $opts);
        }
        return self::$instance;
    }

    public static function query(string $sql, array $params = []): PDOStatement {
        $stmt = self::get()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public static function insert(string $table, array $data): int {
        $cols = implode(', ', array_map(fn($k) => "`$k`", array_keys($data)));
        $placeholders = implode(', ', array_fill(0, count($data), '?'));
        $stmt = self::get()->prepare("INSERT INTO `$table` ($cols) VALUES ($placeholders)");
        $stmt->execute(array_values($data));
        return (int) self::get()->lastInsertId();
    }

    public static function batchInsert(string $table, array $rows, int $chunkSize = 500): void {
        if (empty($rows)) return;
        $cols = array_keys($rows[0]);
        $colStr = implode(', ', array_map(fn($k) => "`$k`", $cols));
        foreach (array_chunk($rows, $chunkSize) as $chunk) {
            $rowPlaceholders = array_map(
                fn($r) => '(' . implode(', ', array_fill(0, count($cols), '?')) . ')',
                $chunk
            );
            $sql = "INSERT INTO `$table` ($colStr) VALUES " . implode(', ', $rowPlaceholders);
            $values = array_merge(...array_map(fn($r) => array_values($r), $chunk));
            self::get()->prepare($sql)->execute($values);
        }
    }
}
