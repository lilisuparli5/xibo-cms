import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CameraPlayer from './CameraPlayer';

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  supported: true,
  instances: [] as Array<{
    destroy: ReturnType<typeof vi.fn>;
    loadSource: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('@/services/monitoringCameraApi', () => ({ fetchCameraPlayback: state.fetch }));
vi.mock('hls.js', () => ({
  default: class {
    static isSupported = () => state.supported;
    static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' };
    destroy = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    stopLoad = vi.fn();
    on = vi.fn();
    constructor() {
      state.instances.push(this);
    }
  },
}));

describe('CameraPlayer lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.instances.length = 0;
    state.supported = true;
    state.fetch.mockResolvedValue('https://stream.example.test/camera/index.m3u8');
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  it('destroys HLS and aborts the playback request when closed', async () => {
    const view = render(<CameraPlayer cameraId={1} />);
    await waitFor(() => expect(state.instances).toHaveLength(1));
    const signal = state.fetch.mock.calls[0]![1] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(state.instances[0]!.destroy).toHaveBeenCalled();
  });

  it('ignores a late response for a previously selected camera', async () => {
    let resolveOld!: (url: string) => void;
    state.fetch.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const view = render(<CameraPlayer cameraId={1} />);
    view.rerender(<CameraPlayer cameraId={2} />);
    await waitFor(() => expect(state.instances).toHaveLength(1));
    await act(async () => {
      resolveOld('https://old.example.test/live.m3u8');
    });
    expect(state.instances).toHaveLength(1);
    expect(state.instances[0]!.loadSource).not.toHaveBeenCalledWith(
      'https://old.example.test/live.m3u8',
    );
  });

  it('uses native HLS and reflects actual playback events', async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue('probably');
    render(<CameraPlayer cameraId={1} />);
    const video = screen.getByLabelText('Live camera');
    await waitFor(() =>
      expect(video).toHaveAttribute('src', 'https://stream.example.test/camera/index.m3u8'),
    );
    fireEvent.playing(video);
    expect(screen.getByRole('status')).toHaveTextContent('Playing');
    fireEvent.waiting(video);
    expect(screen.getByRole('status')).toHaveTextContent('Buffering');
    expect(state.instances).toHaveLength(0);
  });

  it('does not claim camera offline when access to the playback URL fails', async () => {
    state.fetch.mockRejectedValue(new Error('403'));
    render(<CameraPlayer cameraId={1} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Stream unavailable'));
    expect(screen.queryByText('Camera offline')).not.toBeInTheDocument();
  });

  it('creates a fresh connection on reconnect', async () => {
    render(<CameraPlayer cameraId={1} />);
    await waitFor(() => expect(state.instances).toHaveLength(1));
    fireEvent.click(screen.getByText('Reconnect'));
    await waitFor(() => expect(state.instances).toHaveLength(2));
    expect(state.instances[0]!.destroy).toHaveBeenCalled();
  });
});
