import React, { useState, useEffect } from 'react';
import { History, Trash2, Play, AlertTriangle, Calendar, Clock } from 'lucide-react';
import { HistoryItem } from '../types.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { motion, AnimatePresence } from 'motion/react';

export const HistoryView: React.FC = () => {
  const { user, navigateTo } = useAuth();
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConfirmClearModal, setShowConfirmClearModal] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);

    api.getHistory(user.id)
      .then(setHistoryList)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user?.id]);

  const handleClearHistory = async () => {
    if (!user?.id) return;
    await api.clearHistory(user.id);
    setHistoryList([]);
    setShowConfirmClearModal(false);
  };

  return (
    <div className="min-h-screen bg-[#08090D] text-white pt-32 pb-24 px-6 sm:px-8 lg:px-12 max-w-[1200px] mx-auto font-inter">
      
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-12">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-brand font-black text-[10px] tracking-[0.3em] uppercase">
            <div className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
            <span>Sua Atividade</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-black font-display tracking-tight text-white">
            Histórico
          </h1>
          <p className="text-sm text-zinc-500 max-w-md leading-relaxed">
            Reveja os conteúdos que você assistiu recentemente e continue de onde parou em qualquer dispositivo.
          </p>
        </div>

        {historyList.length > 0 && (
          <button
            onClick={() => setShowConfirmClearModal(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#11131A] border border-white/5 text-zinc-400 hover:text-white hover:bg-white/10 transition-all text-[10px] font-black uppercase tracking-widest group"
          >
            <Trash2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
            <span>Limpar Histórico</span>
          </button>
        )}
      </div>

      {/* HISTORY ITEMS */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map(n => (
            <div key={n} className="h-28 bg-[#11131A] border border-white/5 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : historyList.length > 0 ? (
        <div className="space-y-4">
          {historyList.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              onClick={() => navigateTo('watch', undefined, { type: item.mediaType, tmdbId: item.tmdbId, season: item.seasonNumber, episode: item.episodeNumber })}
              className="group flex items-center justify-between p-4 rounded-2xl bg-[#11131A]/50 border border-white/5 hover:border-brand/40 hover:bg-brand/5 transition-all duration-500 cursor-pointer gap-6 overflow-hidden relative"
            >
              <div className="flex items-center gap-6 z-10">
                <div className="w-32 aspect-video rounded-xl overflow-hidden bg-black shrink-0 border border-white/5 group-hover:border-brand/20 transition-all shadow-2xl relative">
                  <img
                    src={item.backdropPath || item.posterPath}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 opacity-60 group-hover:opacity-100"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play className="w-8 h-8 text-white fill-white drop-shadow-[0_0_15px_rgba(229,9,20,0.5)]" />
                  </div>
                  {/* PROGRESS BAR */}
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                    <div className="h-full bg-brand" style={{ width: `${item.progressPercent}%` }} />
                  </div>
                </div>
                
                <div className="min-w-0">
                  <h4 className="text-lg font-bold text-white group-hover:text-brand transition-colors truncate font-display tracking-tight uppercase">
                    {item.title}
                  </h4>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`text-[9px] px-2 py-0.5 rounded-sm font-black uppercase tracking-widest ${item.mediaType === 'movie' ? 'bg-blue-500/10 text-blue-400' : 'bg-brand/10 text-brand'}`}>
                      {item.mediaType === 'movie' ? 'Filme' : `Série · T${item.seasonNumber} E${item.episodeNumber}`}
                    </span>
                    <div className="flex items-center text-[9px] text-zinc-500 font-bold uppercase tracking-widest gap-4">
                      <span className="flex items-center"><Calendar className="w-3 h-3 mr-1.5 text-zinc-700" /> {new Date(item.lastWatchedAt).toLocaleDateString('pt-BR')}</span>
                      <span className="flex items-center"><Clock className="w-3 h-3 mr-1.5 text-zinc-700" /> {new Date(item.lastWatchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="hidden sm:flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 text-zinc-500 group-hover:bg-brand group-hover:text-white transition-all duration-500 z-10">
                <Play className="w-5 h-5 fill-current" />
              </div>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="text-center py-32 bg-[#11131A]/50 rounded-3xl border border-white/5 space-y-6">
          <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mx-auto text-zinc-800 border border-white/5">
            <History className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-white font-display uppercase tracking-tight">Seu histórico está limpo</h3>
            <p className="text-sm text-zinc-500 max-w-xs mx-auto">Sua atividade de streaming aparecerá aqui para que você possa continuar assistindo facilmente.</p>
          </div>
          <button 
             onClick={() => navigateTo('home')}
             className="px-10 py-4 bg-brand text-white text-xs font-black uppercase tracking-[0.2em] rounded-xl hover:bg-brand-hover transition-all shadow-xl shadow-brand/20 active:scale-95"
          >
            Descobrir Conteúdo
          </button>
        </div>
      )}

      {/* CLEAR HISTORY CONFIRMATION MODAL */}
      <AnimatePresence>
        {showConfirmClearModal && (
          <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#11131A] border border-white/10 rounded-3xl p-10 max-w-sm w-full space-y-8 shadow-2xl text-center"
            >
              <div className="space-y-4">
                <div className="w-16 h-16 bg-brand/10 rounded-full flex items-center justify-center text-brand border border-brand/20 mx-auto">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-2xl font-black text-white font-display tracking-tight uppercase">Limpar Tudo?</h3>
                <p className="text-sm text-zinc-500 leading-relaxed font-medium">
                  Você está prestes a remover permanentemente todo o seu histórico. Esta ação não pode ser desfeita.
                </p>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setShowConfirmClearModal(false)}
                  className="py-4 rounded-xl bg-white/5 text-white font-black text-[10px] uppercase tracking-widest hover:bg-white/10 transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleClearHistory}
                  className="py-4 rounded-xl bg-brand text-white font-black text-[10px] uppercase tracking-widest shadow-xl shadow-brand/20 hover:bg-brand-hover transition-all"
                >
                  Limpar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
