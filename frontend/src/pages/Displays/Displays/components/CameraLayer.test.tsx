import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CameraLayer from './CameraLayer';

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), canModify: true, map: vi.fn() }));
vi.mock('@/context/UserContext', () => ({ useUserContext: () => ({ user: {} }) }));
vi.mock('@/utils/permissions', () => ({ hasFeature: () => mocks.canModify }));
vi.mock('@/services/displaysApi', () => ({
  fetchDisplays: async () => ({ rows: [{ displayId: 1, display: 'Lobby' }] }),
}));
vi.mock('@/services/monitoringCameraApi', () => ({
  fetchCameraMap: mocks.map,
  saveCamera: mocks.save,
  deleteCamera: mocks.remove,
}));
vi.mock('./CameraPlayer', () => ({
  default: ({ cameraId }: { cameraId: number }) => <div data-testid="video">{cameraId}</div>,
}));
vi.mock('react-leaflet', () => ({
  useMap: () => ({ flyTo: vi.fn(), getZoom: () => 10, getCenter: () => ({ lat: 0, lng: 110 }) }),
  CircleMarker: () => null,
  Popup: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CameraLayer />
    </QueryClientProvider>,
  );
}

describe('CCTV map panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canModify = true;
    mocks.save.mockResolvedValue({});
    mocks.map.mockResolvedValue({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [110, 0] },
          properties: { cameraId: 1, displayId: 1, display: 'Lobby', name: 'Gate camera' },
        },
      ],
    });
  });

  it('opens video only on selection and removes it when the panel closes', async () => {
    mount();
    expect(mocks.map).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('CCTV cameras'));
    const camera = await screen.findByText('Gate camera · Lobby');
    expect(screen.queryByTestId('video')).not.toBeInTheDocument();
    fireEvent.click(camera);
    expect(await screen.findByTestId('video')).toHaveTextContent('1');
    fireEvent.click(screen.getByText('Close CCTV'));
    expect(screen.queryByTestId('video')).not.toBeInTheDocument();
  });

  it('hides camera management from users without modify permission', async () => {
    mocks.canModify = false;
    mount();
    fireEvent.click(screen.getByText('CCTV cameras'));
    fireEvent.click(await screen.findByText('Gate camera · Lobby'));
    expect(screen.queryByText('Add camera')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit camera')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete camera')).not.toBeInTheDocument();
  });

  it('submits a new camera with zero latitude without converting it to an empty value', async () => {
    mount();
    fireEvent.click(screen.getByText('CCTV cameras'));
    fireEvent.click(await screen.findByText('Add camera'));
    await screen.findByRole('option', { name: 'Lobby' });
    fireEvent.change(screen.getByLabelText('Camera name'), { target: { value: 'North gate' } });
    fireEvent.change(screen.getByLabelText('Display'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('HLS playback URL'), {
      target: { value: 'https://video.example.test/live.m3u8' },
    });
    fireEvent.click(screen.getByText('Save camera'));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(
        expect.objectContaining({
          displayId: '1',
          name: 'North gate',
          latitude: '0.0000000',
        }),
        undefined,
      ),
    );
  });

  it('requires confirmation before deleting camera configuration', async () => {
    mount();
    fireEvent.click(screen.getByText('CCTV cameras'));
    fireEvent.click(await screen.findByText('Gate camera · Lobby'));
    fireEvent.click(screen.getByText('Delete camera'));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(1));
  });
});
