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
  RefreshCw,
  Sparkles,
  Globe
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
    if (useMgebPrefix) {
      const built = buildMgebUrl(rawTyped, true);
      onChangeUrl(built.innerUrl ? built.finalUrl : '', built.innerUrl);
    } else {
      const cleaned = rawTyped.trim();
      onChangeUrl(cleaned, cleaned);
    }
  };

  const handleToggleMode = (nextUseMgeb: boolean) => {
    onToggleMgebPrefix(nextUseMgeb);
    const stripped = stripMgebPrefix(value);
    if (nextUseMgeb) {
      const built = buildMgebUrl(stripped.innerUrl || value, true);
      onChangeUrl(built.innerUrl ? built.finalUrl : '', built.innerUrl);
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
      {/* Label & Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-[#E50914]" />
          <span>{label}</span>
        </label>

        <div className="inline-flex rounded-xl border border-white/10 bg-[#09090b] p-0.5">
          <button
            type="button"
            onClick={() => handleToggleMode(true)}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              useMgebPrefix
                ? 'bg-[#E50914] text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Sparkles className="w-3 h-3" />
            Prefixo MGEB
          </button>
          <button
            type="button"
            onClick={() => handleToggleMode(false)}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap ${
              !useMgebPrefix
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Globe className="w-3 h-3" />
            Link Original
          </button>
        </div>
      </div>

      {/* URL Input & Actions */}
      <div className="bg-[#09090b] border border-white/10 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-zinc-400">
            {useMgebPrefix
              ? 'Insira a URL original sem prefixo — combinação MGEB automática sem duplicação.'
              : 'Insira a URL direta do stream (.mp4, .m3u8) ou embed.'}
          </span>

          <div className="flex items-center gap-2">
            {hasInput && (
              <button
                type="button"
                onClick={handleClear}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white flex items-center gap-1 whitespace-nowrap"
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
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap"
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
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-[#E50914]/20 hover:bg-[#E50914] border border-[#E50914]/40 text-white flex items-center gap-1.5 disabled:opacity-40 whitespace-nowrap transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{showPlayTest ? 'Fechar Player' : 'Reproduzir Teste'}</span>
              </button>
            )}
          </div>
        </div>

        <input
          type="text"
          value={displayInput}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder={placeholder}
          className="w-full min-h-[44px] bg-black border border-white/15 focus:border-[#E50914] rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-mono text-white outline-none transition-colors"
        />

        {/* PREFIXO OFICIAL MGEB + Preview */}
        <div className="bg-black border border-white/10 rounded-xl px-3.5 py-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-mono font-black uppercase tracking-wider text-[#E50914] shrink-0">
                PREFIXO OFICIAL MGEB
              </span>
              <code className="text-[11px] font-mono text-zinc-300 truncate select-all">{MGEB_PREFIX}</code>
            </div>

            {hasInput ? (
              evaluation.valid ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {evaluation.compatibilityLabel || 'Endereço válido'}
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

          {hasInput && (
            <div className="space-y-1.5 pt-1 border-t border-white/5 text-[11px] font-mono">
              <div className="flex items-start gap-2">
                <span className="text-zinc-500 shrink-0 w-24">URL Original:</span>
                <span className="text-zinc-300 break-all">{evaluation.innerUrl || displayInput}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  <span className="text-zinc-500 shrink-0 w-24">URL Final:</span>
                  <span className="text-emerald-400 break-all select-all">{finalPreview}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyFinal}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/15 border border-white/10 text-[11px] font-sans font-bold text-zinc-200 flex items-center gap-1 shrink-0 whitespace-nowrap"
                >
                  {copiedFinal ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedFinal ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
            </div>
          )}

          {hasInput && evaluation.isHtmlPage && !useMgebPrefix && (
            <p className="text-[11px] text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Página HTML externa detetada — ative o Prefixo Oficial MGEB para converter o stream automaticamente.
            </p>
          )}

          {hasInput && !evaluation.valid && evaluation.error && (
            <p className="text-[11px] text-amber-300 font-medium">{evaluation.error}</p>
          )}
        </div>

        {helperText && <p className="text-[11px] text-zinc-400">{helperText}</p>}
      </div>
    </div>
  );
};
