<?php
/**
 * Dependency-isolated controller smoke tests, with SQLite and minimal HTTP/auth doubles.
 * Run: php -d extension=pdo_sqlite -d extension=mbstring tests/isolated/monitoring-camera-smoke.php
 * This does not replace a migrated MySQL + authenticated CMS integration test.
 */
namespace Slim\Http {
    class ServerRequest
    {
        public function __construct(private array $params = [], private bool $xhr = true) {}
        public function getParams(): array { return $this->params; }
        public function getQueryParams(): array { return $this->params; }
        public function getHeaderLine(string $name): string { return $this->xhr ? 'XMLHttpRequest' : ''; }
    }
    class Response
    {
        public array $headers = [];
        public mixed $data = null;
        public function withHeader(string $name, string $value): self { $this->headers[$name] = $value; return $this; }
        public function withJson(mixed $data): self { $this->data = $data; return $this; }
    }
}
namespace Xibo\Support\Exception {
    class AccessDeniedException extends \Exception {}
    class NotFoundException extends \Exception {}
    class InvalidArgumentException extends \Exception
    {
        public function __construct(string $message, string $field) { parent::__construct($message); }
    }
}
namespace Xibo\Factory {
    class DisplayFactory
    {
        public function getById(int $id): object { return (object)['displayId' => $id]; }
        public function query(mixed $sort, array $filter): array
        {
            return [(object)['displayId' => 1, 'display' => 'Allowed display']];
        }
    }
}
namespace Xibo\Storage {
    interface StorageServiceInterface {}
    class TestStorage implements StorageServiceInterface
    {
        public \PDO $db;
        public function __construct()
        {
            $this->db = new \PDO('sqlite::memory:');
            $this->db->setAttribute(\PDO::ATTR_ERRMODE, \PDO::ERRMODE_EXCEPTION);
            $this->db->exec('CREATE TABLE monitoringcamera (cameraId INTEGER PRIMARY KEY, displayId INTEGER,
                name TEXT, latitude REAL, longitude REAL, playbackUrl TEXT)');
        }
        public function select(string $sql, array $params): array
        {
            $statement = $this->db->prepare($sql);
            $statement->execute($params);
            return $statement->fetchAll(\PDO::FETCH_ASSOC);
        }
        public function insert(string $sql, array $params): int
        {
            $this->update($sql, $params);
            return (int)$this->db->lastInsertId();
        }
        public function update(string $sql, array $params): void
        {
            $statement = $this->db->prepare($sql);
            $statement->execute($params);
        }
    }
}
namespace Xibo\Controller {
    class Base
    {
        public object $user;
        public function getUser(): object { return $this->user; }
        public function getSanitizer(array $params): object
        {
            return new class($params) {
                public function __construct(private array $params) {}
                public function getInt(string $key): ?int { return isset($this->params[$key]) ? (int)$this->params[$key] : null; }
            };
        }
    }
}
namespace {
    function __(string $message): string { return $message; }
    require __DIR__ . '/../../lib/Controller/MonitoringCamera.php';
    $checks = 0;
    function check(bool $condition, string $label): void
    {
        global $checks;
        if (!$condition) throw new \RuntimeException($label);
        $checks++;
    }
    function denied(callable $operation, string $exception): void
    {
        try { $operation(); } catch (\Throwable $error) {
            check($error instanceof $exception, 'Unexpected exception: ' . $error::class);
            return;
        }
        throw new \RuntimeException('Expected ' . $exception);
    }
    $store = new \Xibo\Storage\TestStorage();
    $controller = new \Xibo\Controller\MonitoringCamera($store, new \Xibo\Factory\DisplayFactory());
    $controller->user = new class {
        public bool $editable = true;
        public function checkViewable(object $display): bool { return $display->displayId === 1; }
        public function checkEditable(object $display): bool { return $this->editable && $display->displayId === 1; }
    };
    $draft = ['displayId' => '1', 'name' => 'Gate', 'latitude' => '0', 'longitude' => '110.1234567',
        'playbackUrl' => 'https://stream.example.test/live/index.m3u8'];
    $response = $controller->save(new \Slim\Http\ServerRequest($draft), new \Slim\Http\Response());
    $id = $response->data['cameraId'];
    check($id === 1, 'Create camera');
    $store->db->exec("INSERT INTO monitoringcamera VALUES(2,2,'Hidden',1,2,'https://hidden.example.test/live')");
    $map = $controller->map(new \Slim\Http\ServerRequest(), new \Slim\Http\Response());
    check(count($map->data['features']) === 1, 'Map excludes inaccessible display');
    check($map->data['features'][0]['geometry']['coordinates'] === [110.1234567, 0.0], 'GeoJSON order and zero coordinate');
    check(!str_contains(json_encode($map->data), 'stream.example'), 'Map never includes playback URLs');
    check($map->headers['Cache-Control'] === 'no-store', 'Map not cached');
    $read = $controller->playback(new \Slim\Http\ServerRequest(), new \Slim\Http\Response(), $id);
    check($read->data['url'] === $draft['playbackUrl'], 'Authorized playback');
    $edit = $draft;
    $edit['name'] = 'Gate updated';
    $edit['playbackUrl'] = '';
    $controller->save(new \Slim\Http\ServerRequest($edit), new \Slim\Http\Response(), $id);
    $read = $controller->playback(new \Slim\Http\ServerRequest(), new \Slim\Http\Response(), $id);
    check($read->data['url'] === $draft['playbackUrl'], 'Blank edit preserves playback URL');
    foreach (['rtsp://camera/live', 'http://camera/live', 'https://user:pass@camera/live', 'javascript:alert(1)'] as $url) {
        denied(fn() => $controller->save(new \Slim\Http\ServerRequest(array_replace($draft, ['playbackUrl' => $url])), new \Slim\Http\Response()), \Xibo\Support\Exception\InvalidArgumentException::class);
    }
    foreach (['', '91', 'NaN'] as $latitude) {
        denied(fn() => $controller->save(new \Slim\Http\ServerRequest(array_replace($draft, ['latitude' => $latitude])), new \Slim\Http\Response()), \Xibo\Support\Exception\InvalidArgumentException::class);
    }
    denied(fn() => $controller->playback(new \Slim\Http\ServerRequest(), new \Slim\Http\Response(), 2), \Xibo\Support\Exception\AccessDeniedException::class);
    denied(fn() => $controller->save(new \Slim\Http\ServerRequest(array_replace($draft, ['displayId' => 2])), new \Slim\Http\Response(), $id), \Xibo\Support\Exception\AccessDeniedException::class);
    denied(fn() => $controller->save(new \Slim\Http\ServerRequest($draft, false), new \Slim\Http\Response()), \Xibo\Support\Exception\AccessDeniedException::class);
    $controller->user->editable = false;
    denied(fn() => $controller->save(new \Slim\Http\ServerRequest($draft), new \Slim\Http\Response(), $id), \Xibo\Support\Exception\AccessDeniedException::class);
    denied(fn() => $controller->delete(new \Slim\Http\ServerRequest(), new \Slim\Http\Response(), $id), \Xibo\Support\Exception\AccessDeniedException::class);
    $controller->user->editable = true;
    $controller->delete(new \Slim\Http\ServerRequest(), new \Slim\Http\Response(), $id);
    denied(fn() => $controller->playback(new \Slim\Http\ServerRequest(), new \Slim\Http\Response(), $id), \Xibo\Support\Exception\NotFoundException::class);
    echo "Passed $checks isolated controller checks.\n";
}
