import React, { useState, useEffect } from 'react';
import { Radio, Search, Plus, Play, Trash2, Edit2, Check, X, Tv } from 'lucide-react';
import { useScreenWakeLock } from '../player/useScreenWakeLock.js';
import { api } from '../../lib/api.js';

interface TvChannel {
  id: string;
  name: string;
  category: 'Esportes' | 'Filmes' | 'Notícias' | 'Canais Abertos' | 'Desenhos';
  logoUrl: string;
  streamUrl: string;
  active: boolean;
}

export const LiveTvManager: React.FC = () => {
  useScreenWakeLock();

  // Local Channels State
  const [channels, setChannels] = useState<TvChannel[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<TvChannel | null>(null);
  
  // Form state
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<'Esportes' | 'Filmes' | 'Notícias' | 'Canais Abertos' | 'Desenhos'>('Canais Abertos');
  const [formLogo, setFormLogo] = useState('');
  const [formStream, setFormStream] = useState('');
  
  // Preview State
  const [previewChannel, setPreviewChannel] = useState<TvChannel | null>(null);

  useEffect(() => {
    loadChannels();
  }, []);

  const loadChannels = async () => {
    try {
      const data = await api.getTvChannels();
      if (Array.isArray(data)) {
        setChannels(data);
        if (data.length > 0 && !previewChannel) {
          setPreviewChannel(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  };

  const handleOpenAddModal = () => {
    setEditingChannel(null);
    setFormName('');
    setFormCategory('Canais Abertos');
    setFormLogo('');
    setFormStream('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (ch: TvChannel) => {
    setEditingChannel(ch);
    setFormName(ch.name);
    setFormCategory(ch.category);
    setFormLogo(ch.logoUrl);
    setFormStream(ch.streamUrl);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formStream.trim()) return;

    try {
      if (editingChannel) {
        await api.updateTvChannel(editingChannel.id, {
          name: formName,
          category: formCategory,
          logoUrl: formLogo,
          streamUrl: formStream,
        });
      } else {
        await api.addTvChannel({
          name: formName,
          category: formCategory,
          logoUrl: formLogo,
          streamUrl: formStream,
          active: true,
        });
      }
      setIsModalOpen(false);
      loadChannels();
    } catch (err) {
      console.error('Failed to save channel:', err);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Excluir este canal de TV?')) return;
    try {
      await api.deleteTvChannel(id);
      if (previewChannel?.id === id) {
        setPreviewChannel(null);
      }
      loadChannels();
    } catch (err) {
      console.error('Failed to delete channel:', err);
    }
  };

  const handleToggleActive = async (ch: TvChannel) => {
    try {
      await api.updateTvChannel(ch.id, { active: !ch.active });
      loadChannels();
    } catch (err) {
      console.error('Failed to toggle status:', err);
    }
  };

  const filteredChannels = channels.filter(ch => {
    const matchesSearch = ch.name.toLowerCase().includes(search.toLowerCase());
    const matchesCat = categoryFilter === 'all' || ch.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6 text-white font-sans">
      {/* 1. HEADER */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-red-600 animate-pulse" />
            <h2 className="text-xl font-black uppercase tracking-wider text-white font-display">
              GERENCIADOR DE CANAIS DE TV AO VIVO
            </h2>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Cadastre e teste a transmissão dos seus canais com links HLS / M3U8 e Embeds.
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-950/50"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Canal</span>
        </button>
      </div>

      {/* 2. TOOLBAR */}
      <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-xl p-3 flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Pesquisar canal..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-600"
          />
        </div>

        <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 gap-0.5 overflow-x-auto">
          {['all', 'Canais Abertos', 'Esportes', 'Filmes', 'Notícias', 'Desenhos'].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase whitespace-nowrap transition-all ${
                categoryFilter === cat ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {cat === 'all' ? 'Todos' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* 3. MAIN CHANNEL CONTENT WORKSPACE */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* CHANNELS TABLE/LIST (7 cols) */}
        <div className="lg:col-span-7 bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-950 text-zinc-400 uppercase tracking-wider font-bold text-[10px] border-b border-zinc-800">
                  <th className="p-3.5">Logo</th>
                  <th className="p-3.5">Nome</th>
                  <th className="p-3.5">Categoria</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredChannels.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-zinc-500 font-bold">
                      Nenhum canal localizado para a pesquisa ou categoria selecionada.
                    </td>
                  </tr>
                ) : (
                  filteredChannels.map(ch => (
                    <tr
                      key={ch.id}
                      className={`hover:bg-zinc-800/40 transition-colors cursor-pointer ${
                        previewChannel?.id === ch.id ? 'bg-zinc-800/70' : ''
                      }`}
                      onClick={() => setPreviewChannel(ch)}
                    >
                      <td className="p-3.5">
                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 shrink-0">
                          {ch.logoUrl ? (
                            <img src={ch.logoUrl} alt={ch.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-600 text-[10px] font-bold">TV</div>
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 font-bold text-white">{ch.name}</td>
                      <td className="p-3.5 text-zinc-400">{ch.category}</td>
                      <td className="p-3.5" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleToggleActive(ch)}
                          className={`px-2 py-1 rounded-full text-[9px] font-black uppercase border tracking-wider transition-colors ${
                            ch.active
                              ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                              : 'bg-red-950 text-red-400 border-red-800'
                          }`}
                        >
                          {ch.active ? 'Ativo' : 'Inativo'}
                        </button>
                      </td>
                      <td className="p-3.5 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditModal(ch)}
                            className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors"
                            title="Editar canal"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(ch.id)}
                            className="p-1.5 hover:bg-red-950 text-zinc-400 hover:text-red-400 rounded-lg transition-colors"
                            title="Excluir canal"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TV PREVIEW PANEL PLAYER (5 cols) */}
        <div className="lg:col-span-5 lg:sticky lg:top-24">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                📺 TESTE DE STREAMING AO VIVO
              </span>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                Player Embed HTML5
              </span>
            </div>

            {previewChannel ? (
              <div className="space-y-4">
                {previewChannel.streamUrl.includes('embed') || previewChannel.streamUrl.includes('iframe') || previewChannel.streamUrl.includes('html') ? (
                  <iframe
                    src={previewChannel.streamUrl}
                    className="w-full aspect-video border-none rounded-xl"
                    allowFullScreen
                  />
                ) : (
                  <video
                    controls
                    autoPlay
                    src={previewChannel.streamUrl}
                    className="w-full aspect-video bg-black rounded-xl"
                  />
                )}

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-white text-sm">{previewChannel.name}</h4>
                      <p className="text-zinc-500 text-[11px] font-mono">{previewChannel.category}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase bg-emerald-950 text-emerald-400 border border-emerald-800">
                      {previewChannel.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>

                  <div className="bg-zinc-950 p-2.5 rounded-xl border border-zinc-800/80 font-mono text-[10px] text-zinc-400 break-all space-y-1">
                    <span className="text-zinc-500 font-bold block">URL DO STREAM:</span>
                    <span className="text-red-400">{previewChannel.streamUrl}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-zinc-500 space-y-3">
                <Tv className="w-12 h-12 text-zinc-800 mx-auto" />
                <p className="text-xs font-bold text-zinc-400">Nenhum canal selecionado</p>
                <p className="text-[11px] max-w-xs mx-auto">
                  Clique em um canal na tabela ao lado para visualizar a transmissão em tempo real.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 4. MODAL NOVO/EDITAR CANAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                {editingChannel ? 'Editar Canal de TV' : 'Cadastrar Novo Canal'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-zinc-400 hover:text-white p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nome do Canal</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: TV Globo HD"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Categoria</label>
                <select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value as any)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-bold"
                >
                  <option value="Canais Abertos">Canais Abertos</option>
                  <option value="Esportes">Esportes</option>
                  <option value="Filmes">Filmes</option>
                  <option value="Notícias">Notícias</option>
                  <option value="Desenhos">Desenhos</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">URL do Logo (Opcional)</label>
                <input
                  type="url"
                  placeholder="https://exemplo.com/logo.png"
                  value={formLogo}
                  onChange={e => setFormLogo(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">URL de Transmissão (HLS .m3u8 / Embed)</label>
                <input
                  type="url"
                  required
                  placeholder="https://exemplo.com/live/stream.m3u8"
                  value={formStream}
                  onChange={e => setFormStream(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600 font-mono"
                />
              </div>

              <div className="pt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>Salvar Canal</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
