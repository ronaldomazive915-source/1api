import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Minimize,
  Check,
  AlertTriangle,
  RefreshCw,
  Layers,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  SkipForward,
  Settings,
  Subtitles,
  RectangleHorizontal,
  History,
  Maximize2,
  AudioLines,
  Download,
  Share2,
  Copy,
  SlidersHorizontal,
  Link2,
  Plus,
  Minus,
  ShieldAlert,
  FileVideo,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../lib/api.js';
import { classifySourceUrl } from '../../lib/sourceClassification.js';
import { PlaybackVersionAvailability, SourceDiagnostics, SourceKind } from '../../types.js';
import {
  SubtitleCue,
  SubtitlePrefsState,
  SubtitleFontSize,
  SubtitleColor,
  SubtitleBgOpacity,
  readAudioVersionPref,
  writeAudioVersionPref,
  readSubtitlePrefs,
  writeSubtitlePrefs,
  parseSubtitleTextToCues,
  getActiveSubtitleText,
  formatSourceVersionBadge,
  inferSourceVersionType,
  inspectDownloadCompatibility,
  buildDownloadManagerUrls
} from '../../lib/playerEnhancements.js';
import {
  isHtmlOrUnsupportedSource,
  isSourcePlayableCandidate,
  pickPreferredSourceIndex,
  isSourceDublado,
  isSourceLegendado,
  findSourceForVersion,
  loadAudioPreference,
  saveAudioPreference
} from '../../lib/sourceMetadata.js';
import { heightToQualityLabel } from '../../lib/videoQualityUtils.js';

export interface VideoSourceItem {
  id?: string;
  serverName?: string;
  provider?: string;
  label?: string;
  url: string;
  originalUrl?: string;
  externalPageUrl?: string;
  verificationLabel?: string;
  sourceKind?: SourceKind;
  format?: string;
  type?: string;
  audioLanguage?: string;
  subtitleLanguage?: string;
  versionType?: string;
  subtitleUrl?: string;
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

interface UnifiedSubtitleTrack {
  key: string;
  label: string;
  lang: string;
  origin: 'source' | 'prop' | 'user' | 'embedded';
  src?: string;
  embeddedIndex?: number;
}

interface AudioOption {
  index: number;
  label: string;
  lang?: string;
}

export type FrameSizeMode =
  | 'default'
  | 'original'
  | '16:9'
  | '4:3'
  | '21:9'
  | '9:16'
  | '1:1'
  | 'fit'
  | 'fullscreen';

export const FRAME_SIZE_OPTIONS: Array<{ id: FrameSizeMode; label: string; hint: string }> = [
  { id: 'default', label: 'Padrão', hint: 'Cinema responsivo' },
  { id: 'original', label: 'Original', hint: 'Proporção nativa' },
  { id: '16:9', label: '16:9', hint: 'Widescreen HD' },
  { id: '4:3', label: '4:3', hint: 'Clássico' },
  { id: '21:9', label: '21:9', hint: 'Ultrawide Cinema' },
  { id: '9:16', label: '9:16', hint: 'Vertical Mobile' },
  { id: '1:1', label: '1:1', hint: 'Quadrado' },
  { id: 'fit', label: 'Ajustar à Tela', hint: 'Sem cortes' },
  { id: 'fullscreen', label: 'Completo (Ecrã Inteiro)', hint: 'Ecrã inteiro' }
];

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
  initialPositionCompleted?: boolean;
  subtitles?: SubtitleTrackItem[];
  isCinemaMode?: boolean;
  onToggleCinemaMode?: () => void;
  onProgress?: (data: {
    currentTime: number;
    duration: number;
    progressPercent: number;
    completed?: boolean;
    flush?: boolean;
  }) => void;
  onRestartProgress?: () => void;
  onEnded?: () => void;
  onPlaybackEvent?: (status: 'STARTED' | 'ERROR', message?: string, sourceType?: string, sourceUrl?: string) => void;
  versionAvailability?: PlaybackVersionAvailability;
}

interface ResolvedPlaybackState {
  isDirect: boolean;
  directUrl?: string;
  embedUrl: string;
  externalPageUrl?: string;
  verificationLabel?: string;
  provider: string;
  format: string;
  sourceKind?: SourceKind;
  fallbackToIframe?: boolean;
  note?: string;
}

const RESUME_PREFIX = 'ronycine_resume_';
const FRAME_SIZE_STORAGE_KEY = 'ronycine_frame_size';

function readStoredFrameSize(): FrameSizeMode {
  if (typeof window === 'undefined') return 'default';
  try {
    const val = localStorage.getItem(FRAME_SIZE_STORAGE_KEY) as FrameSizeMode | null;
    if (val && FRAME_SIZE_OPTIONS.some(o => o.id === val)) return val;
  } catch {}
  return 'default';
}

function writeStoredFrameSize(mode: FrameSizeMode) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(FRAME_SIZE_STORAGE_KEY, mode);
  } catch {}
}

interface StoredResumeEntry {
  time: number;
  duration: number;
  completed: boolean;
}

function readStoredResumeEntry(resumeKey?: string): StoredResumeEntry {
  if (!resumeKey || typeof window === 'undefined') {
    return { time: 0, duration: 0, completed: false };
  }
  try {
    const raw = localStorage.getItem(`${RESUME_PREFIX}${resumeKey}`);
    if (!raw) return { time: 0, duration: 0, completed: false };
    const parsed = JSON.parse(raw);
    const time = Number(parsed?.time || 0);
    const dur = Number(parsed?.duration || 0);
    const isCompleted =
      Boolean(parsed?.completed) || (dur > 60 && time >= dur * 0.93) || (dur > 0 && time >= dur * 0.95);
    if (isCompleted) {
      return { time: 0, duration: dur, completed: true };
    }
    if (time >= 10) {
      return { time, duration: dur, completed: false };
    }
    return { time: 0, duration: dur, completed: false };
  } catch {
    return { time: 0, duration: 0, completed: false };
  }
}

function writeStoredResume(
  resumeKey: string | undefined,
  time: number,
  duration: number,
  markCompleted = false
) {
  if (!resumeKey || typeof window === 'undefined') return;
  try {
    const isCompleted =
      markCompleted || (duration > 60 && time >= duration * 0.93) || (duration > 0 && time >= duration * 0.95);
    if (isCompleted) {
      localStorage.setItem(
        `${RESUME_PREFIX}${resumeKey}`,
        JSON.stringify({
          time: Math.floor(time || duration || 0),
          duration: Math.floor(duration || 0),
          completed: true,
          updatedAt: Date.now()
        })
      );
      return;
    }
    if (time >= 10) {
      localStorage.setItem(
        `${RESUME_PREFIX}${resumeKey}`,
        JSON.stringify({
          time: Math.floor(time),
          duration: Math.floor(duration || 0),
          completed: false,
          updatedAt: Date.now()
        })
      );
    }
  } catch {}
}

function clearStoredResume(resumeKey?: string) {
  if (!resumeKey || typeof window === 'undefined') return;
  try {
    localStorage.removeItem(`${RESUME_PREFIX}${resumeKey}`);
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
  const msg = (rawError || '').trim();
  if (msg) return msg;
  if (status === 'embed_blocked') {
    return 'Esta página não permite incorporação externa (X-Frame-Options / CSP). Abra a página original no fornecedor ou ative o Prefixo MGEB.';
  }
  if (status === 'unsupported_format') {
    return 'A fonte devolveu uma página web informativa e não um fluxo de vídeo direto compatível.';
  }
  return 'Não foi possível reproduzir esta fonte. Tente outra fonte ou ative o Prefixo MGEB.';
}

function isLikelyMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const uaMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return coarse || uaMobile;
}

function getFullscreenElementCompat(): Element | null {
  if (typeof document === 'undefined') return null;
  const docAny = document as any;
  return document.fullscreenElement || docAny.webkitFullscreenElement || docAny.mozFullScreenElement || null;
}

