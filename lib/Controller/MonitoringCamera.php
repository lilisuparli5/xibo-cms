<?php

namespace Xibo\Controller;

use Slim\Http\Response;
use Slim\Http\ServerRequest as Request;
use Xibo\Factory\DisplayFactory;
use Xibo\Storage\StorageServiceInterface;
use Xibo\Support\Exception\AccessDeniedException;
use Xibo\Support\Exception\InvalidArgumentException;
use Xibo\Support\Exception\NotFoundException;

/** Cameras inherit the view/edit permissions of their associated display. */
class MonitoringCamera extends Base
{
    public function __construct(
        private readonly StorageServiceInterface $store,
        private readonly DisplayFactory $displayFactory
    ) {
    }

    private function checkDisplay(int $id, bool $edit = false): void
    {
        $display = $this->displayFactory->getById($id);
        if (!$this->getUser()->checkViewable($display)
            || ($edit && !$this->getUser()->checkEditable($display))
        ) {
            throw new AccessDeniedException();
        }
    }

    private function checkWriteRequest(Request $request): void
    {
        // JSON-session endpoints: cross-origin HTML forms cannot supply this header.
        if ($request->getHeaderLine('X-Requested-With') !== 'XMLHttpRequest') {
            throw new AccessDeniedException();
        }
    }

    private function camera(int $id, bool $edit = false): array
    {
        $rows = $this->store->select('SELECT * FROM monitoringcamera WHERE cameraId = :id', ['id' => $id]);
        if (empty($rows)) {
            throw new NotFoundException(__('Camera not found'));
        }
        $this->checkDisplay((int)$rows[0]['displayId'], $edit);
        return $rows[0];
    }

    public function map(Request $request, Response $response): Response
    {
        $params = $this->getSanitizer($request->getQueryParams());
        // The factory applies folder and display-group permissions. Do not join raw displays instead.
        $displays = $this->displayFactory->query(null, ['folderId' => $params->getInt('folderId')]);
        $allowed = [];
        foreach ($displays as $display) {
            $allowed[(int)$display->displayId] = $display->display;
        }
        $features = [];
        if (!empty($allowed)) {
            $ids = array_keys($allowed);
            $rows = $this->store->select(
                'SELECT cameraId, displayId, name, latitude, longitude FROM monitoringcamera'
                    . ' WHERE displayId IN (' . implode(',', array_fill(0, count($ids), '?')) . ')',
                $ids
            );
            foreach ($rows as $row) {
                $features[] = [
                    'type' => 'Feature',
                    'geometry' => ['type' => 'Point', 'coordinates' => [(float)$row['longitude'], (float)$row['latitude']]],
                    'properties' => [
                        'cameraId' => (int)$row['cameraId'],
                        'displayId' => (int)$row['displayId'],
                        'display' => $allowed[(int)$row['displayId']],
                        'name' => $row['name'],
                    ],
                ];
            }
        }
        return $response->withHeader('Cache-Control', 'no-store')
            ->withJson(['type' => 'FeatureCollection', 'features' => $features]);
    }

    public function playback(Request $request, Response $response, int $id): Response
    {
        $camera = $this->camera($id);
        return $response->withHeader('Cache-Control', 'no-store')->withJson(['url' => $camera['playbackUrl']]);
    }

    public function save(Request $request, Response $response, ?int $id = null): Response
    {
        $this->checkWriteRequest($request);
        $existing = $id === null ? null : $this->camera($id, true);
        $body = $request->getParams();
        $displayId = filter_var($body['displayId'] ?? null, FILTER_VALIDATE_INT);
        if (!$displayId || $displayId < 1) {
            throw new InvalidArgumentException(__('Choose a display'), 'displayId');
        }
        $this->checkDisplay($displayId, true);
        $name = is_string($body['name'] ?? null) ? trim($body['name']) : '';
        if ($name === '' || mb_strlen($name) > 100) {
            throw new InvalidArgumentException(__('Camera name must contain 1 to 100 characters'), 'name');
        }
        $coordinates = [];
        foreach (['latitude' => 90, 'longitude' => 180] as $field => $limit) {
            $value = $body[$field] ?? null;
            if (!is_numeric($value) || !is_finite((float)$value) || abs((float)$value) > $limit) {
                throw new InvalidArgumentException(__('Enter valid camera coordinates'), $field);
            }
            $coordinates[$field] = (float)$value;
        }
        // Blank on edit preserves the URL, so credentials/tokens need not be read into the form.
        if (isset($body['playbackUrl']) && !is_string($body['playbackUrl'])) {
            throw new InvalidArgumentException(__('Enter an HTTPS HLS URL'), 'playbackUrl');
        }
        $url = trim($body['playbackUrl'] ?? '');
        $url = $url !== '' ? $url : ($existing['playbackUrl'] ?? '');
        $parts = parse_url($url);
        if (strlen($url) > 4096 || !filter_var($url, FILTER_VALIDATE_URL)
            || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['fragment'])
        ) {
            throw new InvalidArgumentException(__('Enter an HTTPS HLS URL without embedded credentials'), 'playbackUrl');
        }
        $values = array_merge($coordinates, ['displayId' => $displayId, 'name' => $name, 'playbackUrl' => $url]);
        if ($id === null) {
            $id = (int)$this->store->insert(
                'INSERT INTO monitoringcamera (displayId, name, latitude, longitude, playbackUrl)'
                    . ' VALUES (:displayId, :name, :latitude, :longitude, :playbackUrl)',
                $values
            );
        } else {
            $values['id'] = $id;
            $this->store->update(
                'UPDATE monitoringcamera SET displayId=:displayId, name=:name, latitude=:latitude,'
                    . ' longitude=:longitude, playbackUrl=:playbackUrl WHERE cameraId=:id',
                $values
            );
        }
        return $response->withHeader('Cache-Control', 'no-store')->withJson(['cameraId' => $id]);
    }

    public function delete(Request $request, Response $response, int $id): Response
    {
        $this->checkWriteRequest($request);
        $this->camera($id, true);
        $this->store->update('DELETE FROM monitoringcamera WHERE cameraId=:id', ['id' => $id]);
        return $response->withJson(['deleted' => true]);
    }
}
