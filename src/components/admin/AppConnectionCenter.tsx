import React, { useState, useEffect } from 'react';
import { 
  Tv, 
  Smartphone, 
  Wifi, 
  Key, 
  RefreshCw, 
  Check, 
  Copy, 
  ShieldCheck, 
  QrCode, 
  Activity, 
  AlertCircle, 
  Clock, 
  Radio, 
  Sliders, 
  CheckCircle2, 
  XCircle,
  ExternalLink,
  Laptop,
  Terminal,
  Cpu,
  UserCheck
} from 'lucide-react';
import { BRANDING } from '../../lib/branding.js';

interface ConnectedDevice {
  id: string;
  name: string;
  type: 'tv' | 'mobile' | 'box';
  appVersion: string;
  ip: string;
  status: 'online' | 'offline';
  lastPing: string;
  pairedAt: string;
}

export const AppConnectionCenter: React.FC = () => {
  const [pairingCode, setPairingCode] = useState<string>('741-852');
  const [expiresIn, setExpiresIn] = useState<number>(600); // 10 minutes
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'waiting' | 'success'>('waiting');

  const [devices, setDevices] = useState<ConnectedDevice[]>([
    {
      id: 'dev-1',
      name: 'Smart TV Living Room (Tizen)',
      type: 'tv',
      appVersion: '3.2.0',
      ip: '192.168.1.105',
      status: 'online',
      lastPing: 'Há 12s',
      pairedAt: '2026-09-20 14:30'
    },
    {
      id: 'dev-2',
      name: 'Android TV 4K Box Pro',
      type: 'box',
      appVersion: '3.2.0',
      ip: '192.168.1.142',
      status: 'online',
      lastPing: 'Há 45s',
      pairedAt: '2026-09-21 19:15'
    },
    {
      id: 'dev-3',
      name: 'Fire TV Stick 4K Quarto',
      type: 'box',
      appVersion: '3.1.9',
      ip: '192.168.1.180',
      status: 'offline',
      lastPing: 'Há 3 horas',
      pairedAt: '2026-09-18 10:00'
    }
  ]);

  // Countdown timer for pairing code
  useEffect(() => {
    if (expiresIn <= 0) return;
    const timer = setInterval(() => {
      setExpiresIn(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresIn]);

  const generateNewPairingCode = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const part1 = Math.floor(100 + Math.random() * 900);
      const part2 = Math.floor(100 + Math.random() * 900);
      setPairingCode(`${part1}-${part2}`);
      setExpiresIn(600);
      setIsGenerating(false);
      setConnectionStatus('waiting');
    }, 400);
  };

  const copyToClipboard = (text: string, keyName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyName);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleDisconnectDevice = (id: string) => {
    setDevices(prev => prev.filter(d => d.id !== id));
  };

  const envConfigSnippet = `# Configurações Oficiais da Plataforma IPTV
PLATFORM_NAME=${BRANDING.PLATFORM_NAME}
APP_NAME=${BRANDING.APP_NAME}
ADMIN_NAME=${BRANDING.ADMIN_NAME}
APP_ID=${BRANDING.APP_ID}
FOUNDER_NAME=${BRANDING.FOUNDER.NAME}
FOUNDER_EMAIL=${BRANDING.FOUNDER.EMAIL}
API_BASE_URL=/api
SOCKET_URL=/`;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 border border-zinc-800/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-red-600/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 bg-red-600/20 border border-red-500/40 rounded-xl flex items-center justify-center text-red-500 shadow-md">
                <Tv className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-black text-white tracking-wide uppercase">
                    {BRANDING.CONNECTION_CENTER_NAME}
                  </h1>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    SISTEMA ATIVO
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Gerenciamento da infraestrutura de comunicação e sincronização do aplicativo IPTV.
                </p>
              </div>
            </div>

            {/* Founder Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs">
              <UserCheck className="w-3.5 h-3.5 text-red-500 shrink-0" />
              <span className="text-zinc-400 font-medium">Fundador:</span>
              <strong className="text-zinc-200 font-bold tracking-wide">{BRANDING.FOUNDER.NAME}</strong>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400">{BRANDING.FOUNDER.ROLE}</span>
              <span className="text-zinc-600">|</span>
              <span className="text-zinc-400 font-mono text-[11px]">{BRANDING.FOUNDER.EMAIL}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={generateNewPairingCode}
              disabled={isGenerating}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 active:scale-95 text-white font-bold text-xs shadow-lg shadow-red-950/40 transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span>Gerar Novo Código</span>
            </button>
            <button
              onClick={() => copyToClipboard(envConfigSnippet, 'env')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 font-medium text-xs transition-all"
            >
              {copiedKey === 'env' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey === 'env' ? 'Configuração Copiada!' : 'Copiar Variáveis (.env)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Code Generator + Connection Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Pairing Code Card (5 Cols) */}
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800/80 rounded-2xl p-6 shadow-xl flex flex-col justify-between space-y-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-300">
                <Key className="w-4 h-4 text-red-500" />
                <span>Código de Pareamento Rápido</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400">
                <Clock className="w-3 h-3 text-red-400" />
                <span>Expira em: <strong className="text-white">{formatTimer(expiresIn)}</strong></span>
              </div>
            </div>

            {/* Big Code Display */}
            <div className="bg-gradient-to-b from-zinc-900/90 to-zinc-950 border border-zinc-800/90 rounded-2xl p-6 text-center shadow-inner relative group">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest block mb-1">
                Insira no {BRANDING.APP_NAME}
              </span>
              <div className="text-4xl sm:text-5xl font-mono font-black tracking-widest text-white py-2 selection:bg-red-600">
                {pairingCode}
              </div>
              <p className="text-xs text-zinc-400 mt-2">
                Código temporário de alta segurança para conexão do {BRANDING.APP_NAME} com a {BRANDING.ADMIN_NAME}.
              </p>

              <button
                onClick={() => copyToClipboard(pairingCode, 'code')}
                className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-xs text-zinc-200 transition-colors"
              >
                {copiedKey === 'code' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'code' ? 'Código Copiado!' : 'Copiar Código'}</span>
              </button>
            </div>
          </div>

          {/* Quick QR Code Simulation */}
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl p-4 flex items-center gap-4">
            <div className="w-16 h-16 bg-white p-1 rounded-lg shrink-0 flex items-center justify-center shadow">
              <QrCode className="w-14 h-14 text-black" />
            </div>
            <div className="text-xs space-y-1">
              <strong className="block text-zinc-200 font-bold">QR Code de Conexão</strong>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                Abra a câmera do aplicativo {BRANDING.APP_NAME} e aponte para conectar automaticamente.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-zinc-900 text-[11px] text-zinc-500 flex items-center justify-between">
            <span>Status de Autorização:</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Pronto para Pareamento
            </span>
          </div>
        </div>

        {/* Pairing Instructions & Connection Status (7 Cols) */}
        <div className="lg:col-span-7 bg-zinc-950 border border-zinc-800/80 rounded-2xl p-6 shadow-xl space-y-6">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-200 flex items-center gap-2">
              <Radio className="w-4 h-4 text-red-500" />
              <span>Instruções de Conexão Passo a Passo</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              Siga os passos abaixo para conectar qualquer televisão, dispositivo Android ou TV Box ao {BRANDING.PLATFORM_NAME}.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 space-y-2">
              <div className="w-7 h-7 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center text-xs font-bold">
                1
              </div>
              <h3 className="text-xs font-bold text-zinc-200">Abra o {BRANDING.APP_NAME}</h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Inicie o aplicativo {BRANDING.APP_NAME} no seu dispositivo e acesse a tela de <strong>Pareamento / Conectar</strong>.
              </p>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 space-y-2">
              <div className="w-7 h-7 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center text-xs font-bold">
                2
              </div>
              <h3 className="text-xs font-bold text-zinc-200">Insira o Código</h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Digite o código de 6 dígitos gerado (<span className="font-mono font-bold text-zinc-200">{pairingCode}</span>) ou escaneie o QR Code.
              </p>
            </div>

            <div className="bg-zinc-900/50 border border-zinc-800/80 rounded-xl p-4 space-y-2">
              <div className="w-7 h-7 rounded-lg bg-red-600/20 text-red-500 flex items-center justify-center text-xs font-bold">
                3
              </div>
              <h3 className="text-xs font-bold text-zinc-200">Acesso Concedido</h3>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                O {BRANDING.APP_NAME} sincroniza imediatamente o catálogo completo, canais e players da {BRANDING.ADMIN_NAME}.
              </p>
            </div>
          </div>

          {/* Technical Specs & Identifiers */}
          <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-red-500" />
              <span>Identificadores Técnicos da Plataforma</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-400">Nome Oficial:</span>
                <strong className="text-white font-mono">{BRANDING.PLATFORM_NAME}</strong>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-400">Identificador (APP_ID):</span>
                <strong className="text-emerald-400 font-mono">{BRANDING.APP_ID}</strong>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-400">Central Admin:</span>
                <strong className="text-white font-mono">{BRANDING.ADMIN_NAME}</strong>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-950 border border-zinc-800">
                <span className="text-zinc-400">Compatibilidade Legada:</span>
                <span className="text-zinc-300 font-mono text-[11px]">{BRANDING.LEGACY_APP_ID} (Suportado)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connected Devices Table */}
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-red-600/20 text-red-500 rounded-xl">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
                Instâncias do {BRANDING.APP_NAME} Conectadas ({devices.length})
              </h2>
              <p className="text-xs text-zinc-400">
                Dispositivos autorizados que estão recebendo streams, canais e metadados da {BRANDING.ADMIN_NAME}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Heartbeat: <strong>Ativo a cada 30s</strong></span>
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800/80 text-zinc-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-4">Dispositivo</th>
                <th className="py-3 px-4">Versão do App</th>
                <th className="py-3 px-4">Endereço IP</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Último Ping</th>
                <th className="py-3 px-4">Pareado em</th>
                <th className="py-3 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900/80">
              {devices.map(device => (
                <tr key={device.id} className="hover:bg-zinc-900/30 transition-colors">
                  <td className="py-3.5 px-4 font-medium text-white flex items-center gap-2.5">
                    {device.type === 'tv' && <Tv className="w-4 h-4 text-red-500 shrink-0" />}
                    {device.type === 'box' && <Laptop className="w-4 h-4 text-purple-400 shrink-0" />}
                    {device.type === 'mobile' && <Smartphone className="w-4 h-4 text-blue-400 shrink-0" />}
                    <span>{device.name}</span>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-zinc-300">
                    v{device.appVersion}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-zinc-400">
                    {device.ip}
                  </td>
                  <td className="py-3.5 px-4">
                    {device.status === 'online' ? (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                        Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                        Offline
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 text-zinc-400">
                    {device.lastPing}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-zinc-500 text-[11px]">
                    {device.pairedAt}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => handleDisconnectDevice(device.id)}
                      className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-red-600/20 text-zinc-400 hover:text-red-400 border border-zinc-800 hover:border-red-500/30 transition-all text-[11px]"
                    >
                      Revogar Acesso
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