type SettingsSubmenu = 'root' | 'frame' | 'quality' | 'speed' | 'subtitles' | 'audio' | 'sources';

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
  initialPositionCompleted,
  subtitles = [],
  isCinemaMode,
  onToggleCinemaMode,
  onProgress,
  onRestartProgress,
  onEnded,
  onPlaybackEvent,
  versionAvailability
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const dashRef = useRef<dashjsType.MediaPlayerClass | null>(null);

  const subtitlesKey = useMemo(
    () => (subtitles || []).map(s => `${s.lang}:${s.src}:${s.label}:${Boolean(s.default)}`).join('|'),
    [subtitles]
  );
  const subtitlesRef = useRef<SubtitleTrackItem[]>(subtitles);
  subtitlesRef.current = subtitles;

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
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [phaseLabel, setPhaseLabel] = useState<string>('A preparar reprodução...');
  const [realLoadProgress, setRealLoadProgress] = useState<number | null>(null);
  const [bufferedPercent, setBufferedPercent] = useState<number>(0);
  const [longLoadingStalled, setLongLoadingStalled] = useState<boolean>(false);
  const [resolvedData, setResolvedData] = useState<ResolvedPlaybackState | null>(null);
  const [useCors, setUseCors] = useState<boolean>(() => subtitles.length > 0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [hasError, setHasError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [iframeLoaded, setIframeLoaded] = useState<boolean>(false);

  // Pro Features state: Frame size, Cinema, Quality, Subtitles, Audio, Resume
  const [frameSize, setFrameSize] = useState<FrameSizeMode>(() => readStoredFrameSize());
  const [internalCinemaMode, setInternalCinemaMode] = useState<boolean>(false);
  const effectiveCinemaMode = isCinemaMode !== undefined ? isCinemaMode : internalCinemaMode;
  const [qualityLevels, setQualityLevels] = useState<QualityOption[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<number>(-1);
  const [embeddedSubtitleTracks, setEmbeddedSubtitleTracks] = useState<Array<{ index: number; label: string; lang: string }>>([]);
  const [userSubtitles, setUserSubtitles] = useState<Array<{ key: string; label: string; lang: string; src: string }>>([]);
  const [parsedCuesByKey, setParsedCuesByKey] = useState<Record<string, SubtitleCue[]>>({});
  const [selectedSubKey, setSelectedSubKey] = useState<string | null>(null);
  const [subPrefs, setSubPrefs] = useState<SubtitlePrefsState>(() => readSubtitlePrefs());
  // Version state & persistent audio preference
  const [versionNotice, setVersionNotice] = useState<{ message: string; id: number } | null>(null);
  const [persistedVersion, setPersistedVersion] = useState<'dublado' | 'legendado'>(() => {
    const pref = readAudioVersionPref();
    const prefMetadata = loadAudioPreference();
    const v = (pref?.versionType || prefMetadata?.versionType || '').toLowerCase();
    if (v === 'legendado') return 'legendado';
    return 'dublado';
  });
  const [audioTracks, setAudioTracks] = useState<AudioOption[]>([]);
  const [selectedAudio, setSelectedAudio] = useState<number>(0);
  const [resumePromptSec, setResumePromptSec] = useState<number>(0);
  const [detectedVideoQuality, setDetectedVideoQuality] = useState<string>('');

  // Menus, controls, tap pulse & HUD feedback
  const [showControls, setShowControls] = useState<boolean>(true);
  const [showSettingsMenu, setShowSettingsMenu] = useState<boolean>(false);
  const [settingsSubmenu, setSettingsSubmenu] = useState<SettingsSubmenu>('root');
  const [showSourceMenu, setShowSourceMenu] = useState<boolean>(false);
  const [showAudioSubPanel, setShowAudioSubPanel] = useState<boolean>(false);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const [tapPulse, setTapPulse] = useState<{ x: number; y: number; id: number } | null>(null);
  const [hudNotice, setHudNotice] = useState<{ text: string; id: number } | null>(null);
  const [showDownloadMenu, setShowDownloadMenu] = useState<boolean>(false);
  const [downloadFeedbackMsg, setDownloadFeedbackMsg] = useState<string | null>(null);

  const updateSubPrefs = useCallback((updater: (prev: SubtitlePrefsState) => SubtitlePrefsState) => {
    setSubPrefs(prev => {
      const next = updater(prev);
      writeSubtitlePrefs(next);
      return next;
    });
  }, []);

  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hudTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTouchTimestampRef = useRef<number>(0);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const orientationLockedRef = useRef<boolean>(false);
  const orientationLockInFlightRef = useRef<Promise<void> | null>(null);
  const wasPlayingBeforeFsRef = useRef<boolean>(false);
  const wasPlayingBeforeSwitchRef = useRef<boolean>(autoplay);
  const lastSavedTimeRef = useRef<number>(0);
  const lastPersistedSecRef = useRef<number>(0);
  const prevListIdentityRef = useRef<string>(listIdentity);
  const failedIndicesRef = useRef<Set<number>>(new Set());
  const startedReportedRef = useRef<boolean>(false);
  const isSwitchingSourceRef = useRef<boolean>(false);
  const pendingSourceSwitchSeekRef = useRef<number | null>(null);
  const pendingResumeSeekRef = useRef<number | null>(null);
  const verifyResumeSeekRef = useRef<number | null>(null);
  const resumeDecisionRef = useRef<'none' | 'pending' | 'continued' | 'restarted' | 'dismissed'>('none');
  const evaluatedResumeKeyRef = useRef<string | null>(null);
  const evaluatedInitialPosRef = useRef<number>(0);
  const resumeKeyRef = useRef<string | undefined>(resumeKey);
  resumeKeyRef.current = resumeKey;

  const onPlaybackEventRef = useRef(onPlaybackEvent);
  onPlaybackEventRef.current = onPlaybackEvent;
  const onSelectAlternativeSourceRef = useRef(onSelectAlternativeSource);
  onSelectAlternativeSourceRef.current = onSelectAlternativeSource;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const onRestartProgressRef = useRef(onRestartProgress);
  onRestartProgressRef.current = onRestartProgress;

  const activeSource = sourceList[activeSourceIndex] || sourceList[0];
  const activeUrl = activeSource?.originalUrl || activeSource?.url || '';
  const activeDeclaredFormat = normalizeMimeToFormat(
    activeSource?.format || activeSource?.type,
    activeUrl
  );

  const showHud = useCallback((text: string) => {
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    setHudNotice({ text, id: Date.now() });
    hudTimeoutRef.current = setTimeout(() => setHudNotice(null), 2000);
  }, []);

  const versionNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showVersionNotice = useCallback((message: string) => {
    if (versionNoticeTimeoutRef.current) clearTimeout(versionNoticeTimeoutRef.current);
    const id = Date.now();
    setVersionNotice({ message, id });
    versionNoticeTimeoutRef.current = setTimeout(() => {
      setVersionNotice(curr => (curr?.id === id ? null : curr));
    }, 3500);
  }, []);

  const downloadInfo = useMemo(
    () => inspectDownloadCompatibility(activeSource, resolvedData, title),
    [activeSource, resolvedData, title]
  );

  const handleCopyDownloadLink = useCallback(() => {
    const linkToCopy = downloadInfo.directUrl;
    if (!downloadInfo.supported || !linkToCopy) {
      setDownloadFeedbackMsg('Esta fonte não suporta download direto.');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(linkToCopy).then(() => {
        showHud('Link de download copiado!');
        setDownloadFeedbackMsg('Link copiado para a área de transferência.');
      }).catch(() => {
        setDownloadFeedbackMsg('Não foi possível copiar automaticamente neste navegador.');
      });
    }
  }, [downloadInfo, showHud]);

  const handleDirectDownload = useCallback(() => {
    if (!downloadInfo.supported || !downloadInfo.directUrl || downloadInfo.mode !== 'direct_file') {
      setDownloadFeedbackMsg(downloadInfo.compatibilityText);
      return;
    }
    const a = document.createElement('a');
    a.href = downloadInfo.directUrl;
    a.download = downloadInfo.suggestedFilename;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showHud(`A iniciar download (${downloadInfo.suggestedFilename})...`);
    setShowDownloadMenu(false);
  }, [downloadInfo, showHud]);

  const handleExternalManagerIntent = useCallback((manager: '1dm' | 'adm') => {
    if (!downloadInfo.supported || !downloadInfo.directUrl) {
      setDownloadFeedbackMsg('Esta fonte não suporta download direto.');
      return;
    }
    const { oneDmIntent, admIntent, isAndroid } = buildDownloadManagerUrls(downloadInfo.directUrl);
    const label = manager === '1dm' ? '1DM' : 'ADM';

    if (!isAndroid) {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(downloadInfo.directUrl).catch(() => {});
      }
      setDownloadFeedbackMsg(
        `Integração direta ${label} destina-se a Android. Link copiado para colar manualmente no seu gestor.`
      );
      showHud(`Link copiado para colar no ${label}`);
      return;
    }

    const intentUrl = manager === '1dm' ? oneDmIntent : admIntent;
    showHud(`A abrir no ${label}...`);
    setDownloadFeedbackMsg(`A enviar stream para ${label}. Certifique-se de que a app está instalada.`);
    try {
      window.location.href = intentUrl;
    } catch {
      setDownloadFeedbackMsg(`Não foi possível abrir o ${label}. Utilize "Copiar Link".`);
    }
  }, [downloadInfo, showHud]);

  const handleShareDownload = useCallback(async () => {
    if (!downloadInfo.supported || !downloadInfo.directUrl) {
      setDownloadFeedbackMsg('Esta fonte não suporta download direto.');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: title || 'Ronycine Vídeo',
          text: `${title || 'Vídeo'} (${downloadInfo.formatLabel})`,
          url: downloadInfo.directUrl
        });
        showHud('Link partilhado com sucesso!');
        setShowDownloadMenu(false);
        return;
      } catch {}
    }
    handleCopyDownloadLink();
  }, [downloadInfo, title, showHud, handleCopyDownloadLink]);

  // Unified subtitle tracks list (active source subtitle + props + user-added external + embedded HLS/DASH)
  const allSubtitleTracks: UnifiedSubtitleTrack[] = useMemo(() => {
    const items: UnifiedSubtitleTrack[] = [];
    const seenSrc = new Set<string>();

    if (activeSource?.subtitleUrl?.trim()) {
      const sUrl = activeSource.subtitleUrl.trim();
      seenSrc.add(sUrl);
      items.push({
        key: `source:${sUrl}`,
        label: activeSource.subtitleLanguage?.trim()
          ? `${activeSource.subtitleLanguage.trim()} (Fonte)`
          : 'Legenda da Fonte',
        lang: activeSource.subtitleLanguage?.trim() || 'pt',
        origin: 'source',
        src: sUrl
      });
    }

    (subtitles || []).forEach((s, idx) => {
      if (!s.src || seenSrc.has(s.src)) return;
      seenSrc.add(s.src);
      items.push({
        key: `prop:${idx}:${s.src}`,
        label: s.label || s.lang || `Legenda ${idx + 1}`,
        lang: s.lang || 'pt',
        origin: 'prop',
        src: s.src
      });
    });

    userSubtitles.forEach((u) => {
      if (!u.src || seenSrc.has(u.src)) return;
      seenSrc.add(u.src);
      items.push({
        key: u.key,
        label: u.label,
        lang: u.lang,
        origin: 'user',
        src: u.src
      });
    });

    embeddedSubtitleTracks.forEach((e) => {
      items.push({
        key: `emb:${e.index}`,
        label: e.label,
        lang: e.lang || 'sub',
        origin: 'embedded',
        embeddedIndex: e.index
      });
    });

    return items;
  }, [activeSource?.subtitleUrl, activeSource?.subtitleLanguage, subtitles, userSubtitles, embeddedSubtitleTracks]);

  const fetchAndParseSubtitle = useCallback(async (trackKey: string, url: string): Promise<SubtitleCue[]> => {
    const isExternalHttp = /^https?:\/\//i.test(url);
    let rawText = '';

    if (isExternalHttp) {
      try {
        rawText = await api.fetchExternalSubtitle(url);
      } catch {
        const directRes = await fetch(url);
        if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
        rawText = await directRes.text();
      }
    } else {
      const directRes = await fetch(url);
      if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
      rawText = await directRes.text();
    }

    const cues = parseSubtitleTextToCues(rawText);
    if (cues.length === 0) {
      throw new Error('O ficheiro não contém legendas .srt ou .vtt válidas.');
    }
    setParsedCuesByKey(prev => ({ ...prev, [trackKey]: cues }));
    return cues;
  }, []);

  const handleSelectSubtitleKey = useCallback(async (track: UnifiedSubtitleTrack | null) => {
    if (!track) {
      setSelectedSubKey(null);
      updateSubPrefs(prev => ({ ...prev, enabled: false, preferredLang: '__off__' }));
      showHud('Legendas desativadas');
      return;
    }

    if (track.origin !== 'embedded' && track.src && !parsedCuesByKey[track.key]) {
      try {
        await fetchAndParseSubtitle(track.key, track.src);
      } catch {
        showHud('Não foi possível carregar as legendas desta faixa.');
        return;
      }
    }

    setSelectedSubKey(track.key);
    updateSubPrefs(prev => ({
      ...prev,
      enabled: true,
      preferredLang: track.lang || (prev.preferredLang === '__off__' ? '' : prev.preferredLang)
    }));
    showHud(`Legendas: ${track.label}`);
  }, [parsedCuesByKey, fetchAndParseSubtitle, updateSubPrefs, showHud]);

  // Orientation management (Android/Mobile Fullscreen Landscape + Safe Deduplicated Lock/Unlock)
  const lockLandscapeOrientation = useCallback(async () => {
    if (typeof window === 'undefined' || !isLikelyMobileDevice()) return;
    if (orientationLockedRef.current) return;
    if (orientationLockInFlightRef.current) return orientationLockInFlightRef.current;

    const orientationAny = window.screen?.orientation as any;
    if (!orientationAny || typeof orientationAny.lock !== 'function') {
      if (window.innerHeight > window.innerWidth) {
        showHud('Rotação automática indisponível neste navegador — rode manualmente');
      }
      return;
    }

    const task = (async () => {
      try {
        await orientationAny.lock('landscape');
        orientationLockedRef.current = true;
      } catch {
        try {
          await orientationAny.lock('landscape-primary');
          orientationLockedRef.current = true;
        } catch {
          if (window.innerHeight > window.innerWidth) {
            showHud('Rotação automática bloqueada — rode manualmente');
          }
        }
      } finally {
        orientationLockInFlightRef.current = null;
      }
    })();

    orientationLockInFlightRef.current = task;
    return task;
  }, [showHud]);

  const unlockOrientation = useCallback(() => {
    if (typeof window === 'undefined') return;
    orientationLockInFlightRef.current = null;
    if (!orientationLockedRef.current) return;
    try {
      const orientationAny = window.screen?.orientation as any;
      if (orientationAny && typeof orientationAny.unlock === 'function') {
        orientationAny.unlock();
      }
    } catch {}
    orientationLockedRef.current = false;
  }, []);

  const handlePlaybackFailure = useCallback(
    (message: string, failedFormat?: string, failedUrl?: string) => {
      onPlaybackEventRef.current?.('ERROR', message, failedFormat, failedUrl);
      failedIndicesRef.current.add(activeSourceIndex);

      const nextFallbackIdx = sourceList.findIndex(
        (s, idx) =>
          idx !== activeSourceIndex &&
          !failedIndicesRef.current.has(idx) &&
          s.enabled !== false &&
          String(s.status || '').toLowerCase() !== 'offline' &&
          String(s.status || '').toLowerCase() !== 'inactive' &&
          !isHtmlOrUnsupportedSource(s)
      );

      if (nextFallbackIdx >= 0) {
        const livePos = videoRef.current?.currentTime || lastSavedTimeRef.current || 0;
        if (livePos > 0) {
          lastSavedTimeRef.current = livePos;
          pendingSourceSwitchSeekRef.current = livePos;
        }
        wasPlayingBeforeSwitchRef.current = videoRef.current ? !videoRef.current.paused : autoplay;
        isSwitchingSourceRef.current = true;
        setIsBuffering(true);
        setLongLoadingStalled(false);
        setHasError(false);
        setActiveSourceIndex(nextFallbackIdx);
        showHud('Fonte atual indisponível — a trocar para alternativa...');
        if (onSelectAlternativeSourceRef.current && sourceList[nextFallbackIdx]) {
          onSelectAlternativeSourceRef.current(sourceList[nextFallbackIdx]);
        }
        return;
      }

      setIsBuffering(false);
      setLongLoadingStalled(false);
      setResolvedData(null);
      setHasError(true);
      setErrorMessage(message || 'Esta fonte está indisponível. Escolha outra fonte ou tente novamente.');
    },
    [activeSourceIndex, sourceList, autoplay, showHud]
  );

  const formatTime = (sec: number) => {
    if (isNaN(sec) || sec < 0) return '00:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Sync fullscreen status listener (handles ESC, back button, Android gesture exit)
  useEffect(() => {
    const onFsChange = () => {
      const active = Boolean(getFullscreenElementCompat());
      setIsFullscreen(active);
      if (active) {
        lockLandscapeOrientation();
      } else {
        unlockOrientation();
      }
      // Position & playback safeguard across fullscreen/orientation transitions
      const v = videoRef.current;
      if (v) {
        if (lastSavedTimeRef.current > 2 && v.currentTime < 1) {
          try {
            v.currentTime = lastSavedTimeRef.current;
          } catch {}
        }
        if (wasPlayingBeforeFsRef.current && v.paused) {
          v.play().catch(() => {});
        }
      }
    };
    const onVideoEndFs = () => {
      setIsFullscreen(false);
      unlockOrientation();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    const vidEl = videoRef.current;
    vidEl?.addEventListener('webkitendfullscreen', onVideoEndFs as any);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      vidEl?.removeEventListener('webkitendfullscreen', onVideoEndFs as any);
    };
  }, [lockLandscapeOrientation, unlockOrientation]);

  // Apply any queued user-confirmed resume seek or mid-playback source-switch seek once metadata is ready
  const applyPendingResumeSeek = useCallback(() => {
    const video = videoRef.current;
    const requestedTarget =
      pendingResumeSeekRef.current !== null && pendingResumeSeekRef.current > 0
        ? pendingResumeSeekRef.current
        : pendingSourceSwitchSeekRef.current !== null && pendingSourceSwitchSeekRef.current > 0
          ? pendingSourceSwitchSeekRef.current
          : null;

    if (requestedTarget === null || !video) return false;
    if (video.readyState < 1 && !dashRef.current) return false;

    const vidDur = video.duration;
    const safeTarget =
      vidDur && isFinite(vidDur) && vidDur > 5
        ? Math.min(requestedTarget, Math.max(0, vidDur - 1.5))
        : requestedTarget;

    try {
      if (dashRef.current) {
        (dashRef.current as any).seek(safeTarget);
      }
      video.currentTime = safeTarget;
    } catch {}

    lastSavedTimeRef.current = safeTarget;
    lastPersistedSecRef.current = safeTarget;
    setCurrentTime(safeTarget);

    if (pendingResumeSeekRef.current !== null) {
      verifyResumeSeekRef.current = safeTarget;
      pendingResumeSeekRef.current = null;
      if (video.paused) {
        setAutoplayBlocked(false);
        video.play().catch((err: any) => {
          if (err?.name === 'NotAllowedError') setAutoplayBlocked(true);
        });
      }
    }
    pendingSourceSwitchSeekRef.current = null;
    return true;
  }, []);

  const flushProgressNow = useCallback((forceBackend = false, markCompleted = false) => {
    const video = videoRef.current;
    const key = resumeKeyRef.current;
    const cur = video?.currentTime ?? lastSavedTimeRef.current ?? 0;
    const dur = (video?.duration && isFinite(video.duration) ? video.duration : duration) || 0;

    if (resumeDecisionRef.current === 'pending' && !markCompleted && cur < 15) {
      return;
    }
    if (!markCompleted && cur < 10) return;

    const isCompleted = markCompleted || (dur > 60 && cur >= dur * 0.93);
    lastSavedTimeRef.current = cur;
    lastPersistedSecRef.current = cur;
    writeStoredResume(key, cur, dur, isCompleted);

    if (onProgressRef.current) {
      onProgressRef.current({
        currentTime: isCompleted ? dur || cur : cur,
        duration: dur,
        progressPercent: isCompleted ? 100 : dur > 0 ? Math.min(100, (cur / dur) * 100) : 0,
        completed: isCompleted,
        flush: forceBackend
      });
    }
  }, [duration]);

  // Seed resume notification ONCE per content/episode (never auto-seek without user confirmation)
  useEffect(() => {
    const contentChanged = prevListIdentityRef.current !== listIdentity;
    const resumeKeyChanged = evaluatedResumeKeyRef.current !== (resumeKey || null);

    if (contentChanged) {
      prevListIdentityRef.current = listIdentity;
      unlockOrientation();
      failedIndicesRef.current.clear();
      wasPlayingBeforeSwitchRef.current = autoplay;
      const currentPref = readAudioVersionPref();
      const preferredIdx = pickPreferredSourceIndex(sourceList, currentPref);
      setActiveSourceIndex(preferredIdx);
      if (currentPref.versionType === 'legendado') setPersistedVersion('legendado');
      else if (currentPref.versionType === 'dublado') setPersistedVersion('dublado');
      setQualityLevels([]);
      setSelectedQuality(-1);
      setDetectedVideoQuality('');
      setEmbeddedSubtitleTracks([]);
      setSelectedSubKey(null);
      setAudioTracks([]);
      setSelectedAudio(0);
      setCurrentTime(0);
      setDuration(0);
      setBufferedPercent(0);
      setRealLoadProgress(null);
      setLongLoadingStalled(false);
      setShowAudioSubPanel(false);
      setShowDownloadMenu(false);
      setDownloadFeedbackMsg(null);
      if (hasNextEpisode) {
        isSwitchingSourceRef.current = false;
      }
    }

    if (contentChanged || resumeKeyChanged) {
      evaluatedResumeKeyRef.current = resumeKey || null;
      evaluatedInitialPosRef.current = 0;
      pendingResumeSeekRef.current = null;
      pendingSourceSwitchSeekRef.current = null;
      verifyResumeSeekRef.current = null;
      lastSavedTimeRef.current = 0;
      lastPersistedSecRef.current = 0;
      resumeDecisionRef.current = 'none';
      setResumePromptSec(0);
    }

    const localEntry = readStoredResumeEntry(resumeKey);
    if (initialPositionCompleted || localEntry.completed) {
      resumeDecisionRef.current = 'none';
      setResumePromptSec(0);
      return;
    }

    const propSec = initialPositionSeconds && initialPositionSeconds >= 10 ? initialPositionSeconds : 0;
    const candidateSec = Math.max(propSec, localEntry.time);

    if (resumeKeyChanged || contentChanged) {
      if (candidateSec >= 10) {
        evaluatedInitialPosRef.current = propSec;
        resumeDecisionRef.current = 'pending';
        setResumePromptSec(candidateSec);
      }
    } else if (
      propSec >= 10 &&
      evaluatedInitialPosRef.current === 0 &&
      resumeDecisionRef.current === 'none'
    ) {
      // Handle async backend progress hydration arriving shortly after mount
      evaluatedInitialPosRef.current = propSec;
      resumeDecisionRef.current = 'pending';
      setResumePromptSec(propSec);
    }
  }, [
    listIdentity,
    sourceList,
    resumeKey,
    initialPositionSeconds,
    initialPositionCompleted,
    hasNextEpisode,
    autoplay,
    unlockOrientation
  ]);

  // Auto-hide resume notification after 10s so it never stays permanently on screen
  useEffect(() => {
    if (resumePromptSec <= 0) return;
    const t = setTimeout(() => {
      setResumePromptSec(0);
      if (resumeDecisionRef.current === 'pending') {
        resumeDecisionRef.current = 'dismissed';
      }
    }, 10000);
    return () => clearTimeout(t);
  }, [resumePromptSec]);

  // Persist progress immediately when tab hides, user exits page, or component unmounts
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgressNow(true, false);
      }
    };
    const onPageHide = () => {
      flushProgressNow(true, false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      flushProgressNow(true, false);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [flushProgressNow]);

  const cleanupMediaEngines = useCallback(() => {
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
  }, []);

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
      if (tapPulseTimeoutRef.current) clearTimeout(tapPulseTimeoutRef.current);
      unlockOrientation();
      cleanupMediaEngines();
    };
  }, [cleanupMediaEngines, unlockOrientation]);

  // 1. Resolve Source via backend (with AbortController + hard 16s timeout)
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const resolveTimeout = setTimeout(() => {
      controller.abort();
    }, 16000);

    cleanupMediaEngines();
    startedReportedRef.current = false;
    setResolvedData(null);
    setIframeLoaded(false);
    setIsPlaying(false);
    setAutoplayBlocked(false);
    setIsBuffering(false);
    setRealLoadProgress(null);
    setBufferedPercent(0);
    setLongLoadingStalled(false);
    setQualityLevels([]);
    setSelectedQuality(-1);
    setDetectedVideoQuality('');
    setEmbeddedSubtitleTracks([]);
    setSelectedSubKey(prev => (prev && prev.startsWith('user:') ? prev : null));
    setAudioTracks([]);
    setSelectedAudio(0);
    setDownloadFeedbackMsg(null);
    setUseCors(subtitlesRef.current.length > 0);

    if (!activeUrl) {
      clearTimeout(resolveTimeout);
      setResolving(false);
      handlePlaybackFailure('Nenhuma URL configurada para esta fonte.', activeDeclaredFormat, activeUrl);
      return () => controller.abort();
    }

    if (activeSource && isHtmlOrUnsupportedSource(activeSource)) {
      clearTimeout(resolveTimeout);
      setResolving(false);
      handlePlaybackFailure(
        'A fonte devolveu uma página HTML informativa e não um fluxo de vídeo direto compatível.',
        activeDeclaredFormat,
        activeUrl
      );
      return () => controller.abort();
    }

    setResolving(true);
    setHasError(false);
    setErrorMessage('');

    const staticCheck = classifySourceUrl(activeUrl);
    if (!staticCheck.valid) {
      clearTimeout(resolveTimeout);
      setResolving(false);
      handlePlaybackFailure(staticCheck.error || 'URL de fonte inválida.', activeDeclaredFormat, activeUrl);
      return () => controller.abort();
    }

    if (isSwitchingSourceRef.current) {
      setPhaseLabel('A recuperar ligação...');
    } else if (staticCheck.sourceKind === 'PHP_VIDEO_ENDPOINT' || staticCheck.sourceKind === 'UNKNOWN') {
      setPhaseLabel('A verificar fonte...');
    } else {
      setPhaseLabel('A preparar reprodução...');
    }
    isSwitchingSourceRef.current = false;

    const connectTimer = setTimeout(() => {
      if (!cancelled) setPhaseLabel('A inicializar player...');
    }, 750);

    api
      .resolveProviderSource(activeUrl, activeDeclaredFormat, controller.signal)
      .then((res) => {
        if (cancelled) return;

        if (res.success) {
          const resolvedFormat = res.format || activeDeclaredFormat;
          const isDirect = Boolean(res.isDirect);
          setPhaseLabel(
            !isDirect
              ? 'A preparar transmissão...'
              : resolvedFormat === 'm3u8' || resolvedFormat === 'hls'
                ? 'A preparar transmissão...'
                : 'A carregar vídeo...'
          );
          setIsBuffering(true);
          setResolvedData({
            isDirect,
            directUrl: res.directUrl || (isDirect ? activeUrl : undefined),
            embedUrl: res.embedUrl || activeUrl,
            provider: res.provider || activeSource?.serverName || activeSource?.provider || 'Servidor RONYCINE',
            format: resolvedFormat,
            sourceKind: res.sourceKind || staticCheck.sourceKind,
            fallbackToIframe: Boolean(res.fallbackToIframe),
            note: res.note
          });
          setHasError(false);
        } else {
          const msg = toUserFriendlyError(res.error, res.status);
          handlePlaybackFailure(msg, activeDeclaredFormat, activeUrl);
        }
      })
      .catch((err: any) => {
        if (cancelled) return;

        if (
          staticCheck.sourceKind === 'DIRECT_MP4' ||
          staticCheck.sourceKind === 'DIRECT_WEBM' ||
          staticCheck.sourceKind === 'DIRECT_HLS' ||
          staticCheck.sourceKind === 'DIRECT_DASH'
        ) {
          setPhaseLabel(
            staticCheck.suggestedFormat === 'm3u8'
              ? 'A preparar transmissão...'
              : 'A carregar vídeo...'
          );
          setIsBuffering(true);
          setResolvedData({
            isDirect: true,
            directUrl: activeUrl,
            embedUrl: activeUrl,
            provider: activeSource?.serverName || staticCheck.suggestedServerName || 'Servidor Direto',
            format: staticCheck.suggestedFormat,
            sourceKind: staticCheck.sourceKind,
            fallbackToIframe: false
          });
          setHasError(false);
        } else if (staticCheck.sourceKind === 'EMBED_PLAYER') {
          setPhaseLabel('A preparar transmissão...');
          setIsBuffering(true);
          setResolvedData({
            isDirect: false,
            embedUrl: activeUrl,
            provider: activeSource?.serverName || 'Embed Externo',
            format: 'embed',
            sourceKind: 'EMBED_PLAYER'
          });
          setHasError(false);
        } else {
          const msg = toUserFriendlyError(err?.message);
          handlePlaybackFailure(msg, activeDeclaredFormat, activeUrl);
        }
      })
      .finally(() => {
        clearTimeout(resolveTimeout);
        clearTimeout(connectTimer);
        if (!cancelled) {
          setResolving(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(resolveTimeout);
      clearTimeout(connectTimer);
      controller.abort();
    };
  }, [activeSourceIndex, activeUrl, activeDeclaredFormat, retryToken, cleanupMediaEngines]);

  // Safety & slow-loading safeguard
  useEffect(() => {
    if ((!isBuffering && !resolving) || hasError || autoplayBlocked) {
      setLongLoadingStalled(false);
      return;
    }

    const slowTimer = setTimeout(() => {
      setLongLoadingStalled(true);
    }, 11000);

    let iframeSafetyTimer: ReturnType<typeof setTimeout> | null = null;
    if (!resolving && resolvedData && !resolvedData.isDirect) {
      iframeSafetyTimer = setTimeout(() => {
        setIframeLoaded(true);
        setIsBuffering(false);
        setLongLoadingStalled(false);
      }, 15000);
    }

    return () => {
      clearTimeout(slowTimer);
      if (iframeSafetyTimer) clearTimeout(iframeSafetyTimer);
    };
  }, [isBuffering, resolving, hasError, autoplayBlocked, resolvedData]);

  // Compute real buffer percentage for direct <video>
  const updateBufferedMetrics = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const dur = video.duration;
    if (!dur || !isFinite(dur) || dur <= 0 || video.buffered.length === 0) return;

    let maxEnd = 0;
    const cur = video.currentTime || 0;
    for (let i = 0; i < video.buffered.length; i++) {
      const start = video.buffered.start(i);
      const end = video.buffered.end(i);
      if (cur >= start - 1 && end > maxEnd) {
        maxEnd = end;
      }
    }
    if (maxEnd === 0) {
      maxEnd = video.buffered.end(video.buffered.length - 1);
    }
    const pct = Math.min(100, Math.max(0, Math.round((maxEnd / dur) * 100)));
    setBufferedPercent(pct);
    if (video.paused && cur === 0 && pct > 0) {
      setRealLoadProgress(pct);
    }
  }, []);

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

    // Auto-select & pre-load preferred or source-attached subtitles cleanly
    const autoLoadBestSubtitle = async () => {
      if (disposed) return;
      const sourceSubUrl = activeSource?.subtitleUrl?.trim();
      const propTracks = subtitlesRef.current;
      const isLegendadoSource = inferSourceVersionType(activeSource || {}) === 'Legendado';
      const userExplicitlyOff = subPrefs.preferredLang === '__off__';

      if (sourceSubUrl) {
        const key = `source:${sourceSubUrl}`;
        if (!parsedCuesByKey[key]) {
          fetchAndParseSubtitle(key, sourceSubUrl).catch(() => {});
        }
        if (subPrefs.enabled || (isLegendadoSource && !userExplicitlyOff)) {
          setSelectedSubKey(prev => (prev && prev.startsWith('user:') ? prev : key));
        }
      } else if (propTracks.length > 0) {
        const defTrack = propTracks.find(s => s.default) || (subPrefs.enabled ? propTracks[0] : null);
        if (defTrack) {
          const idx = propTracks.indexOf(defTrack);
          const key = `prop:${idx}:${defTrack.src}`;
          if (!parsedCuesByKey[key]) {
            fetchAndParseSubtitle(key, defTrack.src).catch(() => {});
          }
          setSelectedSubKey(prev => (prev && prev.startsWith('user:') ? prev : key));
        }
      }
    };
    autoLoadBestSubtitle();

    const attemptAutoPlay = () => {
      const shouldStartPlaying = wasPlayingBeforeSwitchRef.current;
      if (!shouldStartPlaying || disposed) {
        if (!disposed) {
          setIsBuffering(false);
        }
        return;
      }
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err: any) => {
          if (disposed) return;
          setIsPlaying(false);
          setIsBuffering(false);
          if (err?.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
          }
        });
      }
    };

    const initEngine = async () => {
      if (isHls) {
        setPhaseLabel('A inicializar player...');
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

            const syncHlsAudioAndSubTracks = () => {
              if (disposed) return;
              if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
                const mappedEmb = hls.subtitleTracks.map((st, idx) => ({
                  index: idx,
                  label: st.name || st.lang || `Legenda ${idx + 1}`,
                  lang: st.lang || 'sub'
                }));
                setEmbeddedSubtitleTracks(mappedEmb);
                if (subPrefs.enabled && !activeSource?.subtitleUrl && subtitlesRef.current.length === 0) {
                  const prefLang = (subPrefs.preferredLang || '').toLowerCase();
                  const matched = prefLang && prefLang !== '__off__'
                    ? mappedEmb.find(t => t.lang.toLowerCase().includes(prefLang) || t.label.toLowerCase().includes(prefLang))
                    : mappedEmb[0];
                  if (matched) {
                    setSelectedSubKey(prev => (prev && prev.startsWith('user:') ? prev : `emb:${matched.index}`));
                  }
                }
              }

              if (hls.audioTracks && hls.audioTracks.length > 0) {
                setAudioTracks(
                  hls.audioTracks.map((at, idx) => ({
                    index: idx,
                    label: at.name || at.lang || `Faixa ${idx + 1}`,
                    lang: at.lang
                  }))
                );
                setSelectedAudio(hls.audioTrack >= 0 ? hls.audioTrack : 0);
              }
            };

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (disposed) return;
              setPhaseLabel('A carregar vídeo...');
              const levels = (hls.levels || []).map((lvl, idx) => ({
                index: idx,
                label: lvl.height ? heightToQualityLabel(lvl.height).label : `${Math.round((lvl.bitrate || 0) / 1000)} kbps`
              }));
              setQualityLevels(levels);
              setSelectedQuality(-1);

              syncHlsAudioAndSubTracks();
              applyPendingResumeSeek();
              attemptAutoPlay();
            });

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, syncHlsAudioAndSubTracks);
            hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, syncHlsAudioAndSubTracks);

            hls.on(Hls.Events.FRAG_BUFFERED, () => {
              if (disposed) return;
              updateBufferedMetrics();
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
              if (disposed || !data.fatal) return;
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hlsMediaRecoveryAttempted) {
                hlsMediaRecoveryAttempted = true;
                setPhaseLabel('A recuperar ligação...');
                hls.recoverMediaError();
                return;
              }
              handlePlaybackFailure('Não foi possível carregar o manifesto HLS/M3U8.', 'm3u8', mediaUrl);
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            setPhaseLabel('A carregar vídeo...');
            video.src = mediaUrl;
            video.onloadedmetadata = () => {
              if (disposed) return;
              if (video.videoHeight > 0) {
                setDetectedVideoQuality(heightToQualityLabel(video.videoHeight).label);
              }
              const nativeAudio = (video as any).audioTracks;
              if (nativeAudio && nativeAudio.length > 1) {
                const list: AudioOption[] = [];
                let activeIdx = 0;
                for (let i = 0; i < nativeAudio.length; i++) {
                  if (nativeAudio[i].enabled) activeIdx = i;
                  list.push({
                    index: i,
                    label: nativeAudio[i].label || nativeAudio[i].language || `Faixa ${i + 1}`,
                    lang: nativeAudio[i].language
                  });
                }
                setAudioTracks(list);
                setSelectedAudio(activeIdx);
              }
              applyPendingResumeSeek();
            };
            attemptAutoPlay();
          } else {
            handlePlaybackFailure('Este navegador não suporta reprodução HLS/M3U8.', 'm3u8', mediaUrl);
          }
        } catch {
          if (!disposed) {
            handlePlaybackFailure('Falha ao inicializar motor HLS.', 'm3u8', mediaUrl);
          }
        }
      } else if (isDash) {
        setPhaseLabel('A inicializar player...');
        try {
          const dashjs = await import('dashjs');
          if (disposed) return;

          const player = dashjs.MediaPlayer().create();
          dashRef.current = player;
          player.initialize(video, mediaUrl, autoplay);

          player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
            if (disposed) return;
            setPhaseLabel('A carregar vídeo...');
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

              // Capture DASH multi-audio tracks when available
              if (typeof dashAny.getTracksFor === 'function') {
                const dAudio = dashAny.getTracksFor('audio') || [];
                if (dAudio.length > 0) {
                  const curTrack = typeof dashAny.getCurrentTrackFor === 'function' ? dashAny.getCurrentTrackFor('audio') : null;
                  setAudioTracks(
                    dAudio.map((t: any, idx: number) => ({
                      index: idx,
                      label: t.labels?.[0]?.text || t.lang || `Áudio ${idx + 1}`,
                      lang: t.lang
                    }))
                  );
                  const curIdx = curTrack ? dAudio.findIndex((t: any) => t === curTrack || t.id === curTrack.id) : 0;
                  setSelectedAudio(curIdx >= 0 ? curIdx : 0);
                }

                const dText = dashAny.getTracksFor('text') || [];
                if (dText.length > 0) {
                  setEmbeddedSubtitleTracks(
                    dText.map((t: any, idx: number) => ({
                      index: idx,
                      label: t.labels?.[0]?.text || t.lang || `Legenda ${idx + 1}`,
                      lang: t.lang || 'sub'
                    }))
                  );
                }
              }
              applyPendingResumeSeek();
            } catch {}
          });

          player.on(dashjs.MediaPlayer.events.ERROR, () => {
            if (disposed) return;
            handlePlaybackFailure('Falha ao reproduzir manifesto DASH (.mpd).', 'dash', mediaUrl);
          });
        } catch {
          if (!disposed) {
            handlePlaybackFailure('Falha ao inicializar motor DASH.', 'dash', mediaUrl);
          }
        }
      } else {
        // Direct MP4 / WebM / PHP endpoint streaming video
        setPhaseLabel('A carregar vídeo...');
        video.src = mediaUrl;
        video.playbackRate = playbackSpeed;
        video.onloadedmetadata = () => {
          if (disposed) return;
          if (video.videoHeight > 0) {
            setDetectedVideoQuality(heightToQualityLabel(video.videoHeight).label);
          }
          const nativeAudio = (video as any).audioTracks;
          if (nativeAudio && nativeAudio.length > 1) {
            const list: AudioOption[] = [];
            let activeIdx = 0;
            for (let i = 0; i < nativeAudio.length; i++) {
              if (nativeAudio[i].enabled) activeIdx = i;
              list.push({
                index: i,
                label: nativeAudio[i].label || nativeAudio[i].language || `Faixa ${i + 1}`,
                lang: nativeAudio[i].language
              });
            }
            setAudioTracks(list);
            setSelectedAudio(activeIdx);
          }
          applyPendingResumeSeek();
        };
        attemptAutoPlay();
      }
    };

    initEngine();

    return () => {
      disposed = true;
      cleanupMediaEngines();
    };
  }, [resolving, hasError, resolvedData?.isDirect, resolvedData?.directUrl, resolvedData?.format, autoplay, subtitlesKey, useCors, cleanupMediaEngines]);

  // Apply subtitle selection (embedded HLS/DASH tracks use native engine; SRT/VTT external & props use parsed cue overlay)
  useEffect(() => {
    const selectedTrack = allSubtitleTracks.find(t => t.key === selectedSubKey) || null;

    if (hlsRef.current && hlsRef.current.subtitleTracks && hlsRef.current.subtitleTracks.length > 0) {
      hlsRef.current.subtitleTrack = selectedTrack?.origin === 'embedded' ? (selectedTrack.embeddedIndex ?? -1) : -1;
    }

    if (dashRef.current) {
      try {
        const dashAny = dashRef.current as any;
        if (typeof dashAny.setTextTrack === 'function') {
          dashAny.setTextTrack(selectedTrack?.origin === 'embedded' ? (selectedTrack.embeddedIndex ?? -1) : -1);
        }
      } catch {}
    }

    const video = videoRef.current;
    if (video && video.textTracks) {
      for (let i = 0; i < video.textTracks.length; i++) {
        // Keep browser native cue box hidden for tracks rendered by our customizable cue overlay
        video.textTracks[i].mode =
          selectedTrack?.origin === 'embedded' && i === selectedTrack.embeddedIndex ? 'showing' : 'hidden';
      }
    }
  }, [selectedSubKey, allSubtitleTracks, subtitlesKey]);

  // Preload cues whenever a non-embedded subtitle key is selected
  useEffect(() => {
    if (!selectedSubKey) return;
    const track = allSubtitleTracks.find(t => t.key === selectedSubKey);
    if (track && track.origin !== 'embedded' && track.src && !parsedCuesByKey[track.key]) {
      fetchAndParseSubtitle(track.key, track.src).catch(() => {});
    }
  }, [selectedSubKey, allSubtitleTracks, parsedCuesByKey, fetchAndParseSubtitle]);

  // Compute active parsed subtitle overlay line(s) with sync offset
  const activeOverlaySubtitleText = useMemo(() => {
    if (!selectedSubKey) return '';
    const cues = parsedCuesByKey[selectedSubKey];
    if (!cues || cues.length === 0) return '';
    return getActiveSubtitleText(cues, currentTime, subPrefs.syncOffsetSeconds);
  }, [selectedSubKey, parsedCuesByKey, currentTime, subPrefs.syncOffsetSeconds]);

  // 3. Controls Auto-hide (4 seconds exact; never hides while using menu/seeking/paused)
  const scheduleAutoHide = useCallback(
    (delayMs = 4000) => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (isPlaying && !showSettingsMenu && !showSourceMenu && !showAudioSubPanel && !showDownloadMenu && !isSeeking) {
        controlsTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, delayMs);
      }
    },
    [isPlaying, showSettingsMenu, showSourceMenu, showAudioSubPanel, showDownloadMenu, isSeeking]
  );

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    scheduleAutoHide(4000);
  }, [scheduleAutoHide]);

  // Keep controls visible while a menu or seek slider is active; restart 4s countdown once closed
  useEffect(() => {
    if (showSettingsMenu || showSourceMenu || showAudioSubPanel || showDownloadMenu || isSeeking || !isPlaying) {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    } else if (showControls) {
      scheduleAutoHide(4000);
    }
  }, [showSettingsMenu, showSourceMenu, showAudioSubPanel, showDownloadMenu, isSeeking, isPlaying, showControls, scheduleAutoHide]);

  // Spawn subtle visual tap ring without pausing/playing video
  const triggerTapPulse = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(24, Math.min(rect.width - 24, clientX - rect.left));
    const y = Math.max(24, Math.min(rect.height - 24, clientY - rect.top));
    if (tapPulseTimeoutRef.current) clearTimeout(tapPulseTimeoutRef.current);
    setTapPulse({ x, y, id: Date.now() });
    tapPulseTimeoutRef.current = setTimeout(() => setTapPulse(null), 380);
  }, []);

  // Video stage tap handler:
  // 1st tap: show controls (+ 4s auto-hide timer)
  // 2nd tap: hide controls IMMEDIATELY
  // NEVER toggles play/pause!
  const handleStageTap = useCallback(
    (clientX?: number, clientY?: number) => {
      if (showSettingsMenu || showSourceMenu || showAudioSubPanel || showDownloadMenu) {
        setShowSettingsMenu(false);
        setShowSourceMenu(false);
        setShowAudioSubPanel(false);
        setShowDownloadMenu(false);
        setSettingsSubmenu('root');
        showControlsTemporarily();
        return;
      }

      if (typeof clientX === 'number' && typeof clientY === 'number') {
        triggerTapPulse(clientX, clientY);
      }

      if (!showControls) {
        showControlsTemporarily();
      } else {
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        setShowControls(false);
      }
    },
    [showSettingsMenu, showSourceMenu, showAudioSubPanel, showDownloadMenu, showControls, showControlsTemporarily, triggerTapPulse]
  );

  // Playback Controls (exclusively triggered by Play/Pause buttons or keyboard Space)
  const togglePlay = useCallback(() => {
    if (!videoRef.current || !resolvedData?.isDirect) return;
    if (videoRef.current.paused) {
      setAutoplayBlocked(false);
      videoRef.current.play().catch((err: any) => {
        if (err?.name === 'NotAllowedError') setAutoplayBlocked(true);
      });
    } else {
      videoRef.current.pause();
    }
  }, [resolvedData?.isDirect]);

  const seek = useCallback(
    (seconds: number) => {
      if (!videoRef.current) return;
      const maxDur = duration || videoRef.current.duration || 0;
      const newTime = Math.max(0, Math.min(maxDur, videoRef.current.currentTime + seconds));
      videoRef.current.currentTime = newTime;
      lastSavedTimeRef.current = newTime;
      setCurrentTime(newTime);
      showHud(seconds > 0 ? `+${seconds}s` : `${seconds}s`);
    },
    [duration, showHud]
  );

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const time = parseFloat(e.target.value);
    pendingResumeSeekRef.current = null;
    verifyResumeSeekRef.current = null;
    if (resumeDecisionRef.current === 'pending') {
      resumeDecisionRef.current = 'dismissed';
      setResumePromptSec(0);
    }
    videoRef.current.currentTime = time;
    lastSavedTimeRef.current = time;
    setCurrentTime(time);
  };

  const handleContinueFromSaved = useCallback(() => {
    const target = resumePromptSec;
    setResumePromptSec(0);
    resumeDecisionRef.current = 'continued';
    if (target > 0) {
      pendingResumeSeekRef.current = target;
      const applied = applyPendingResumeSeek();
      if (!applied) {
        showHud(`A retomar de ${formatTime(target)}...`);
      } else {
        showHud(`Continuando de ${formatTime(target)}`);
      }
    }
  }, [resumePromptSec, applyPendingResumeSeek, showHud]);

  const restartFromBeginning = useCallback(() => {
    setResumePromptSec(0);
    resumeDecisionRef.current = 'restarted';
    pendingResumeSeekRef.current = null;
    pendingSourceSwitchSeekRef.current = null;
    verifyResumeSeekRef.current = null;
    clearStoredResume(resumeKeyRef.current);
    lastSavedTimeRef.current = 0;
    lastPersistedSecRef.current = 0;
    setCurrentTime(0);
    if (dashRef.current) {
      try {
        (dashRef.current as any).seek(0);
      } catch {}
    }
    if (videoRef.current) {
      try {
        videoRef.current.currentTime = 0;
      } catch {}
      setAutoplayBlocked(false);
      videoRef.current.play().catch((err: any) => {
        if (err?.name === 'NotAllowedError') setAutoplayBlocked(true);
      });
    }
    onRestartProgressRef.current?.();
    showHud('Reprodução reiniciada do início');
  }, [showHud]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    showHud(nextMuted ? 'Som silenciado' : `Volume: ${Math.round((volume || 1) * 100)}%`);
  }, [isMuted, volume, showHud]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    const val = parseFloat(e.target.value);
    videoRef.current.volume = val;
    videoRef.current.muted = val === 0;
    setVolume(val);
    setIsMuted(val === 0);
    showHud(val === 0 ? 'Som silenciado' : `Volume: ${Math.round(val * 100)}%`);
  };

  const changePlaybackSpeed = (speed: number) => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setPlaybackSpeed(speed);
    setSettingsSubmenu('root');
    showHud(`Velocidade: ${speed === 1 ? 'Normal (1x)' : `${speed}x`}`);
  };

  const changeQuality = (index: number) => {
    setSelectedQuality(index);
    setSettingsSubmenu('root');
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
    const qLabel = index === -1 ? 'Automática' : qualityLevels.find(q => q.index === index)?.label || 'Selecionada';
    showHud(`Qualidade: ${qLabel}`);
  };

  const changeAudioTrack = (index: number) => {
    setSelectedAudio(index);
    setSettingsSubmenu('root');
    if (hlsRef.current && hlsRef.current.audioTracks && hlsRef.current.audioTracks.length > index) {
      hlsRef.current.audioTrack = index;
    }
    if (dashRef.current) {
      try {
        const dashAny = dashRef.current as any;
        const tracks = typeof dashAny.getTracksFor === 'function' ? dashAny.getTracksFor('audio') : [];
        if (tracks[index] && typeof dashAny.setCurrentTrack === 'function') {
          dashAny.setCurrentTrack(tracks[index]);
        }
      } catch {}
    }
    const video = videoRef.current as any;
    if (video?.audioTracks && video.audioTracks.length > 1) {
      for (let i = 0; i < video.audioTracks.length; i++) {
        video.audioTracks[i].enabled = i === index;
      }
    }
    const chosen = audioTracks.find(a => a.index === index);
    if (chosen) {
      writeAudioVersionPref({ audioLanguage: chosen.lang || chosen.label, versionType: inferSourceVersionType(activeSource || {}) });
      showHud(`Áudio: ${chosen.label}`);
    }
  };

  const switchSource = (index: number, persistVersionPref = false) => {
    if (index === activeSourceIndex) {
      setShowSourceMenu(false);
      setShowSettingsMenu(false);
      setShowAudioSubPanel(false);
      return;
    }
    const chosen = sourceList[index];
    if (
      !chosen ||
      !isSourcePlayableCandidate(chosen) ||
      failedIndicesRef.current.has(index)
    ) {
      setShowSourceMenu(false);
      setShowSettingsMenu(false);
      setShowAudioSubPanel(false);
      showVersionNotice(
        chosen?.diagnostics?.failureReason ||
          'A fonte selecionada está offline ou incompatível. A reprodução atual foi mantida.'
      );
      return;
    }
    const liveTime = videoRef.current?.currentTime || lastSavedTimeRef.current || currentTime || 0;
    if (liveTime > 0) {
      lastSavedTimeRef.current = liveTime;
      pendingSourceSwitchSeekRef.current = liveTime;
    } else {
      pendingSourceSwitchSeekRef.current = null;
    }
    wasPlayingBeforeSwitchRef.current = videoRef.current ? !videoRef.current.paused : autoplay;
    isSwitchingSourceRef.current = true;
    setSelectedSubKey(prev => (prev && prev.startsWith('user:') ? prev : null));
    setActiveSourceIndex(index);
    setShowSourceMenu(false);
    setShowSettingsMenu(false);
    setShowAudioSubPanel(false);

    const badge = formatSourceVersionBadge(chosen);
    if (persistVersionPref) {
      writeAudioVersionPref({
        audioLanguage: chosen.audioLanguage,
        versionType: badge.versionType
      });
    }
    const verLower = badge.versionType.toLowerCase();
    if (verLower === 'dublado') {
      showHud('A carregar versão dublada...');
    } else if (verLower === 'legendado') {
      showHud('A carregar versão legendada...');
    } else if (verLower === 'original') {
      showHud('A carregar versão original...');
    } else {
      showHud(`A trocar para ${badge.shortLabel}...`);
    }
    if (onSelectAlternativeSourceRef.current) {
      onSelectAlternativeSourceRef.current(chosen);
    }
  };

  // --- RONYCINE AUDIO & VERSION SYSTEM (DUBLADO / LEGENDADO) ---

  const isDubladoAvailable = useMemo(() => {
    if (findSourceForVersion(sourceList, 'dublado') !== null) return true;
    if (isSourceDublado(activeSource || {})) return true;
    if (
      audioTracks.length > 1 &&
      audioTracks.some(t => {
        const l = `${t.label} ${t.lang || ''}`.toLowerCase();
        return /\b(portugu[eê]s|pt|pt-br|dubl|dublado)\b/i.test(l);
      })
    ) {
      return true;
    }
    return false;
  }, [sourceList, activeSource, audioTracks]);

  const isLegendadoAvailable = useMemo(() => {
    // CRITICAL: Never treat optional external .srt/.vtt subtitles alone as a Versão Legendada stream!
    if (findSourceForVersion(sourceList, 'legendado') !== null) return true;
    if (isSourceLegendado(activeSource || {})) return true;
    if (
      audioTracks.length > 1 &&
      audioTracks.some(t => {
        const l = `${t.label} ${t.lang || ''}`.toLowerCase();
        return !/\b(portugu[eê]s|pt|pt-br)\b/i.test(l);
      })
    ) {
      return true;
    }
    return false;
  }, [sourceList, activeSource, audioTracks]);

  const dubladoUnavailableText = useMemo(() => {
    if (versionAvailability?.dublado?.status === 'unavailable') {
      return versionAvailability.dublado.reason || 'Versão dublada indisponível — fonte falhou ou é incompatível.';
    }
    return 'Versão dublada indisponível — nenhuma fonte cadastrada.';
  }, [versionAvailability]);

  const legendadoUnavailableText = useMemo(() => {
    if (versionAvailability?.legendado?.status === 'unavailable') {
      return versionAvailability.legendado.reason || 'Versão legendada indisponível — fonte falhou ou é incompatível.';
    }
    return 'Versão legendada indisponível — nenhuma fonte cadastrada.';
  }, [versionAvailability]);

  const effectiveVersion: 'dublado' | 'legendado' = useMemo(() => {
    if (activeSource) {
      if (isSourceLegendado(activeSource)) return 'legendado';
      if (isSourceDublado(activeSource)) return 'dublado';
    }
    if (audioTracks.length > 1 && audioTracks[selectedAudio]) {
      const currentAudioTrack = audioTracks[selectedAudio];
      const l = `${currentAudioTrack.label} ${currentAudioTrack.lang || ''}`.toLowerCase();
      if (/\b(portugu[eê]s|pt|pt-br|dubl)\b/i.test(l)) return 'dublado';
      return 'legendado';
    }
    return persistedVersion;
  }, [activeSource, audioTracks, selectedAudio, persistedVersion]);

  const handleSelectDublado = useCallback(() => {
    if (!isDubladoAvailable) {
      showVersionNotice(dubladoUnavailableText);
      return;
    }

    setPersistedVersion('dublado');
    writeAudioVersionPref({ versionType: 'dublado', audioLanguage: 'Português' });
    saveAudioPreference({ versionType: 'dublado', audioLanguage: 'Português' });

    // Situação A: Fonte dedicada cadastrada como dublada (prioritária para troca de versão real)
    const dubMatch = findSourceForVersion(sourceList, 'dublado');
    if (dubMatch && dubMatch.index !== activeSourceIndex && !isSourceDublado(activeSource || {})) {
      setSelectedSubKey(null);
      updateSubPrefs(p => ({ ...p, enabled: false }));
      switchSource(dubMatch.index, true);
      return;
    }

    // Situação B: Faixa de áudio interna da transmissão atual (multi-áudio)
    const internalPtTrack =
      audioTracks.length > 1
        ? audioTracks.find(t => {
            const l = `${t.label} ${t.lang || ''}`.toLowerCase();
            return /\b(portugu[eê]s|pt|pt-br|dubl|dublado)\b/i.test(l);
          })
        : undefined;

    if (internalPtTrack && internalPtTrack.index !== selectedAudio) {
      changeAudioTrack(internalPtTrack.index);
      setSelectedSubKey(null);
      updateSubPrefs(p => ({ ...p, enabled: false }));
      showHud('Áudio dublado ativado');
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    // Já está na versão dublada ativa
    if (isSourceDublado(activeSource || {})) {
      setSelectedSubKey(null);
      updateSubPrefs(p => ({ ...p, enabled: false }));
      showHud('Versão dublada ativa');
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    if (dubMatch && dubMatch.index !== activeSourceIndex) {
      setSelectedSubKey(null);
      updateSubPrefs(p => ({ ...p, enabled: false }));
      switchSource(dubMatch.index, true);
      return;
    }

    showVersionNotice(dubladoUnavailableText);
  }, [
    isDubladoAvailable,
    dubladoUnavailableText,
    audioTracks,
    selectedAudio,
    activeSource,
    sourceList,
    activeSourceIndex,
    changeAudioTrack,
    updateSubPrefs,
    showHud,
    showVersionNotice,
    switchSource
  ]);

  const handleSelectLegendado = useCallback(() => {
    if (!isLegendadoAvailable) {
      showVersionNotice(legendadoUnavailableText);
      return;
    }

    setPersistedVersion('legendado');
    writeAudioVersionPref({ versionType: 'legendado' });
    saveAudioPreference({ versionType: 'legendado' });

    // Situação A: Fonte dedicada cadastrada como legendada (troca mantendo timestamp atual!)
    const legMatch = findSourceForVersion(sourceList, 'legendado');
    if (legMatch && legMatch.index !== activeSourceIndex && !isSourceLegendado(activeSource || {})) {
      if (legMatch.source.subtitleUrl) {
        updateSubPrefs(p => ({ ...p, enabled: true }));
      }
      switchSource(legMatch.index, true);
      return;
    }

    // Situação B: Stream multiáudio real com faixa original + legendas
    if (audioTracks.length > 1) {
      const origTrack = audioTracks.find(t => {
        const l = `${t.label} ${t.lang || ''}`.toLowerCase();
        return !/\b(portugu[eê]s|pt|pt-br)\b/i.test(l);
      });
      if (origTrack && origTrack.index !== selectedAudio) {
        changeAudioTrack(origTrack.index);
        const targetSub = allSubtitleTracks[0];
        if (targetSub) {
          handleSelectSubtitleKey(targetSub);
        } else {
          updateSubPrefs(p => ({ ...p, enabled: true }));
        }
        showHud('Versão legendada ativada');
        if (videoRef.current && videoRef.current.paused) {
          videoRef.current.play().catch(() => {});
        }
        return;
      }
    }

    if (isSourceLegendado(activeSource || {})) {
      const targetSub = allSubtitleTracks[0];
      if (targetSub && selectedSubKey === null) {
        handleSelectSubtitleKey(targetSub);
      } else {
        updateSubPrefs(p => ({ ...p, enabled: true }));
      }
      showHud('Versão legendada ativa');
      if (videoRef.current && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
      return;
    }

    if (legMatch && legMatch.index !== activeSourceIndex) {
      switchSource(legMatch.index, true);
      return;
    }

    showVersionNotice(legendadoUnavailableText);
  }, [
    isLegendadoAvailable,
    legendadoUnavailableText,
    activeSource,
    allSubtitleTracks,
    selectedSubKey,
    audioTracks,
    selectedAudio,
    sourceList,
    activeSourceIndex,
    changeAudioTrack,
    handleSelectSubtitleKey,
    updateSubPrefs,
    showHud,
    showVersionNotice,
    switchSource
  ]);

  const enterFullscreenWithOrientation = useCallback(async () => {
    if (videoRef.current) {
      if (videoRef.current.currentTime > 0) {
        lastSavedTimeRef.current = videoRef.current.currentTime;
      }
      wasPlayingBeforeFsRef.current = !videoRef.current.paused;
    }
    const el: any = containerRef.current;
    if (!el) return;

    try {
      if (typeof el.requestFullscreen === 'function') {
        try {
          await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
        } catch {
          await el.requestFullscreen();
        }
      } else if (typeof el.webkitRequestFullscreen === 'function') {
        await el.webkitRequestFullscreen();
      } else if (videoRef.current && typeof (videoRef.current as any).webkitEnterFullscreen === 'function') {
        (videoRef.current as any).webkitEnterFullscreen();
      }
      await lockLandscapeOrientation();
    } catch {
      if (videoRef.current && typeof (videoRef.current as any).webkitEnterFullscreen === 'function') {
        try {
          (videoRef.current as any).webkitEnterFullscreen();
        } catch {}
      }
    }
  }, [lockLandscapeOrientation]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    if (videoRef.current) {
      if (videoRef.current.currentTime > 0) {
        lastSavedTimeRef.current = videoRef.current.currentTime;
      }
      wasPlayingBeforeFsRef.current = !videoRef.current.paused;
    }

    const activeFs = getFullscreenElementCompat();
    if (!activeFs) {
      await enterFullscreenWithOrientation();
    } else {
      unlockOrientation();
      const docAny = document as any;
      try {
        if (typeof document.exitFullscreen === 'function') {
          await document.exitFullscreen();
        } else if (typeof docAny.webkitExitFullscreen === 'function') {
          await docAny.webkitExitFullscreen();
        }
      } catch {}
    }
  }, [enterFullscreenWithOrientation, unlockOrientation]);

  const handleCinemaToggle = useCallback(() => {
    const nextState = !effectiveCinemaMode;
    if (onToggleCinemaMode) {
      onToggleCinemaMode();
    } else {
      setInternalCinemaMode(prev => !prev);
    }
    showHud(nextState ? 'Modo Cinema ativado' : 'Modo Cinema desativado');
  }, [effectiveCinemaMode, onToggleCinemaMode, showHud]);

  const handleSelectFrameSize = (mode: FrameSizeMode) => {
    setFrameSize(mode);
    writeStoredFrameSize(mode);
    if (mode === 'fullscreen' && containerRef.current && !getFullscreenElementCompat()) {
      enterFullscreenWithOrientation();
    }
    setSettingsSubmenu('root');
    const optLabel = FRAME_SIZE_OPTIONS.find(o => o.id === mode)?.label || mode;
    showHud(`Ecrã: ${optLabel}`);
  };

  // Desktop keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'Escape') {
        if (showSettingsMenu || showSourceMenu || showAudioSubPanel || showDownloadMenu) {
          setShowSettingsMenu(false);
          setShowSourceMenu(false);
          setShowAudioSubPanel(false);
          setShowDownloadMenu(false);
          setSettingsSubmenu('root');
        } else if (effectiveCinemaMode) {
          handleCinemaToggle();
        }
        return;
      }

      if (!resolvedData?.isDirect) return;

      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        togglePlay();
        showControlsTemporarily();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(-10);
        showControlsTemporarily();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(10);
        showControlsTemporarily();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
        showControlsTemporarily();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    resolvedData?.isDirect,
    showSettingsMenu,
    showSourceMenu,
    showAudioSubPanel,
    showDownloadMenu,
    effectiveCinemaMode,
    togglePlay,
    seek,
    toggleMute,
    toggleFullscreen,
    handleCinemaToggle,
    showControlsTemporarily
  ]);

  // Compute responsive live frame wrapper + video object-fit classes cleanly without reloading media
  const { frameWrapperClass, videoFitClass } = useMemo(() => {
    switch (frameSize) {
      case 'original':
        return { frameWrapperClass: 'w-full h-full flex items-center justify-center', videoFitClass: 'w-auto h-auto max-w-full max-h-full object-contain' };
      case '16:9':
        return { frameWrapperClass: 'h-full max-w-full aspect-video mx-auto flex items-center justify-center', videoFitClass: 'w-full h-full object-cover' };
      case '4:3':
        return { frameWrapperClass: 'h-full max-w-full aspect-[4/3] mx-auto flex items-center justify-center', videoFitClass: 'w-full h-full object-cover' };
      case '21:9':
        return { frameWrapperClass: 'w-full max-h-full aspect-[21/9] my-auto flex items-center justify-center', videoFitClass: 'w-full h-full object-cover' };
      case '9:16':
        return { frameWrapperClass: 'h-full max-w-full aspect-[9/16] mx-auto flex items-center justify-center', videoFitClass: 'w-full h-full object-cover' };
      case '1:1':
        return { frameWrapperClass: 'h-full max-w-full aspect-square mx-auto flex items-center justify-center', videoFitClass: 'w-full h-full object-cover' };
      case 'fit':
        return { frameWrapperClass: 'w-full h-full flex items-center justify-center', videoFitClass: 'w-full h-full object-contain' };
      case 'fullscreen':
        return { frameWrapperClass: 'w-full h-full flex items-center justify-center', videoFitClass: 'w-full h-full object-fill' };
      case 'default':
      default:
        return { frameWrapperClass: 'w-full h-full flex items-center justify-center', videoFitClass: 'w-full h-full object-contain' };
    }
  }, [frameSize]);

  const activeFrameLabel = FRAME_SIZE_OPTIONS.find(f => f.id === frameSize)?.label || 'Padrão';

  // Never keep loading visible once playback starts or if playback is paused / autoplay blocked!
  const showUltraLoading =
    !hasError &&
    !autoplayBlocked &&
    (resolving ||
      (isBuffering &&
        (!resolvedData ||
          (resolvedData.isDirect
            ? !isPlaying && currentTime === 0 && autoplay
            : !iframeLoaded))));

  const showMidStreamBuffering =
    !showUltraLoading && !hasError && isBuffering && isPlaying && resolvedData?.isDirect;

  // Real progress SVG arc math
  const ringRadius = 34;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const hasRealPercentage = realLoadProgress !== null && realLoadProgress >= 0 && realLoadProgress <= 100 && !resolving;
  const ringOffset = hasRealPercentage
    ? ringCircumference - (realLoadProgress / 100) * ringCircumference
    : ringCircumference * 0.72;

  const controlsVisible =
    showControls ||
    showSettingsMenu ||
    showSourceMenu ||
    showAudioSubPanel ||
    showDownloadMenu ||
    (resolvedData ? !resolvedData.isDirect : false);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`relative w-full h-full bg-[#080808] group overflow-hidden select-none font-sans outline-none flex items-center justify-center ${
        isFullscreen ? 'fixed inset-0 w-screen h-screen max-w-none max-h-none z-[9999]' : ''
      } ${
        effectiveCinemaMode && !onToggleCinemaMode && !isFullscreen ? 'fixed inset-0 z-[90]' : ''
      }`}
      onMouseMove={() => {
        if (Date.now() - lastTouchTimestampRef.current > 700) {
          showControlsTemporarily();
        }
      }}
      onTouchStart={(e) => {
        if (e.touches.length === 1) {
          const t = e.touches[0];
          touchStartPosRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
        } else {
          touchStartPosRef.current = null;
        }
      }}
      onTouchEnd={(e) => {
        lastTouchTimestampRef.current = Date.now();
        const start = touchStartPosRef.current;
        touchStartPosRef.current = null;
        const touch = e.changedTouches?.[0];
        if (!touch) return;
        if (start) {
          const dx = Math.abs(touch.clientX - start.x);
          const dy = Math.abs(touch.clientY - start.y);
          const dt = Date.now() - start.time;
          if (dx > 14 || dy > 14 || dt > 500) {
            return;
          }
        }
        handleStageTap(touch.clientX, touch.clientY);
      }}
      onClick={(e) => {
        if (Date.now() - lastTouchTimestampRef.current < 700) {
          return;
        }
        handleStageTap(e.clientX, e.clientY);
      }}
    >
      {/* SUBTLE CENTER/TAP RIPPLE FEEDBACK (Never pauses playback) */}
      <AnimatePresence>
        {tapPulse && (
          <motion.div
            key={tapPulse.id}
            initial={{ opacity: 0.55, scale: 0.5 }}
            animate={{ opacity: 0, scale: 1.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.38, ease: 'easeOut' }}
            style={{ left: tapPulse.x - 28, top: tapPulse.y - 28 }}
            className="absolute w-14 h-14 rounded-full border-2 border-[#E50914]/70 bg-white/10 pointer-events-none z-20"
          />
        )}
      </AnimatePresence>

      {/* BRIEF HUD NOTICE (Volume / Speed / Cinema / Orientation hint) */}
      <AnimatePresence>
        {hudNotice && (
          <motion.div
            key={hudNotice.id}
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.96 }}
            transition={{ duration: 0.16 }}
            className="absolute top-16 sm:top-20 left-1/2 -translate-x-1/2 z-40 bg-[#111111]/95 border border-white/15 px-4 py-1.5 rounded-xl text-xs font-bold text-white shadow-2xl backdrop-blur-md pointer-events-none whitespace-nowrap"
          >
            {hudNotice.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ELEGANT VERSION NOTIFICATION (Áudio dublado indisponível / Versão legendada indisponível) */}
      <AnimatePresence>
        {versionNotice && (
          <motion.div
            key={versionNotice.id}
            initial={{ opacity: 0, y: -16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="absolute top-16 sm:top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none max-w-[92vw] sm:max-w-md"
          >
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[#111111]/95 backdrop-blur-xl border border-white/15 border-l-4 border-l-[#E50914] shadow-2xl shadow-black/80 text-white">
              <Info className="w-4 h-4 text-[#E50914] shrink-0" />
              <span className="text-xs sm:text-sm font-semibold tracking-wide">
                {versionNotice.message}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DISCRETE MID-STREAM BUFFERING BADGE */}
      <AnimatePresence>
        {showMidStreamBuffering && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-16 right-4 sm:right-6 z-30 bg-[#111111]/90 border border-[#E50914]/40 px-3 py-1.5 rounded-xl flex items-center gap-2 pointer-events-none backdrop-blur-md"
          >
            <div className="w-3.5 h-3.5 rounded-full border-2 border-[#E50914] border-t-transparent animate-spin" />
            <span className="text-[11px] font-bold text-zinc-200">A carregar buffer...</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SMART TOP-POSITIONED RESUME NOTIFICATION */}
      <AnimatePresence>
        {resumePromptSec >= 10 && !resolving && !hasError && resolvedData?.isDirect && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-14 sm:top-16 left-4 sm:left-6 z-40 max-w-[calc(100%-2rem)] bg-[#111111]/95 border border-white/15 rounded-xl px-3.5 py-2 flex flex-wrap items-center gap-2.5 backdrop-blur-md shadow-2xl"
          >
            <History className="w-4 h-4 text-[#E50914] shrink-0" />
            <span className="text-[11px] sm:text-xs font-semibold text-zinc-200">
              Continuar de onde paraste?{' '}
              <span className="font-mono text-white font-bold tabular-nums">{formatTime(resumePromptSec)}</span>
            </span>
            <div className="flex items-center gap-1.5 ml-1">
              <button
                type="button"
                onClick={handleContinueFromSaved}
                className="min-h-[32px] px-3 py-1 rounded-lg bg-[#E50914] hover:bg-red-700 text-white text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer"
              >
                Continuar
              </button>
              <button
                type="button"
                onClick={restartFromBeginning}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 hover:text-white text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Recomeçar
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* RONYCINE ANIMATED LOADING PRESENTATION */}
      <AnimatePresence>
        {showUltraLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className={`absolute inset-0 flex flex-col items-center justify-center bg-[#080808]/95 z-40 backdrop-blur-md p-6 text-center ${
              longLoadingStalled ? 'pointer-events-auto' : 'pointer-events-none'
            }`}
            onTouchEnd={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Subtle radial red ambient glow */}
            <div className="absolute w-64 h-64 rounded-full bg-[#E50914]/10 blur-3xl pointer-events-none" />

            <div className="relative w-24 h-24 flex items-center justify-center mb-5">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
                <circle
                  cx="40"
                  cy="40"
                  r={ringRadius}
                  fill="none"
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth="4"
                />
                <circle
                  cx="40"
                  cy="40"
                  r={ringRadius}
                  fill="none"
                  stroke="#E50914"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  className={hasRealPercentage ? 'transition-[stroke-dashoffset] duration-200' : 'origin-center animate-spin'}
                  style={
                    hasRealPercentage
                      ? { filter: 'drop-shadow(0 0 10px rgba(229,9,20,0.65))' }
                      : { animationDuration: '1.15s', filter: 'drop-shadow(0 0 10px rgba(229,9,20,0.65))' }
                  }
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                {hasRealPercentage ? (
                  <span className="text-sm font-black font-mono tabular-nums text-white">
                    {realLoadProgress}%
                  </span>
                ) : (
                  <span className="text-xs font-black tracking-tighter text-white font-display">
                    RC
                  </span>
                )}
              </div>
            </div>

            <span className="text-base sm:text-xl font-black tracking-[0.3em] text-white font-display uppercase mb-1">
              RONY<span className="text-[#E50914]">CINE</span>
            </span>
            <span className="text-[10px] font-black tracking-[0.22em] text-zinc-400 uppercase mb-3">
              PREPARANDO A SUA EXPERIÊNCIA...
            </span>

            <div className="px-4 py-1.5 rounded-xl bg-[#111111] border border-white/10 text-xs font-semibold text-zinc-200 max-w-xs">
              {loadingMessage || phaseLabel}
            </div>

            {longLoadingStalled && (
              <div className="mt-5 flex flex-col items-center gap-3">
                <p className="text-xs text-amber-300 font-semibold max-w-xs">
                  O carregamento está a demorar mais do que o esperado. Pode tentar novamente ou escolher outra fonte.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setLongLoadingStalled(false);
                      failedIndicesRef.current.clear();
                      setRetryToken(t => t + 1);
                    }}
                    className="min-h-[44px] px-4 py-2 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Tentar Novamente</span>
                  </button>
                  {sourceList.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = (activeSourceIndex + 1) % sourceList.length;
                        switchSource(next);
                      }}
                      className="min-h-[44px] px-4 py-2 bg-[#202020] hover:bg-white/15 border border-white/15 text-white text-xs font-bold uppercase tracking-wider rounded-xl flex items-center gap-2"
                    >
                      <Layers className="w-3.5 h-3.5 text-[#E50914]" />
                      <span>Trocar Fonte</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* AUTOPLAY BLOCKED CTA OVERLAY */}
      {!resolving && !hasError && resolvedData?.isDirect && autoplayBlocked && !isPlaying && (
        <div
          className="absolute inset-0 z-40 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center"
          onTouchEnd={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setAutoplayBlocked(false);
              togglePlay();
            }}
            className="w-20 h-20 rounded-full bg-[#E50914] hover:bg-red-700 text-white flex items-center justify-center shadow-[0_0_40px_rgba(229,9,20,0.5)] transition-transform hover:scale-105 active:scale-95 mb-4"
            aria-label="Reproduzir vídeo"
          >
            <Play className="w-9 h-9 fill-white ml-1" />
          </button>
          <span className="text-xs font-black uppercase tracking-[0.2em] text-white">
            Toque em Play para Reproduzir
          </span>
          <span className="text-[11px] text-zinc-400 mt-1">
            Reprodução automática bloqueada pelo navegador
          </span>
        </div>
      )}

      {/* ERROR OVERLAY */}
      {hasError && !resolving && (
        <div
          className="absolute inset-0 z-50 bg-[#080808] flex flex-col items-center justify-center p-6 sm:p-8 text-center"
          onTouchEnd={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-14 h-14 rounded-full bg-[#E50914]/15 border border-[#E50914]/35 flex items-center justify-center text-[#E50914] mb-4">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#E50914] mb-1">
            RONYCINE
          </span>
          <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight text-white mb-2 font-display">
            Esta fonte não permite reprodução dentro do nosso player.
          </h3>
          <p className="text-xs sm:text-sm font-medium text-zinc-400 max-w-md mb-6 leading-relaxed">
            {errorMessage || 'O fornecedor restringe a incorporação direta (X-Frame-Options). Utilize o botão abaixo para abrir no fornecedor ou escolha outra fonte.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {(activeSource?.externalPageUrl || resolvedData?.externalPageUrl || activeUrl) && (
              <a
                href={activeSource?.externalPageUrl || resolvedData?.externalPageUrl || activeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] px-6 py-3 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold uppercase tracking-widest rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-[#E50914]/30"
              >
                <span>Abrir no Fornecedor</span>
              </a>
            )}

            {sourceList.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSourceMenu(prev => !prev)}
                  className="min-h-[44px] px-6 py-3 bg-[#202020] hover:bg-[#303030] border border-white/15 text-white text-xs font-bold uppercase tracking-widest rounded-xl flex items-center gap-2 transition-all"
                >
                  <Layers className="w-4 h-4 text-[#E50914]" />
                  <span>Escolher Outra Fonte ({sourceList.length})</span>
                </button>
                {showSourceMenu && (
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 bg-[#111111] border border-white/15 rounded-xl shadow-2xl p-2 z-50 flex flex-col gap-1 text-left max-h-64 overflow-y-auto">
                    {sourceList.map((s, idx) => {
                      const badge = formatSourceVersionBadge(s);
                      const isFailed = failedIndicesRef.current.has(idx);
                      return (
                        <button
                          key={s.id || idx}
                          type="button"
                          onClick={() => {
                            failedIndicesRef.current.delete(idx);
                            switchSource(idx, true);
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                            activeSourceIndex === idx ? 'bg-[#E50914] text-white' : 'text-zinc-300 hover:bg-white/10'
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="block truncate">{badge.fullLabel}</span>
                            <span className="text-[10px] font-medium opacity-75 truncate block">
                              {[s.serverName || `Fonte ${idx + 1}`, isFailed ? 'Falhou antes' : 'Alternativa'].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                          {activeSourceIndex === idx && <Check className="w-3.5 h-3.5 shrink-0 ml-2" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                failedIndicesRef.current.clear();
                setRetryToken(t => t + 1);
              }}
              className="min-h-[44px] px-5 py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold uppercase tracking-widest rounded-xl flex items-center gap-2 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar Novamente</span>
            </button>

            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="min-h-[44px] px-5 py-3 bg-white/5 border border-white/10 text-zinc-300 text-xs font-bold uppercase tracking-widest rounded-xl flex items-center gap-2 hover:bg-white/10 hover:text-white transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ACTIVE MEDIA STAGE (Frame size & orientation transitions never reload video element) */}
      {!resolving && !hasError && resolvedData && (
        <div className={frameWrapperClass}>
          {resolvedData.isDirect ? (
            <video
              ref={videoRef}
              poster={poster}
              playsInline
              preload="metadata"
              {...(useCors ? { crossOrigin: 'anonymous' as const } : {})}
              className={`${videoFitClass} bg-black transition-all duration-200`}
              onLoadStart={() => {
                if (autoplay) setIsBuffering(true);
              }}
              onWaiting={() => {
                setIsBuffering(true);
                setPhaseLabel('A carregar vídeo...');
              }}
              onProgress={updateBufferedMetrics}
              onLoadedData={() => {
                setIsBuffering(false);
                setLongLoadingStalled(false);
                updateBufferedMetrics();
                if (!startedReportedRef.current) {
                  startedReportedRef.current = true;
                  setPhaseLabel('Reprodução pronta!');
                  onPlaybackEventRef.current?.('STARTED', undefined, resolvedData.format, resolvedData.directUrl);
                }
              }}
              onCanPlay={() => {
                setIsBuffering(false);
                setLongLoadingStalled(false);
                updateBufferedMetrics();
                applyPendingResumeSeek();
                if (!startedReportedRef.current) {
                  startedReportedRef.current = true;
                  setPhaseLabel('Reprodução pronta!');
                  onPlaybackEventRef.current?.('STARTED', undefined, resolvedData.format, resolvedData.directUrl);
                }
              }}
              onPlaying={() => {
                setIsPlaying(true);
                setIsBuffering(false);
                setLongLoadingStalled(false);
                setAutoplayBlocked(false);
                setRealLoadProgress(null);
                if (videoRef.current && verifyResumeSeekRef.current !== null) {
                  const target = verifyResumeSeekRef.current;
                  if (videoRef.current.currentTime < 3 && target > 10) {
                    try {
                      videoRef.current.currentTime = target;
                    } catch {}
                  }
                  verifyResumeSeekRef.current = null;
                }
                if (!startedReportedRef.current) {
                  startedReportedRef.current = true;
                  setPhaseLabel('Reprodução pronta!');
                  onPlaybackEventRef.current?.('STARTED', undefined, resolvedData.format, resolvedData.directUrl);
                }
              }}
              onPause={() => {
                setIsPlaying(false);
                setShowControls(true);
                flushProgressNow(true, false);
              }}
              onTimeUpdate={() => {
                if (!videoRef.current) return;
                const cur = videoRef.current.currentTime || 0;
                const dur = videoRef.current.duration || 0;
                setCurrentTime(cur);
                setDuration(dur);
                updateBufferedMetrics();

                // Guard: do not overwrite previous saved resume position during initial seconds while prompt is open
                if (resumeDecisionRef.current === 'pending' && cur < 15) {
                  return;
                }

                const isNearEndCompleted = dur > 60 && cur >= dur * 0.93;
                if (cur >= 10 && (Math.abs(cur - lastPersistedSecRef.current) >= 4 || isNearEndCompleted)) {
                  lastSavedTimeRef.current = cur;
                  lastPersistedSecRef.current = cur;
                  writeStoredResume(resumeKey, cur, dur, isNearEndCompleted);
                  if (isNearEndCompleted) {
                    setResumePromptSec(0);
                    resumeDecisionRef.current = 'dismissed';
                  }
                }
                if (onProgress && cur >= 10) {
                  onProgress({
                    currentTime: cur,
                    duration: dur,
                    progressPercent: isNearEndCompleted ? 100 : dur > 0 ? (cur / dur) * 100 : 0,
                    completed: isNearEndCompleted,
                    flush: isNearEndCompleted
                  });
                }
              }}
              onEnded={() => {
                setIsPlaying(false);
                const dur = videoRef.current?.duration || duration || 0;
                setResumePromptSec(0);
                pendingResumeSeekRef.current = null;
                verifyResumeSeekRef.current = null;
                resumeDecisionRef.current = 'dismissed';
                writeStoredResume(resumeKey, dur, dur, true);
                if (onProgressRef.current) {
                  onProgressRef.current({
                    currentTime: dur,
                    duration: dur,
                    progressPercent: 100,
                    completed: true,
                    flush: true
                  });
                }
                if (onEnded) onEnded();
              }}
              onError={() => {
                if (useCors) {
                  setUseCors(false);
                  return;
                }
                if (resolvedData.fallbackToIframe && resolvedData.embedUrl) {
                  setPhaseLabel('A preparar transmissão...');
                  setIsBuffering(true);
                  setResolvedData({
                    ...resolvedData,
                    isDirect: false,
                    format: 'iframe',
                    fallbackToIframe: false
                  });
                  return;
                }
                if (
                  resolvedData.format !== 'm3u8' &&
                  resolvedData.format !== 'hls' &&
                  resolvedData.format !== 'dash' &&
                  resolvedData.format !== 'mpd'
                ) {
                  handlePlaybackFailure(
                    'O navegador não conseguiu carregar ou descodificar este stream de vídeo.',
                    resolvedData.format,
                    resolvedData.directUrl
                  );
                }
              }}
            >
            </video>
          ) : (
            <div className="relative w-full h-full bg-black">
              <iframe
                key={resolvedData.embedUrl}
                src={resolvedData.embedUrl}
                className="w-full h-full border-none"
                allowFullScreen
                referrerPolicy="no-referrer-when-downgrade"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                title={title || 'RONYCINE CINEMA ULTRA'}
                onLoad={() => {
                  setIframeLoaded(true);
                  setIsBuffering(false);
                  setLongLoadingStalled(false);
                  setPhaseLabel('Reprodução pronta!');
                  if (!startedReportedRef.current) {
                    startedReportedRef.current = true;
                    onPlaybackEventRef.current?.('STARTED', undefined, 'embed', resolvedData.embedUrl);
                  }
                }}
                onError={() => {
                  handlePlaybackFailure(
                    'Não foi possível carregar o player incorporado externo.',
                    'embed',
                    resolvedData.embedUrl
                  );
                }}
              />
            </div>
          )}

          {/* CUSTOM SUBTITLE OVERLAY (Renders parsed .srt/.vtt with sync offset & typography customization) */}
          {resolvedData.isDirect && activeOverlaySubtitleText && (
            <div
              className={`absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none px-4 w-full max-w-3xl text-center transition-all duration-200 ${
                controlsVisible ? 'bottom-20 sm:bottom-24' : 'bottom-6 sm:bottom-10'
              }`}
            >
              <span
                className={`inline-block rounded-lg px-3 py-1.5 font-semibold leading-snug whitespace-pre-line shadow-lg ${
                  subPrefs.fontSize === 'small'
                    ? 'text-xs sm:text-sm'
                    : subPrefs.fontSize === 'large'
                      ? 'text-base sm:text-xl'
                      : subPrefs.fontSize === 'xlarge'
                        ? 'text-lg sm:text-2xl'
                        : 'text-sm sm:text-base'
                } ${
                  subPrefs.bgOpacity === 'dark'
                    ? 'bg-black/90'
                    : subPrefs.bgOpacity === 'semi'
                      ? 'bg-black/60 backdrop-blur-sm'
                      : 'bg-transparent [text-shadow:_0_2px_6px_rgb(0_0_0_/_95%),_0_0_3px_rgb(0_0_0_/_90%)]'
                } ${
                  subPrefs.color === '#FACC15'
                    ? 'text-yellow-400'
                    : subPrefs.color === '#38BDF8'
                      ? 'text-sky-400'
                      : 'text-white'
                }`}
              >
                {activeOverlaySubtitleText}
              </span>
            </div>
          )}
        </div>
      )}

      {/* CINEMA ULTRA CONTROLS OVERLAY */}
      {!resolving && !hasError && resolvedData && (
        <AnimatePresence>
          {controlsVisible && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className={`absolute inset-0 z-30 flex flex-col justify-between pointer-events-none ${
                resolvedData.isDirect
                  ? 'bg-gradient-to-t from-black/95 via-transparent to-black/75'
                  : 'bg-gradient-to-b from-black/80 via-transparent to-transparent'
              }`}
            >
              {/* TOP BAR */}
              <div
                className={`p-3 sm:p-5 flex items-center justify-between gap-3 ${
                  controlsVisible ? 'pointer-events-auto' : 'pointer-events-none'
                }`}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  showControlsTemporarily();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  showControlsTemporarily();
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {onBack && (
                    <button
                      type="button"
                      onClick={onBack}
                      className="min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl bg-black/70 hover:bg-[#E50914] border border-white/10 text-white flex items-center justify-center transition-colors shrink-0"
                      title="Voltar"
                    >
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  )}
                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-[#E50914] text-[10px] font-black uppercase tracking-[0.22em]">
                        RONYCINE
                      </span>
                    </div>
                    {title && (
                      <h2 className="text-white text-xs sm:text-base font-bold tracking-tight font-display truncate">
                        {title}
                      </h2>
                    )}
                  </div>
                </div>

                {/* Top Right Actions: Next Episode + Embed Audio/Source + Download Status + Fullscreen */}
                <div className="flex items-center gap-2 shrink-0">
                  {hasNextEpisode && onNextEpisode && (
                    <button
                      type="button"
                      onClick={onNextEpisode}
                      className="min-h-[44px] sm:min-h-[38px] px-3.5 py-2 rounded-xl bg-[#E50914] hover:bg-red-700 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all shadow-lg shadow-[#E50914]/25"
                    >
                      <span className="hidden sm:inline">Próximo Episódio</span>
                      <span className="sm:hidden">Próx. Ep</span>
                      <SkipForward className="w-4 h-4" />
                    </button>
                  )}

                  {!resolvedData.isDirect && (
                    <div className="flex items-center gap-2">
                      {sourceList.length > 1 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => {
                              setShowAudioSubPanel(prev => !prev);
                              setShowSettingsMenu(false);
                              setShowSourceMenu(false);
                              setShowDownloadMenu(false);
                            }}
                            className={`min-h-[44px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                              showAudioSubPanel
                                ? 'bg-[#E50914] border-[#E50914] text-white shadow-lg shadow-[#E50914]/30'
                                : 'bg-[#111111]/90 border-white/15 hover:border-[#E50914] text-white'
                            }`}
                            title="Versão do Áudio"
                            aria-label="Versão do Áudio"
                          >
                            {effectiveVersion === 'dublado' ? (
                              <Volume2 className="w-4 h-4 text-[#E50914]" />
                            ) : (
                              <Subtitles className="w-4 h-4 text-[#E50914]" />
                            )}
                            <span className="hidden sm:inline text-[11px] font-bold">
                              {effectiveVersion === 'dublado' ? 'Dublado' : 'Legendado'}
                            </span>
                          </button>

                          {showAudioSubPanel && (
                            <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-[#111111]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-50 p-3 space-y-2.5">
                              <div className="px-1 pb-1.5 border-b border-white/10 flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                  Versão do Áudio
                                </span>
                                <span className="text-[10px] text-zinc-400 font-medium">
                                  {effectiveVersion === 'dublado' ? 'Dublado ativo' : 'Legendado ativo'}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSelectDublado();
                                    setShowAudioSubPanel(false);
                                  }}
                                  className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                                    effectiveVersion === 'dublado'
                                      ? 'bg-[#E50914] border-[#E50914] text-white font-bold shadow-md shadow-[#E50914]/30'
                                      : isDubladoAvailable
                                        ? 'bg-black/60 border-white/15 hover:border-white/30 text-zinc-200'
                                        : 'bg-black/30 border-white/5 text-zinc-500 opacity-60'
                                  }`}
                                  title={isDubladoAvailable ? 'Selecionar versão dublada' : dubladoUnavailableText}
                                >
                                  <div className="flex items-center gap-1">
                                    <Volume2 className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-black uppercase">Dublado</span>
                                  </div>
                                  <span className="text-[9px] opacity-75">
                                    {isDubladoAvailable
                                      ? 'Áudio PT'
                                      : versionAvailability?.dublado?.status === 'unavailable'
                                      ? 'Indisponível'
                                      : 'Não cadastrada'}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSelectLegendado();
                                    setShowAudioSubPanel(false);
                                  }}
                                  className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all ${
                                    effectiveVersion === 'legendado'
                                      ? 'bg-[#E50914] border-[#E50914] text-white font-bold shadow-md shadow-[#E50914]/30'
                                      : isLegendadoAvailable
                                        ? 'bg-black/60 border-white/15 hover:border-white/30 text-zinc-200'
                                        : 'bg-black/30 border-white/5 text-zinc-500 opacity-60'
                                  }`}
                                  title={isLegendadoAvailable ? 'Selecionar versão legendada' : legendadoUnavailableText}
                                >
                                  <div className="flex items-center gap-1">
                                    <Subtitles className="w-3.5 h-3.5" />
                                    <span className="text-[11px] font-black uppercase">Legendado</span>
                                  </div>
                                  <span className="text-[9px] opacity-75">
                                    {isLegendadoAvailable
                                      ? 'Com Legenda'
                                      : versionAvailability?.legendado?.status === 'unavailable'
                                      ? 'Indisponível'
                                      : 'Não cadastrada'}
                                  </span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowDownloadMenu(prev => !prev);
                            setShowSettingsMenu(false);
                            setShowSourceMenu(false);
                          }}
                          className={`min-h-[44px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-xl border flex items-center justify-center gap-1.5 transition-all ${
                            showDownloadMenu
                              ? 'bg-[#E50914] border-[#E50914] text-white'
                              : 'bg-[#111111]/90 border-white/15 hover:border-[#E50914] text-zinc-200'
                          }`}
                          title="Baixar"
                        >
                          <Download className="w-4 h-4" />
                          <span className="hidden sm:inline text-[11px] font-bold">Baixar</span>
                        </button>

                        {showDownloadMenu && (
                          <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-1.5rem)] bg-[#111111]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-3.5 text-xs z-50 space-y-2.5">
                            <div className="flex items-start gap-2.5 text-amber-300">
                              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-[#E50914]" />
                              <div>
                                <p className="font-bold text-white">Esta fonte não suporta download direto.</p>
                                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                                  {downloadInfo.warningText}
                                </p>
                              </div>
                            </div>
                            {sourceList.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowDownloadMenu(false);
                                  setShowSettingsMenu(true);
                                  setSettingsSubmenu('sources');
                                }}
                                className="w-full py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-[11px] text-center"
                              >
                                Ver Outras Fontes Disponíveis
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl bg-[#111111]/90 border border-white/15 hover:border-[#E50914] text-white flex items-center justify-center transition-all"
                        title="Ecrã Inteiro"
                      >
                        {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* CENTER PLAY/PAUSE & SEEK (Direct Video Mode Only — Explicit Play/Pause button only) */}
              {resolvedData.isDirect && !autoplayBlocked && !showUltraLoading && (
                <div
                  className={`flex items-center justify-center gap-6 sm:gap-10 ${
                    controlsVisible ? 'pointer-events-auto' : 'pointer-events-none'
                  }`}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    showControlsTemporarily();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    showControlsTemporarily();
                  }}
                >
                  <button
                    type="button"
                    onClick={() => seek(-10)}
                    className="min-w-[48px] min-h-[48px] rounded-full bg-black/50 hover:bg-black/80 border border-white/10 text-white/90 hover:text-white flex items-center justify-center transition-all active:scale-95"
                    title="Voltar 10s (←)"
                  >
                    <RotateCcw className="w-6 h-6 sm:w-7 sm:h-7" />
                  </button>
                  <button
                    type="button"
                    onClick={togglePlay}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#E50914] text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-2xl shadow-[#E50914]/45"
                    title={isPlaying ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
                    aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                  >
                    {isPlaying ? (
                      <Pause className="w-7 h-7 sm:w-9 sm:h-9 fill-white" />
                    ) : (
                      <Play className="w-7 h-7 sm:w-9 sm:h-9 fill-white ml-1" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => seek(10)}
                    className="min-w-[48px] min-h-[48px] rounded-full bg-black/50 hover:bg-black/80 border border-white/10 text-white/90 hover:text-white flex items-center justify-center transition-all active:scale-95"
                    title="Avançar 10s (→)"
                  >
                    <RotateCw className="w-6 h-6 sm:w-7 sm:h-7" />
                  </button>
                </div>
              )}

              {/* BOTTOM CONTROLS BAR (Direct Video Mode Only) */}
              {resolvedData.isDirect ? (
                <div
                  className={`px-3 pb-3 pt-2 sm:px-6 sm:pb-4 space-y-2 relative bg-gradient-to-t from-[#080808]/95 via-[#080808]/75 to-transparent ${
                    controlsVisible ? 'pointer-events-auto' : 'pointer-events-none'
                  }`}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    showControlsTemporarily();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    showControlsTemporarily();
                  }}
                >
                  {/* Timeline Slider with real buffer track */}
                  <div className="relative group/slider h-6 flex items-center">
                    <div className="absolute inset-x-0 h-1.5 rounded-full bg-white/15 overflow-hidden pointer-events-none">
                      <div
                        className="h-full bg-white/30 transition-all duration-300"
                        style={{ width: `${bufferedPercent}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={duration || 100}
                      value={currentTime}
                      onMouseDown={() => setIsSeeking(true)}
                      onMouseUp={() => setIsSeeking(false)}
                      onTouchStart={() => setIsSeeking(true)}
                      onTouchEnd={() => setIsSeeking(false)}
                      onChange={handleSeekChange}
                      className="relative z-10 w-full h-1.5 bg-transparent appearance-none rounded-full cursor-pointer accent-[#E50914] outline-none transition-all hover:h-2"
                      style={{
                        background: `linear-gradient(to right, #E50914 ${duration > 0 ? (currentTime / duration) * 100 : 0}%, transparent ${duration > 0 ? (currentTime / duration) * 100 : 0}%)`
                      }}
                    />
                  </div>

                  {/* Action Row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 sm:gap-3.5">
                      <button
                        type="button"
                        onClick={togglePlay}
                        className="min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] flex items-center justify-center text-white hover:text-[#E50914] transition-colors"
                        title={isPlaying ? 'Pausar' : 'Reproduzir'}
                        aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                      >
                        {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white" />}
                      </button>

                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <button
                          type="button"
                          onClick={toggleMute}
                          className="min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] flex items-center justify-center text-white hover:text-[#E50914] transition-colors"
                          title={isMuted ? 'Ativar Som (M)' : 'Silenciar (M)'}
                        >
                          {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                        </button>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={isMuted ? 0 : volume}
                          onChange={handleVolumeChange}
                          className="hidden sm:block w-20 h-1.5 bg-white/20 appearance-none rounded-full cursor-pointer accent-[#E50914] outline-none"
                        />
                      </div>

                      <div className="text-[11px] sm:text-xs font-bold text-white font-mono tabular-nums whitespace-nowrap">
                        {formatTime(currentTime)} <span className="mx-1 text-zinc-500">/</span> {formatTime(duration)}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-2">
                      {/* UNIFIED ÁUDIO / LEGENDA TWO-BUTTON SELECTOR */}
                      <div className="relative flex items-center gap-1.5">
                        {/* On md screens and up: DIRECT TWO BUTTONS [ DUBLADO ] [ LEGENDADO ] */}
                        <div className="hidden md:flex items-center gap-1 bg-black/60 p-1 rounded-xl border border-white/10">
                          {/* BOTÃO 1 — DUBLADO */}
                          <button
                            type="button"
                            onClick={handleSelectDublado}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                              effectiveVersion === 'dublado'
                                ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/40 font-extrabold'
                                : isDubladoAvailable
                                  ? 'text-zinc-300 hover:text-white hover:bg-white/10'
                                  : 'text-zinc-500 hover:text-zinc-400 opacity-60'
                            }`}
                            title={isDubladoAvailable ? 'Selecionar áudio dublado' : dubladoUnavailableText}
                          >
                            <Volume2 className="w-3.5 h-3.5 shrink-0" />
                            <span>Dublado</span>
                            {effectiveVersion === 'dublado' && <Check className="w-3 h-3 ml-0.5" />}
                          </button>

                          {/* BOTÃO 2 — LEGENDADO */}
                          <button
                            type="button"
                            onClick={handleSelectLegendado}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all ${
                              effectiveVersion === 'legendado'
                                ? 'bg-[#E50914] text-white shadow-md shadow-[#E50914]/40 font-extrabold'
                                : isLegendadoAvailable
                                  ? 'text-zinc-300 hover:text-white hover:bg-white/10'
                                  : 'text-zinc-500 hover:text-zinc-400 opacity-60'
                            }`}
                            title={isLegendadoAvailable ? 'Selecionar versão legendada' : legendadoUnavailableText}
                          >
                            <Subtitles className="w-3.5 h-3.5 shrink-0" />
                            <span>Legendado</span>
                            {effectiveVersion === 'legendado' && <Check className="w-3 h-3 ml-0.5" />}
                          </button>
                        </div>

                        {/* On small / mobile screens: Touch trigger button that opens the 2-button panel */}
                        <div className="md:hidden relative">
                          <button
                            type="button"
                            onClick={() => {
                              setShowAudioSubPanel(prev => !prev);
                              setShowSettingsMenu(false);
                              setShowSourceMenu(false);
                              setShowDownloadMenu(false);
                            }}
                            className={`min-h-[44px] px-2.5 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-bold transition-all ${
                              showAudioSubPanel
                                ? 'bg-[#E50914] border-[#E50914] text-white shadow-lg shadow-[#E50914]/30'
                                : 'bg-white/10 border-white/15 hover:bg-white/20 text-white'
                            }`}
                            title="Versão do Áudio"
                          >
                            {effectiveVersion === 'dublado' ? (
                              <Volume2 className="w-4 h-4 text-[#E50914]" />
                            ) : (
                              <Subtitles className="w-4 h-4 text-[#E50914]" />
                            )}
                            <span>{effectiveVersion === 'dublado' ? 'Dublado' : 'Legendado'}</span>
                          </button>
                        </div>

                        {/* POPOVER PANEL FOR MOBILE OR EXPANDED MODAL */}
                        {showAudioSubPanel && (
                          <div className="fixed sm:absolute right-3 sm:right-0 bottom-16 sm:bottom-full sm:mb-3 w-[calc(100vw-1.5rem)] sm:w-80 flex flex-col bg-[#111111]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-50 text-xs p-3 space-y-3">
                            <div className="flex items-center justify-between pb-2 border-b border-white/10">
                              <div className="flex items-center gap-2">
                                <AudioLines className="w-4 h-4 text-[#E50914]" />
                                <span className="text-[11px] font-black uppercase tracking-wider text-white">
                                  Versão do Áudio
                                </span>
                              </div>
                              <span className="text-[10px] text-zinc-400 font-medium">
                                {effectiveVersion === 'dublado' ? 'Dublado ativo' : 'Legendado ativo'}
                              </span>
                            </div>

                            {/* APENAS OS DOIS BOTÕES */}
                            <div className="grid grid-cols-2 gap-2.5">
                              {/* BOTÃO 1 — DUBLADO */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleSelectDublado();
                                  setShowAudioSubPanel(false);
                                }}
                                className={`relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
                                  effectiveVersion === 'dublado'
                                    ? 'bg-[#E50914] border-[#E50914] text-white shadow-lg shadow-[#E50914]/30 font-bold'
                                    : isDubladoAvailable
                                      ? 'bg-black/60 border-white/15 hover:border-white/30 hover:bg-white/10 text-zinc-200'
                                      : 'bg-black/30 border-white/5 text-zinc-500 opacity-60 hover:opacity-80'
                                }`}
                                title={isDubladoAvailable ? 'Selecionar áudio dublado' : dubladoUnavailableText}
                              >
                                <div className="flex items-center justify-center gap-1.5">
                                  <Volume2 className="w-4 h-4 shrink-0" />
                                  <span className="font-extrabold uppercase tracking-wide text-xs">Dublado</span>
                                  {effectiveVersion === 'dublado' && <Check className="w-3.5 h-3.5 ml-0.5" />}
                                </div>
                                <span className="text-[10px] opacity-80 leading-tight">
                                  {effectiveVersion === 'dublado'
                                    ? 'Em reprodução'
                                    : isDubladoAvailable
                                      ? 'Áudio em PT'
                                      : versionAvailability?.dublado?.status === 'unavailable'
                                      ? 'Indisponível'
                                      : 'Não cadastrada'}
                                </span>
                              </button>

                              {/* BOTÃO 2 — LEGENDADO */}
                              <button
                                type="button"
                                onClick={() => {
                                  handleSelectLegendado();
                                  setShowAudioSubPanel(false);
                                }}
                                className={`relative flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl border text-center transition-all ${
                                  effectiveVersion === 'legendado'
                                    ? 'bg-[#E50914] border-[#E50914] text-white shadow-lg shadow-[#E50914]/30 font-bold'
                                    : isLegendadoAvailable
                                      ? 'bg-black/60 border-white/15 hover:border-white/30 hover:bg-white/10 text-zinc-200'
                                      : 'bg-black/30 border-white/5 text-zinc-500 opacity-60 hover:opacity-80'
                                }`}
                                title={isLegendadoAvailable ? 'Selecionar versão legendada' : legendadoUnavailableText}
                              >
                                <div className="flex items-center justify-center gap-1.5">
                                  <Subtitles className="w-4 h-4 shrink-0" />
                                  <span className="font-extrabold uppercase tracking-wide text-xs">Legendado</span>
                                  {effectiveVersion === 'legendado' && <Check className="w-3.5 h-3.5 ml-0.5" />}
                                </div>
                                <span className="text-[10px] opacity-80 leading-tight">
                                  {effectiveVersion === 'legendado'
                                    ? 'Em reprodução'
                                    : isLegendadoAvailable
                                      ? 'Original + Legenda'
                                      : versionAvailability?.legendado?.status === 'unavailable'
                                      ? 'Indisponível'
                                      : 'Não cadastrada'}
                                </span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* BAIXAR (HONEST DOWNLOAD MANAGER MODAL/POPOVER) */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowDownloadMenu(prev => !prev);
                            setDownloadFeedbackMsg(null);
                            setShowSettingsMenu(false);
                            setShowSourceMenu(false);
                            setShowAudioSubPanel(false);
                          }}
                          className={`min-h-[44px] sm:min-h-[38px] px-2.5 sm:px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-wider transition-all ${
                            showDownloadMenu
                              ? 'bg-white text-black'
                              : 'bg-[#E50914] hover:bg-red-700 text-white shadow-lg shadow-[#E50914]/30'
                          }`}
                          title="Baixar vídeo ou enviar para 1DM / ADM"
                        >
                          <Download className="w-4 h-4 shrink-0" />
                          <span className="hidden sm:inline">Baixar</span>
                        </button>

                        {showDownloadMenu && (
                          <div className="fixed sm:absolute right-3 sm:right-0 bottom-16 sm:bottom-full sm:mb-3 w-[calc(100vw-1.5rem)] sm:w-80 bg-[#111111]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-50 p-3 text-xs space-y-3">
                            <div className="flex items-center justify-between border-b border-white/10 pb-2">
                              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
                                <FileVideo className="w-3.5 h-3.5 text-[#E50914]" />
                                Download RONYCINE
                              </span>
                              <span className="text-[10px] font-mono text-zinc-300 font-bold">
                                {downloadInfo.formatLabel}
                              </span>
                            </div>

                            {/* Honest File Metadata Block */}
                            <div className="bg-black/60 border border-white/10 rounded-xl p-2.5 space-y-1 text-[11px]">
                              <div className="flex justify-between gap-2">
                                <span className="text-zinc-500">Ficheiro:</span>
                                <span className="text-zinc-200 font-mono truncate">{downloadInfo.suggestedFilename}</span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span className="text-zinc-500">Qualidade:</span>
                                <span className="text-zinc-200 font-semibold">{downloadInfo.qualityLabel}</span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span className="text-zinc-500">Tamanho:</span>
                                <span className="text-zinc-200 font-mono">{downloadInfo.sizeLabel}</span>
                              </div>
                              <p className={`pt-1 text-[10px] font-semibold ${downloadInfo.supported ? 'text-emerald-400' : 'text-red-400'}`}>
                                {downloadInfo.compatibilityText}
                              </p>
                              {downloadInfo.warningText && (
                                <p className="text-[10px] text-amber-300 leading-snug">
                                  {downloadInfo.warningText}
                                </p>
                              )}
                            </div>

                            {downloadInfo.supported ? (
                              <div className="space-y-1">
                                {downloadInfo.mode === 'direct_file' && (
                                  <button
                                    type="button"
                                    onClick={handleDirectDownload}
                                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl bg-[#E50914]/15 hover:bg-[#E50914] text-white transition-colors min-h-[40px] text-left"
                                  >
                                    <Download className="w-4 h-4 shrink-0" />
                                    <div>
                                      <p className="font-bold">Download Direto</p>
                                      <p className="text-[10px] opacity-80">Descarregar pelo navegador</p>
                                    </div>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleExternalManagerIntent('1dm')}
                                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[40px] text-left"
                                >
                                  <div className="w-5 h-5 rounded bg-[#E50914]/20 text-[#E50914] font-black text-[10px] flex items-center justify-center shrink-0">
                                    1D
                                  </div>
                                  <div>
                                    <p className="font-bold">1DM</p>
                                    <p className="text-[10px] text-zinc-400">Abrir no 1DM (Android)</p>
                                  </div>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleExternalManagerIntent('adm')}
                                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[40px] text-left"
                                >
                                  <div className="w-5 h-5 rounded bg-sky-500/20 text-sky-400 font-black text-[10px] flex items-center justify-center shrink-0">
                                    AD
                                  </div>
                                  <div>
                                    <p className="font-bold">ADM</p>
                                    <p className="text-[10px] text-zinc-400">Abrir no Advanced Download Manager</p>
                                  </div>
                                </button>

                                <button
                                  type="button"
                                  onClick={handleShareDownload}
                                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[40px] text-left"
                                >
                                  <Share2 className="w-4 h-4 text-zinc-300 shrink-0" />
                                  <div>
                                    <p className="font-bold">Outro Gestor / Partilhar</p>
                                    <p className="text-[10px] text-zinc-400">Enviar link para outra aplicação</p>
                                  </div>
                                </button>

                                <button
                                  type="button"
                                  onClick={handleCopyDownloadLink}
                                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[40px] text-left border-t border-white/5 pt-2"
                                >
                                  <Copy className="w-4 h-4 text-zinc-300 shrink-0" />
                                  <div>
                                    <p className="font-bold">Copiar Link de Download</p>
                                    <p className="text-[10px] text-zinc-400">Copiar URL direta do stream</p>
                                  </div>
                                </button>
                              </div>
                            ) : (
                              sourceList.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowDownloadMenu(false);
                                    setShowAudioSubPanel(true);
                                  }}
                                  className="w-full py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-center"
                                >
                                  Escolher Outra Fonte
                                </button>
                              )
                            )}

                            {downloadFeedbackMsg && (
                              <p className="p-2 rounded-xl bg-white/5 border border-white/10 text-[10px] text-amber-300 leading-snug">
                                {downloadFeedbackMsg}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* CINEMA MODE */}
                      <button
                        type="button"
                        onClick={handleCinemaToggle}
                        className={`min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] rounded-xl flex items-center justify-center transition-all ${
                          effectiveCinemaMode ? 'text-[#E50914] bg-white/10' : 'text-white hover:text-[#E50914]'
                        }`}
                        title="Modo Cinema"
                      >
                        <RectangleHorizontal className="w-5 h-5" />
                      </button>

                      {/* COMPACT MAIS OPÇÕES POPOVER */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setShowSettingsMenu(prev => !prev);
                            setSettingsSubmenu('root');
                            setShowSourceMenu(false);
                            setShowAudioSubPanel(false);
                            setShowDownloadMenu(false);
                          }}
                          className={`min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] px-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all ${
                            showSettingsMenu
                              ? 'bg-[#E50914] text-white'
                              : 'bg-white/10 hover:bg-white/20 text-white'
                          }`}
                          title="Mais opções"
                          aria-label="Mais opções"
                        >
                          <Settings className="w-4 h-4" />
                          <span className="hidden md:inline text-[11px] font-bold">Mais Opções</span>
                        </button>

                        {showSettingsMenu && (
                          <div className="fixed sm:absolute right-3 sm:right-0 bottom-16 sm:bottom-full sm:mb-3 w-[calc(100vw-1.5rem)] sm:w-80 bg-[#111111]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden z-50">
                            {settingsSubmenu === 'root' ? (
                              <div className="p-2 divide-y divide-white/5 text-xs">
                                <div className="px-3 py-2 flex items-center justify-between">
                                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                    Mais Opções
                                  </span>
                                  <span className="text-[10px] font-mono text-[#E50914] font-bold">
                                    {playbackSpeed}x
                                  </span>
                                </div>

                                <div className="py-1 space-y-0.5">
                                  <button
                                    type="button"
                                    onClick={() => setSettingsSubmenu('frame')}
                                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[44px]"
                                  >
                                    <span className="flex items-center gap-2.5 font-semibold">
                                      <Maximize2 className="w-4 h-4 text-[#E50914]" />
                                      Tamanho do Ecrã
                                    </span>
                                    <span className="flex items-center gap-1 text-zinc-400 text-[11px]">
                                      {activeFrameLabel}
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    </span>
                                  </button>

                                  {qualityLevels.length > 1 ? (
                                    <button
                                      type="button"
                                      onClick={() => setSettingsSubmenu('quality')}
                                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[44px]"
                                    >
                                      <span className="flex items-center gap-2.5 font-semibold">
                                        <Settings className="w-4 h-4 text-zinc-300" />
                                        Qualidade
                                      </span>
                                      <span className="flex items-center gap-1 text-zinc-400 text-[11px]">
                                        {selectedQuality === -1
                                          ? 'Automática'
                                          : qualityLevels.find(q => q.index === selectedQuality)?.label || 'Auto'}
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      </span>
                                    </button>
                                  ) : (detectedVideoQuality || qualityLevels[0]?.label || activeSource?.quality) ? (
                                    <div className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-zinc-300 min-h-[44px]">
                                      <span className="flex items-center gap-2.5 font-semibold">
                                        <Settings className="w-4 h-4 text-zinc-400" />
                                        Resolução
                                      </span>
                                      <span className="text-zinc-400 text-[11px] font-mono">
                                        {detectedVideoQuality || qualityLevels[0]?.label || activeSource?.quality}
                                      </span>
                                    </div>
                                  ) : null}

                                  <button
                                    type="button"
                                    onClick={() => setSettingsSubmenu('speed')}
                                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[44px]"
                                  >
                                    <span className="flex items-center gap-2.5 font-semibold">
                                      <RefreshCw className="w-4 h-4 text-zinc-300" />
                                      Velocidade
                                    </span>
                                    <span className="flex items-center gap-1 text-zinc-400 text-[11px] font-mono">
                                      {playbackSpeed}x
                                      <ChevronRight className="w-3.5 h-3.5" />
                                    </span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowSettingsMenu(false);
                                      setShowAudioSubPanel(true);
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[44px]"
                                  >
                                    <span className="flex items-center gap-2.5 font-semibold">
                                      <AudioLines className="w-4 h-4 text-[#E50914]" />
                                      Versão do Áudio
                                    </span>
                                    <span className="flex items-center gap-1 text-zinc-400 text-[11px] font-semibold truncate max-w-[120px]">
                                      {effectiveVersion === 'dublado' ? 'Dublado' : 'Legendado'}
                                      <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                                    </span>
                                  </button>

                                  {sourceList.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => setSettingsSubmenu('sources')}
                                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[44px]"
                                    >
                                      <span className="flex items-center gap-2.5 font-semibold">
                                        <Layers className="w-4 h-4 text-[#E50914]" />
                                        Fontes e Versões
                                      </span>
                                      <span className="flex items-center gap-1 text-zinc-400 text-[11px]">
                                        {formatSourceVersionBadge(activeSource || {}).shortLabel}
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      </span>
                                    </button>
                                  )}
                                </div>

                                <div className="pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleCinemaToggle();
                                      setShowSettingsMenu(false);
                                    }}
                                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-[#202020] text-white transition-colors min-h-[44px]"
                                  >
                                    <span className="flex items-center gap-2.5 font-semibold">
                                      <RectangleHorizontal className="w-4 h-4 text-zinc-300" />
                                      Modo Cinema
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                        effectiveCinemaMode ? 'bg-[#E50914] text-white' : 'bg-white/10 text-zinc-400'
                                      }`}
                                    >
                                      {effectiveCinemaMode ? 'ON' : 'OFF'}
                                    </span>
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="p-2 text-xs">
                                <button
                                  type="button"
                                  onClick={() => setSettingsSubmenu('root')}
                                  className="w-full flex items-center gap-2 px-2.5 py-2 border-b border-white/10 mb-1.5 text-zinc-300 hover:text-white font-bold min-h-[40px]"
                                >
                                  <ChevronLeft className="w-4 h-4" />
                                  <span>
                                    {settingsSubmenu === 'frame'
                                      ? 'Tamanho do Ecrã'
                                      : settingsSubmenu === 'quality'
                                        ? 'Qualidade do Vídeo'
                                        : settingsSubmenu === 'speed'
                                          ? 'Velocidade de Reprodução'
                                          : 'Fontes e Versões'}
                                  </span>
                                </button>

                                <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5 admin-scrollbar">
                                  {settingsSubmenu === 'frame' &&
                                    FRAME_SIZE_OPTIONS.map(opt => (
                                      <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => handleSelectFrameSize(opt.id)}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left transition-colors min-h-[44px] ${
                                          frameSize === opt.id
                                            ? 'bg-[#E50914] text-white font-bold'
                                            : 'text-zinc-200 hover:bg-[#202020]'
                                        }`}
                                      >
                                        <div>
                                          <p className="font-semibold">{opt.label}</p>
                                          <p className="text-[10px] opacity-75">{opt.hint}</p>
                                        </div>
                                        {frameSize === opt.id && <Check className="w-4 h-4 shrink-0" />}
                                      </button>
                                    ))}

                                  {settingsSubmenu === 'quality' && (
                                    qualityLevels.length > 0 ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => changeQuality(-1)}
                                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl min-h-[44px] ${
                                            selectedQuality === -1 ? 'bg-[#E50914] text-white font-bold' : 'text-zinc-200 hover:bg-[#202020]'
                                          }`}
                                        >
                                          <span>Automática</span>
                                          {selectedQuality === -1 && <Check className="w-4 h-4" />}
                                        </button>
                                        {qualityLevels.map(lvl => (
                                          <button
                                            key={lvl.index}
                                            type="button"
                                            onClick={() => changeQuality(lvl.index)}
                                            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl font-mono min-h-[44px] ${
                                              selectedQuality === lvl.index ? 'bg-[#E50914] text-white font-bold' : 'text-zinc-200 hover:bg-[#202020]'
                                            }`}
                                          >
                                            <span>{lvl.label}</span>
                                            {selectedQuality === lvl.index && <Check className="w-4 h-4" />}
                                          </button>
                                        ))}
                                      </>
                                    ) : (
                                      <div className="p-3 text-center text-zinc-400">
                                        A qualidade ajusta-se automaticamente para este vídeo.
                                      </div>
                                    )
                                  )}

                                  {settingsSubmenu === 'speed' &&
                                    [0.5, 0.75, 1, 1.25, 1.5, 2].map(speed => (
                                      <button
                                        key={speed}
                                        type="button"
                                        onClick={() => changePlaybackSpeed(speed)}
                                        className={`w-full flex items-center justify-between px-3 py-2 rounded-xl font-mono min-h-[44px] ${
                                          playbackSpeed === speed ? 'bg-[#E50914] text-white font-bold' : 'text-zinc-200 hover:bg-[#202020]'
                                        }`}
                                      >
                                        <span>{speed === 1 ? 'Normal (1x)' : `${speed}x`}</span>
                                        {playbackSpeed === speed && <Check className="w-4 h-4" />}
                                      </button>
                                    ))}

                                  {settingsSubmenu === 'sources' &&
                                    sourceList.map((s, idx) => {
                                      const badge = formatSourceVersionBadge(s);
                                      return (
                                        <button
                                          key={s.id || idx}
                                          type="button"
                                          onClick={() => switchSource(idx, true)}
                                          className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-left min-h-[44px] ${
                                            activeSourceIndex === idx ? 'bg-[#E50914] text-white font-bold' : 'text-zinc-200 hover:bg-[#202020]'
                                          }`}
                                        >
                                          <div className="min-w-0">
                                            <p className="truncate font-semibold">{badge.shortLabel}</p>
                                            <p className="text-[10px] opacity-75 truncate">
                                              {[s.serverName || `Fonte ${idx + 1}`, badge.quality].filter(Boolean).join(' · ')}
                                            </p>
                                          </div>
                                          {activeSourceIndex === idx && <Check className="w-4 h-4 shrink-0 ml-2" />}
                                        </button>
                                      );
                                    })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* FULLSCREEN + MOBILE LANDSCAPE LOCK */}
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="min-w-[44px] min-h-[44px] sm:min-w-[38px] sm:min-h-[38px] flex items-center justify-center text-white hover:text-[#E50914] transition-colors"
                        title="Ecrã Inteiro (F)"
                      >
                        {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
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
