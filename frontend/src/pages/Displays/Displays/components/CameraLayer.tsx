import { useQuery, useQueryClient } from '@tanstack/react-query';
import L from 'leaflet';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleMarker, Popup, useMap } from 'react-leaflet';

import { useUserContext } from '@/context/UserContext';
import { fetchDisplays } from '@/services/displaysApi';
import { deleteCamera, fetchCameraMap, saveCamera } from '@/services/monitoringCameraApi';
import type { CameraDraft, CameraFeature } from '@/services/monitoringCameraApi';
import { hasFeature } from '@/utils/permissions';

const CameraPlayer = lazy(() => import('./CameraPlayer'));
const emptyDraft: CameraDraft = {
  name: '',
  displayId: '',
  latitude: '',
  longitude: '',
  playbackUrl: '',
};

export default function CameraLayer({ folderId }: { folderId?: number | null }) {
  const { t } = useTranslation();
  const { user } = useUserContext();
  const canModify = hasFeature(user, 'displays.modify');
  const client = useQueryClient();
  const map = useMap();
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CameraDraft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [search, setSearch] = useState('');
  const [displaySearch, setDisplaySearch] = useState('');
  const [lookup, setLookup] = useState('');
  const cameras = useQuery({
    queryKey: ['cameraMap', folderId],
    queryFn: () => fetchCameraMap(folderId),
    enabled: open,
    refetchInterval: open ? 30_000 : false,
  });
  const displays = useQuery({
    queryKey: ['cameraDisplayOptions', lookup],
    queryFn: () => fetchDisplays({ start: 0, length: 50, display: lookup }),
    enabled: open && editing,
  });
  const features = cameras.data?.features ?? [];
  const selected = features.find((feature) => feature.properties.cameraId === selectedId);

  useEffect(() => {
    const timer = setTimeout(() => setLookup(displaySearch), 300);
    return () => clearTimeout(timer);
  }, [displaySearch]);

  useEffect(() => {
    if (panel.current) {
      L.DomEvent.disableClickPropagation(panel.current);
      L.DomEvent.disableScrollPropagation(panel.current);
    }
  }, []);

  const select = (feature: CameraFeature) => {
    setSelectedId(feature.properties.cameraId);
    setEditing(false);
    setConfirmDelete(false);
    setError('');
    const [lng, lat] = feature.geometry.coordinates;
    map.flyTo([lat, lng], Math.max(map.getZoom(), 14));
  };
  const edit = (feature?: CameraFeature) => {
    setSelectedId(feature?.properties.cameraId ?? null);
    const center = map.getCenter();
    setDraft(
      feature
        ? {
            name: feature.properties.name,
            displayId: String(feature.properties.displayId),
            latitude: String(feature.geometry.coordinates[1]),
            longitude: String(feature.geometry.coordinates[0]),
            playbackUrl: '',
          }
        : { ...emptyDraft, latitude: center.lat.toFixed(7), longitude: center.lng.toFixed(7) },
    );
    setEditing(true);
    setDisplaySearch('');
    setConfirmDelete(false);
    setError('');
  };
  const mutate = async (remove = false) => {
    setSaving(true);
    setError('');
    try {
      if (remove && selectedId !== null) await deleteCamera(selectedId);
      else await saveCamera(draft, selectedId ?? undefined);
      await client.invalidateQueries({ queryKey: ['cameraMap'] });
      setEditing(false);
      setSelectedId(null);
      setConfirmDelete(false);
    } catch {
      setError(t('Could not save changes. Check the camera details and your display permissions.'));
    } finally {
      setSaving(false);
    }
  };
  const field = (name: keyof CameraDraft, value: string) =>
    setDraft((current) => ({ ...current, [name]: value }));

  return (
    <>
      {open &&
        features.map((feature) => (
          <CircleMarker
            key={feature.properties.cameraId}
            center={[feature.geometry.coordinates[1], feature.geometry.coordinates[0]]}
            radius={9}
            pathOptions={{ color: '#1d4ed8', fillColor: '#60a5fa', fillOpacity: 0.9 }}
            eventHandlers={{ click: () => select(feature) }}
          >
            <Popup>
              <strong>{feature.properties.name}</strong>
              <br />
              {t('CCTV camera')}
            </Popup>
          </CircleMarker>
        ))}
      <div
        ref={panel}
        className="absolute top-3 right-3 z-1000 max-h-[85%] max-w-[calc(100%-1.5rem)] overflow-auto bg-white rounded-lg border shadow p-3 text-sm"
        style={{ width: open ? 340 : 'auto' }}
      >
        <button
          type="button"
          className="font-semibold underline"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            setSelectedId(null);
            setEditing(false);
            setError('');
          }}
        >
          {open ? t('Close CCTV') : t('CCTV cameras')}
        </button>
        {open && (
          <div className="space-y-3 mt-3">
            <p className="text-xs text-gray-500">
              {t(
                'Blue markers show camera locations. Use this camera list to search; display filters apply to display markers only.',
              )}
            </p>
            {cameras.isFetching && <p role="status">{t('Updating cameras...')}</p>}
            {cameras.isError && (
              <p role="alert">
                {t('Cannot load cameras. Check the connection and camera database migration.')}
              </p>
            )}
            <button type="button" className="underline" onClick={() => void cameras.refetch()}>
              {t('Refresh cameras')}
            </button>
            {!editing && (
              <>
                <input
                  aria-label={t('Search cameras')}
                  placeholder={t('Search cameras')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="border rounded p-2 w-full"
                />
                {features.length === 0 && !cameras.isFetching && !cameras.isError && (
                  <p>{t('No cameras in this folder. Add a camera to begin.')}</p>
                )}
                <ul className="max-h-36 overflow-auto space-y-1">
                  {features
                    .filter((feature) =>
                      feature.properties.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((feature) => (
                      <li key={feature.properties.cameraId}>
                        <button
                          type="button"
                          className="underline text-left"
                          onClick={() => select(feature)}
                        >
                          {feature.properties.name} · {feature.properties.display}
                        </button>
                      </li>
                    ))}
                </ul>
                {canModify && (
                  <button type="button" className="border rounded px-3 py-1" onClick={() => edit()}>
                    {t('Add camera')}
                  </button>
                )}
                {selected && (
                  <section className="space-y-2 border-t pt-3">
                    <h3 className="font-semibold">{selected.properties.name}</h3>
                    <Suspense fallback={<p>{t('Loading video player...')}</p>}>
                      <CameraPlayer key={selectedId} cameraId={selected.properties.cameraId} />
                    </Suspense>
                    <button
                      type="button"
                      className="underline mr-3"
                      onClick={() => setSelectedId(null)}
                    >
                      {t('Close video')}
                    </button>
                    {canModify && (
                      <>
                        <button
                          type="button"
                          className="underline mr-3"
                          onClick={() => edit(selected)}
                        >
                          {t('Edit camera')}
                        </button>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setConfirmDelete(true)}
                        >
                          {t('Delete camera')}
                        </button>
                        {confirmDelete && (
                          <div>
                            <p>{t('Delete this camera configuration?')}</p>
                            <button
                              type="button"
                              disabled={saving}
                              className="underline mr-3"
                              onClick={() => void mutate(true)}
                            >
                              {t('Confirm delete')}
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => setConfirmDelete(false)}
                            >
                              {t('Cancel')}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}
              </>
            )}
            {editing && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void mutate();
                }}
              >
                <label className="block">
                  {t('Camera name')}
                  <input
                    required
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) => field('name', e.target.value)}
                    className="border rounded p-2 w-full"
                  />
                </label>
                <label className="block">
                  {t('Find display')}
                  <input
                    value={displaySearch}
                    onChange={(e) => setDisplaySearch(e.target.value)}
                    className="border rounded p-2 w-full"
                  />
                </label>
                <label className="block">
                  {t('Display')}
                  <select
                    required
                    value={draft.displayId}
                    onChange={(e) => field('displayId', e.target.value)}
                    className="border rounded p-2 w-full"
                  >
                    <option value="">{t('Choose a display')}</option>
                    {draft.displayId &&
                      !displays.data?.rows.some((d) => String(d.displayId) === draft.displayId) && (
                        <option value={draft.displayId}>
                          {selected?.properties.display ?? draft.displayId}
                        </option>
                      )}
                    {displays.data?.rows.map((display) => (
                      <option key={display.displayId} value={display.displayId}>
                        {display.display}
                      </option>
                    ))}
                  </select>
                </label>
                {displays.isError && <p role="alert">{t('Could not load displays')}</p>}
                {(['latitude', 'longitude'] as const).map((name) => (
                  <label className="block" key={name}>
                    {t(name === 'latitude' ? 'Latitude' : 'Longitude')}
                    <input
                      type="number"
                      required
                      step="any"
                      min={name === 'latitude' ? -90 : -180}
                      max={name === 'latitude' ? 90 : 180}
                      value={draft[name]}
                      onChange={(e) => field(name, e.target.value)}
                      className="border rounded p-2 w-full"
                    />
                  </label>
                ))}
                <label className="block">
                  {t('HLS playback URL')}
                  <input
                    type="url"
                    required={selectedId === null}
                    maxLength={4096}
                    placeholder="https://…/index.m3u8"
                    value={draft.playbackUrl}
                    onChange={(e) => field('playbackUrl', e.target.value)}
                    className="border rounded p-2 w-full"
                  />
                </label>
                <p className="text-xs text-gray-500">
                  {t(
                    'Use an HTTPS HLS stream without embedded camera passwords. On edit, leave blank to keep the current URL.',
                  )}
                </p>
                <button disabled={saving} className="border rounded px-3 py-1 mr-3">
                  {saving ? t('Saving...') : t('Save camera')}
                </button>
                <button type="button" disabled={saving} onClick={() => setEditing(false)}>
                  {t('Cancel')}
                </button>
              </form>
            )}
            {error && (
              <p role="alert" className="text-red-700">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
