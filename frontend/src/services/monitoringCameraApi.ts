import http from '@/lib/api';

export interface CameraFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { cameraId: number; displayId: number; display: string; name: string };
}

export interface CameraDraft {
  displayId: string;
  name: string;
  latitude: string;
  longitude: string;
  playbackUrl: string;
}

export async function fetchCameraMap(folderId?: number | null) {
  const response = await http.get<{ type: 'FeatureCollection'; features: CameraFeature[] }>(
    '/monitoringcamera/map',
    { params: { folderId } },
  );
  return response.data;
}

export async function fetchCameraPlayback(id: number, signal: AbortSignal): Promise<string> {
  const response = await http.get<{ url: string }>(`/monitoringcamera/${id}/playback`, { signal });
  return response.data.url;
}

export async function saveCamera(draft: CameraDraft, id?: number) {
  return http.request({
    method: id === undefined ? 'POST' : 'PUT',
    url: `/monitoringcamera${id === undefined ? '' : `/${id}`}`,
    data: new URLSearchParams({ ...draft }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
}

export async function deleteCamera(id: number) {
  return http.delete(`/monitoringcamera/${id}`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
}
