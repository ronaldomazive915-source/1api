import React, { useEffect, useMemo, useRef, useState } from 'react';
import type HlsType from 'hls.js';
import type * as dashjsType from 'dashjs';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Check,
  AlertTriangle,
  RefreshCw,
  Layers,
  ShieldCheck,
  ChevronDown,
  ArrowLeft,
  SkipForward,
  Settings,
  Subtitles,
  RectangleHorizontal,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../lib/api.js';
import { classifySourceUrl } from '../../lib/sourceClassification.js';
import { SourceDiagnostics, SourceKind } from '../../types.js';

export interface VideoSourceItem {
  id?: string;
  serverName?: string;
  provider?: string;
  label?: string;
  url: string;
  originalUrl?: string;
  sourceKind?: SourceKind;
  format?: string;
  type?: string;
  audioLanguage?: string;
  subtitleLanguage?: string;
  quality?: string;
  isPrimary?: boolean;
  priority?: number;
  enabled?: boolean;
  status?: string;
  diagnostics?: SourceDiagnostics;
}

export interface SubtitleTrackItem {
  label: string;
  lang: string;
  src: string;
  default?: boolean;
}

interface QualityOption {
  index: number;
  label: string;
}

interface SubtitleOption {
  index: number;
  label: string;
  lang?: string;
}

interface RonycinePlayerProps {
  sources?: VideoSourceItem[];
  src?: string;
  type?: string;
  format?: string;
  poster?: string;
  title?: string;
  autoplay?: boolean;
  alternativeSources?: VideoSourceItem[];
  onSelectAlternativeSource?: (source: VideoSourceItem) => void;
  hasNextEpisode?: boolean;
  onNextEpisode?: () => void;
  standalone?: boolean;
  onBack?: () => void;
  loadingMessage?: string;
  resumeKey?: string;
  initialPositionSeconds?: number;
  subtitles?: SubtitleTrackItem[];
  isCinemaMode?: boolean;
  onToggleCinemaMode?: () => void;
  onProgress?: (data: { currentTime: number; duration: number; progressPercent: number }) => void;
  onEnded?: () => void;
  onPlaybackEvent?: (status: 'STARTED' | 'ERROR', message?: string, sourceType?: string, sourceUrl?: string) => void;
}

interface ResolvedPlaybackState {
  isDirect: boolean;
  directUrl?: string;
  embedUrl: string;
  provider: string;
  format: string;
  sourceKind?: SourceKind;
  note?: string;
}

const RESUME_PREFIX = 'ronycine_resume_';

