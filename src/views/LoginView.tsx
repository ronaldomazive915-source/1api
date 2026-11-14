import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mail, 
  Lock, 
  User as UserIcon, 
  Eye, 
  EyeOff, 
  Loader2, 
  AlertCircle,
  CheckCircle2,
  Globe,
  ArrowLeft,
  Crown
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';

export const LoginView: React.FC = () => {
  const { user, login, register, googleLogin, navigateTo, previousView } = useAuth();
  
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: ''
  });

  useEffect(() => {
    if (user) {
      setIsSuccess(true);
      const timer = setTimeout(() => {
        if (user.role === 'founder' || user.role === 'admin') {
          navigateTo('admin');
        } else {
          navigateTo(previousView || 'home');
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [user, previousView, navigateTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const email = formData.email.trim();
    const password = formData.password;

    if (!email || !password) {
      setError('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    if (!isLogin && !formData.name.trim()) {
      setError('Por favor, informe seu nome completo para o cadastro.');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(formData.name.trim(), email, password);
      }
      setIsSuccess(true);
    } catch (err: any) {
      let msg = err.message || 'Falha na autenticação. Verifique suas credenciais.';
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        msg = 'Falha de conexão com o servidor. Verifique sua conexão com a internet.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await googleLogin();
      setIsSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Não foi possível autenticar com o Google.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center px-6 py-12 overflow-hidden bg-[#08090D] selection:bg-brand">
      
      {/* BACKGROUND ELEMENTS */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-[450px]"
      >
        <div className="mb-6">
          <button
            onClick={() => navigateTo('home')}
            className="inline-flex items-center gap-2 text-xs font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-widest px-3 py-2 rounded-xl hover:bg-white/5"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar ao Início
          </button>
        </div>

        <div className="bg-[#11131A] border border-white/5 rounded-3xl p-8 sm:p-12 shadow-2xl relative overflow-hidden">
          
          {/* HEADER */}
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center mb-4 shadow-xl shadow-brand/20">
              <Globe className="w-8 h-8 text-white" />
            </div>
            
            <h1 className="text-3xl font-black tracking-tighter text-white uppercase font-display">
              RONYCINE <span className="text-brand">API</span>
            </h1>
            <p className="text-zinc-500 text-[10px] mt-1.5 font-black uppercase tracking-[0.2em] text-center">
              {isLogin ? 'Autenticação e Acesso Seguro' : 'Cadastro de Desenvolvedor / Parceiro'}
            </p>
          </div>

          {/* TABS */}
          <div className="flex bg-[#0D0F14] p-1 rounded-xl mb-8 border border-white/5">
            <button
              type="button"
              onClick={() => { setIsLogin(true); setError(null); }}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${isLogin ? 'bg-brand text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
            >
              Fazer Login
            </button>
            <button
              type="button"
              onClick={() => { setIsLogin(false); setError(null); }}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all ${!isLogin ? 'bg-brand text-white shadow-lg' : 'text-zinc-500 hover:text-white'}`}
            >
              Criar Conta
            </button>
          </div>

          {/* FORM */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block px-1">Nome Completo</label>
                <div className="relative group">
                  <UserIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-brand transition-colors" />
                  <input
                    type="text"
                    required={!isLogin}
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[#0D0F14] border border-white/5 rounded-xl py-3.5 pl-12 pr-4 text-white text-sm focus:outline-none focus:border-brand transition-all font-medium"
                    placeholder="Seu nome"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block px-1">E-mail</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-brand transition-colors" />
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full bg-[#0D0F14] border border-white/5 rounded-xl py-3.5 pl-12 pr-4 text-white text-sm focus:outline-none focus:border-brand transition-all font-medium"
                  placeholder="usuario@empresa.com"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 block px-1">Senha de Acesso</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-brand transition-colors" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full bg-[#0D0F14] border border-white/5 rounded-xl py-3.5 pl-12 pr-12 text-white text-sm focus:outline-none focus:border-brand transition-all font-medium"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: -5 }} 
                animate={{ opacity: 1, y: 0 }}
                className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold p-4 rounded-xl flex items-start gap-3 leading-relaxed"
              >
                <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
                <span>{error}</span>
              </motion.div>
            )}

            {isSuccess && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold p-4 rounded-xl flex items-center gap-3"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                <span>
                  {user?.role === 'founder' 
                    ? '👑 Fundador autenticado! Redirecionando para o painel...'
                    : 'Autenticado com sucesso! Entrando na plataforma...'}
                </span>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading || isSuccess}
              className="w-full bg-brand hover:bg-brand-hover text-white font-black uppercase tracking-[0.2em] text-xs py-4 rounded-xl shadow-xl shadow-brand/20 transition-all flex items-center justify-center active:scale-95 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isSuccess ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                isLogin ? 'Entrar na Plataforma' : 'Criar Conta de Acesso'
              )}
            </button>
          </form>

          {/* SOCIAL LOGIN */}
          <div className="mt-8 space-y-5">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/5"></div>
              </div>
              <div className="relative flex justify-center text-[10px] uppercase font-black tracking-[0.2em] text-zinc-600">
                <span className="bg-[#11131A] px-4">Ou continue com</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={loading || isSuccess}
              className="w-full bg-white hover:bg-zinc-100 text-black font-black text-xs uppercase tracking-widest py-3.5 rounded-xl transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl disabled:opacity-50"
            >
              <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
              <span>Entrar com Google</span>
            </button>
          </div>
        </div>

        <p className="text-center mt-6 text-[9px] text-zinc-600 font-black uppercase tracking-[0.3em]">
          Ambiente Protegido por Criptografia de 256 bits • RONYCINE API
        </p>
      </motion.div>
    </div>
  );
};
