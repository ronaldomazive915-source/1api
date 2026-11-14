import React, { useState, useEffect } from 'react';
import {
  Play,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Film,
  Tv,
  ExternalLink,
  Copy,
  Trash2,
  Check,
  Globe,
  Sliders,
  Sparkles,
  Link as LinkIcon,
  Eye,
  Star
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { PlayerSource, VideoFormatType } from '../../types.js';
import { OFFICIAL_BASE_URL } from '../../lib/siteConfig.js';

export const PlayerSourcesManager: React.FC = () => {
  const [sources, setSources] = useState<PlayerSource[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<'all' | 'movie' | 'tv'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Form State for Adding Source
  const [showForm, setShowForm] = useState<boolean>(false);
  const [formData, setFormData] = useState({
    tmdbId: '',
    imdbId: '',
    type: 'movie' as 'movie' | 'tv',
    season: '1',
    episode: '1',
    format: 'm3u8' as VideoFormatType,
    url: '',
    provider: 'custom',
    label: '',
    quality: 'Auto',
    isPrimary: true
  });

  // Testing URL state
  const [testingUrl, setTestingUrl] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; accessible: boolean; format: string; message: string } | null>(null);

  // Copy Feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Preview Modal
  const [previewSource, setPreviewSource] = useState<PlayerSource | null>(null);

  const loadSources = async () => {
    setLoading(true);
    try {
      const data = await api.getPlayerSources();
      setSources(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSources();
  }, []);

  const handleTestUrl = async () => {
    if (!formData.url) return;
    setTestingUrl(true);
    setTestResult(null);
    try {
      const res = await api.testPlayerSourceUrl(formData.url);
      setTestResult(res);
      if (res.accessible && res.format) {
        setFormData(prev => ({ ...prev, format: res.format as VideoFormatType }));
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        accessible: false,
        format: 'mp4',
        message: `Erro ao testar URL: ${err.message}`
      });
    } finally {
      setTestingUrl(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.url) return;

    try {
      await api.addPlayerSource({
        tmdbId: formData.tmdbId ? parseInt(formData.tmdbId) : undefined,
        imdbId: formData.imdbId || undefined,
        type: formData.type,
        season: formData.type === 'tv' ? parseInt(formData.season) : undefined,
        episode: formData.type === 'tv' ? parseInt(formData.episode) : undefined,
        format: formData.format,
        url: formData.url,
        provider: formData.provider || 'custom',
        label: formData.label || (formData.isPrimary ? 'Servidor Principal' : 'Servidor Alternativo'),
        quality: formData.quality,
        isPrimary: formData.isPrimary,
        status: 'active'
      });

      setShowForm(false);
      setFormData({
        tmdbId: '',
        imdbId: '',
        type: 'movie',
        season: '1',
        episode: '1',
        format: 'm3u8',
        url: '',
        provider: 'custom',
        label: '',
        quality: 'Auto',
        isPrimary: true
      });
      setTestResult(null);
      loadSources();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja remover esta fonte de reprodução?')) return;
    try {
      await api.deletePlayerSource(id);
      loadSources();
    } catch (err) {
      console.error(err);
    }
  };

  const copyEmbedLink = (source: PlayerSource) => {
    let url = '';
    if (source.type === 'tv') {
      url = `${OFFICIAL_BASE_URL}/embed/${source.tmdbId || 'tv/imdb/' + source.imdbId}/${source.season || 1}/${source.episode || 1}`;
    } else {
      url = `${OFFICIAL_BASE_URL}/embed/${source.tmdbId || 'imdb/' + source.imdbId}`;
    }

    navigator.clipboard.writeText(url);
    setCopiedId(source.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredSources = sources.filter(s => {
    if (filterType !== 'all' && s.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        s.url.toLowerCase().includes(q) ||
        (s.label && s.label.toLowerCase().includes(q)) ||
        (s.tmdbId && String(s.tmdbId).includes(q)) ||
        (s.imdbId && s.imdbId.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-red-950/40 via-zinc-900 to-zinc-900 p-6 rounded-3xl border border-red-900/30 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 bg-[#E50914] text-white font-black text-[10px] rounded uppercase tracking-wider">
              RONYCINE OFICIAL
            </span>
            <h2 className="text-xl font-black text-white tracking-tight">Gerenciador de Player & Fontes</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1 max-w-xl">
            Cadastre fontes diretas de vídeo em MP4 e M3U8 (HLS), teste acessibilidade, gerencie servidores alternativos e obtenha os links de <code className="text-red-400">/embed</code> universais.
          </p>
        </div>

        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center space-x-2 px-5 py-3 bg-[#E50914] hover:bg-red-700 text-white font-bold rounded-2xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-red-900/30 active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Cadastrar Nova Fonte</span>
        </button>
      </div>

      {/* Form Modal / Inline */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-zinc-900/90 border border-zinc-800 p-6 rounded-3xl space-y-4 shadow-2xl backdrop-blur-xl">
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-[#E50914]" />
            <span>Adicionar Fonte de Reprodução Direta</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Tipo de Conteúdo</label>
              <select
                value={formData.type}
                onChange={e => setFormData({ ...formData, type: e.target.value as 'movie' | 'tv' })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              >
                <option value="movie">Filme</option>
                <option value="tv">Série (Episódio)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">TMDB ID</label>
              <input
                type="number"
                placeholder="Ex: 550"
                value={formData.tmdbId}
                onChange={e => setFormData({ ...formData, tmdbId: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">IMDb ID (Opcional)</label>
              <input
                type="text"
                placeholder="Ex: tt0137523"
                value={formData.imdbId}
                onChange={e => setFormData({ ...formData, imdbId: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              />
            </div>
          </div>

          {formData.type === 'tv' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Temporada</label>
                <input
                  type="number"
                  min="1"
                  value={formData.season}
                  onChange={e => setFormData({ ...formData, season: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Episódio</label>
                <input
                  type="number"
                  min="1"
                  value={formData.episode}
                  onChange={e => setFormData({ ...formData, episode: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1">URL Direta da Mídia (MP4 ou M3U8)</label>
            <div className="flex gap-2">
              <input
                type="url"
                required
                placeholder="https://servidor-autorizado.com/video.m3u8"
                value={formData.url}
                onChange={e => setFormData({ ...formData, url: e.target.value })}
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none font-mono"
              />
              <button
                type="button"
                onClick={handleTestUrl}
                disabled={testingUrl || !formData.url}
                className="px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs rounded-xl transition-colors disabled:opacity-50 flex items-center space-x-1"
              >
                {testingUrl ? <RefreshCw className="w-4 h-4 animate-spin" /> : <span>Testar Fonte</span>}
              </button>
            </div>
          </div>

          {/* Test Result Box */}
          {testResult && (
            <div className={`p-3 rounded-xl border text-xs flex items-center space-x-2 ${
              testResult.accessible ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'
            }`}>
              {testResult.accessible ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Formato</label>
              <select
                value={formData.format}
                onChange={e => setFormData({ ...formData, format: e.target.value as VideoFormatType })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              >
                <option value="m3u8">M3U8 / HLS</option>
                <option value="mp4">MP4 / Vídeo Direto</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1">Nome do Servidor / Rótulo</label>
              <input
                type="text"
                placeholder="Ex: Servidor Principal 1080p"
                value={formData.label}
                onChange={e => setFormData({ ...formData, label: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-[#E50914] focus:outline-none"
              />
            </div>

            <div className="flex items-center space-x-2 pt-6">
              <input
                type="checkbox"
                id="isPrimary"
                checked={formData.isPrimary}
                onChange={e => setFormData({ ...formData, isPrimary: e.target.checked })}
                className="w-4 h-4 rounded bg-zinc-950 border-zinc-800 text-[#E50914] focus:ring-0"
              />
              <label htmlFor="isPrimary" className="text-xs font-medium text-zinc-300">
                Definir como Servidor Principal
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-xl text-xs"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 bg-[#E50914] hover:bg-red-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider"
            >
              Salvar Fonte
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-zinc-900 p-4 rounded-2xl border border-zinc-800">
        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              filterType === 'all' ? 'bg-[#E50914] text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Todos ({sources.length})
          </button>
          <button
            onClick={() => setFilterType('movie')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              filterType === 'movie' ? 'bg-[#E50914] text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Filmes
          </button>
          <button
            onClick={() => setFilterType('tv')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
              filterType === 'tv' ? 'bg-[#E50914] text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            Séries
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-500" />
          <input
            type="text"
            placeholder="Buscar por ID, URL ou Servidor..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-[#E50914]"
          />
        </div>
      </div>

      {/* Sources List Table */}
      {loading ? (
        <div className="p-12 text-center text-zinc-500 flex justify-center">
          <RefreshCw className="w-8 h-8 animate-spin text-[#E50914]" />
        </div>
      ) : filteredSources.length === 0 ? (
        <div className="p-12 text-center bg-zinc-900/50 rounded-3xl border border-zinc-800 text-zinc-400">
          Nenhuma fonte de reprodução encontrada.
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider font-bold border-b border-zinc-800">
                <tr>
                  <th className="p-4">Conteúdo</th>
                  <th className="p-4">Formato</th>
                  <th className="p-4">Servidor / Rótulo</th>
                  <th className="p-4">URL da Mídia</th>
                  <th className="p-4 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredSources.map(source => (
                  <tr key={source.id} className="hover:bg-zinc-850/50 transition-colors">
                    <td className="p-4 font-semibold">
                      <div className="flex items-center space-x-2">
                        {source.type === 'movie' ? <Film className="w-4 h-4 text-[#E50914]" /> : <Tv className="w-4 h-4 text-sky-400" />}
                        <span>
                          {source.type === 'movie' ? 'Filme' : `Série T${source.season || 1}:E${source.episode || 1}`}
                          {source.tmdbId ? ` (TMDB ${source.tmdbId})` : ` (${source.imdbId})`}
                        </span>
                        {source.isPrimary && (
                          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 font-bold text-[10px] rounded border border-amber-500/30">
                            Principal
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${
                        source.format === 'm3u8' ? 'bg-purple-950 text-purple-300 border border-purple-800' : 'bg-blue-950 text-blue-300 border border-blue-800'
                      }`}>
                        {source.format.toUpperCase()}
                      </span>
                    </td>

                    <td className="p-4 font-medium text-white">{source.label || 'Personalizado'}</td>

                    <td className="p-4 font-mono text-[11px] text-zinc-400 truncate max-w-xs">
                      {source.url}
                    </td>

                    <td className="p-4">
                      <div className="flex items-center justify-center space-x-2">
                        <button
                          onClick={() => copyEmbedLink(source)}
                          className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition-colors"
                          title="Copiar Link /EMBED Universal"
                        >
                          {copiedId === source.id ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>

                        <button
                          onClick={() => setPreviewSource(source)}
                          className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition-colors"
                          title="Preview no RONYCINE Player"
                        >
                          <Eye className="w-4 h-4 text-red-400" />
                        </button>

                        <button
                          onClick={() => handleDelete(source.id)}
                          className="p-2 bg-red-950/60 hover:bg-red-900/80 text-red-300 rounded-xl transition-colors"
                          title="Excluir Fonte"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
