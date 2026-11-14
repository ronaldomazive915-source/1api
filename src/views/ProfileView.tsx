import React, { useState } from 'react';
import { User as UserIcon, Shield, Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { api } from '../lib/api.js';

export const ProfileView: React.FC = () => {
  const { user, updateCurrentUser } = useAuth();
  const [emailInput, setEmailInput] = useState(user?.email || '');
  const [nameInput, setNameInput] = useState(user?.name || '');
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (nameInput.trim()) {
      try {
        const res = await api.updateUserProfile({ name: nameInput.trim() });
        if (res.success && res.user) {
          updateCurrentUser({ name: res.user.name });
          setSuccessMsg('Perfil atualizado com sucesso!');
          setTimeout(() => setSuccessMsg(''), 3000);
        }
      } catch (err: any) {
        setErrorMsg(err.message || 'Erro ao atualizar perfil.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] text-white pt-28 pb-24 px-4 sm:px-6 lg:px-8 max-w-2xl mx-auto font-inter">
      <div className="bg-[#121212]/50 backdrop-blur-xl rounded-[2rem] p-8 sm:p-10 border border-white/5 shadow-2xl space-y-10">
        
        {/* PROFILE HEADER */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="relative group">
            <div className="w-24 h-24 rounded-full bg-brand/10 border-2 border-brand/20 flex items-center justify-center text-white text-3xl font-black font-outfit shadow-[0_0_40px_rgba(229,9,20,0.15)] group-hover:border-brand/40 transition-all duration-500">
              {user?.role === 'founder' ? '👑' : user?.name ? user.name.substring(0, 1).toUpperCase() : <UserIcon className="w-10 h-10" />}
            </div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-brand rounded-full flex items-center justify-center border-4 border-[#121212] shadow-lg">
              <Shield className="w-3.5 h-3.5 text-white" />
            </div>
          </div>
          
          <div>
            <h1 className="text-3xl font-black text-white font-outfit tracking-tight">{user?.name || 'Usuário'}</h1>
            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-[0.2em] flex items-center justify-center mt-2">
              <span className={`w-1.5 h-1.5 rounded-full mr-2 ${user?.role === 'founder' ? 'bg-amber-400' : 'bg-brand'}`} />
              {user?.role === 'founder' 
                ? '👑 Fundador Principal' 
                : user?.role === 'admin' 
                ? 'Administrador' 
                : 'Usuário Registrado'}
            </span>
          </div>
        </div>

        {/* PROFILE FORM */}
        <form onSubmit={handleUpdate} className="space-y-8">
          {errorMsg && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-2xl font-medium text-center">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs rounded-2xl font-medium text-center animate-in fade-in slide-in-from-top-2">
              {successMsg}
            </div>
          )}

          <div className="grid gap-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Nome Completo</label>
              <div className="group flex items-center bg-black/40 border border-white/5 rounded-2xl px-5 py-4 focus-within:border-brand/50 focus-within:bg-black/60 transition-all duration-300">
                <UserIcon className="w-4 h-4 text-zinc-500 mr-3 group-focus-within:text-brand" />
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full bg-transparent text-sm text-white focus:outline-none placeholder-zinc-700"
                  placeholder="Seu nome"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Endereço de E-mail</label>
              <div className="group flex items-center bg-black/40 border border-white/5 rounded-2xl px-5 py-4 focus-within:border-brand/50 focus-within:bg-black/60 transition-all duration-300">
                <Mail className="w-4 h-4 text-zinc-500 mr-3 group-focus-within:text-brand" />
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  className="w-full bg-transparent text-sm text-white focus:outline-none placeholder-zinc-700"
                  placeholder="seu@email.com"
                />
              </div>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              className="w-full py-4 rounded-2xl bg-brand hover:bg-brand-hover text-white font-black text-[11px] uppercase tracking-[0.2em] shadow-[0_0_20px_rgba(229,9,20,0.2)] hover:shadow-[0_0_30px_rgba(229,9,20,0.4)] transition-all duration-500 active:scale-[0.98]"
            >
              Atualizar Perfil
            </button>
          </div>
        </form>

        <div className="pt-6 border-t border-white/5 text-center">
          <p className="text-[10px] text-zinc-600 uppercase tracking-widest">RONYCINE API v2.0 • Sistema Seguro</p>
        </div>
      </div>
    </div>
  );
};
