import React, { useState } from 'react';
import {
  Copy,
  Check,
  Eraser,
  ShieldCheck,
  Play,
  CheckCircle2,
  AlertTriangle,
  Link2,
  RefreshCw
} from 'lucide-react';
import { MGEB_PREFIX, buildMgebUrl, stripMgebPrefix } from '../../lib/mgebUtils.js';

interface MgebUrlFieldProps {
  value: string;
  useMgebPrefix: boolean;
  onChangeUrl: (finalUrl: string, innerUrl: string) => void;
  onToggleMgebPrefix: (useMgeb: boolean) => void;
  onTestSource?: () => void;
  onTogglePlayTest?: () => void;
  isTesting?: boolean;
  showPlayTest?: boolean;
  label?: string;
  placeholder?: string;
  helperText?: string;
}

export const MgebUrlField: React.FC<MgebUrlFieldProps> = ({
  value,
  useMgebPrefix,
  onChangeUrl,
  onToggleMgebPrefix,
  onTestSource,
  onTogglePlayTest,
  isTesting = false,
  showPlayTest = false,
  label = 'Endereço da Fonte de Vídeo',
  placeholder = 'https://ww1.123flmsfree.com/pt/detail/movie/NArSJO2YBjCoeqfg0mlMH-Heart-of-the-Beast',
  helperText
}) => {
  const [copiedFinal, setCopiedFinal] = useState(false);

  const { innerUrl } = stripMgebPrefix(value);
  const displayInput = useMgebPrefix ? innerUrl : value;
  const evaluation = buildMgebUrl(displayInput, useMgebPrefix);
  const finalPreview = evaluation.finalUrl || (useMgebPrefix ? MGEB_PREFIX : '');
  const hasInput = displayInput.trim().length > 0;

  const handleInputChange = (rawTyped: string) => {
    const cleaned = rawTyped;
    if (useMgebPrefix) {
      const stripped = stripMgebPrefix(cleaned);
      const nextFinal = stripped.innerUrl ? `${MGEB_PREFIX}${stripped.innerUrl}` : '';
      onChangeUrl(nextFinal, stripped.innerUrl);
    } else {
      onChangeUrl(cleaned.trim(), cleaned.trim());
    }
  };

  const handleToggleMode = (nextUseMgeb: boolean) => {
    onToggleMgebPrefix(nextUseMgeb);
    const stripped = stripMgebPrefix(value);
    if (nextUseMgeb) {
      const nextFinal = stripped.innerUrl ? `${MGEB_PREFIX}${stripped.innerUrl}` : '';
      onChangeUrl(nextFinal, stripped.innerUrl);
    } else {
      const direct = stripped.innerUrl || value;
      onChangeUrl(direct, direct);
    }
  };

  const handleClear = () => {
    onChangeUrl('', '');
  };

  const handleCopyFinal = () => {
    if (!finalPreview) return;
    navigator.clipboard?.writeText(finalPreview);
    setCopiedFinal(true);
    setTimeout(() => setCopiedFinal(false), 1800);
  };

  return (
    <div className="space-y-3">
      {/* Header Row + Mode Switch */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-[#E50914]" />
          <span>{label}</span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleToggleMode(!useMgebPrefix)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors whitespace-nowrap shrink-0 ${
              useMgebPrefix
                ? 'bg-[#E50914]/15 border-[#E50914]/40 text-white hover:bg-[#E50914]/25'
                : 'bg-white/5 border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            {useMgebPrefix ? 'Prefixo MGEB: Ativo' : 'Usar Prefixo MGEB'}
          </button>

          {hasInput && (
            <button
              type="button"
              onClick={handleClear}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white flex items-center gap-1 whitespace-nowrap shrink-0"
              title="Limpar campo"
            >
              <Eraser className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          )}

          {onTestSource && (
            <button
              type="button"
              onClick={onTestSource}
              disabled={isTesting || !evaluation.valid}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              {isTesting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#E50914]" />
              ) : (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              )}
              <span>Testar Fonte</span>
            </button>
          )}

          {onTogglePlayTest && (
            <button
              type="button"
              onClick={onTogglePlayTest}
              disabled={!evaluation.valid}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#E50914]/20 hover:bg-[#E50914] border border-[#E50914]/40 text-white flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap shrink-0 transition-colors"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{showPlayTest ? 'Fechar Player' : 'Reproduzir Teste'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Visually Separated Two-Part Input: FIXED MGEB PREFIX + ORIGINAL SOURCE LINK */}
      <div className="bg-[#09090b] border border-white/15 rounded-xl p-3 space-y-2.5">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 items-stretch">
          <div className="lg:col-span-5 bg-black/80 border border-white/10 rounded-lg px-3 py-2 flex flex-col justify-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Prefixo Fixo {useMgebPrefix ? '(Automático)' : '(Desativado)'}
            </span>
            <code
              className={`text-xs font-mono truncate select-all mt-0.5 ${
                useMgebPrefix ? 'text-[#E50914] font-semibold' : 'text-zinc-500 line-through'
              }`}
              title={MGEB_PREFIX}
            >
              {MGEB_PREFIX}
            </code>
          </div>

          <div className="lg:col-span-7 flex flex-col justify-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1 block lg:hidden">
              Link da Fonte
            </span>
            <input
              type="text"
              value={displayInput}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={placeholder}
              className="w-full h-full min-h-[44px] bg-black border border-white/15 focus:border-[#E50914] rounded-lg px-3.5 py-2 text-xs sm:text-sm font-mono text-white outline-none transition-colors"
            />
          </div>
        </div>

        {/* Final Combined URL Preview + Validity Indicator */}
        <div className="bg-black/90 border border-white/10 rounded-lg px-3 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Pré-visualização do Resultado Final
              </span>
              {hasInput ? (
                evaluation.valid ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Endereço válido
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Endereço inválido
                  </span>
                )
              ) : (
                <span className="text-[11px] text-zinc-500">Aguardando link original</span>
              )}
            </div>
            <p className="text-xs font-mono text-emerald-400 break-all select-all">
              {hasInput ? finalPreview : `${MGEB_PREFIX}...`}
            </p>
            {hasInput && !evaluation.valid && evaluation.error && (
              <p className="text-[11px] text-amber-300 font-medium">{evaluation.error}</p>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopyFinal}
            disabled={!hasInput}
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-xs font-bold text-zinc-200 hover:text-white flex items-center gap-1.5 shrink-0 self-start sm:self-center disabled:opacity-40 whitespace-nowrap"
          >
            {copiedFinal ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedFinal ? 'Copiado' : 'Copiar URL'}</span>
          </button>
        </div>

        {helperText && <p className="text-[11px] text-zinc-400">{helperText}</p>}
      </div>
    </div>
  );
};
