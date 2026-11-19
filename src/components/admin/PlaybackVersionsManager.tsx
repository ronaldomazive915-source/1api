import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Mic,
  Subtitles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Save,
  Play,
  Trash2,
  Link2,
  Sparkles,
  History,
  Layers,
  Power,
  X,
  ShieldCheck,
  Eraser,
  Plus,
  Edit3,
  Star
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { AuditLog, PlaybackVersionAvailability } from '../../types.js';
import { classifySourceUrl } from '../../lib/sourceClassification.js';
import { buildMgebUrl, stripMgebPrefix, MGEB_PREFIX } from '../../lib/mgebUtils.js';
import { SOURCE_QUALITY_OPTIONS } from '../../lib/sourceMetadata.js';
import { RonycinePlayer } from '../player/RonycinePlayer.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

export interface PlaybackVersionsManagerProps {
  tmdbId: number;
  contentType: 'movie' | 'tv';
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  onUpdated?: (availability?: PlaybackVersionAvailability) => void;
  compact?: boolean;
}

interface SlotDraft {
  sourceId?: string;
  url: string;
  useMgebPrefix: boolean;
  serverName: string;
  quality: string;
  format: string;
  enabled: boolean;
  isPrimary: boolean;
  status?: string;
  verificationResult?: string;
  diagnostics?: any;
  updatedAt?: string;
  dirty: boolean;
}

function makeEmptyDraft(version: 'dublado' | 'legendado', nextIndex = 1): SlotDraft {
  const baseName = version === 'dublado' ? 'Servidor Dublado' : 'Servidor Legendado';
  return {
    sourceId: undefined,
    url: '',
    useMgebPrefix: true,
    serverName: nextIndex > 1 ? `${baseName} #${nextIndex}` : baseName,
    quality: '1080p',
    format: 'auto',
    enabled: true,
    isPrimary: nextIndex === 1,
    status: undefined,
    verificationResult: undefined,
    diagnostics: undefined,
    updatedAt: undefined,
    dirty: false
  };
}

function slotFromSource(src: any | null, version: 'dublado' | 'legendado'): SlotDraft {
  if (!src) return makeEmptyDraft(version, 1);
  const rawUrl = String(src.originalUrl || src.url || '').trim();
  const stripped = stripMgebPrefix(rawUrl);
  return {
    sourceId: src.id,
    url: rawUrl,
    useMgebPrefix: stripped.hadPrefix,
    serverName:
      String(src.serverName || src.provider || src.label || '').trim() ||
      (version === 'dublado' ? 'Servidor Dublado' : 'Servidor Legendado'),
    quality: String(src.quality || '1080p'),
    format: String(src.format || 'auto'),
    enabled: src.enabled !== false,
    isPrimary: Boolean(src.isPrimary),
    status: src.status,
    verificationResult: src.verificationResult,
    diagnostics: src.diagnostics,
    updatedAt: src.updatedAt || src.createdAt,
    dirty: false
  };
}

function getHonestStatusBadge(src: { status?: string; enabled?: boolean; isSaved?: boolean; url?: string }) {
  if (!src.isSaved) {
    if (src.url?.trim()) {
      return {
        label: 'Não guardada',
        className: 'bg-amber-950/50 text-amber-300 border-amber-500/35'
      };
    }
    return {
      label: 'Não configurada',
      className: 'bg-zinc-900 text-zinc-400 border-white/10'
    };
  }
  if (src.enabled === false) {
    return {
      label: 'Desativada',
      className: 'bg-zinc-900 text-zinc-400 border-white/10'
    };
  }
  const s = String(src.status || 'registered').toLowerCase();
  if (s === 'online' || s === 'active') {
    return {
      label: 'Disponível / Online',
      className: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/35'
    };
  }
  if (s === 'validating' || s === 'verifying') {
    return {
      label: 'A verificar',
      className: 'bg-blue-950/50 text-blue-300 border-blue-500/35'
    };
  }
  if (s === 'offline' || s === 'inactive') {
    return {
      label: 'Indisponível',
      className: 'bg-red-950/50 text-red-300 border-red-500/35'
    };
  }
  if (s === 'unsupported_format' || s === 'incompatible') {
    return {
      label: 'Formato incompatível',
      className: 'bg-purple-950/50 text-purple-300 border-purple-500/35'
    };
  }
  if (s === 'embed_blocked') {
    return {
      label: 'Embed bloqueado',
      className: 'bg-orange-950/50 text-orange-300 border-orange-500/35'
    };
  }
  if (s === 'unverifiable' || s === 'playback_unverified') {
    return {
      label: 'Não verificável',
      className: 'bg-amber-950/50 text-amber-300 border-amber-500/35'
    };
  }
  return {
    label: 'Guardada · Pendente verificação',
    className: 'bg-amber-950/40 text-amber-200 border-amber-500/30'
  };
}