function readStoredResume(resumeKey?: string): number {
  if (!resumeKey || typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(`${RESUME_PREFIX}${resumeKey}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const time = Number(parsed?.time || 0);
    const dur = Number(parsed?.duration || 0);
    if (time > 5 && (!dur || time < dur * 0.95)) {
      return time;
    }
    return 0;
  } catch {
    return 0;
  }
}

function writeStoredResume(resumeKey: string | undefined, time: number, duration: number) {
  if (!resumeKey || typeof window === 'undefined') return;
  try {
    if (duration > 0 && time >= duration * 0.95) {
      localStorage.removeItem(`${RESUME_PREFIX}${resumeKey}`);
      return;
    }
    if (time > 5) {
      localStorage.setItem(
        `${RESUME_PREFIX}${resumeKey}`,
        JSON.stringify({ time: Math.floor(time), duration: Math.floor(duration || 0), updatedAt: Date.now() })
      );
    }
  } catch {}
}

function normalizeMimeToFormat(typeOrFormat?: string, url?: string): string {
  const f = (typeOrFormat || '').toLowerCase();
  if (f.includes('mpegurl') || f === 'm3u8' || f === 'hls') return 'm3u8';
  if (f.includes('dash') || f === 'mpd') return 'dash';
  if (f.includes('webm') || f === 'webm') return 'webm';
  if (f.includes('mp4') || f === 'mp4') return 'mp4';
  if (f === 'iframe' || f === 'embed') return f;
  if (f === 'php_endpoint') return 'php_endpoint';
  if (f === 'html') return 'html';
  if (url) {
    const classified = classifySourceUrl(url);
    return classified.suggestedFormat;
  }
  return 'auto';
}

function toUserFriendlyError(rawError?: string, status?: string): string {
  const lower = (rawError || '').toLowerCase();
  if (
    status === 'embed_blocked' ||
    lower.includes('x-frame-options') ||
    lower.includes('frame-ancestors') ||
    lower.includes('incorporação externa')
  ) {
    return 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde. (Incorporação externa bloqueada pelo servidor de origem)';
  }
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('recusou o acesso') ||
    lower.includes('forbidden')
  ) {
    return 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde. (O servidor de origem recusou o acesso)';
  }
  if (
    status === 'unsupported_format' ||
    lower.includes('formato de vídeo compatível') ||
    lower.includes('text/html') ||
    lower.includes('página web')
  ) {
    return 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde. (Formato incompatível)';
  }
  if (rawError && rawError.trim().length > 0 && rawError.length < 180 && !rawError.includes('<html')) {
    return rawError;
  }
  return 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.';
}

export const RonycinePlayer: React.FC<RonycinePlayerProps> = ({
  sources = [],
  src,
  type = 'video/mp4',
  format,
  poster,
  title,
  autoplay = true,
  alternativeSources = [],
  onSelectAlternativeSource,
  hasNextEpisode = false,
  onNextEpisode,
  onBack,
  loadingMessage,
  resumeKey,
  initialPositionSeconds,
  subtitles = [],
  isCinemaMode,
  onToggleCinemaMode,
  onProgress,
  onEnded,
  onPlaybackEvent
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const dashRef = useRef<dashjsType.MediaPlayerClass | null>(null);

  // Normalize unified source list while preserving enabled + primary + priority order
  const sourceList: VideoSourceItem[] = useMemo(() => {
    const rawList =
      sources && sources.length > 0
        ? sources
        : src
          ? [
              {
                url: src,
                format: normalizeMimeToFormat(format || type, src),
                serverName: 'Servidor Principal',
                isPrimary: true,
                priority: 1,
                enabled: true
              },
              ...(alternativeSources || [])
            ]
          : [];

    const enabledOnly = rawList.filter(s => s.enabled !== false);

    return [...enabledOnly].sort((a, b) => {
      if ((b.isPrimary ? 1 : 0) !== (a.isPrimary ? 1 : 0)) {
        return (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0);
      }
      const pa = typeof a.priority === 'number' ? a.priority : 999;
      const pb = typeof b.priority === 'number' ? b.priority : 999;
      return pa - pb;
    });
  }, [sources, src, format, type, alternativeSources]);

  const listIdentity = useMemo(
    () => `${resumeKey || ''}::${sourceList.map(s => s.id || s.originalUrl || s.url).join('|')}`,
    [sourceList, resumeKey]
  );

  const [activeSourceIndex, setActiveSourceIndex] = useState<number>(0);
  const [retryToken, setRetryToken] = useState<number>(0);
  const [resolving, setResolving] = useState<boolean>(true);
  const [phaseLabel, setPhaseLabel] = useState<string>('Inicializando fonte...');
  const [resolvedData, setResolvedData] = useState<ResolvedPlaybackState | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [iframeLoaded, setIframeLoaded] = useState<boolean>(false);

  // Pro Features state: Cinema, Quality, Subtitles, Resume
  const [internalCinemaMode, setInternalCinemaMode] = useState<boolean>(false);
  const effectiveCinemaMode = isCinemaMode !== undefined ? isCinemaMode : internalCinemaMode;
  const [qualityLevels, setQualityLevels] = useState<QualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleOption[]>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number>(-1);
  const [resumedFromSec, setResumedFromSec] = useState<number>(0);

  // Menus & controls UI state
  const [showControls, setShowControls] = useState<boolean>(true);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  const [showSourceMenu, setShowSourceMenu] = useState<boolean>(false);
  const [showQualityMenu, setShowQualityMenu] = useState<boolean>(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState<boolean>(false);

  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedTimeRef = useRef<number>(0);
  const lastPersistedSecRef = useRef<number>(0);
  const prevListIdentityRef = useRef<string>(listIdentity);
  const failedIndicesRef = useRef<Set<number>>(new Set());

  const handlePlaybackFailure = (message: string, failedFormat?: string, failedUrl?: string) => {
    onPlaybackEvent?.('ERROR', message, failedFormat, failedUrl);
    failedIndicesRef.current.add(activeSourceIndex);
    const nextIdx = sourceList.findIndex((_, idx) => idx !== activeSourceIndex && !failedIndicesRef.current.has(idx));
    if (nextIdx >= 0) {
      setHasError(false);
      setErrorMessage('');
      setActiveSourceIndex(nextIdx);
      const chosen = sourceList[nextIdx];
      if (chosen && onSelectAlternativeSource) {
        onSelectAlternativeSource(chosen);
      }
      return;
    }
    setResolvedData(null);
    setHasError(true);
    setErrorMessage(message);
  };

  const formatTime = (sec: number) => {
    if (isNaN(sec) || sec < 0) return '00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Seed resume position and reset state when switching content
  useEffect(() => {
    if (prevListIdentityRef.current !== listIdentity) {
      prevListIdentityRef.current = listIdentity;
      failedIndicesRef.current.clear();
      setActiveSourceIndex(0);
      setQualityLevels([]);
      setSelectedQuality(-1);
      setSubtitleTracks([]);
      setSelectedSubtitle(-1);
      setCurrentTime(0);
      setDuration(0);
    }

    const stored = initialPositionSeconds && initialPositionSeconds > 5
      ? initialPositionSeconds
      : readStoredResume(resumeKey);
    if (stored > 5) {
      lastSavedTimeRef.current = stored;
      setResumedFromSec(stored);
    } else {
      lastSavedTimeRef.current = 0;
      setResumedFromSec(0);
    }
  }, [listIdentity, resumeKey, initialPositionSeconds]);

  // Auto-hide resume notice after 5s
  useEffect(() => {
    if (resumedFromSec <= 0) return;
    const t = setTimeout(() => setResumedFromSec(0), 5000);
    return () => clearTimeout(t);
  }, [resumedFromSec]);

  const activeSource = sourceList[activeSourceIndex] || sourceList[0];
  const activeUrl = activeSource?.originalUrl || activeSource?.url || '';
  const activeDeclaredFormat = normalizeMimeToFormat(
    activeSource?.format || activeSource?.type,
    activeUrl
  );

  const cleanupMediaEngines = () => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {}
      hlsRef.current = null;
    }
    if (dashRef.current) {
      try {
        dashRef.current.reset();
        dashRef.current.destroy();
      } catch {}
      dashRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.removeAttribute('src');
        videoRef.current.load();
      } catch {}
    }
  };

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      cleanupMediaEngines();
    };
  }, []);

  // 1. Resolve Source via backend
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    cleanupMediaEngines();
    setResolvedData(null);
    setIframeLoaded(false);
    setIsPlaying(false);
    setQualityLevels([]);
    setSelectedQuality(-1);
    setSubtitleTracks([]);
    setSelectedSubtitle(-1);

    if (!activeUrl) {
      setResolving(false);
      setHasError(true);
      setErrorMessage('Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.');
      return () => controller.abort();
    }

    setResolving(true);
    setHasError(false);
    setErrorMessage('');

    const staticCheck = classifySourceUrl(activeUrl);
    if (!staticCheck.valid) {
      setResolving(false);
      setHasError(true);
      setErrorMessage(staticCheck.error || 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.');
      return () => controller.abort();
    }

    setPhaseLabel(
      staticCheck.sourceKind === 'PHP_VIDEO_ENDPOINT' || staticCheck.sourceKind === 'UNKNOWN'
        ? 'Verificando compatibilidade...'
        : 'Inicializando fonte...'
    );

    api
      .resolveProviderSource(activeUrl, activeDeclaredFormat, controller.signal)
      .then((res) => {
        if (cancelled) return;

        if (res.success) {
          setResolvedData({
            isDirect: Boolean(res.isDirect),
            directUrl: res.directUrl,
            embedUrl: res.embedUrl || activeUrl,
            provider: res.provider || activeSource?.serverName || activeSource?.provider || 'Servidor RONYCINE',
            format: res.format || activeDeclaredFormat,
            sourceKind: res.sourceKind || staticCheck.sourceKind,
            note: res.note
          });
          setHasError(false);
          onPlaybackEvent?.('STARTED', undefined, res.format || activeDeclaredFormat, res.directUrl || res.embedUrl || activeUrl);
        } else {
          const msg = toUserFriendlyError(res.error, res.status);
          handlePlaybackFailure(msg, activeDeclaredFormat, activeUrl);
        }
      })
      .catch((err: any) => {
        if (cancelled || err?.name === 'AbortError') return;

        if (
          staticCheck.sourceKind === 'DIRECT_MP4' ||
          staticCheck.sourceKind === 'DIRECT_WEBM' ||
          staticCheck.sourceKind === 'DIRECT_HLS' ||
          staticCheck.sourceKind === 'DIRECT_DASH'
        ) {
          setResolvedData({
            isDirect: true,
            directUrl: activeUrl,
            embedUrl: activeUrl,
            provider: activeSource?.serverName || 'Servidor Direto',
            format: staticCheck.suggestedFormat,
            sourceKind: staticCheck.sourceKind
          });
          setHasError(false);
          onPlaybackEvent?.('STARTED', undefined, staticCheck.suggestedFormat, activeUrl);
        } else if (staticCheck.sourceKind === 'EMBED_PLAYER') {
          setResolvedData({
            isDirect: false,
            embedUrl: activeUrl,
            provider: activeSource?.serverName || 'Embed Externo',
            format: 'embed',
            sourceKind: 'EMBED_PLAYER'
          });
          setHasError(false);
          onPlaybackEvent?.('STARTED', undefined, 'embed', activeUrl);
        } else {
          const msg = toUserFriendlyError(err?.message);
          handlePlaybackFailure(msg, activeDeclaredFormat, activeUrl);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setResolving(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeSourceIndex, activeUrl, activeDeclaredFormat, retryToken]);

  // 2. Initialize Direct Video Engine (MP4 / WebM / lazy HLS / lazy DASH)
  useEffect(() => {
    if (resolving || hasError || !resolvedData?.isDirect || !resolvedData.directUrl || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    const mediaUrl = resolvedData.directUrl;
    const fmt = (resolvedData.format || '').toLowerCase();
    const isHls = fmt === 'm3u8' || fmt === 'hls' || mediaUrl.toLowerCase().includes('.m3u8');
    const isDash = fmt === 'dash' || fmt === 'mpd' || mediaUrl.toLowerCase().includes('.mpd');

    let disposed = false;
    cleanupMediaEngines();

    // Populate any external subtitle props initially
    if (subtitles.length > 0) {
      setSubtitleTracks(subtitles.map((s, idx) => ({ index: idx, label: s.label, lang: s.lang })));
      const defIdx = subtitles.findIndex(s => s.default);
      if (defIdx >= 0) setSelectedSubtitle(defIdx);
    } else {
      setSubtitleTracks([]);
    }

    const initEngine = async () => {
      if (isHls) {
        try {
          const { default: Hls } = await import('hls.js');
          if (disposed) return;

          if (Hls.isSupported()) {
            let hlsMediaRecoveryAttempted = false;
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: true
            });
            hlsRef.current = hls;
            hls.loadSource(mediaUrl);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (disposed) return;
              const levels = (hls.levels || []).map((lvl, idx) => ({
                index: idx,
                label: lvl.height ? `${lvl.height}p` : `${Math.round((lvl.bitrate || 0) / 1000)} kbps`
              }));
              // Dedupe identical heights nicely while keeping original level index
              setQualityLevels(levels);
              setSelectedQuality(-1);

              if (hls.subtitleTracks && hls.subtitleTracks.length > 0 && subtitles.length === 0) {
                setSubtitleTracks(
                  hls.subtitleTracks.map((st, idx) => ({
                    index: idx,
                    label: st.name || st.lang || `Legenda ${idx + 1}`,
                    lang: st.lang
                  }))
                );
              }

              if (lastSavedTimeRef.current > 0) {
                video.currentTime = lastSavedTimeRef.current;
              }
              if (autoplay) {
                video.play().catch(() => setIsPlaying(false));
              }
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
              if (disposed || !data.fatal) return;
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hlsMediaRecoveryAttempted) {
                hlsMediaRecoveryAttempted = true;
                hls.recoverMediaError();
                return;
              }
              handlePlaybackFailure('Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.', 'm3u8', mediaUrl);
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = mediaUrl;
            if (lastSavedTimeRef.current > 0) video.currentTime = lastSavedTimeRef.current;
            if (autoplay) video.play().catch(() => setIsPlaying(false));
          } else {
            handlePlaybackFailure('Este navegador não suporta reprodução HLS/M3U8.', 'm3u8', mediaUrl);
          }
        } catch {
          if (!disposed) {
            handlePlaybackFailure('Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.', 'm3u8', mediaUrl);
          }
        }
      } else if (isDash) {
        try {
          const dashjs = await import('dashjs');
          if (disposed) return;

          const player = dashjs.MediaPlayer().create();
          dashRef.current = player;
          player.initialize(video, mediaUrl, autoplay);

          player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
            if (disposed) return;
            try {
              const dashAny = player as any;
              const bitrates =
                (typeof dashAny.getBitrateInfoListFor === 'function'
                  ? dashAny.getBitrateInfoListFor('video')
                  : typeof dashAny.getRepresentationsByType === 'function'
                  ? dashAny.getRepresentationsByType('video')
                  : []) || [];
              const mapped: QualityOption[] = bitrates.map((b: any, idx: number) => ({
                index: b.qualityIndex ?? b.index ?? idx,
                label: b.height ? `${b.height}p` : `${Math.round(((b.bitrate || b.bandwidth || 0) as number) / 1000)} kbps`
              }));
              setQualityLevels(mapped);
              setSelectedQuality(-1);
            } catch {}
          });

          if (lastSavedTimeRef.current > 0) {
            player.seek(lastSavedTimeRef.current);
          }

          player.on(dashjs.MediaPlayer.events.ERROR, () => {
            if (disposed) return;
            handlePlaybackFailure('Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.', 'dash', mediaUrl);
          });
        } catch {
          if (!disposed) {
            handlePlaybackFailure('Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.', 'dash', mediaUrl);
          }
        }
      } else {
        // Direct MP4 / WebM
        video.src = mediaUrl;
        video.onloadedmetadata = () => {
          if (disposed) return;
          if (lastSavedTimeRef.current > 0 && video.duration > lastSavedTimeRef.current + 2) {
            video.currentTime = lastSavedTimeRef.current;
          }
        };
        if (autoplay) {
          video.play().catch(() => setIsPlaying(false));
        }
      }
    };

    initEngine();

    return () => {
      disposed = true;
      cleanupMediaEngines();
    };
  }, [resolving, hasError, resolvedData, autoplay, subtitles]);

  // Apply subtitle selection to native <video> textTracks or HLS subtitleTrack
  useEffect(() => {
    if (hlsRef.current && hlsRef.current.subtitleTracks && hlsRef.current.subtitleTracks.length > 0 && subtitles.length === 0) {
      hlsRef.current.subtitleTrack = selectedSubtitle;
    }
    const video = videoRef.current;
    if (video && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = i === selectedSubtitle ? 'showing' : 'hidden';
      }
    }
  }, [selectedSubtitle, subtitles]);

  // 3. Controls Auto-hide
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSpeedMenu && !showSourceMenu && !showQualityMenu && !showSubtitleMenu) {
        setShowControls(false);
      }
    }, 3000);
  };

  // Playback Controls
  const togglePlay = () => {
    if (!videoRef.current || !resolvedData?.isDirect) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  };

  const seek = (seconds: number) => {
    if (!videoRef.current) return;
    const maxDur = duration || videoRef.current.duration || 0;
    const newTime = Math.max(0, Math.min(maxDur, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const restartFromBeginning = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
    lastSavedTimeRef.current = 0;
    setCurrentTime(0);
    setResumedFromSec(0);
    writeStoredResume(resumeKey, 0, duration);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.volume = val;
    videoRef.current.muted = val === 0;
    setVolume(val);
    setIsMuted(val === 0);
  };

  const changePlaybackSpeed = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setPlaybackSpeed(speed);
    setShowSpeedMenu(false);
  };

  const changeQuality = (index: number) => {
    setSelectedQuality(index);
    setShowQualityMenu(false);
    if (hlsRef.current) {
      hlsRef.current.currentLevel = index;
    }
    if (dashRef.current) {
      try {
        const dashAny = dashRef.current as any;
        dashRef.current.updateSettings({
          streaming: { abr: { autoSwitchBitrate: { video: index === -1 } } }
        });
        if (index >= 0) {
          if (typeof dashAny.setQualityFor === 'function') {
            dashAny.setQualityFor('video', index);
          } else if (typeof dashAny.setRepresentationForTypeByIndex === 'function') {
            dashAny.setRepresentationForTypeByIndex('video', index);
          }
        }
      } catch {}
    }
  };

  const switchSource = (index: number) => {
    if (index === activeSourceIndex) {
      setShowSourceMenu(false);
      return;
    }
    if (currentTime > 0) {
      lastSavedTimeRef.current = currentTime;
    }
    setActiveSourceIndex(index);
    setShowSourceMenu(false);
    const chosen = sourceList[index];
    if (chosen && onSelectAlternativeSource) {
      onSelectAlternativeSource(chosen);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleCinemaToggle = () => {
    if (onToggleCinemaMode) {
      onToggleCinemaMode();
    } else {
      setInternalCinemaMode(prev => !prev);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-[#080808] group overflow-hidden select-none font-sans ${
        effectiveCinemaMode && !onToggleCinemaMode ? 'fixed inset-0 z-[90]' : ''
      }`}
      onMouseMove={handleMouseMove}
      onClick={handleMouseMove}
    >
      {/* RESUME POSITION TOAST */}
      <AnimatePresence>
        {resumedFromSec > 5 && !resolving && !hasError && resolvedData?.isDirect && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="absolute top-16 left-4 sm:left-6 z-40 bg-black/85 border border-white/15 rounded-lg px-3.5 py-2 flex items-center gap-3 backdrop-blur-md shadow-xl"
          >
            <History className="w-4 h-4 text-[#E50914] shrink-0" />
            <span className="text-[11px] font-semibold text-zinc-200">
              Retomando de <span className="font-mono text-white font-bold">{formatTime(resumedFromSec)}</span>
            </span>
            <button
              type="button"
              onClick={restartFromBeginning}
              className="text-[10px] font-black uppercase tracking-wider text-[#E50914] hover:text-white transition-colors"
            >
              Reiniciar
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RESOLVING / LOADING OVERLAY */}
      {resolving && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080808]/95 z-50 backdrop-blur-md p-6 text-center">
          <div className="w-12 h-12 border-4 border-[#E50914] border-t-transparent rounded-full animate-spin mb-4" />
          <span className="text-xs font-black uppercase tracking-[0.25em] text-white">
            {loadingMessage || phaseLabel}
          </span>
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mt-2">
            {activeSource?.serverName || activeSource?.provider || 'RONYCINE CINEMA PRO'}
          </span>
        </div>
      )}

      {/* ERROR OVERLAY */}
      {hasError && !resolving && (
        <div className="absolute inset-0 z-50 bg-[#080808] flex flex-col items-center justify-center p-6 sm:p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-[#E50914]/10 border border-[#E50914]/25 flex items-center justify-center text-[#E50914] mb-5">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-white mb-2 font-display">
            Falha na Reprodução
          </h3>
          <p className="text-xs sm:text-sm font-semibold text-zinc-300 max-w-md mb-6 leading-relaxed">
            {errorMessage || 'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                failedIndicesRef.current.clear();
                setRetryToken(t => t + 1);
              }}
              className="px-5 py-2.5 bg-[#E50914] text-white text-xs font-bold uppercase tracking-widest rounded-lg flex items-center gap-2 hover:bg-red-700 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar Novamente</span>
            </button>

            {sourceList.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSourceMenu(prev => !prev)}
                  className="px-5 py-2.5 bg-white/10 border border-white/20 text-white text-xs font-bold uppercase tracking-widest rounded-lg flex items-center gap-2 hover:bg-white/20 transition-all"
                >
                  <Layers className="w-4 h-4" />
                  <span>Trocar Fonte ({sourceList.length})</span>
                </button>
                {showSourceMenu && (
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 bg-[#0F1117] border border-white/15 rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 text-left">
                    {sourceList.map((s, idx) => (
                      <button
                        key={s.id || idx}
                        type="button"
                        onClick={() => switchSource(idx)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                          activeSourceIndex === idx ? 'bg-[#E50914] text-white' : 'text-zinc-300 hover:bg-white/10'
                        }`}
                      >
                        <span className="truncate">{s.serverName || s.provider || `Fonte ${idx + 1}`}</span>
                        {activeSourceIndex === idx && <Check className="w-3.5 h-3.5 shrink-0 ml-2" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="px-5 py-2.5 bg-white/5 border border-white/10 text-zinc-300 text-xs font-bold uppercase tracking-widest rounded-lg flex items-center gap-2 hover:bg-white/10 hover:text-white transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* DIRECT VIDEO ELEMENT (MP4 / WebM / HLS / DASH) */}
      {!resolving && !hasError && resolvedData?.isDirect && (
        <video
          ref={videoRef}
          poster={poster}
          playsInline
          crossOrigin="anonymous"
          className="w-full h-full object-contain bg-black cursor-pointer"
          onClick={togglePlay}
          onTimeUpdate={() => {
            if (!videoRef.current) return;
            const cur = videoRef.current.currentTime || 0;
            const dur = videoRef.current.duration || 0;
            setCurrentTime(cur);
            setDuration(dur);
            if (Math.abs(cur - lastPersistedSecRef.current) >= 3) {
              lastPersistedSecRef.current = cur;
              writeStoredResume(resumeKey, cur, dur);
            }
            if (onProgress) {
              onProgress({
                currentTime: cur,
                duration: dur,
                progressPercent: dur > 0 ? (cur / dur) * 100 : 0
              });
            }
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => {
            setIsPlaying(false);
            if (resumeKey && typeof window !== 'undefined') {
              try {
                localStorage.removeItem(`${RESUME_PREFIX}${resumeKey}`);
              } catch {}
            }
            if (onEnded) onEnded();
          }}
          onError={() => {
            if (resolvedData.format !== 'm3u8' && resolvedData.format !== 'hls' && resolvedData.format !== 'dash' && resolvedData.format !== 'mpd') {
              handlePlaybackFailure(
                'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.',
                resolvedData.format,
                resolvedData.directUrl
              );
            }
          }}
        >
          {subtitles.map((track) => (
            <track
              key={`${track.lang}-${track.src}`}
              kind="subtitles"
              label={track.label}
              srcLang={track.lang}
              src={track.src}
              default={track.default}
            />
          ))}
        </video>
      )}

      {/* AUTHORIZED IFRAME / EMBED COMPONENT */}
      {!resolving && !hasError && !resolvedData?.isDirect && resolvedData?.embedUrl && (
        <div className="relative w-full h-full bg-black">
          {!iframeLoaded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 pointer-events-none">
              <RefreshCw className="w-8 h-8 text-[#E50914] animate-spin mb-2" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">
                A carregar player incorporado...
              </span>
            </div>
          )}
          <iframe
            key={resolvedData.embedUrl}
            src={resolvedData.embedUrl}
            className="w-full h-full border-none"
            allowFullScreen
            referrerPolicy="no-referrer-when-downgrade"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            title={title || 'RONYCINE CINEMA PRO'}
            onLoad={() => setIframeLoaded(true)}
            onError={() => {
              handlePlaybackFailure(
                'Não foi possível reproduzir este conteúdo. Tente novamente mais tarde.',
                'embed',
                resolvedData.embedUrl
              );
            }}
          />
        </div>
      )}

      {/* CUSTOM CONTROLS OVERLAY (pointer-events-none on wrapper so iframes remain interactive) */}
      {!resolving && !hasError && resolvedData && (
        <AnimatePresence>
          {(showControls || !resolvedData.isDirect) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className={`absolute inset-0 z-30 flex flex-col justify-between pointer-events-none ${
                resolvedData.isDirect
                  ? 'bg-gradient-to-t from-black/90 via-transparent to-black/70'
                  : 'bg-gradient-to-b from-black/75 via-transparent to-transparent'
              }`}
            >
              {/* TOP BAR */}
              <div className="p-4 sm:p-6 flex items-center justify-between gap-4 pointer-events-auto">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[#E50914] text-[10px] font-black uppercase tracking-[0.25em]">
                      RONYCINE CINEMA PRO
                    </span>
                    <span className="bg-white/10 text-zinc-200 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      {resolvedData.provider} ({resolvedData.format.toUpperCase()})
                    </span>
                  </div>
                  {title && (
                    <h2 className="text-white text-sm sm:text-lg font-bold uppercase tracking-tight font-display truncate">
                      {title}
                    </h2>
                  )}
                </div>

                {/* Source Switcher & Next Episode */}
                <div className="flex items-center gap-2 shrink-0">
                  {hasNextEpisode && onNextEpisode && (
                    <button
                      type="button"
                      onClick={onNextEpisode}
                      className="px-3.5 py-2 rounded-lg bg-[#E50914] hover:bg-red-700 text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all"
                    >
                      <span>Próximo Episódio</span>
                      <SkipForward className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {sourceList.length > 1 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setShowSourceMenu(!showSourceMenu);
                          setShowQualityMenu(false);
                          setShowSubtitleMenu(false);
                          setShowSpeedMenu(false);
                        }}
                        className="px-3.5 py-2 rounded-lg bg-black/75 border border-white/20 hover:border-[#E50914] text-white text-[11px] font-bold uppercase tracking-wider flex items-center gap-2 backdrop-blur-md transition-all"
                      >
                        <Layers className="w-3.5 h-3.5 text-[#E50914]" />
                        <span>Fonte ({activeSourceIndex + 1}/{sourceList.length})</span>
                        <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                      </button>

                      {showSourceMenu && (
                        <div className="absolute right-0 mt-2 w-64 bg-[#0F1117] border border-white/15 rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1">
                          <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-500 border-b border-white/10 mb-1">
                            Fontes Disponíveis
                          </div>
                          {sourceList.map((s, idx) => (
                            <button
                              key={s.id || idx}
                              type="button"
                              onClick={() => switchSource(idx)}
                              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs font-bold transition-all ${
                                activeSourceIndex === idx
                                  ? 'bg-[#E50914] text-white'
                                  : 'text-zinc-300 hover:bg-white/10'
                              }`}
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="uppercase font-mono truncate">
                                  {s.serverName || s.provider || `Fonte ${idx + 1}`}
                                </span>
                                <span className="text-[9px] opacity-75 truncate">
                                  {s.audioLanguage || 'Português'}
                                  {s.quality ? ` • ${s.quality}` : ''}
                                  {s.isPrimary ? ' • Principal' : ''}
                                </span>
                              </div>
                              {activeSourceIndex === idx && <Check className="w-4 h-4 shrink-0 ml-2" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* CENTER PLAY/PAUSE (Direct Video Mode Only) */}
              {resolvedData.isDirect && (
                <div className="flex items-center justify-center gap-8 sm:gap-10 pointer-events-auto">
                  <button
                    type="button"
                    onClick={() => seek(-10)}
                    className="text-white/75 hover:text-white transition-all hover:scale-110 active:scale-95"
                    title="Voltar 10s"
                  >
                    <RotateCcw className="w-8 h-8 sm:w-10 sm:h-10" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#E50914] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-[#E50914]/40"
                  >
                    {isPlaying ? (
                      <Pause className="w-8 h-8 sm:w-10 sm:h-10 fill-white" />
                    ) : (
                      <Play className="w-8 h-8 sm:w-10 sm:h-10 fill-white ml-1" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => seek(10)}
                    className="text-white/75 hover:text-white transition-all hover:scale-110 active:scale-95"
                    title="Avançar 10s"
                  >
                    <RotateCw className="w-8 h-8 sm:w-10 sm:h-10" />
                  </button>
                </div>
              )}

              {/* BOTTOM CONTROLS BAR (Direct Video Mode Only) */}
              {resolvedData.isDirect ? (
                <div className="p-4 sm:p-6 space-y-3 pointer-events-auto">
                  <div className="relative group/slider h-2 flex items-center">
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      value={currentTime}
                      onChange={handleSeekChange}
                      className="w-full h-1.5 bg-white/20 appearance-none rounded-full cursor-pointer accent-[#E50914] outline-none transition-all hover:h-2"
                      style={{
                        background: `linear-gradient(to right, #E50914 ${duration > 0 ? (currentTime / duration) * 100 : 0}%, rgba(255,255,255,0.2) ${duration > 0 ? (currentTime / duration) * 100 : 0}%)`
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 sm:gap-5">
                      <button
                        type="button"
                        onClick={togglePlay}
                        className="text-white hover:text-[#E50914] transition-all hover:scale-110"
                      >
                        {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
                      </button>

                      <div className="flex items-center gap-2 group/vol">
                        <button type="button" onClick={toggleMute} className="text-white hover:text-[#E50914] transition-all">
                          {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMuted ? 0 : volume}
                          onChange={handleVolumeChange}
                          className="w-14 sm:w-20 h-1.5 bg-white/20 appearance-none rounded-full cursor-pointer accent-[#E50914] outline-none"
                        />
                      </div>

                      <div className="text-[11px] sm:text-xs font-bold text-white font-mono tabular-nums">
                        {formatTime(currentTime)} <span className="mx-1 text-zinc-500">/</span> {formatTime(duration)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3">
                      {/* SUBTITLES SELECTOR (when tracks available) */}
                      {subtitleTracks.length > 0 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setShowSubtitleMenu(!showSubtitleMenu);
                              setShowQualityMenu(false);
                              setShowSpeedMenu(false);
                              setShowSourceMenu(false);
                            }}
                            className={`p-1.5 rounded transition-all ${
                              selectedSubtitle >= 0 ? 'bg-[#E50914] text-white' : 'bg-white/10 hover:bg-white/20 text-white'
                            }`}
                            title="Legendas"
                          >
                            <Subtitles className="w-4 h-4" />
                          </button>
                          {showSubtitleMenu && (
                            <div className="absolute right-0 bottom-full mb-2 bg-[#0F1117] border border-white/15 rounded-lg p-1.5 z-50 flex flex-col gap-1 w-40">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedSubtitle(-1);
                                  setShowSubtitleMenu(false);
                                }}
                                className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold flex items-center justify-between ${
                                  selectedSubtitle === -1 ? 'bg-[#E50914] text-white' : 'text-zinc-300 hover:bg-white/10'
                                }`}
                              >
                                <span>Desativadas</span>
                                {selectedSubtitle === -1 && <Check className="w-3.5 h-3.5" />}
                              </button>
                              {subtitleTracks.map(track => (
                                <button
                                  key={track.index}
                                  type="button"
                                  onClick={() => {
                                    setSelectedSubtitle(track.index);
                                    setShowSubtitleMenu(false);
                                  }}
                                  className={`w-full text-left px-3 py-1.5 rounded text-xs font-bold flex items-center justify-between ${
                                    selectedSubtitle === track.index ? 'bg-[#E50914] text-white' : 'text-zinc-300 hover:bg-white/10'
                                  }`}
                                >
                                  <span className="truncate">{track.label}</span>
                                  {selectedSubtitle === track.index && <Check className="w-3.5 h-3.5" />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* QUALITY SELECTOR (when adaptive HLS/DASH levels available) */}
                      {qualityLevels.length > 0 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setShowQualityMenu(!showQualityMenu);
                              setShowSubtitleMenu(false);
                              setShowSpeedMenu(false);
                              setShowSourceMenu(false);
                            }}
                            className="text-xs font-bold font-mono px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-all flex items-center gap-1"
                            title="Qualidade"
                          >
                            <Settings className="w-3.5 h-3.5 text-[#E50914]" />
                            <span className="hidden sm:inline">
                              {selectedQuality === -1
                                ? 'Auto'
                                : qualityLevels.find(q => q.index === selectedQuality)?.label || 'Auto'}
                            </span>
                          </button>
                          {showQualityMenu && (
                            <div className="absolute right-0 bottom-full mb-2 bg-[#0F1117] border border-white/15 rounded-lg p-1.5 z-50 flex flex-col gap-1 w-32">
                              <button
                                type="button"
                                onClick={() => changeQuality(-1)}
                                className={`w-full text-left px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center justify-between ${
                                  selectedQuality === -1 ? 'bg-[#E50914] text-white' : 'text-zinc-400 hover:bg-white/10'
                                }`}
                              >
                                <span>Auto</span>
                                {selectedQuality === -1 && <Check className="w-3.5 h-3.5" />}
                              </button>
                              {qualityLevels.map(lvl => (
                                <button
                                  key={lvl.index}
                                  type="button"
                                  onClick={() => changeQuality(lvl.index)}
                                  className={`w-full text-left px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center justify-between ${
                                    selectedQuality === lvl.index ? 'bg-[#E50914] text-white' : 'text-zinc-400 hover:bg-white/10'
                                  }`}
                                >
                                  <span>{lvl.label}</span>
                                  {selectedQuality === lvl.index && <Check className="w-3.5 h-3.5" />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* SPEED SELECTOR */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowSpeedMenu(!showSpeedMenu);
                            setShowQualityMenu(false);
                            setShowSubtitleMenu(false);
                            setShowSourceMenu(false);
                          }}
                          className="text-xs font-bold font-mono px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white transition-all"
                        >
                          {playbackSpeed}x
                        </button>
                        {showSpeedMenu && (
                          <div className="absolute right-0 bottom-full mb-2 bg-[#0F1117] border border-white/15 rounded-lg p-1.5 z-50 flex flex-col gap-1 w-28">
                            {[0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                              <button
                                key={speed}
                                type="button"
                                onClick={() => changePlaybackSpeed(speed)}
                                className={`w-full text-left px-3 py-1.5 rounded text-xs font-mono font-bold flex items-center justify-between ${
                                  playbackSpeed === speed ? 'bg-[#E50914] text-white' : 'text-zinc-400 hover:bg-white/10'
                                }`}
                              >
                                <span>{speed}x</span>
                                {playbackSpeed === speed && <Check className="w-3.5 h-3.5" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* CINEMA MODE */}
                      <button
                        type="button"
                        onClick={handleCinemaToggle}
                        className={`p-1.5 rounded transition-all ${
                          effectiveCinemaMode ? 'text-[#E50914] bg-white/10' : 'text-white hover:text-[#E50914]'
                        }`}
                        title="Modo Cinema"
                      >
                        <RectangleHorizontal className="w-5 h-5" />
                      </button>

                      {/* FULLSCREEN */}
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="text-white hover:text-[#E50914] transition-all hover:scale-110"
                        title="Ecrã Inteiro"
                      >
                        <Maximize className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};
