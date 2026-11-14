import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  X,
  Check,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
  Play,
  Star,
  Globe,
  FileCode,
  Info,
  Power
} from 'lucide-react';
import { SourceDiagnostics, SourceKind, VideoSource } from '../../types.js';
import { api } from '../../lib/api.js';
import {
  classifySourceUrl,
  getSourceKindLabel,
  getStatusDisplayInfo
} from '../../lib/sourceClassification.js';
import { RonycinePlayer } from '../player/RonycinePlayer.js';
import { ErrorBoundary } from '../ErrorBoundary.js';
import { MgebUrlField } from './MgebUrlField.js';
import { buildMgebUrl, stripMgebPrefix } from '../../lib/mgebUtils.js';

interface SourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  initialData?: Partial<VideoSource> & { selectedTitle?: string; selectedPoster?: string };
}

export const SourceModal: React.FC<SourceModalProps> = ({ isOpen, onClose, onSave, initialData }) => {
  const [currentSource, setCurrentSource] = useState<
    Partial<VideoSource> & { selectedTitle?: string; selectedPoster?: string }
  >({});
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Diagnostic Test State
  const [isTestingSource, setIsTestingSource] = useState(false);
  const [testDiagnostic, setTestDiagnostic] = useState<{
    status: string;
    sourceKind: SourceKind;
    detectedFormat: string;
    message: string;
    diagnostics: SourceDiagnostics;
  } | null>(null);

  // Inline Playback Test State
  const [showTestPlayer, setShowTestPlayer] = useState(false);
  const [useMgebPrefix, setUseMgebPrefix] = useState(true);

  useEffect(() => {
    if (initialData) {
      const existingUrl = (initialData.originalUrl || initialData.url || '').trim();
      const stripped = stripMgebPrefix(existingUrl);
      const shouldDefaultMgeb = !existingUrl || stripped.hadPrefix;
      setUseMgebPrefix(shouldDefaultMgeb);
      setCurrentSource({
        serverName: shouldDefaultMgeb ? 'MGEB Endpoint' : 'Servidor Principal',
        format: shouldDefaultMgeb ? 'php_endpoint' : 'embed',
        audioLanguage: 'Português',
        quality: '1080p',
        status: 'registered',
        isPrimary: false,
        priority: 1,
        enabled: true,
        seasonNumber: 1,
        episodeNumber: 1,
        ...initialData
      });
    } else {
      setUseMgebPrefix(true);
      setCurrentSource({
        contentType: 'movie',
        audioLanguage: 'Português',
        quality: '1080p',
        status: 'registered',
        format: 'php_endpoint',
        isPrimary: false,
        priority: 1,
        enabled: true,
        serverName: 'MGEB Endpoint',
        seasonNumber: 1,
        episodeNumber: 1
      });
    }
    setTestDiagnostic(null);
    setShowTestPlayer(false);
    setErrorMessage(null);
    setSavingStatus('idle');
  }, [initialData, isOpen]);

  const liveClassification = useMemo(() => {
    if (!currentSource.url?.trim()) return null;
    return classifySourceUrl(currentSource.url);
  }, [currentSource.url]);

  const handleTestSource = async () => {
    const targetUrl = (currentSource.originalUrl || currentSource.url || '').trim();
    if (!targetUrl) {
      setErrorMessage('Insira uma URL de vídeo para testar.');
      return;
    }

    setIsTestingSource(true);
    setTestDiagnostic(null);
    setErrorMessage(null);

    try {
      const res = await api.verifySourceLink(targetUrl, currentSource.format);
      setTestDiagnostic({
        status: res.status,
        sourceKind: res.sourceKind,
        detectedFormat: res.detectedFormat,
        message: res.message,
        diagnostics: res.diagnostics
      });

      setCurrentSource(prev => ({
        ...prev,
        // NEVER overwrite original outer URL with inner param
        url: targetUrl,
        originalUrl: targetUrl,
        sourceKind: res.sourceKind,
        format: (res.detectedFormat || prev.format) as any,
        status: res.status,
        verificationResult: res.message,
        lastVerifiedAt: res.diagnostics?.testedAt || new Date().toISOString(),
        diagnostics: res.diagnostics
      }));
    } catch (err: any) {
      setTestDiagnostic({
        status: 'unverifiable',
        sourceKind: liveClassification?.sourceKind || 'UNKNOWN',
        detectedFormat: currentSource.format || 'auto',
        message: err?.message || 'Falha ao testar fonte.',
        diagnostics: {
          ...(liveClassification?.diagnostics || {}),
          failureReason: err?.message || 'Erro ao executar diagnóstico remoto.'
        }
      });
      setCurrentSource(prev => ({ ...prev, status: 'unverifiable' }));
    } finally {
      setIsTestingSource(false);
    }
  };

  const handleSaveSource = async (keepOpen = false) => {
    const cleanUrl = (currentSource.url || '').trim();
    if (!currentSource.contentId || !cleanUrl || !currentSource.serverName?.trim()) {
      setErrorMessage('Preencha os campos obrigatórios (TMDB ID, URL da Fonte e Nome do Servidor).');
      setSavingStatus('error');
      return;
    }

    const built = buildMgebUrl(cleanUrl, useMgebPrefix);
    if (!built.valid) {
      setErrorMessage(built.error || 'URL inválida.');
      setSavingStatus('error');
      return;
    }

    const classified = classifySourceUrl(built.finalUrl);
    if (!classified.valid) {
      setErrorMessage(classified.error || 'URL inválida.');
      setSavingStatus('error');
      return;
    }

    setSavingStatus('saving');
    setErrorMessage(null);

    const payload: Partial<VideoSource> = {
      ...currentSource,
      url: classified.originalUrl,
      originalUrl: classified.originalUrl,
      sourceKind: currentSource.sourceKind || classified.sourceKind,
      format: currentSource.format || classified.suggestedFormat,
      status: currentSource.status || 'registered',
      diagnostics: currentSource.diagnostics || classified.diagnostics
    };

    try {
      if (currentSource.id) {
        await api.updateVideoSource(currentSource.id, payload);
      } else {
        await api.addVideoSource(payload as any);
      }

      setSavingStatus('success');
      onSave();

      if (keepOpen) {
        setTimeout(() => {
          setCurrentSource(prev => ({
            ...prev,
            id: undefined,
            serverName: `Servidor Fonte ${prev.contentType === 'tv' ? `E${prev.episodeNumber} ` : ''}Backup`,
            url: '',
            originalUrl: undefined,
            sourceKind: undefined,
            diagnostics: undefined,
            isPrimary: false,
            status: 'registered'
          }));
          setTestDiagnostic(null);
          setShowTestPlayer(false);
          setSavingStatus('idle');
        }, 800);
      } else {
        setTimeout(() => {
          onClose();
          setSavingStatus('idle');
        }, 900);
      }
    } catch (err: any) {
      console.error('Failed to save source:', err);
      setErrorMessage(err.message || 'Erro ao salvar fonte.');
      setSavingStatus('error');
    }
  };

  const handleUrlChange = (rawUrl: string) => {
    const classified = classifySourceUrl(rawUrl);
    const shouldReplaceServerName =
      !currentSource.serverName ||
      currentSource.serverName === 'Servidor Principal' ||
      currentSource.serverName === 'UQLOAD' ||
      currentSource.serverName === 'AnonMP4' ||
      currentSource.serverName === 'MGEB Endpoint' ||
      currentSource.serverName === 'Endpoint PHP';

    setCurrentSource(prev => ({
      ...prev,
      // Keep full outer URL intact (e.g. https://mgeb.space/mp4.php?url=...)
      url: rawUrl,
      originalUrl: rawUrl,
      sourceKind: classified.valid ? classified.sourceKind : prev.sourceKind,
      format: (classified.valid ? classified.suggestedFormat : prev.format) as any,
      serverName:
        shouldReplaceServerName && classified.suggestedServerName
          ? classified.suggestedServerName
          : prev.serverName || 'Servidor Principal',
      diagnostics: classified.valid ? classified.diagnostics : prev.diagnostics
    }));
  };

  const activeDiag = testDiagnostic?.diagnostics || currentSource.diagnostics || liveClassification?.diagnostics;
  const activeKind = testDiagnostic?.sourceKind || currentSource.sourceKind || liveClassification?.sourceKind;
  const statusInfo = getStatusDisplayInfo(testDiagnostic?.status || currentSource.status);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-sm overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-full max-w-3xl bg-[#0c0c0c] border border-white/10 rounded-3xl overflow-hidden shadow-2xl my-auto"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white uppercase tracking-tight font-display">
                    {currentSource.id ? 'Editar Fonte de Vídeo' : 'Adicionar Fonte de Vídeo'}
                  </h3>
                  <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                    Associação, Diagnóstico e Reprodução RONYCINE
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 text-zinc-500 hover:text-white transition-all"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 sm:p-8 space-y-6 max-h-[82vh] overflow-y-auto font-sans">
              {/* Selected Content Banner */}
              {currentSource.selectedTitle && (
                <div className="p-4 bg-brand/10 border border-brand/30 rounded-2xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    {currentSource.selectedPoster && (
                      <img
                        src={
                          currentSource.selectedPoster.startsWith('http')
                            ? currentSource.selectedPoster
                            : `https://image.tmdb.org/t/p/w185${currentSource.selectedPoster}`
                        }
                        alt={currentSource.selectedTitle}
                        className="w-10 h-14 object-cover rounded-lg border border-brand/40 flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 bg-brand text-white rounded-md">
                        Conteúdo Selecionado
                      </span>
                      <p className="font-black text-white text-sm truncate mt-1">{currentSource.selectedTitle}</p>
                      <p className="text-[10px] text-zinc-400 font-mono">
                        Tipo: {currentSource.contentType === 'movie' ? 'Filme' : 'Série'} · TMDB ID: {currentSource.contentId}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Form Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Tipo de Conteúdo
                  </label>
                  <select
                    value={currentSource.contentType || 'movie'}
                    onChange={(e) => setCurrentSource({ ...currentSource, contentType: e.target.value as any })}
                    className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-bold"
                  >
                    <option value="movie">Filme</option>
                    <option value="tv">Série</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">TMDB ID</label>
                  <input
                    type="number"
                    value={currentSource.contentId || ''}
                    onChange={(e) => setCurrentSource({ ...currentSource, contentId: parseInt(e.target.value, 10) || undefined })}
                    className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-mono"
                    placeholder="Ex: 550"
                    required
                  />
                </div>

                {currentSource.contentType === 'tv' && (
                  <>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        Temporada
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={currentSource.seasonNumber || 1}
                        onChange={(e) =>
                          setCurrentSource({ ...currentSource, seasonNumber: Math.max(1, parseInt(e.target.value, 10) || 1) })
                        }
                        className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        Episódio
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={currentSource.episodeNumber || 1}
                        onChange={(e) =>
                          setCurrentSource({ ...currentSource, episodeNumber: Math.max(1, parseInt(e.target.value, 10) || 1) })
                        }
                        className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                        required
                      />
                    </div>
                  </>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Nome do Servidor / Fonte
                  </label>
                  <input
                    type="text"
                    value={currentSource.serverName || ''}
                    onChange={(e) => setCurrentSource({ ...currentSource, serverName: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-bold"
                    placeholder="Ex: Fonte Principal, MGEB Endpoint, UQLOAD"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Formato da Fonte
                  </label>
                  <select
                    value={currentSource.format || 'embed'}
                    onChange={(e) => setCurrentSource({ ...currentSource, format: e.target.value as any })}
                    className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-bold"
                  >
                    <option value="mp4">MP4 Direto</option>
                    <option value="m3u8">M3U8 / HLS Stream</option>
                    <option value="dash">DASH Stream (.mpd)</option>
                    <option value="webm">WebM Direto</option>
                    <option value="php_endpoint">Endpoint PHP (ex: mgeb.space/mp4.php)</option>
                    <option value="embed">Embed / Iframe (Player Externo)</option>
                    <option value="iframe">Iframe Player</option>
                    <option value="html">Página HTML Externa</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Idioma do Áudio
                  </label>
                  <input
                    type="text"
                    value={currentSource.audioLanguage || 'Português'}
                    onChange={(e) => setCurrentSource({ ...currentSource, audioLanguage: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none"
                    placeholder="Ex: Português, Dublado, Legendado"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                    Qualidade do Vídeo
                  </label>
                  <select
                    value={currentSource.quality || '1080p'}
                    onChange={(e) => setCurrentSource({ ...currentSource, quality: e.target.value })}
                    className="w-full bg-black border border-white/10 rounded-2xl px-4 py-3 text-sm text-white focus:border-brand outline-none font-bold"
                  >
                    <option value="Automática">Automática / Adaptação HLS</option>
                    <option value="4K">4K Ultra HD</option>
                    <option value="1080p">1080p Full HD</option>
                    <option value="720p">720p HD</option>
                    <option value="480p">480p SD</option>
                  </select>
                </div>
              </div>

              {/* Primary, Enabled & Priority Controls */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-black/60 border border-white/10 cursor-pointer hover:border-brand/40 transition-all">
                  <input
                    type="checkbox"
                    checked={Boolean(currentSource.isPrimary)}
                    onChange={(e) => setCurrentSource({ ...currentSource, isPrimary: e.target.checked })}
                    className="w-4 h-4 accent-[#E50914] rounded cursor-pointer"
                  />
                  <Star className={`w-4 h-4 ${currentSource.isPrimary ? 'text-amber-400 fill-amber-400' : 'text-zinc-500'}`} />
                  <div>
                    <span className="text-xs font-bold text-white block">Fonte principal</span>
                    <span className="text-[10px] text-zinc-500">Prioridade máxima no player.</span>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3.5 rounded-2xl bg-black/60 border border-white/10 cursor-pointer hover:border-emerald-500/40 transition-all">
                  <input
                    type="checkbox"
                    checked={currentSource.enabled !== false}
                    onChange={(e) => setCurrentSource({ ...currentSource, enabled: e.target.checked })}
                    className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                  />
                  <Power className={`w-4 h-4 ${currentSource.enabled !== false ? 'text-emerald-400' : 'text-zinc-500'}`} />
                  <div>
                    <span className="text-xs font-bold text-white block">Fonte ativa</span>
                    <span className="text-[10px] text-zinc-500">Disponível no Direct Play.</span>
                  </div>
                </label>

                <div className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-black/60 border border-white/10">
                  <div>
                    <span className="text-xs font-bold text-white block">Prioridade</span>
                    <span className="text-[10px] text-zinc-500">1 = maior prioridade</span>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={currentSource.priority ?? 1}
                    onChange={(e) =>
                      setCurrentSource({
                        ...currentSource,
                        priority: Math.max(1, parseInt(e.target.value, 10) || 1)
                      })
                    }
                    className="w-16 bg-black border border-white/15 rounded-xl px-2.5 py-2 text-xs text-white font-mono text-center focus:border-brand outline-none"
                  />
                </div>
              </div>

              {/* MGEB Prefix + URL Input + Preview + Test Source */}
              <MgebUrlField
                value={currentSource.url || ''}
                useMgebPrefix={useMgebPrefix}
                onToggleMgebPrefix={setUseMgebPrefix}
                onChangeUrl={(finalUrl) => handleUrlChange(finalUrl)}
                onTestSource={handleTestSource}
                onTogglePlayTest={() => setShowTestPlayer(prev => !prev)}
                isTesting={isTestingSource}
                showPlayTest={showTestPlayer}
                helperText="O prefixo MGEB é combinado automaticamente sem duplicação. Se colar um endereço já completo com https://mgeb.space/mp4.php?url=..., o sistema reconhece e evita duplicar."
              />

              {/* Live / Remote Diagnostic Panel */}
              {currentSource.url?.trim() && (
                <div className="bg-black/70 border border-white/10 rounded-2xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2.5">
                    <div className="flex items-center gap-2">
                      <FileCode className="w-4 h-4 text-brand" />
                      <span className="text-[11px] font-black uppercase tracking-wider text-white">
                        Diagnóstico da Fonte
                      </span>
                    </div>
                    <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-200">
                      Estado: {statusInfo.label}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                    <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5">
                      <span className="text-[9px] font-bold uppercase text-zinc-500 block">Tipo Classificado</span>
                      <span className="text-zinc-200 font-mono font-bold">{getSourceKindLabel(activeKind)}</span>
                    </div>

                    <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5">
                      <span className="text-[9px] font-bold uppercase text-zinc-500 block">Domínio & Endpoint</span>
                      <span className="text-zinc-200 font-mono truncate block">
                        <Globe className="w-3 h-3 inline mr-1 text-zinc-400" />
                        {activeDiag?.domain || '—'} {activeDiag?.endpointPath || ''}
                      </span>
                    </div>

                    {activeDiag?.hasUrlParam && (
                      <div className="sm:col-span-2 bg-white/[0.02] p-2.5 rounded-xl border border-white/5">
                        <span className="text-[9px] font-bold uppercase text-zinc-500 block">
                          Parâmetro ?url= Detectado (URL Original Preservada)
                        </span>
                        <span className="text-zinc-300 font-mono text-[10px] break-all">
                          {activeDiag.nestedUrl || 'Presente (vazio)'}
                        </span>
                      </div>
                    )}

                    {testDiagnostic && (
                      <>
                        <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5">
                          <span className="text-[9px] font-bold uppercase text-zinc-500 block">HTTP / Content-Type Real</span>
                          <span className="text-zinc-200 font-mono">
                            {testDiagnostic.diagnostics.httpStatus ?? 'Sem resposta'} ·{' '}
                            {testDiagnostic.diagnostics.contentType || 'Desconhecido'}
                          </span>
                        </div>

                        <div className="bg-white/[0.02] p-2.5 rounded-xl border border-white/5">
                          <span className="text-[9px] font-bold uppercase text-zinc-500 block">Compatibilidade</span>
                          <span className="text-zinc-200 font-mono">
                            Direto: {testDiagnostic.diagnostics.directPlayable ? 'Sim' : 'Não'} · Iframe:{' '}
                            {testDiagnostic.diagnostics.embedAllowed === false ? 'Bloqueado' : 'Permitido'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {testDiagnostic && (
                    <div
                      className={`p-3 rounded-xl border text-xs font-semibold flex items-start gap-2 ${
                        testDiagnostic.status === 'online'
                          ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                          : 'bg-amber-950/30 border-amber-500/30 text-amber-200'
                      }`}
                    >
                      {testDiagnostic.status === 'online' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <p>{testDiagnostic.message}</p>
                        {testDiagnostic.diagnostics.failureReason && testDiagnostic.status !== 'online' && (
                          <p className="text-[10px] opacity-80 mt-0.5 font-mono">
                            {testDiagnostic.diagnostics.failureReason}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Inline Test Player */}
              {showTestPlayer && currentSource.url && (
                <div className="rounded-2xl overflow-hidden border border-white/15 bg-black aspect-video">
                  <ErrorBoundary fallbackTitle="Erro ao testar reprodução" resetKey={currentSource.url}>
                    <RonycinePlayer
                      sources={[
                        {
                          id: currentSource.id || 'test-preview',
                          url: currentSource.url,
                          originalUrl: currentSource.originalUrl || currentSource.url,
                          format: currentSource.format,
                          sourceKind: currentSource.sourceKind,
                          serverName: currentSource.serverName || 'Teste Admin',
                          audioLanguage: currentSource.audioLanguage,
                          quality: currentSource.quality,
                          isPrimary: true
                        }
                      ]}
                      title={`Teste: ${currentSource.selectedTitle || currentSource.serverName || 'Fonte'}`}
                      autoplay={true}
                    />
                  </ErrorBoundary>
                </div>
              )}

              {savingStatus === 'error' && errorMessage && (
                <div className="p-3.5 bg-brand/10 border border-brand/30 rounded-xl text-brand text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {savingStatus === 'success' && (
                <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Fonte de vídeo guardada com sucesso no RONYCINE API!</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all"
                >
                  Cancelar
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSaveSource(true)}
                    disabled={savingStatus === 'saving'}
                    className="px-5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all border border-white/10 disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingStatus === 'saving' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 text-brand" />
                    )}
                    <span>Guardar e Continuar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveSource(false)}
                    disabled={savingStatus === 'saving'}
                    className="px-6 py-2.5 bg-brand hover:bg-brand/90 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-xl shadow-brand/20 disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingStatus === 'saving' ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    <span>{currentSource.id ? 'Guardar Alterações' : 'Guardar Fonte'}</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
