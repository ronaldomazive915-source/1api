import React, { useState, useEffect } from 'react';
import { 
  Megaphone, 
  Plus, 
  Search, 
  Filter, 
  Eye, 
  Edit3, 
  Copy, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Play, 
  Code, 
  Layers, 
  Smartphone, 
  Monitor, 
  Tablet, 
  BarChart2, 
  RefreshCw,
  X,
  Check,
  Clock,
  Sparkles
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { AdCampaign } from '../../types.js';

export const AdsManager: React.FC = () => {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewCampaign, setPreviewCampaign] = useState<AdCampaign | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    type: 'banner' as AdCampaign['type'],
    displayLocation: ['home', 'player'] as string[],
    codeOrLink: '',
    status: 'ACTIVE' as AdCampaign['status'],
    minIntervalMinutes: 15,
    maxPerSession: 3,
    maxPerUser: 10,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    allowedDevices: ['desktop', 'tablet', 'mobile'] as string[],
    priority: 1,
    description: ''
  });

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const res = await api.getAdminAds();
      setCampaigns(Array.isArray(res) ? res : []);
    } catch (err) {
      console.error('Failed to load ad campaigns:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setFormData({
      name: '',
      type: 'banner',
      displayLocation: ['home', 'player'],
      codeOrLink: '',
      status: 'ACTIVE',
      minIntervalMinutes: 15,
      maxPerSession: 3,
      maxPerUser: 10,
      startDate: new Date().toISOString().slice(0, 10),
      endDate: '',
      allowedDevices: ['desktop', 'tablet', 'mobile'],
      priority: 1,
      description: ''
    });
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (c: AdCampaign) => {
    setEditingId(c.id);
    setFormData({
      name: c.name,
      type: c.type,
      displayLocation: [...c.displayLocation],
      codeOrLink: c.codeOrLink,
      status: c.status,
      minIntervalMinutes: c.frequency?.minIntervalMinutes ?? 15,
      maxPerSession: c.frequency?.maxPerSession ?? 3,
      maxPerUser: c.frequency?.maxPerUser ?? 10,
      startDate: c.startDate || new Date().toISOString().slice(0, 10),
      endDate: c.endDate || '',
      allowedDevices: [...c.allowedDevices],
      priority: c.priority ?? 1,
      description: c.description || ''
    });
    setErrorMsg(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.codeOrLink.trim()) {
      setErrorMsg('Preencha o nome da campanha e o código/link de publicidade.');
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    try {
      const payload = {
        name: formData.name.trim(),
        type: formData.type,
        displayLocation: formData.displayLocation,
        codeOrLink: formData.codeOrLink.trim(),
        status: formData.status,
        frequency: {
          minIntervalMinutes: Number(formData.minIntervalMinutes),
          maxPerSession: Number(formData.maxPerSession),
          maxPerUser: Number(formData.maxPerUser)
        },
        startDate: formData.startDate,
        endDate: formData.endDate || undefined,
        allowedDevices: formData.allowedDevices,
        priority: Number(formData.priority),
        description: formData.description.trim()
      };

      if (editingId) {
        await api.updateAdminAd(editingId, payload);
        setSuccessMsg('Campanha atualizada com sucesso!');
      } else {
        await api.createAdminAd(payload);
        setSuccessMsg('Campanha criada com sucesso!');
      }

      setIsModalOpen(false);
      loadCampaigns();
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao guardar campanha.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Tem a certeza que pretende eliminar esta campanha de anúncios?')) return;
    try {
      await api.deleteAdminAd(id);
      loadCampaigns();
      setSuccessMsg('Campanha eliminada.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Erro ao eliminar campanha.');
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await api.duplicateAdminAd(id);
      loadCampaigns();
      setSuccessMsg('Campanha duplicada com sucesso!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Erro ao duplicar.');
    }
  };

  const handleToggleStatus = async (c: AdCampaign) => {
    const nextStatus = c.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      await api.updateAdminAd(c.id, { status: nextStatus });
      loadCampaigns();
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar estado.');
    }
  };

  // Stats calculation
  const totalCampaigns = campaigns.length;
  const activeCount = campaigns.filter(c => c.status === 'ACTIVE').length;
  const disabledCount = campaigns.filter(c => c.status === 'DISABLED').length;
  const totalImpressions = campaigns.reduce((acc, c) => acc + (c.impressions || 0), 0);
  const totalClicks = campaigns.reduce((acc, c) => acc + (c.clicks || 0), 0);
  const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%' : '0.00%';

  const filteredCampaigns = campaigns.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || c.codeOrLink.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
    const matchesType = typeFilter === 'ALL' || c.type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-black border border-zinc-800/80 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 bg-red-600/10 border border-red-500/20 rounded-xl text-red-500">
              <Megaphone className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Gestão de Propagandas</h1>
          </div>
          <p className="text-sm text-zinc-400 max-w-2xl">
            Crie, configure e distribua campanhas publicitárias em tempo real para o site e players externos integrados via API do RONYCINE.
          </p>
        </div>
        <button
          onClick={handleOpenCreate}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl shadow-lg shadow-red-600/20 transition-all cursor-pointer"
        >
          <Plus className="w-5 h-5" />
          <span>Criar Propaganda</span>
        </button>
      </div>

      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Dashboard Metrics Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Total Campanhas</span>
          <p className="text-2xl font-bold text-white mt-1">{totalCampaigns}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">Ativas</span>
          <p className="text-2xl font-bold text-white mt-1">{activeCount}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Desativadas</span>
          <p className="text-2xl font-bold text-white mt-1">{disabledCount}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-blue-400 uppercase tracking-wider">Impressões</span>
          <p className="text-2xl font-bold text-white mt-1">{totalImpressions.toLocaleString()}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">Cliques</span>
          <p className="text-2xl font-bold text-white mt-1">{totalClicks.toLocaleString()}</p>
        </div>
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <span className="text-xs font-medium text-purple-400 uppercase tracking-wider">Taxa de Cliques (CTR)</span>
          <p className="text-2xl font-bold text-white mt-1">{avgCtr}</p>
        </div>
      </div>

      {/* Filters & Search Bar */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 flex flex-col sm:flex-row gap-4 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            placeholder="Pesquisar campanhas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-red-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-zinc-950/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-300 focus:outline-none focus:border-red-500 transition-colors"
          >
            <option value="ALL">Todos os Estados</option>
            <option value="ACTIVE">Ativo</option>
            <option value="DISABLED">Desativado</option>
            <option value="SCHEDULED">Agendado</option>
            <option value="EXPIRED">Expirado</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-zinc-950/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-zinc-300 focus:outline-none focus:border-red-500 transition-colors"
          >
            <option value="ALL">Todos os Tipos</option>
            <option value="banner">Banner</option>
            <option value="banner_responsive">Banner Responsivo</option>
            <option value="popunder">Pop-under</option>
            <option value="video_preroll">Vídeo / Pré-roll</option>
            <option value="external_code">Código Externo</option>
            <option value="url_link">Link Direto</option>
          </select>
        </div>
      </div>

      {/* Campaigns List / Grid */}
      {loading ? (
        <div className="py-20 text-center text-zinc-500">A carregar campanhas publicitárias...</div>
      ) : filteredCampaigns.length === 0 ? (
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-12 text-center">
          <Megaphone className="w-12 h-12 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-white">Nenhuma campanha encontrada</h3>
          <p className="text-sm text-zinc-400 mt-1">Crie a sua primeira propaganda para começar a rentabilizar o site e os players externos.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCampaigns.map(c => (
            <div key={c.id} className="bg-zinc-900/80 border border-zinc-800/90 rounded-2xl p-5 flex flex-col justify-between hover:border-zinc-700 transition-all shadow-lg group">
              <div>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      c.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                    }`}>
                      {c.status === 'ACTIVE' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                      {c.status}
                    </span>
                    <h3 className="text-base font-bold text-white mt-2 group-hover:text-red-400 transition-colors">{c.name}</h3>
                  </div>
                  <span className="text-xs px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-400 uppercase font-mono">
                    {c.type}
                  </span>
                </div>

                {c.description && (
                  <p className="text-xs text-zinc-400 line-clamp-2 mb-3">{c.description}</p>
                )}

                <div className="space-y-1.5 text-xs text-zinc-400 mb-4 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/50">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Locais:</span>
                    <span className="text-zinc-300 font-medium">{c.displayLocation.join(', ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Impressões:</span>
                    <span className="text-white font-medium">{c.impressions || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Cliques:</span>
                    <span className="text-white font-medium">{c.clicks || 0}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-zinc-800/80">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleToggleStatus(c)}
                    title={c.status === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                    className={`p-2 rounded-xl transition-colors ${c.status === 'ACTIVE' ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-zinc-500 hover:bg-zinc-800'}`}
                  >
                    {c.status === 'ACTIVE' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setPreviewCampaign(c)}
                    title="Pré-visualizar"
                    className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDuplicate(c.id)}
                    title="Duplicar"
                    className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleOpenEdit(c)}
                    title="Editar"
                    className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-xl transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    title="Eliminar"
                    className="p-2 text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Criar / Editar Propaganda */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-600/10 rounded-xl text-red-500">
                  <Megaphone className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-white">
                  {editingId ? 'Editar Campanha de Anúncios' : 'Criar Nova Propaganda'}
                </h2>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {errorMsg && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Nome Interno da Campanha *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Banner Topo Home - Patrocinador X"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Tipo de Propaganda</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="banner">Banner Fixo</option>
                    <option value="banner_responsive">Banner Responsivo</option>
                    <option value="popunder">Pop-under</option>
                    <option value="video_preroll">Vídeo / Pré-roll</option>
                    <option value="external_code">Código de Publicidade Externo (HTML/JS)</option>
                    <option value="url_link">Link de Publicidade Direta</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Estado Inicial</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500"
                  >
                    <option value="ACTIVE">Ativo (Entregar Anúncio)</option>
                    <option value="DISABLED">Desativado</option>
                    <option value="SCHEDULED">Agendado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Código HTML, Script, URL da Imagem ou Link *</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Insira o código do anúncio, script embed, ou URL de destino..."
                  value={formData.codeOrLink}
                  onChange={(e) => setFormData({ ...formData, codeOrLink: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white font-mono focus:outline-none focus:border-red-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2 uppercase tracking-wider">Locais de Exibição</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'global', label: 'Global (Todas as páginas)' },
                    { id: 'home', label: 'Página Inicial' },
                    { id: 'detail', label: 'Página de Detalhes' },
                    { id: 'movies', label: 'Página de Filmes' },
                    { id: 'series', label: 'Página de Séries' },
                    { id: 'player', label: 'Player (Geral)' },
                    { id: 'player_before', label: 'Antes do Player (Pré-roll)' },
                    { id: 'player_inside', label: 'Dentro do Player' },
                    { id: 'player_after', label: 'Depois do Player' }
                  ].map(loc => {
                    const checked = formData.displayLocation.includes(loc.id);
                    return (
                      <label key={loc.id} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800/80 p-2.5 rounded-xl text-xs text-zinc-300 cursor-pointer hover:border-zinc-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({ ...formData, displayLocation: [...formData.displayLocation, loc.id] });
                            } else {
                              setFormData({ ...formData, displayLocation: formData.displayLocation.filter(l => l !== loc.id) });
                            }
                          }}
                          className="rounded border-zinc-700 text-red-600 focus:ring-red-500 bg-zinc-900"
                        />
                        <span>{loc.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Intervalo Mín (min)</label>
                  <input
                    type="number"
                    value={formData.minIntervalMinutes}
                    onChange={(e) => setFormData({ ...formData, minIntervalMinutes: parseInt(e.target.value) || 0 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Max / Sessão</label>
                  <input
                    type="number"
                    value={formData.maxPerSession}
                    onChange={(e) => setFormData({ ...formData, maxPerSession: parseInt(e.target.value) || 0 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Prioridade</label>
                  <input
                    type="number"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 1 })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-red-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">Descrição Interna / Notas</label>
                <input
                  type="text"
                  placeholder="Notas para a equipa administrativa..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-medium rounded-xl text-sm transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white font-medium rounded-xl text-sm transition-colors shadow-lg shadow-red-600/20 disabled:opacity-50"
                >
                  {saving ? 'A guardar...' : 'Guardar Campanha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Pré-visualização */}
      {previewCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-xl p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800 mb-4">
              <h3 className="text-lg font-bold text-white">Pré-visualização: {previewCampaign.name}</h3>
              <button onClick={() => setPreviewCampaign(null)} className="p-2 text-zinc-400 hover:text-white rounded-xl">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-black/80 border border-zinc-800 rounded-2xl p-6 min-h-[160px] flex items-center justify-center text-center">
              {previewCampaign.type === 'banner' || previewCampaign.type === 'banner_responsive' ? (
                <div className="w-full">
                  <div className="text-xs text-zinc-500 mb-2">Simulação de Banner Publicitário</div>
                  <div className="p-4 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white font-mono break-all">
                    {previewCampaign.codeOrLink}
                  </div>
                </div>
              ) : (
                <div className="w-full">
                  <div className="text-xs text-zinc-500 mb-2">Conteúdo da Campanha ({previewCampaign.type})</div>
                  <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 font-mono max-h-40 overflow-y-auto">
                    {previewCampaign.codeOrLink}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setPreviewCampaign(null)}
                className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-medium rounded-xl"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
