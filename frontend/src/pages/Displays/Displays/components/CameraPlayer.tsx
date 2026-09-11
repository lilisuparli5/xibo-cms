import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchCameraPlayback } from '@/services/monitoringCameraApi';

export default function CameraPlayer({ cameraId }: { cameraId: number }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('Connecting');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const abort = new AbortController();
    let hls: Hls | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const update = (value: string) => {
      if (!abort.signal.aborted) setStatus(value);
    };
    const timeout = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        update('Stream unavailable');
        hls?.stopLoad();
      }, 20_000);
    };
    const playing = () => {
      clearTimeout(timer);
      update('Playing');
    };
    const waiting = () => {
      update('Buffering');
      timeout();
    };
    const failed = () => {
      clearTimeout(timer);
      update('Stream unavailable');
    };
    const paused = () => {
      clearTimeout(timer);
      update('Paused');
    };
    const ended = () => {
      clearTimeout(timer);
      update('Stream ended');
    };
    const play = () => {
      void video.play().catch(() => update('Press play to start'));
    };
    video.addEventListener('playing', playing);
    video.addEventListener('waiting', waiting);
    video.addEventListener('error', failed);
    video.addEventListener('pause', paused);
    video.addEventListener('ended', ended);
    update('Connecting');
    timeout();
    void fetchCameraPlayback(cameraId, abort.signal)
      .then((url) => {
        if (abort.signal.aborted) return;
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
          play();
        } else if (Hls.isSupported()) {
          hls = new Hls({ maxBufferLength: 15, backBufferLength: 0 });
          hls.on(Hls.Events.MANIFEST_PARSED, play);
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              failed();
              hls?.destroy();
            }
          });
          hls.loadSource(url);
          hls.attachMedia(video);
        } else {
          clearTimeout(timer);
          update('HLS playback is not supported by this browser');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) failed();
      });
    return () => {
      abort.abort();
      clearTimeout(timer);
      hls?.destroy();
      video.removeEventListener('playing', playing);
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('error', failed);
      video.removeEventListener('pause', paused);
      video.removeEventListener('ended', ended);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [cameraId, attempt]);

  return (
    <div className="space-y-2">
      <video
        ref={videoRef}
        controls
        muted
        playsInline
        className="w-full bg-black rounded"
        aria-label={t('Live camera')}
      />
      <p role="status">{t(status)}</p>
      <p className="text-xs text-gray-500">
        {t(
          'Playback status for this viewing session. Camera health is not monitored in the background.',
        )}
      </p>
      <button type="button" className="underline" onClick={() => setAttempt((value) => value + 1)}>
        {t('Reconnect')}
      </button>
    </div>
  );
}