export const PlaybackVersionsManager: React.FC<PlaybackVersionsManagerProps> = ({
  tmdbId,
  contentType,
  title,
  seasonNumber = 1,
  episodeNumber = 1,
  episodeTitle,
  onUpdated,
  compact = false
}) => {
  const normType: 'movie' | 'tv' = contentType === 'tv' ? 'tv' : 'movie';
  const [loading, setLoading] = useState(true);
  const [dubSources, setDubSources] = useState<any[]>([]);
  const [legSources, setLegSources] = useState<any[]>([]);
  const [dubDraft, setDubDraft] = useState<SlotDraft>(() => makeEmptyDraft('dublado', 1));
  const [legDraft, setLegDraft] = useState<SlotDraft>(() => makeEmptyDraft('legendado', 1));
  const [legacySources, setLegacySources] = useState<any[]>([]);
  const [history, setHistory] = useState<AuditLog[]>([]);
  const [availability, setAvailability] = useState<PlaybackVersionAvailability | null>(null);

  const [savingSlot, setSavingSlot] = useState<'dublado' | 'legendado' | 'both' | null>(null);
  const [testingKey, setTestingKey] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);

  const [playTestModal, setPlayTestModal] = useState<{
    title: string;
    version: 'dublado' | 'legendado' | 'legacy';
    source: any;
  } | null>(null);

  const applyServerResponse = useCallback(
    (
      res: {
        dublado: { primary: any | null; sources: any[] };
        legendado: { primary: any | null; sources: any[] };
        legacyOrOther: any[];
        history: AuditLog[];
        versionAvailability: PlaybackVersionAvailability;
      },
      options?: { preserveDraftMode?: 'dublado' | 'legendado' | 'new_dublado' | 'new_legendado' }
    ) => {
      const nextDubSources = res.dublado?.sources || [];
      const nextLegSources = res.legendado?.sources || [];
      setDubSources(nextDubSources);
      setLegSources(nextLegSources);

      if (options?.preserveDraftMode === 'new_dublado') {
        setDubDraft(makeEmptyDraft('dublado', nextDubSources.length + 1));
      } else {
        const targetDub = res.dublado?.primary || nextDubSources[0] || null;
        setDubDraft(targetDub ? slotFromSource(targetDub, 'dublado') : makeEmptyDraft('dublado', 1));
      }

      if (options?.preserveDraftMode === 'new_legendado') {
        setLegDraft(makeEmptyDraft('legendado', nextLegSources.length + 1));
      } else {
        const targetLeg = res.legendado?.primary || nextLegSources[0] || null;
        setLegDraft(targetLeg ? slotFromSource(targetLeg, 'legendado') : makeEmptyDraft('legendado', 1));
      }

      setLegacySources(res.legacyOrOther || []);
      setHistory(res.history || []);
      setAvailability(res.versionAvailability || null);
      setConfirmRemoveId(null);
      onUpdated?.(res.versionAvailability);
    },
    [onUpdated]
  );

  const loadSlots = useCallback(async () => {
    if (!tmdbId || tmdbId <= 0) return;
    setLoading(true);
    try {
      const res = await api.getVersionSlots({
        contentType: normType,
        tmdbId,
        seasonNumber: normType === 'tv' ? seasonNumber : undefined,
        episodeNumber: normType === 'tv' ? episodeNumber : undefined
      });
      applyServerResponse(res);
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Não foi possível carregar as versões deste conteúdo.'
      });
    } finally {
      setLoading(false);
    }
  }, [tmdbId, normType, seasonNumber, episodeNumber, applyServerResponse]);

  useEffect(() => {
    setFeedback(null);
    loadSlots();
  }, [loadSlots]);

  const updateDraftUrl = (version: 'dublado' | 'legendado', rawInput: string, forceMgeb?: boolean) => {
    const setter = version === 'dublado' ? setDubDraft : setLegDraft;
    setter(prev => {
      const useMgeb = forceMgeb !== undefined ? forceMgeb : prev.useMgebPrefix;
      const built = buildMgebUrl(rawInput, useMgeb);
      const nextUrl = useMgeb ? (built.innerUrl ? built.finalUrl : '') : rawInput.trim();
      const classified = nextUrl ? classifySourceUrl(nextUrl) : null;
      return {
        ...prev,
        useMgebPrefix: useMgeb,
        url: nextUrl,
        format: classified?.valid ? classified.suggestedFormat : prev.format,
        dirty: true
      };
    });
    setFeedback(null);
  };

  const toggleDraftMgeb = (version: 'dublado' | 'legendado', nextMgeb: boolean) => {
    const setter = version === 'dublado' ? setDubDraft : setLegDraft;
    setter(prev => {
      const built = buildMgebUrl(prev.url, nextMgeb);
      const nextUrl = nextMgeb ? (built.innerUrl ? built.finalUrl : '') : built.innerUrl || prev.url;
      return {
        ...prev,
        useMgebPrefix: nextMgeb,
        url: nextUrl,
        dirty: prev.dirty || Boolean(nextUrl)
      };
    });
  };

  const handleTestDraft = async (version: 'dublado' | 'legendado') => {
    const draft = version === 'dublado' ? dubDraft : legDraft;
    const setter = version === 'dublado' ? setDubDraft : setLegDraft;
    const cleanUrl = draft.url.trim();
    if (!cleanUrl) {
      setFeedback({
        type: 'warning',
        text: `Insira uma URL na ${version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada'} antes de testar.`
      });
      return;
    }

    const built = buildMgebUrl(cleanUrl, draft.useMgebPrefix);
    const targetUrl = built.valid ? built.finalUrl : cleanUrl;

    setTestingKey(`draft-${version}`);
    setFeedback(null);
    try {
      const probe = await api.verifySourceLink(targetUrl, draft.format);
      setter(prev => ({
        ...prev,
        status: probe.status,
        format: probe.detectedFormat || prev.format,
        verificationResult: probe.message,
        diagnostics: probe.diagnostics
      }));

      if (draft.sourceId) {
        await api
          .updateVideoSource(draft.sourceId, {
            status: probe.status,
            sourceKind: probe.sourceKind,
            format: probe.detectedFormat || draft.format,
            lastVerifiedAt: probe.diagnostics?.testedAt || new Date().toISOString(),
            verificationResult: probe.message,
            diagnostics: probe.diagnostics
          })
          .catch(() => {});
        await loadSlots();
      }

      setFeedback({
        type: probe.status === 'online' ? 'success' : probe.status === 'unverifiable' ? 'warning' : 'error',
        text: `${version === 'dublado' ? 'Dublada' : 'Legendada'}: ${probe.message}`
      });
    } catch (err: any) {
      const msg = err?.message || 'Falha ao testar fonte.';
      setter(prev => ({
        ...prev,
        status: 'offline',
        verificationResult: msg
      }));
      setFeedback({
        type: 'error',
        text: `${version === 'dublado' ? 'Dublada' : 'Legendada'}: ${msg}`
      });
    } finally {
      setTestingKey(null);
    }
  };

  const handleTestSavedSource = async (version: 'dublado' | 'legendado', src: any) => {
    if (!src?.id) return;
    setTestingKey(src.id);
    setFeedback(null);
    try {
      const updated = await api.verifyVideoSource(src.id);
      await loadSlots();
      setFeedback({
        type:
          updated.status === 'online'
            ? 'success'
            : updated.status === 'unverifiable'
            ? 'warning'
            : 'error',
        text: `${src.serverName || (version === 'dublado' ? 'Dublada' : 'Legendada')}: ${
          updated.verificationResult || 'Verificação concluída.'
        }`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao verificar fonte guardada.'
      });
    } finally {
      setTestingKey(null);
    }
  };

  const handleSaveSlot = async (version: 'dublado' | 'legendado', asAlternative = false) => {
    const draft = version === 'dublado' ? dubDraft : legDraft;
    const rawUrl = draft.url.trim();
    if (!rawUrl) {
      setFeedback({
        type: 'warning',
        text: `Insira uma URL válida na ${version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada'} para guardar.`
      });
      return;
    }

    const built = buildMgebUrl(rawUrl, draft.useMgebPrefix);
    if (!built.valid) {
      setFeedback({
        type: 'error',
        text: `${version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada'}: ${built.error || 'URL inválida.'}`
      });
      return;
    }

    const classified = classifySourceUrl(built.finalUrl);
    if (!classified.valid) {
      setFeedback({
        type: 'error',
        text: `${version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada'}: ${classified.error || 'URL inválida.'}`
      });
      return;
    }

    const isEditingExisting = Boolean(draft.sourceId) && !asAlternative;

    setSavingSlot(version);
    setFeedback(null);
    try {
      const res = await api.saveVersionSlots({
        contentType: normType,
        tmdbId,
        seasonNumber: normType === 'tv' ? seasonNumber : undefined,
        episodeNumber: normType === 'tv' ? episodeNumber : undefined,
        version,
        url: built.finalUrl,
        useMgebPrefix: draft.useMgebPrefix,
        serverName: draft.serverName.trim() || (version === 'dublado' ? 'Servidor Dublado' : 'Servidor Legendado'),
        quality: draft.quality || '1080p',
        format: draft.format || 'auto',
        enabled: draft.enabled,
        isPrimary: isEditingExisting ? draft.isPrimary : (version === 'dublado' ? dubSources.length === 0 : legSources.length === 0),
        sourceId: isEditingExisting ? draft.sourceId : undefined,
        replaceExisting: isEditingExisting,
        verify: false
      });
      applyServerResponse(res);
      const warnText = res.duplicateWarnings?.length ? ` ${res.duplicateWarnings.join(' ')}` : '';
      setFeedback({
        type: res.duplicateWarnings?.length ? 'warning' : 'success',
        text: `${version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada'} guardada com sucesso (pendente verificação).${warnText}`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || `Erro ao guardar ${version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada'}.`
      });
    } finally {
      setSavingSlot(null);
    }
  };

  const handleSaveBoth = async () => {
    const slotsToSave: any[] = [];
    if (dubDraft.url.trim()) {
      const built = buildMgebUrl(dubDraft.url.trim(), dubDraft.useMgebPrefix);
      if (!built.valid) {
        setFeedback({ type: 'error', text: `Versão Dublada: ${built.error || 'URL inválida.'}` });
        return;
      }
      slotsToSave.push({
        version: 'dublado' as const,
        url: built.finalUrl,
        useMgebPrefix: dubDraft.useMgebPrefix,
        serverName: dubDraft.serverName.trim() || 'Servidor Dublado',
        quality: dubDraft.quality || '1080p',
        format: dubDraft.format || 'auto',
        enabled: dubDraft.enabled,
        sourceId: dubDraft.sourceId,
        replaceExisting: Boolean(dubDraft.sourceId),
        verify: false
      });
    }
    if (legDraft.url.trim()) {
      const built = buildMgebUrl(legDraft.url.trim(), legDraft.useMgebPrefix);
      if (!built.valid) {
        setFeedback({ type: 'error', text: `Versão Legendada: ${built.error || 'URL inválida.'}` });
        return;
      }
      slotsToSave.push({
        version: 'legendado' as const,
        url: built.finalUrl,
        useMgebPrefix: legDraft.useMgebPrefix,
        serverName: legDraft.serverName.trim() || 'Servidor Legendado',
        quality: legDraft.quality || '1080p',
        format: legDraft.format || 'auto',
        enabled: legDraft.enabled,
        sourceId: legDraft.sourceId,
        replaceExisting: Boolean(legDraft.sourceId),
        verify: false
      });
    }

    if (slotsToSave.length === 0) {
      setFeedback({ type: 'warning', text: 'Preencha pelo menos uma das versões para guardar.' });
      return;
    }

    setSavingSlot('both');
    setFeedback(null);
    try {
      const res = await api.saveVersionSlots({
        contentType: normType,
        tmdbId,
        seasonNumber: normType === 'tv' ? seasonNumber : undefined,
        episodeNumber: normType === 'tv' ? episodeNumber : undefined,
        slots: slotsToSave
      });
      applyServerResponse(res);
      const warnText = res.duplicateWarnings?.length ? ` ${res.duplicateWarnings.join(' ')}` : '';
      setFeedback({
        type: res.duplicateWarnings?.length ? 'warning' : 'success',
        text: `Versões atualizadas com sucesso.${warnText}`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Erro ao guardar versões.'
      });
    } finally {
      setSavingSlot(null);
    }
  };

  const handleSetPrimary = async (version: 'dublado' | 'legendado', src: any) => {
    if (!src?.id) return;
    setSavingSlot(version);
    try {
      const res = await api.saveVersionSlots({
        contentType: normType,
        tmdbId,
        seasonNumber: normType === 'tv' ? seasonNumber : undefined,
        episodeNumber: normType === 'tv' ? episodeNumber : undefined,
        version,
        url: src.originalUrl || src.url,
        serverName: src.serverName || src.provider,
        quality: src.quality || '1080p',
        format: src.format || 'auto',
        enabled: true,
        isPrimary: true,
        sourceId: src.id,
        replaceExisting: true,
        verify: false
      });
      applyServerResponse(res);
      setFeedback({
        type: 'success',
        text: `${src.serverName || 'Fonte'} definida como principal (${version === 'dublado' ? 'Dublada' : 'Legendada'}).`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Falha ao definir fonte principal.' });
    } finally {
      setSavingSlot(null);
    }
  };

  const handleRemoveSource = async (version: 'dublado' | 'legendado', sourceId: string) => {
    setSavingSlot(version);
    setFeedback(null);
    try {
      const res = await api.deleteVersionSlot({
        contentType: normType,
        tmdbId,
        version,
        sourceId,
        seasonNumber: normType === 'tv' ? seasonNumber : undefined,
        episodeNumber: normType === 'tv' ? episodeNumber : undefined
      });
      applyServerResponse(res);
      setConfirmRemoveId(null);
      setFeedback({
        type: 'success',
        text: `Fonte da ${version === 'dublado' ? 'Versão Dublada' : 'Versão Legendada'} removida.`
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        text: err?.message || 'Falha ao remover fonte.'
      });
    } finally {
      setSavingSlot(null);
    }
  };

  const duplicateAcrossSlots = useMemo(() => {
    const d = dubDraft.url.trim();
    const l = legDraft.url.trim();
    return Boolean(d && l && d === l);
  }, [dubDraft.url, legDraft.url]);

  const renderSlotCard = (version: 'dublado' | 'legendado') => {
    const isDub = version === 'dublado';
    const sourcesList = isDub ? dubSources : legSources;
    const draft = isDub ? dubDraft : legDraft;
    const setter = isDub ? setDubDraft : setLegDraft;
    const stripped = stripMgebPrefix(draft.url);
    const displayValue = draft.useMgebPrefix ? stripped.innerUrl : draft.url;
    const evaluation = displayValue.trim() ? buildMgebUrl(displayValue, draft.useMgebPrefix) : null;
    const classified = draft.url.trim() ? classifySourceUrl(draft.url.trim()) : null;
    const isEditingSaved = Boolean(draft.sourceId);

    const cardBadge = getHonestStatusBadge({
      status: draft.status,
      enabled: draft.enabled,
      isSaved: isEditingSaved,
      url: draft.url
    });

    return (
      <div
        key={version}
        data-testid={`version-slot-${version}`}
        className="rounded-2xl border border-white/10 p-4 sm:p-5 space-y-4 bg-[#080808]"
      >
        {/* Header da Versão */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                isDub
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                  : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/25'
              }`}
            >
              {isDub ? <Mic className="w-4 h-4" /> : <Subtitles className="w-4 h-4" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-xs sm:text-sm font-black uppercase tracking-wide text-white">
                  {isDub ? 'Versão Dublada' : 'Versão Legendada'}
                </h4>
                <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] font-mono tabular-nums text-zinc-300">
                  {sourcesList.length} {sourcesList.length === 1 ? 'fonte' : 'fontes'}
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                {isDub ? 'Áudio em Português' : 'Áudio original com legenda'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setter(makeEmptyDraft(version, sourcesList.length + 1));
              setFeedback(null);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] font-bold text-white flex items-center gap-1 whitespace-nowrap transition-colors"
            title="Limpar formulário para adicionar nova fonte nesta versão"
          >
            <Plus className="w-3.5 h-3.5 text-[#E50914]" />
            <span>Nova Fonte</span>
          </button>
        </div>

        {/* Lista de Fontes Guardadas desta Versão (Múltiplos Servidores) */}
        {sourcesList.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Fontes Guardadas ({sourcesList.length})
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
              {sourcesList.map((src, idx) => {
                const badge = getHonestStatusBadge({
                  status: src.status,
                  enabled: src.enabled !== false,
                  isSaved: true,
                  url: src.originalUrl || src.url
                });
                const isSelectedForEdit = draft.sourceId === src.id;
                const srcUrl = String(src.originalUrl || src.url || '');
                const srcStripped = stripMgebPrefix(srcUrl);

                return (
                  <div
                    key={src.id}
                    className={`rounded-xl border p-2.5 space-y-2 transition-colors ${
                      isSelectedForEdit
                        ? 'bg-[#131318] border-[#E50914]/50'
                        : 'bg-[#0e0e11] border-white/10'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold text-white truncate">
                          {src.serverName || src.provider || `Servidor #${idx + 1}`}
                        </span>
                        {src.isPrimary && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[9px] font-black uppercase text-emerald-300">
                            Principal
                          </span>
                        )}
                        <span className="text-[10px] font-mono text-zinc-400">
                          {src.quality || '1080p'} · {(src.format || 'auto').toUpperCase()}
                        </span>
                        {srcStripped.hadPrefix && (
                          <span className="text-[9px] font-mono font-bold text-[#ff6b72] px-1.5 py-0.5 rounded bg-[#E50914]/10 border border-[#E50914]/30">
                            MGEB
                          </span>
                        )}
                      </div>

                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>

                    <p className="text-[10px] font-mono text-zinc-400 break-all line-clamp-2">{srcUrl}</p>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setter(slotFromSource(src, version))}
                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[10px] font-bold text-zinc-200 flex items-center gap-1 whitespace-nowrap"
                      >
                        <Edit3 className="w-3 h-3" />
                        Editar
                      </button>

                      <button
                        type="button"
                        disabled={testingKey === src.id}
                        onClick={() => handleTestSavedSource(version, src)}
                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[10px] font-bold text-zinc-200 flex items-center gap-1 whitespace-nowrap disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${testingKey === src.id ? 'animate-spin' : ''}`} />
                        Testar
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setPlayTestModal({
                            title: `${title || `TMDB ${tmdbId}`} — ${isDub ? 'Dublado' : 'Legendado'} (${src.serverName || 'Fonte'})`,
                            version,
                            source: src
                          })
                        }
                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[10px] font-bold text-zinc-200 flex items-center gap-1 whitespace-nowrap"
                      >
                        <Play className="w-3 h-3 text-[#E50914]" />
                        Reproduzir
                      </button>

                      {!src.isPrimary && (
                        <button
                          type="button"
                          disabled={savingSlot !== null}
                          onClick={() => handleSetPrimary(version, src)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[10px] font-bold text-zinc-300 flex items-center gap-1 whitespace-nowrap"
                        >
                          <Star className="w-3 h-3 text-amber-400" />
                          Principal
                        </button>
                      )}

                      {confirmRemoveId === src.id ? (
                        <div className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            disabled={savingSlot !== null}
                            onClick={() => handleRemoveSource(version, src.id)}
                            className="px-2 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold whitespace-nowrap"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRemoveId(null)}
                            className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300 text-[10px] font-bold"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(src.id)}
                          className="ml-auto px-2 py-1 rounded-lg bg-red-950/30 hover:bg-red-950/60 border border-red-500/25 text-red-300 text-[10px] font-bold flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Editor / Formulário de Fonte (Adicionar ou Editar) */}
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-zinc-300">
              {isEditingSaved ? `A editar: ${draft.serverName}` : 'Adicionar Nova Fonte'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cardBadge.className}`}>
              {cardBadge.label}
            </span>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Link2 className="w-3 h-3 text-[#E50914]" />
              URL {isDub ? 'Dublada' : 'Legendada'}
            </label>
            <button
              type="button"
              onClick={() => toggleDraftMgeb(version, !draft.useMgebPrefix)}
              className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold border flex items-center gap-1 transition-colors whitespace-nowrap ${
                draft.useMgebPrefix
                  ? 'bg-[#E50914]/15 border-[#E50914]/50 text-[#ff6b72]'
                  : 'bg-zinc-900 border-white/10 text-zinc-400 hover:text-white'
              }`}
              title="Alternar prefixo oficial MGEB (https://mgeb.space/mp4.php?url=)"
            >
              <Sparkles className="w-3 h-3" />
              MGEB {draft.useMgebPrefix ? 'ON' : 'OFF'}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="url"
              value={displayValue}
              onChange={(e) => updateDraftUrl(version, e.target.value)}
              placeholder={
                draft.useMgebPrefix
                  ? 'https://ww1.123flmsfree.com/pt/detail/movie/...'
                  : isDub
                  ? 'https://servidor.com/filme-dublado.mp4 ou .m3u8'
                  : 'https://servidor.com/filme-legendado.mp4 ou .m3u8'
              }
              className="flex-1 min-w-0 bg-[#111114] border border-white/15 rounded-xl px-3 py-2 text-xs text-white font-mono placeholder:text-zinc-600 focus:border-[#E50914] outline-none"
            />
            {draft.url && (
              <button
                type="button"
                onClick={() => updateDraftUrl(version, '', draft.useMgebPrefix)}
                className="p-2 rounded-xl bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white"
                title="Limpar campo"
              >
                <Eraser className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* PREFIXO OFICIAL MGEB — Sempre visível abaixo do campo */}
          <div className="bg-[#0e0e11] border border-white/10 rounded-xl px-3 py-2.5 space-y-1.5 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-mono font-black uppercase tracking-wider text-[#E50914] shrink-0">
                  PREFIXO OFICIAL MGEB
                </span>
                <code className="font-mono text-[10px] text-zinc-300 truncate select-all">{MGEB_PREFIX}</code>
              </div>
              <span className="text-[10px] font-bold text-zinc-400">
                {draft.useMgebPrefix ? 'Automático (sem duplicar)' : 'Desativado (link original)'}
              </span>
            </div>

            {displayValue.trim() && (
              <div className="space-y-1 pt-1 border-t border-white/5 font-mono text-[10px]">
                <p className="text-zinc-400 break-all">
                  <span className="text-zinc-500">Original: </span>
                  {evaluation?.innerUrl || displayValue}
                </p>
                <p className="text-emerald-400 break-all">
                  <span className="text-zinc-500">Processada: </span>
                  {evaluation?.finalUrl || draft.url}
                </p>
              </div>
            )}

            {displayValue.trim() && evaluation?.isHtmlPage && !draft.useMgebPrefix && (
              <p className="text-[10px] text-amber-300 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Página HTML detetada — ative MGEB ON para resolver o stream automaticamente.
              </p>
            )}
          </div>

          {classified && !classified.valid && (
            <p className="text-[11px] text-red-400 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              {classified.error || 'URL inválida. Use http:// ou https://.'}
            </p>
          )}

          {classified && classified.valid && (
            <p className="text-[10px] text-zinc-400 flex items-center gap-1.5">
              <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
              Classificação estática: <strong className="text-zinc-200 uppercase">{classified.suggestedFormat}</strong>
            </p>
          )}

          {/* Metadata rápida */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1">
                Servidor
              </label>
              <input
                type="text"
                value={draft.serverName}
                onChange={(e) => setter(prev => ({ ...prev, serverName: e.target.value, dirty: true }))}
                className="w-full bg-[#111114] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:border-[#E50914] outline-none"
                placeholder={isDub ? 'Servidor Dublado' : 'Servidor Legendado'}
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1">
                Qualidade
              </label>
              <select
                value={draft.quality}
                onChange={(e) => setter(prev => ({ ...prev, quality: e.target.value, dirty: true }))}
                className="w-full bg-[#111114] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:border-[#E50914] outline-none"
              >
                {SOURCE_QUALITY_OPTIONS.map(q => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setter(prev => ({ ...prev, enabled: !prev.enabled, dirty: true }))}
                className={`w-full py-1.5 px-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                  draft.enabled
                    ? 'bg-emerald-950/40 border-emerald-500/35 text-emerald-300'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-400'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                {draft.enabled ? 'Ativa' : 'Desativada'}
              </button>
            </div>
          </div>

          {(draft.verificationResult || draft.diagnostics?.failureReason) && (
            <div
              className={`p-2.5 rounded-xl border text-[11px] flex items-start gap-2 ${
                draft.status === 'online'
                  ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                  : draft.status === 'offline' || draft.status === 'unsupported_format'
                  ? 'bg-red-950/30 border-red-500/30 text-red-300'
                  : 'bg-zinc-900 border-white/10 text-zinc-300'
              }`}
            >
              {draft.status === 'online' ? (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              )}
              <span className="leading-snug">{draft.diagnostics?.failureReason || draft.verificationResult}</span>
            </div>
          )}

          {/* Botões de Ação do Editor */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={testingKey === `draft-${version}` || !draft.url.trim()}
              onClick={() => handleTestDraft(version)}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-200 text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingKey === `draft-${version}` ? 'animate-spin' : ''}`} />
              Testar Fonte
            </button>

            {draft.url.trim() && evaluation?.valid && (
              <button
                type="button"
                onClick={() =>
                  setPlayTestModal({
                    title: `${title || `TMDB ${tmdbId}`} — ${isDub ? 'Dublado' : 'Legendado'}`,
                    version,
                    source: {
                      id: draft.sourceId || `test-${version}`,
                      url: evaluation.finalUrl,
                      originalUrl: evaluation.finalUrl,
                      format: draft.format || classified?.suggestedFormat || 'auto',
                      versionType: version,
                      audioLanguage: isDub ? 'Português' : 'Original',
                      quality: draft.quality,
                      serverName: draft.serverName,
                      diagnostics: draft.diagnostics
                    }
                  })
                }
                className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-200 text-[11px] font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5 text-[#E50914]" />
                Reproduzir
              </button>
            )}

            {isEditingSaved && sourcesList.length > 0 && (
              <button
                type="button"
                disabled={savingSlot !== null || !draft.url.trim()}
                onClick={() => handleSaveSlot(version, true)}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-white text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-40 transition-colors whitespace-nowrap"
                title="Guarda como um novo servidor adicional sem substituir os atuais"
              >
                <Plus className="w-3.5 h-3.5" />
                Adicionar como Alternativa
              </button>
            )}

            <button
              type="button"
              disabled={savingSlot !== null || !draft.url.trim()}
              onClick={() => handleSaveSlot(version, false)}
              className="ml-auto px-3.5 py-1.5 rounded-xl bg-[#E50914] hover:bg-[#E50914]/90 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              {savingSlot === version
                ? 'A guardar...'
                : isEditingSaved
                ? 'Atualizar Fonte'
                : 'Guardar Fonte'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="playback-versions-manager"
      className={`bg-[#111114] border border-white/10 rounded-2xl ${
        compact ? 'p-4 space-y-4' : 'p-5 sm:p-6 space-y-5'
      }`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3.5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-white">
              FONTES DE REPRODUÇÃO (DUBLADA & LEGENDADA)
            </h3>
            <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] font-mono tabular-nums text-zinc-300">
              {normType === 'tv'
                ? `T${String(seasonNumber).padStart(2, '0')} • E${String(episodeNumber).padStart(2, '0')}${episodeTitle ? ` — ${episodeTitle}` : ''}`
                : 'Filme'}
            </span>
          </div>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Guarda imediata sem bloqueio remoto. Adicione múltiplos servidores por versão e teste quando desejar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {loading && <RefreshCw className="w-4 h-4 text-zinc-400 animate-spin" />}
          {dubDraft.url.trim() && legDraft.url.trim() && (dubDraft.dirty || legDraft.dirty) && (
            <button
              type="button"
              disabled={savingSlot !== null}
              onClick={handleSaveBoth}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              {savingSlot === 'both' ? 'A guardar...' : 'Guardar Ambas'}
            </button>
          )}
          <button
            type="button"
            onClick={loadSlots}
            disabled={loading}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-300"
            title="Recarregar fontes"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Resumo de estado por versão */}
      {availability && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
          <div className="px-3 py-2 rounded-xl bg-[#09090b] border border-white/10 flex items-center justify-between gap-2">
            <span className="font-bold text-zinc-300">Dublada</span>
            <span className="font-mono text-zinc-400 tabular-nums">
              {dubSources.length} {dubSources.length === 1 ? 'fonte' : 'fontes'} ·{' '}
              <strong className={availability.dublado.available ? 'text-emerald-400' : 'text-zinc-400'}>
                {availability.dublado.label || (dubSources.length > 0 ? 'Guardada' : 'Não configurada')}
              </strong>
            </span>
          </div>
          <div className="px-3 py-2 rounded-xl bg-[#09090b] border border-white/10 flex items-center justify-between gap-2">
            <span className="font-bold text-zinc-300">Legendada</span>
            <span className="font-mono text-zinc-400 tabular-nums">
              {legSources.length} {legSources.length === 1 ? 'fonte' : 'fontes'} ·{' '}
              <strong className={availability.legendado.available ? 'text-indigo-400' : 'text-zinc-400'}>
                {availability.legendado.label || (legSources.length > 0 ? 'Guardada' : 'Não configurada')}
              </strong>
            </span>
          </div>
        </div>
      )}

      {duplicateAcrossSlots && (
        <div className="p-3 rounded-xl bg-amber-950/35 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <span>
            Atenção: a URL nos formulários Dublada e Legendada é idêntica. Confirme antes de guardar.
          </span>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-200'
              : feedback.type === 'warning'
              ? 'bg-amber-950/35 border-amber-500/40 text-amber-200'
              : 'bg-red-950/35 border-red-500/40 text-red-200'
          }`}
        >
          <div className="flex items-start gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : feedback.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button type="button" onClick={() => setFeedback(null)} className="text-current opacity-70 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderSlotCard('dublado')}
        {renderSlotCard('legendado')}
      </div>

      {(legacySources.length > 0 || history.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {legacySources.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLegacy(v => !v)}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-300 text-[11px] font-bold flex items-center gap-1.5"
            >
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              Fontes Legadas / Outras ({legacySources.length})
            </button>
          )}
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory(v => !v)}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-300 text-[11px] font-bold flex items-center gap-1.5"
            >
              <History className="w-3.5 h-3.5 text-zinc-400" />
              Histórico ({history.length})
            </button>
          )}
        </div>
      )}

      {showLegacy && legacySources.length > 0 && (
        <div className="p-3.5 rounded-xl bg-[#080808] border border-white/10 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
            Fontes Legadas / Sem Versão Definida
          </p>
          <div className="space-y-2 max-h-44 overflow-y-auto">
            {legacySources.map(src => (
              <div
                key={src.id}
                className="p-2.5 rounded-xl bg-[#111114] border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white truncate">
                    {src.serverName || src.provider || src.label || 'Fonte Legada'} ·{' '}
                    <span className="text-zinc-400 font-mono uppercase">{src.format || 'auto'}</span>
                    {src.versionType ? ` · ${src.versionType}` : ' · Sem versão'}
                  </p>
                  <p className="text-[10px] font-mono text-zinc-500 truncate">{src.originalUrl || src.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setPlayTestModal({
                      title: `${title || `TMDB ${tmdbId}`} — Fonte Legada`,
                      version: 'legacy',
                      source: src
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-bold flex items-center gap-1 shrink-0"
                >
                  <Play className="w-3 h-3" /> Reproduzir
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showHistory && history.length > 0 && (
        <div className="p-3.5 rounded-xl bg-[#080808] border border-white/10 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">
            Histórico de Alterações
          </p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto text-[11px]">
            {history.map(log => (
              <div key={log.id} className="flex items-start justify-between gap-3 py-1 border-b border-white/5 last:border-0">
                <span className="text-zinc-300">{log.details}</span>
                <span className="text-zinc-500 font-mono text-[10px] shrink-0 tabular-nums">
                  {new Date(log.timestamp).toLocaleString('pt-PT')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {playTestModal && (
        <div className="fixed inset-0 z-[80] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#111114] border border-white/15 rounded-2xl max-w-4xl w-full overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <p className="text-xs font-black uppercase tracking-wider text-white truncate">
                Teste de Reprodução: {playTestModal.title}
              </p>
              <button
                type="button"
                onClick={() => setPlayTestModal(null)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="aspect-video bg-black">
              <ErrorBoundary>
                <RonycinePlayer
                  title={playTestModal.title}
                  sources={[playTestModal.source]}
                  autoplay={true}
                  onBack={() => setPlayTestModal(null)}
                />
              </ErrorBoundary>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
