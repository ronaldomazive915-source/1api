import React, { useState, useEffect } from 'react';
import { Trash2, RefreshCw, RotateCcw, AlertTriangle, Film, Tv, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { MediaItem } from '../../types.js';

export const TrashView: React.FC = () => {
  const [trashedItems, setTrashedItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTrash = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminTrash();
      const list = Array.isArray(res) ? res : ((res as any)?.items || []);
      setTrashedItems(list);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar lixeira.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrash();
  }, []);

  const handleRestore = async (id: string) => {
    try {
      await api.restoreAdminTrashItem(id);
      setNotice('Conteúdo restaurado com sucesso para o catálogo.');
      await loadTrash();
    } catch (err: any) {
      setError(err?.message || 'Erro ao restaurar item.');
    }
  };

  const handlePermanentDelete = async (id: string) => {
    if (!window.confirm('Tem certeza que deseja eliminar este item permanentemente? Esta ação não pode ser desfeita.')) {
      return;
    }
    try {
      await api.deletePermanentTrashItem(id);
      setNotice('Conteúdo eliminado permanentemente.');
      await loadTrash();
    } catch (err: any) {
      setError(err?.message || 'Erro ao eliminar permanentemente.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#E50914] mb-1">
            <Trash2 className="w-4 h-4" />
            <span>Gestão de Exclusões</span>
          </div>
          <h2 className="text-2xl font-black text-white uppercase font-display">Lixeira e Recuperação</h2>
          <p className="text-xs text-zinc-400">Conteúdos removidos temporariamente podem ser restaurados a qualquer momento.</p>
        </div>
        <button
          type="button"
          onClick={loadTrash}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
          <span>Atualizar Lixeira</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      <div className="bg-[#0D0F15] border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-zinc-400 text-[10px] uppercase">
              <tr>
                <th className="p-4">Título</th>
                <th className="p-4">Tipo</th>
                <th className="p-4">TMDB ID</th>
                <th className="p-4">Removido em</th>
                <th className="p-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {trashedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">A lixeira está vazia.</td>
                </tr>
              ) : (
                trashedItems.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02]">
                    <td className="p-4 font-bold text-white flex items-center gap-2.5">
                      {item.type === 'tv' || item.type === 'series' ? (
                        <Tv className="w-4 h-4 text-[#E50914]" />
                      ) : (
                        <Film className="w-4 h-4 text-[#E50914]" />
                      )}
                      <span>{item.title}</span>
                    </td>
                    <td className="p-4 uppercase text-zinc-300 font-mono">{item.type}</td>
                    <td className="p-4 font-mono text-zinc-400">{item.tmdbId || 'N/A'}</td>
                    <td className="p-4 font-mono text-zinc-500">
                      {item.deletedAt ? new Date(item.deletedAt).toLocaleString('pt-PT') : 'N/A'}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRestore(item.id)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-bold text-[11px] flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Restaurar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePermanentDelete(item.id)}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          title="Eliminar permanentemente"
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
    </div>
  );
};
