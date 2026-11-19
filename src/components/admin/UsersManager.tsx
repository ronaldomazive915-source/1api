import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  Shield, 
  ShieldAlert, 
  UserX, 
  UserCheck, 
  Megaphone, 
  MegaphoneOff, 
  Lock, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  MoreVertical,
  Calendar,
  Mail,
  Key,
  Layers,
  X,
  Check
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { User } from '../../types.js';

export const UsersManager: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modal / Action state
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [actionType, setActionType] = useState<'suspend' | 'block' | 'ban' | null>(null);
  const [suspensionDuration, setSuspensionDuration] = useState<string>('24h');
  const [actionReason, setActionReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminUsers();
      setUsers(Array.isArray(res) ? res : []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAds = async (u: User) => {
    const nextState = u.adsDistributionEnabled !== false ? false : true;
    try {
      await api.updateAdminUserStatus(u.id, { adsDistributionEnabled: nextState });
      loadUsers();
      setSuccessMsg(`Distribuição de anúncios ${nextState ? 'ativada' : 'desativada'} para ${u.email}`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar estado de anúncios.');
    }
  };

  const handleExecuteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || !actionType) return;

    setProcessing(true);
    try {
      let newStatus: 'active' | 'suspended' | 'blocked' | 'banned' = 'active';
      let expiresAt: string | undefined = undefined;

      if (actionType === 'block') newStatus = 'blocked';
      if (actionType === 'ban') newStatus = 'banned';
      if (actionType === 'suspend') {
        newStatus = 'suspended';
        const now = new Date();
        if (suspensionDuration === '1h') now.setHours(now.getHours() + 1);
        else if (suspensionDuration === '24h') now.setHours(now.getHours() + 24);
        else if (suspensionDuration === '7d') now.setDate(now.getDate() + 7);
        else if (suspensionDuration === '30d') now.setDate(now.getDate() + 30);
        expiresAt = now.toISOString();
      }

      await api.updateAdminUserStatus(selectedUser.id, {
        status: newStatus,
        suspensionReason: actionReason.trim() || 'Violação dos termos de serviço',
        suspensionExpiresAt: expiresAt
      });

      setSelectedUser(null);
      setActionType(null);
      setActionReason('');
      loadUsers();
      setSuccessMsg('Ação aplicada com sucesso.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Erro ao executar ação administrativa.');
    } finally {
      setProcessing(false);
    }
  };

  const handleReactivate = async (u: User) => {
    try {
      await api.updateAdminUserStatus(u.id, { status: 'active', suspensionReason: '', suspensionExpiresAt: undefined });
      loadUsers();
      setSuccessMsg(`Conta de ${u.email} reativada com sucesso.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Erro ao reativar conta.');
    }
  };

  // Stats
  const totalUsers = users.length;
  const activeUsers = users.filter(u => !u.status || u.status === 'active').length;
  const suspendedUsers = users.filter(u => u.status === 'suspended').length;
  const blockedUsers = users.filter(u => u.status === 'blocked' || u.status === 'banned').length;
  const adsDisabledCount = users.filter(u => u.adsDistributionEnabled === false).length;

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || (statusFilter === 'active' && (!u.status || u.status === 'active')) || (statusFilter === u.status);
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-black border border-zinc-800/80 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 bg-red-600/10 border border-red-500/20 rounded-xl text-red-500">
              <Users className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Gestão de Utilizadores</h1>
          </div>
          <p className="text-sm text-zinc-400 max-w-2xl">
            Monitorize contas, controle permissões, aplique bloqueios/suspensões e gira a distribuição de anúncios por utilizador sem apagar aplicações ou chaves API.
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Total Utilizadores</span>
          <p className="text-2xl font-bold text-white mt-1">{totalUsers}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Ativos</span>
          <p className="text-2xl font-bold text-white mt-1">{activeUsers}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">Suspensos</span>
          <p className="text-2xl font-bold text-white mt-1">{suspendedUsers}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-red-400 uppercase tracking-wider">Bloqueados / Banidos</span>
          <p className="text-2xl font-bold text-white mt-1">{blockedUsers}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-purple-400 uppercase tracking-wider">Anúncios Desativados</span>
          <p className="text-2xl font-bold text-white mt-1">{adsDisabledCount}</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Pesquisar por nome ou email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-zinc-950/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-300 focus:outline-none focus:border-red-500 w-full sm:w-auto"
        >
          <option value="ALL">Todos os Estados</option>
          <option value="active">Ativo</option>
          <option value="suspended">Suspenso</option>
          <option value="blocked">Bloqueado</option>
          <option value="banned">Banido</option>
        </select>
      </div>

      {/* Users List */}
      {loading ? (
        <div className="py-20 text-center text-zinc-500">A carregar utilizadores...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-12 text-center">
          <Users className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white">Nenhum utilizador encontrado</h3>
        </div>
      ) : (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-300">
              <thead className="bg-zinc-950 text-xs text-zinc-400 uppercase border-b border-zinc-800">
                <tr>
                  <th className="px-6 py-4">Utilizador</th>
                  <th className="px-6 py-4">Cargo</th>
                  <th className="px-6 py-4">Estado</th>
                  <th className="px-6 py-4">Distribuição Ads</th>
                  <th className="px-6 py-4">Registo</th>
                  <th className="px-6 py-4 text-right">Ações Administrativas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filteredUsers.map(u => {
                  const status = u.status || 'active';
                  const adsEnabled = u.adsDistributionEnabled !== false;
                  return (
                    <tr key={u.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-red-600/20 border border-red-500/30 flex items-center justify-center font-bold text-red-400">
                            {u.name ? u.name.substring(0, 2).toUpperCase() : u.email.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-white">{u.name || 'Utilizador Ronycine'}</div>
                            <div className="text-xs text-zinc-400">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${
                          u.role === 'founder' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
                          u.role === 'admin' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                          'bg-zinc-800 text-zinc-400 border border-zinc-700'
                        }`}>
                          {u.role.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          status === 'suspended' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                          {status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleToggleAds(u)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                            adsEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
                          }`}
                        >
                          {adsEnabled ? <Megaphone className="w-3.5 h-3.5" /> : <MegaphoneOff className="w-3.5 h-3.5" />}
                          <span>{adsEnabled ? 'Ativados' : 'Desativados'}</span>
                        </button>
                      </td>
                      <td className="px-6 py-4 text-xs text-zinc-400">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString('pt-PT') : 'N/D'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {status !== 'active' ? (
                            <button
                              onClick={() => handleReactivate(u)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition-colors"
                            >
                              Reativar
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={() => { setSelectedUser(u); setActionType('suspend'); }}
                                className="px-3 py-1.5 bg-amber-600/20 hover:bg-amber-600 text-amber-400 hover:text-white rounded-xl text-xs font-medium transition-colors border border-amber-500/30"
                              >
                                Suspender
                              </button>
                              <button
                                onClick={() => { setSelectedUser(u); setActionType('block'); }}
                                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white rounded-xl text-xs font-medium transition-colors border border-red-500/30"
                              >
                                Bloquear
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Ação Administrativa (Suspender / Bloquear / Banir) */}
      {selectedUser && actionType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <h3 className="text-lg font-bold text-white capitalize">
                {actionType === 'suspend' ? 'Suspender Utilizador' : actionType === 'block' ? 'Bloquear Utilizador' : 'Banir Utilizador'}
              </h3>
              <button onClick={() => { setSelectedUser(null); setActionType(null); }} className="p-2 text-zinc-400 hover:text-white rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 mb-4">
              Utilizador: <strong className="text-white">{selectedUser.email}</strong>
            </p>

            <form onSubmit={handleExecuteAction} className="space-y-4">
              {actionType === 'suspend' && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Duração da Suspensão</label>
                  <select
                    value={suspensionDuration}
                    onChange={(e) => setSuspensionDuration(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="1h">1 Hora</option>
                    <option value="24h">24 Horas</option>
                    <option value="7d">7 Dias</option>
                    <option value="30d">30 Dias</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Motivo da Ação *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Insira o motivo detalhado..."
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => { setSelectedUser(null); setActionType(null); }}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-red-600/20 disabled:opacity-50"
                >
                  {processing ? 'A processar...' : 'Confirmar Ação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
