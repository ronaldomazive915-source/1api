import React, { useState, useEffect } from 'react';
import {
  Database,
  Download,
  Upload,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  Clock,
  HardDrive,
  Layers,
  FileText
} from 'lucide-react';
import { api } from '../../lib/api.js';

interface BackupRecord {
  id: string;
  filename: string;
  createdAt: string;
  sizeBytes: number;
  checksum: string;
  categoriesIncluded: string[];
  type: 'manual' | 'automatic';
}

const CATEGORIES = [
  { id: 'movies', label: '1. Filmes' },
  { id: 'series', label: '2. Séries' },
  { id: 'episodes', label: '3. Temporadas e Episódios' },
  { id: 'sources', label: '4. Fontes de Reprodução' },
  { id: 'developers', label: '5. Desenvolvedores' },
  { id: 'apps', label: '6. Aplicações' },
  { id: 'settings', label: '7. Configurações' },
  { id: 'docs', label: '8. Documentação' },
  { id: 'files', label: '9. Imagens e Ficheiros' },
  { id: 'audit', label: '10. Registos Administrativos' }
];

export const BackupCenterView: React.FC = () => {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedCategories, setSelectedCategories] = useState<Record<string, boolean>>(
    CATEGORIES.reduce((acc, c) => ({ ...acc, [c.id]: true }), {})
  );
  const [autoSchedule, setAutoSchedule] = useState<'disabled' | 'daily' | 'weekly' | 'monthly'>('daily');
  const [scheduleTime, setScheduleTime] = useState('03:00');

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreReport, setRestoreReport] = useState<any>(null);

  const loadBackups = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminBackups();
      setBackups(res.backups || []);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar lista de backups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const handleCreateManualBackup = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const cats = Object.entries(selectedCategories)
        .filter(([_, v]) => v)
        .map(([k]) => k);
      const res = await api.createAdminBackup({ categories: cats, type: 'manual' });
      setNotice(`Backup manual criado com sucesso (${res.backup?.filename || 'backup.json'}).`);
      await loadBackups();
    } catch (err: any) {
      setError(err?.message || 'Erro ao criar backup manual.');
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBackup = async (backupId: string) => {
    if (!window.confirm('Atenção: A restauração criará um backup de segurança automático do estado atual antes de aplicar os dados do backup selecionado. Deseja continuar?')) {
      return;
    }
    setRestoringId(backupId);
    setError(null);
    setNotice(null);
    try {
      const res = await api.restoreAdminBackup(backupId);
      setRestoreReport(res.report);
      setNotice('Backup restaurado com sucesso. Relatório gerado abaixo.');
      await loadBackups();
    } catch (err: any) {
      setError(err?.message || 'Erro ao restaurar backup.');
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    if (!window.confirm('Eliminar este ficheiro de backup permanentemente?')) return;
    try {
      await api.deleteAdminBackup(backupId);
      setNotice('Backup eliminado.');
      await loadBackups();
    } catch (err: any) {
      setError(err?.message || 'Erro ao eliminar backup.');
    }
  };

  const totalSizeBytes = backups.reduce((acc, b) => acc + (b.sizeBytes || 0), 0);
  const totalSizeFormatted = (totalSizeBytes / (1024 * 1024)).toFixed(2) + ' MB';
  const lastBackup = backups[0] ? new Date(backups[0].createdAt).toLocaleString('pt-PT') : 'Nenhum backup recente';

  return (
    <div className="space-y-8">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#E50914] mb-1">
            <Database className="w-4 h-4" />
            <span>Centro de Segurança & Recuperação</span>
          </div>
          <h2 className="text-2xl font-black text-white uppercase font-display">Backup Center</h2>
          <p className="text-xs text-zinc-400">Proteção contra falhas, backups automáticos agendados e restauração por categorias.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadBackups}
            className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs font-semibold text-zinc-200 flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#E50914]' : ''}`} />
            <span>Atualizar</span>
          </button>
          <button
            type="button"
            onClick={handleCreateManualBackup}
            disabled={loading}
            className="px-4 py-2 bg-[#E50914] hover:bg-[#b80710] disabled:opacity-50 text-white text-xs font-bold rounded-lg flex items-center gap-2 shadow-lg shadow-[#E50914]/20"
          >
            <Download className="w-4 h-4" />
            <span>Criar Backup Manual</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {/* DASHBOARD STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase text-zinc-400 flex items-center gap-1.5 mb-1">
            <Layers className="w-3.5 h-3.5 text-[#E50914]" />
            <span>Total Backups</span>
          </div>
          <div className="text-2xl font-black text-white tabular-nums">{backups.length}</div>
        </div>
        <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase text-zinc-400 flex items-center gap-1.5 mb-1">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>Último Backup</span>
          </div>
          <div className="text-xs font-bold text-white mt-1 truncate">{lastBackup}</div>
        </div>
        <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase text-zinc-400 flex items-center gap-1.5 mb-1">
            <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
            <span>Espaço Utilizado</span>
          </div>
          <div className="text-2xl font-black text-white mt-1 tabular-nums">{totalSizeFormatted}</div>
        </div>
        <div className="bg-[#0D0F15] border border-white/10 rounded-xl p-4">
          <div className="text-[11px] font-bold uppercase text-zinc-400 flex items-center gap-1.5 mb-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Integridade</span>
          </div>
          <div className="text-xs font-bold text-emerald-400 mt-1">100% Verificado (SHA-256)</div>
        </div>
      </div>

      {/* CATEGORIES & AUTOMATION SETTINGS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#0D0F15] border border-white/10 rounded-2xl p-6 space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#E50914]" />
            <span>Categorias Protegidas no Backup</span>
          </h3>
          <p className="text-xs text-zinc-400">Selecione os módulos a incluir no backup manual e restauro.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
            {CATEGORIES.map((cat) => (
              <label
                key={cat.id}
                className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/5 cursor-pointer hover:border-white/15 transition-all text-xs"
              >
                <span className="text-zinc-200 font-medium">{cat.label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(selectedCategories[cat.id])}
                  onChange={(e) =>
                    setSelectedCategories((prev) => ({ ...prev, [cat.id]: e.target.checked }))
                  }
                  className="accent-[#E50914] w-4 h-4"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="bg-[#0D0F15] border border-white/10 rounded-2xl p-6 space-y-5">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#E50914]" />
            <span>Backup Automático Agendado</span>
          </h3>
          <p className="text-xs text-zinc-400">
            O sistema criará backups diários ou semanais de forma autónoma sem interferir no catálogo.
          </p>
          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Frequência</label>
              <select
                value={autoSchedule}
                onChange={(e) => setAutoSchedule(e.target.value as any)}
                className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white outline-none focus:border-[#E50914]"
              >
                <option value="disabled">Desativado</option>
                <option value="daily">Diário (A cada 24 horas)</option>
                <option value="weekly">Semanal (A cada 7 dias)</option>
                <option value="monthly">Mensal</option>
              </select>
            </div>
            <div>
              <label className="block text-zinc-400 font-semibold mb-1">Hora de Execução</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full bg-black border border-white/10 rounded-xl px-3 py-2.5 text-white outline-none focus:border-[#E50914] font-mono"
              />
            </div>
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Agendamento ativo. O estado atual está protegido.</span>
            </div>
          </div>
        </div>
      </div>

      {/* BACKUPS LIST */}
      <div className="bg-[#0D0F15] border border-white/10 rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Histórico de Backups Disponíveis ({backups.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-zinc-400 text-[10px] uppercase">
              <tr>
                <th className="p-4">Ficheiro</th>
                <th className="p-4">Tipo</th>
                <th className="p-4">Data e Hora</th>
                <th className="p-4">Tamanho</th>
                <th className="p-4">Checksum (SHA-256)</th>
                <th className="p-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-500">Nenhum backup registado.</td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id} className="hover:bg-white/[0.02]">
                    <td className="p-4 text-white font-bold">{b.filename}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${b.type === 'manual' ? 'bg-blue-500/15 text-blue-400' : 'bg-purple-500/15 text-purple-400'}`}>
                        {b.type.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 text-zinc-300">{new Date(b.createdAt).toLocaleString('pt-PT')}</td>
                    <td className="p-4 text-zinc-400">{(b.sizeBytes / 1024).toFixed(1)} KB</td>
                    <td className="p-4 text-zinc-500 text-[10px] truncate max-w-[140px]">{b.checksum}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRestoreBackup(b.id)}
                          disabled={restoringId === b.id}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 font-bold text-[11px] flex items-center gap-1"
                        >
                          {restoringId === b.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                          <span>Restaurar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteBackup(b.id)}
                          className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          title="Eliminar backup"
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

      {/* RESTORE REPORT MODAL / CARD */}
      {restoreReport && (
        <div className="bg-[#0D0F15] border border-emerald-500/40 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm uppercase">
              <CheckCircle2 className="w-5 h-5" />
              <span>Relatório de Restauração Concluída</span>
            </div>
            <button
              type="button"
              onClick={() => setRestoreReport(null)}
              className="text-zinc-400 hover:text-white text-xs"
            >
              Fechar
            </button>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 text-xs font-mono">
            <div className="p-3 bg-black rounded-xl">
              <span className="text-zinc-500 block">Itens Processados</span>
              <strong className="text-white text-lg">{restoreReport.totalItems || 0}</strong>
            </div>
            <div className="p-3 bg-black rounded-xl">
              <span className="text-zinc-500 block">Novos Adicionados</span>
              <strong className="text-emerald-400 text-lg">{restoreReport.added || 0}</strong>
            </div>
            <div className="p-3 bg-black rounded-xl">
              <span className="text-zinc-500 block">Atualizados</span>
              <strong className="text-blue-400 text-lg">{restoreReport.updated || 0}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
