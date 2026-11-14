import React, { useState, useEffect } from 'react';
import { LifeBuoy, Search, Filter, MessageSquare, Send, CheckCircle2, UserCheck, Trash2, Clock, AlertCircle, X } from 'lucide-react';

interface Ticket {
  id: string;
  userEmail: string;
  subject: string;
  message: string;
  category: 'Player / Streaming' | 'Financeiro' | 'Pedidos' | 'Cadastro / Login';
  createdAt: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  replies: Array<{
    id: string;
    sender: 'admin' | 'user';
    text: string;
    timestamp: string;
  }>;
}

export const SupportDesk: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  // Selected Ticket details view
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('playfilme_support_tickets');
    if (saved) {
      setTickets(JSON.parse(saved));
    } else {
      // Pre-seed some default support tickets
      const initialTickets: Ticket[] = [
        {
          id: 'TK-9481',
          userEmail: 'marcos.souza@gmail.com',
          subject: 'Player travando na Smart TV',
          message: 'Boa noite, o player megaplay fica dando pequenas travadas de 2 em 2 segundos quando rodo na minha Smart TV LG de 2021. Tem alguma configuração para resolver?',
          category: 'Player / Streaming',
          createdAt: '2026-08-19T10:14:00.000Z',
          status: 'OPEN',
          replies: []
        },
        {
          id: 'TK-9452',
          userEmail: 'aline.lima@gmail.com',
          subject: 'Pedido de anime completo',
          message: 'Olá, gostaria de pedir se possível para adicionarem o anime Jujutsu Kaisen completo. Gosto muito do site de vocês, parabéns pelo trabalho!',
          category: 'Pedidos',
          createdAt: '2026-08-18T16:22:00.000Z',
          status: 'IN_PROGRESS',
          replies: [
            { id: 'rep-1', sender: 'admin', text: 'Olá Aline, obrigada pelo carinho! Vou encaminhar seu pedido de anime para nosso setor de catálogo. Em breve deve estar disponível!', timestamp: '2026-08-18T18:00:00.000Z' }
          ]
        },
        {
          id: 'TK-9410',
          userEmail: 'ricardo.alves@gmail.com',
          subject: 'Como trocar minha senha?',
          message: 'Olá suporte, não estou achando a opção de alterar a minha senha de cadastro na minha conta do IPTV. Podem me instruir?',
          category: 'Cadastro / Login',
          createdAt: '2026-08-17T09:45:00.000Z',
          status: 'RESOLVED',
          replies: [
            { id: 'rep-2', sender: 'admin', text: 'Olá Ricardo, basta clicar no seu avatar no canto superior direito -> Meu Perfil. Lá você encontra o formulário para redefinir sua senha.', timestamp: '2026-08-17T11:20:00.000Z' },
            { id: 'rep-3', sender: 'user', text: 'Deu certo aqui, muito obrigado pela ajuda rápida!', timestamp: '2026-08-17T12:05:00.000Z' }
          ]
        }
      ];
      setTickets(initialTickets);
      localStorage.setItem('playfilme_support_tickets', JSON.stringify(initialTickets));
    }
  }, []);

  const saveTickets = (list: Ticket[]) => {
    setTickets(list);
    localStorage.setItem('playfilme_support_tickets', JSON.stringify(list));
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;

    const newReply = {
      id: `rep-${Date.now()}`,
      sender: 'admin' as const,
      text: replyText,
      timestamp: new Date().toISOString()
    };

    // Append reply and auto-promote status to IN_PROGRESS if it was OPEN
    const newStatus = selectedTicket.status === 'OPEN' ? 'IN_PROGRESS' as const : selectedTicket.status;

    const updatedTickets = tickets.map(t => t.id === selectedTicket.id ? {
      ...t,
      status: newStatus,
      replies: [...t.replies, newReply]
    } : t);

    saveTickets(updatedTickets);

    // Update selected Ticket representation
    setSelectedTicket({
      ...selectedTicket,
      status: newStatus,
      replies: [...selectedTicket.replies, newReply]
    });

    setReplyText('');
    showToast('✓ Resposta enviada com sucesso!');
  };

  const handleUpdateStatus = (id: string, newStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED') => {
    const updated = tickets.map(t => t.id === id ? { ...t, status: newStatus } : t);
    saveTickets(updated);
    if (selectedTicket?.id === id) {
      setSelectedTicket({ ...selectedTicket, status: newStatus });
    }
    showToast(`✓ Ticket marcado como ${newStatus === 'RESOLVED' ? 'Resolvido' : newStatus === 'IN_PROGRESS' ? 'Em Progresso' : 'Pendente'}.`);
  };

  const handleDeleteTicket = (id: string) => {
    if (confirm('Tem certeza que deseja apagar permanentemente este registro de ticket de suporte?')) {
      const filtered = tickets.filter(t => t.id !== id);
      saveTickets(filtered);
      if (selectedTicket?.id === id) setSelectedTicket(null);
      showToast('✓ Ticket de suporte excluído.');
    }
  };

  const filteredTickets = tickets.filter(t => {
    const matchSearch = t.userEmail.toLowerCase().includes(search.toLowerCase()) ||
                        t.subject.toLowerCase().includes(search.toLowerCase()) ||
                        t.id.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const openTicketsCount = tickets.filter(t => t.status === 'OPEN').length;

  return (
    <div className="space-y-6 text-zinc-100 font-sans">
      
      {/* Toast Alert */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-950 border border-emerald-600 text-emerald-200 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 text-xs font-bold">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 rounded-3xl p-6 border border-zinc-800 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-600/20 border border-red-600/40 rounded-2xl text-red-500">
              <LifeBuoy className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white tracking-wide uppercase">
                🎧 CENTRAL DE APOIO AO CLIENTE
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Gerencie solicitações, dúvidas técnicas, financeiras e responda aos seus utilizadores.
              </p>
            </div>
          </div>
        </div>

        {openTicketsCount > 0 && (
          <span className="px-3.5 py-1.5 bg-amber-950/80 border border-amber-800 text-amber-400 text-xs font-bold rounded-full flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            {openTicketsCount} Pendentes de Resposta
          </span>
        )}
      </div>

      {/* TOOLBAR */}
      <div className="bg-zinc-900/95 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Pesquisar por ID do ticket, assunto ou e-mail de utilizador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-red-600"
          />
        </div>

        <div className="flex bg-zinc-950 p-1 border border-zinc-800 rounded-xl gap-1">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'OPEN', label: 'Abertos' },
            { id: 'IN_PROGRESS', label: 'Em Atendimento' },
            { id: 'RESOLVED', label: 'Resolvidos' }
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

      {/* MAIN CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* TICKETS LIST TABLE (6 cols) */}
        <div className="lg:col-span-6 bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-zinc-950 text-zinc-400 uppercase tracking-wider font-bold text-[10px] border-b border-zinc-800">
                  <th className="p-3.5">ID / Usuário</th>
                  <th className="p-3.5">Assunto / Categoria</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-center">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredTickets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-zinc-500 font-bold">
                      Nenhum ticket de suporte localizado para o filtro selecionado.
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map(t => (
                    <tr
                      key={t.id}
                      className={`hover:bg-zinc-800/35 transition-colors cursor-pointer ${
                        selectedTicket?.id === t.id ? 'bg-zinc-800/60' : ''
                      }`}
                      onClick={() => setSelectedTicket(t)}
                    >
                      <td className="p-3.5">
                        <span className="font-mono text-red-400 font-bold block">{t.id}</span>
                        <span className="text-zinc-400 text-[10px] truncate block max-w-[150px]">{t.userEmail}</span>
                      </td>
                      <td className="p-3.5">
                        <span className="font-bold text-white block line-clamp-1">{t.subject}</span>
                        <span className="text-zinc-500 text-[10px] block">{t.category}</span>
                      </td>
                      <td className="p-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border tracking-wider ${
                          t.status === 'RESOLVED' ? 'bg-emerald-950 text-emerald-400 border-emerald-800' :
                          t.status === 'IN_PROGRESS' ? 'bg-amber-950 text-amber-400 border-amber-800' :
                          'bg-red-950 text-red-400 border-red-800 animate-pulse'
                        }`}>
                          {t.status === 'RESOLVED' ? 'Resolvido' : t.status === 'IN_PROGRESS' ? 'Atendimento' : 'Pendente'}
                        </span>
                      </td>
                      <td className="p-3.5 text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleDeleteTicket(t.id)}
                          className="p-1.5 hover:bg-red-950/40 text-zinc-500 hover:text-red-400 rounded-lg transition-colors"
                          title="Excluir ticket"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ACTIVE TICKET DETAILS CHAT & REPLY FORM (6 cols) */}
        <div className="lg:col-span-6 lg:sticky lg:top-24">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 space-y-4 shadow-2xl flex flex-col h-[520px]">
            
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block pb-2 border-b border-zinc-800/80 shrink-0">
              💬 ATENDIMENTO AO CLIENTE INDIVIDUAL
            </span>

            {selectedTicket ? (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                
                {/* Scrollable conversation history */}
                <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin scrollbar-thumb-zinc-800">
                  
                  {/* User query body */}
                  <div className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span className="font-bold text-zinc-400">{selectedTicket.userEmail}</span>
                      <span>{new Date(selectedTicket.createdAt).toLocaleString('pt-BR')}</span>
                    </div>
                    <h4 className="font-extrabold text-white text-xs uppercase tracking-wide">Assunto: {selectedTicket.subject}</h4>
                    <p className="text-zinc-300 text-xs leading-relaxed">{selectedTicket.message}</p>
                    <span className="inline-block text-[9px] font-bold px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-400">
                      🏷 {selectedTicket.category}
                    </span>
                  </div>

                  {/* Status controls */}
                  <div className="flex items-center gap-2 bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80 text-[10px] justify-between">
                    <span className="text-zinc-500 font-bold">Definir Status:</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleUpdateStatus(selectedTicket.id, 'OPEN')}
                        className={`px-2.5 py-1 rounded text-[9px] font-bold ${selectedTicket.status === 'OPEN' ? 'bg-red-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                      >
                        Pendente
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(selectedTicket.id, 'IN_PROGRESS')}
                        className={`px-2.5 py-1 rounded text-[9px] font-bold ${selectedTicket.status === 'IN_PROGRESS' ? 'bg-amber-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                      >
                        Em Atendimento
                      </button>
                      <button
                        onClick={() => handleUpdateStatus(selectedTicket.id, 'RESOLVED')}
                        className={`px-2.5 py-1 rounded text-[9px] font-bold ${selectedTicket.status === 'RESOLVED' ? 'bg-emerald-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'}`}
                      >
                        Resolvido
                      </button>
                    </div>
                  </div>

                  {/* Conversation Replies List */}
                  {selectedTicket.replies.map((rep) => {
                    const isAdmin = rep.sender === 'admin';
                    return (
                      <div
                        key={rep.id}
                        className={`flex flex-col space-y-1 max-w-[85%] ${
                          isAdmin ? 'ml-auto items-end' : 'mr-auto items-start'
                        }`}
                      >
                        <span className="text-[9px] text-zinc-500 font-bold">
                          {isAdmin ? 'Suporte IPTV' : selectedTicket.userEmail} • {new Date(rep.timestamp).toLocaleTimeString('pt-BR')}
                        </span>
                        <div
                          className={`p-3 rounded-2xl text-xs leading-relaxed ${
                            isAdmin
                              ? 'bg-red-600 text-white rounded-tr-none shadow-md shadow-red-950/20'
                              : 'bg-zinc-800 text-zinc-200 rounded-tl-none border border-zinc-700/60'
                          }`}
                        >
                          <p>{rep.text}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Reply Form Footer */}
                <form onSubmit={handleSendReply} className="border-t border-zinc-800 pt-3 shrink-0 flex gap-2">
                  <input
                    type="text"
                    placeholder="Escreva uma resposta para o cliente..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-red-600 placeholder-zinc-500"
                  />
                  <button
                    type="submit"
                    className="p-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-all shadow-lg shadow-red-950/30 shrink-0"
                    title="Enviar resposta"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>

              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 text-center space-y-3">
                <LifeBuoy className="w-12 h-12 text-zinc-800 mx-auto" />
                <p className="text-xs font-bold text-zinc-400">Selecione uma Solicitação</p>
                <p className="text-[11px] max-w-xs mx-auto">
                  Clique em qualquer ticket na tabela ao lado para ler a dúvida, visualizar as respostas históricas e escrever para o utilizador.
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
};
