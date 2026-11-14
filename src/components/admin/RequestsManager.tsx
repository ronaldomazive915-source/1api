import React, { useState, useEffect } from 'react';
import { BellRing, Check, Search, Trash2, Download, RefreshCw, AlertCircle, CheckCircle2, UserCheck, Layers, X } from 'lucide-react';
import { api } from '../../lib/api.js';

interface MediaRequest {
  id: string;
  userEmail: string;
  title: string;
  tmdbId: number;
  type: 'movie' | 'tv';
  requestDate: string;
  status: 'PENDING' | 'IMPORTED' | 'REJECTED';
}

interface RequestsManagerProps {
  onCatalogUpdated?: () => void;
}

export const RequestsManager: React.FC<RequestsManagerProps> = ({ onCatalogUpdated }) => {
  const [requests, setRequests] = useState<MediaRequest[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loadingId, setLoadingId] = useState<string | null>(null);
  
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('playfilme_catalog_requests');
    if (saved) {
      setRequests(JSON.parse(saved));
    } else {
      // Pre-seed default requests
      const initialRequests: MediaRequest[] = [
        { id: 'req-1', userEmail: 'gabriel.costa@gmail.com', title: 'Oppenheimer', tmdbId: 872585, type: 'movie', requestDate: '2026-08-19', status: 'PENDING' },
        { id: 'req-2', userEmail: 'sofia.mendes@outlook.com', title: 'The Last of Us', tmdbId: 100088, type: 'tv', requestDate: '2026-08-18', status: 'PENDING' },
        { id: 'req-3', userEmail: 'thiago.silva@hotmail.com', title: 'Dune: Part Two', tmdbId: 693134, type: 'movie', requestDate: '2026-08-17', status: 'IMPORTED' },
        { id: 'req-4', userEmail: 'ana.julia@yahoo.com', title: 'Shogun (Xógun)', tmdbId: 111110, type: 'tv', requestDate: '2026-08-15', status: 'PENDING' },
      ];
      setRequests(initialRequests);
      localStorage.setItem('playfilme_catalog_requests', JSON.stringify(initialRequests));
    }
  }, []);

  const saveRequests = (list: MediaRequest[]) => {
    setRequests(list);
    localStorage.setItem('playfilme_catalog_requests', JSON.stringify(list));
  };

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  // 1-Click Import execution using Real TMDB API import callback!
  const handleImportRequest = async (req: MediaRequest) => {
    setLoadingId(req.id);
    showToast('success', `Iniciando importação sob demanda de "${req.title}"...`);
    
    try {
      // Calls actual backend endpoint to fetch and format the title!
      const res = await api.importTmdbMedia(req.tmdbId, req.type, false);
      
      if (res.success || res.exists) {
        // Update request status to imported
        const updated = requests.map(r => r.id === req.id ? { ...r, status: 'IMPORTED' as const } : r);
        saveRequests(updated);
        
        showToast('success', `✓ "${req.title}" importado com sucesso para o acervo!`);
        
        if (onCatalogUpdated) {
          onCatalogUpdated();
        }
      } else {
        showToast('error', res.message || 'Falha ao processar importação.');
      }
    } catch (err: any) {
      console.error('Demanded import failed:', err);
      showToast('error', err.message || 'Falha na conexão ou limite TMDB atingido.');
    } finally {
      setLoadingId(null);
    }
  };

  const handleRejectRequest = (id: string) => {
    if (confirm('Tem certeza que deseja marcar este pedido como rejeitado?')) {
      const updated = requests.map(r => r.id === id ? { ...r, status: 'REJECTED' as const } : r);
      saveRequests(updated);
      showToast('success', 'Pedido marcado como rejeitado.');
    }
  };

  const handleDeleteRequest = (id: string) => {
    if (confirm('Tem certeza que deseja apagar o registro deste pedido de catálogo?')) {
      const filtered = requests.filter(r => r.id !== id);
      saveRequests(filtered);
      showToast('success', 'Pedido excluído.');
    }
  };

  const filteredRequests = requests.filter(req => {
    const matchSearch = req.title.toLowerCase().includes(search.toLowerCase()) || 
                        req.userEmail.toLowerCase().includes(search.toLowerCase()) ||
                        String(req.tmdbId).includes(search);
    const matchStatus = statusFilter === 'all' || req.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const pendingCount = requests.filter(r => r.status === 'PENDING').length;

  return (
    <div className="space-y-6 text-zinc-100 font-sans">
      
      {/* Toast Alert Box */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 text-xs font-bold border ${
          toast.type === 'success' 
            ? 'bg-emerald-950 border-emerald-600 text-emerald-200' 
            : 'bg-red-950 border-red-600 text-red-200'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <AlertCircle className="w-5 h-5 text-red-400 shrink-0" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 rounded-3xl p-6 border border-zinc-800 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-600/20 border border-red-600/40 rounded-2xl text-red-500">
              <BellRing className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-wide uppercase flex items-center gap-2">
                📥 PEDIDOS DE CONTEÚDO
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Atenda solicitações de filmes e séries dos usuários com importação automatizada instantânea.
              </p>
            </div>
          </div>
        </div>

        {pendingCount > 0 && (
          <div className="flex items-center gap-2 px-3.5 py-1.5 bg-red-950/80 border border-red-800/60 rounded-full text-xs font-extrabold text-red-400">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping"></span>
            <span>{pendingCount} Pendentes</span>
          </div>
        )}
      </div>

      {/* TOOLBAR */}
      <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Pesquisar pedidos por título, usuário ou ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-600"
          />
        </div>

        <div className="flex bg-zinc-950 p-1 border border-zinc-800 rounded-xl gap-1">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'PENDING', label: 'Pendentes' },
            { id: 'IMPORTED', label: 'Importados' },
            { id: 'REJECTED', label: 'Rejeitados' }
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setStatusFilter(opt.id)}
              className={`px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all whitespace-nowrap ${
                statusFilter === opt.id ? 'bg-red-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* TABLE/GRID OF REQUESTS */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-zinc-950 text-zinc-400 uppercase tracking-wider font-bold text-[10px] border-b border-zinc-800">
                <th className="p-4">Usuário</th>
                <th className="p-4">Título Solicitado</th>
                <th className="p-4">TMDB ID</th>
                <th className="p-4">Tipo</th>
                <th className="p-4">Data do Pedido</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Importação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-zinc-500 font-bold">
                    Nenhum pedido de conteúdo encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                filteredRequests.map(req => {
                  const isPending = req.status === 'PENDING';
                  const isImported = req.status === 'IMPORTED';
                  const isLoading = loadingId === req.id;

                  return (
                    <tr key={req.id} className="hover:bg-zinc-800/35 transition-colors">
                      <td className="p-4 font-semibold text-zinc-300">{req.userEmail}</td>
                      <td className="p-4">
                        <span className="font-extrabold text-white text-sm">{req.title}</span>
                      </td>
                      <td className="p-4 font-mono text-zinc-400 font-bold">{req.tmdbId}</td>
                      <td className="p-4">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase border ${
                          req.type === 'movie' 
                            ? 'bg-red-950 text-red-400 border-red-900/40' 
                            : 'bg-purple-950 text-purple-400 border-purple-900/40'
                        }`}>
                          {req.type === 'movie' ? 'Filme' : 'Série'}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-zinc-400">
                        {new Date(req.requestDate).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase border tracking-wider ${
                          isImported ? 'bg-emerald-950 text-emerald-400 border-emerald-800' :
                          req.status === 'REJECTED' ? 'bg-zinc-950 text-zinc-500 border-zinc-800' :
                          'bg-amber-950 text-amber-400 border-amber-800/80 animate-pulse'
                        }`}>
                          {isImported ? 'Adicionado' : req.status === 'REJECTED' ? 'Rejeitado' : 'Pendente'}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {isPending ? (
                            <>
                              <button
                                onClick={() => handleImportRequest(req)}
                                disabled={isLoading || loadingId !== null}
                                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex items-center gap-1"
                                title="Importar conteúdo automaticamente de 1-Click"
                              >
                                {isLoading ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Download className="w-3 h-3" />
                                )}
                                <span>1-Click</span>
                              </button>
                              <button
                                onClick={() => handleRejectRequest(req.id)}
                                disabled={loadingId !== null}
                                className="p-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors"
                                title="Rejeitar pedido"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => handleDeleteRequest(req.id)}
                              className="p-1.5 hover:bg-red-950/40 text-zinc-500 hover:text-red-400 rounded-lg transition-colors"
                              title="Remover pedido histórico"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
