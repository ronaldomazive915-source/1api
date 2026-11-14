import React, { useState, useEffect } from 'react';
import { History, RefreshCw, Search, Shield, User, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api.js';
import { AuditLog } from '../../types.js';

export const ActivityLogView: React.FC = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');

  const loadLogs = async () => {
    setLoading(true);
    try {
      const data = await api.getAdminLogs();
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    const q = searchFilter.toLowerCase();
    return (
      (log.userEmail || '').toLowerCase().includes(q) ||
      (log.action || '').toLowerCase().includes(q) ||
      (log.details || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#E50914] mb-1">
            <History className="w-4 h-4" />
            <span>Auditoria Administrativa</span>
          </div>
          <h2 className="text-2xl font-black text-white uppercase font-display">Histórico de Atividades</h2>
          <p className="text-xs text-zinc-400">Registo imutável de importações, backups, alterações de configuração e chaves de API.</p>
        </div>
        <button
          type="button"
          onClick={loadLogs}
          className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
          <span>Atualizar Logs</span>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Filtrar por utilizador, ação ou detalhes..."
            className="w-full bg-[#0D0F15] border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-xs text-white outline-none focus:border-[#E50914]"
          />
        </div>
      </div>

      <div className="bg-[#0D0F15] border border-white/10 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-zinc-400 text-[10px] uppercase">
              <tr>
                <th className="p-4">Utilizador Responsável</th>
                <th className="p-4">Ação</th>
                <th className="p-4">Resultado</th>
                <th className="p-4">Detalhes</th>
                <th className="p-4">Data e Hora</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-zinc-500">Nenhum registo de atividade encontrado.</td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.02]">
                    <td className="p-4 font-mono font-bold text-white flex items-center gap-2">
                      <User className="w-3.5 h-3.5 text-[#E50914]" />
                      <span>{log.userEmail || 'sistema@ronycine'}</span>
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded bg-white/10 text-zinc-200 font-mono text-[11px] font-bold">
                        {log.action}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${log.result === 'SUCCESS' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {log.result}
                      </span>
                    </td>
                    <td className="p-4 text-zinc-300 max-w-md truncate">{log.details}</td>
                    <td className="p-4 text-zinc-500 font-mono">{new Date(log.timestamp).toLocaleString('pt-PT')}</td>
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
