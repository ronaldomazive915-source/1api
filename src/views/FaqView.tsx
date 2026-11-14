import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Minus, MessageSquare, Mail } from 'lucide-react';

export const FaqView: React.FC = () => {
  const faqs = [
    {
      question: 'Como faço para obter uma chave de API?',
      answer: 'Para obter sua chave de API, você deve criar uma conta em nossa plataforma e acessar o painel de desenvolvedor. Lá você poderá gerar chaves para diferentes ambientes (testes e produção).'
    },
    {
      question: 'Quais formatos de vídeo são suportados pelo player?',
      answer: 'Nosso player suporta nativamente HLS (m3u8), DASH (mpd) e MP4. Além disso, oferecemos suporte a resoluções que variam de 360p até 4K Ultra HD com troca automática de bitrate.'
    },
    {
      question: 'A API RONYCINE possui limites de requisição?',
      answer: 'Sim, os limites dependem do seu plano. O plano gratuito oferece até 500 requisições diárias para desenvolvimento, enquanto o plano Profissional oferece 50.000 requisições/dia.'
    },
    {
      question: 'Como funciona a integração com o TMDB?',
      answer: 'Nossa API é totalmente compatível com IDs do TMDB. Você pode consultar metadados, posters e links de reprodução utilizando diretamente o ID original do TMDB.'
    },
    {
      question: 'Existe suporte para legendas e múltiplos idiomas?',
      answer: 'Sim, nossos fluxos HLS incluem suporte para múltiplas faixas de áudio e legendas (VTT/SRT) que podem ser selecionadas diretamente na interface do player.'
    }
  ];

  return (
    <div className="pt-32 pb-32 bg-[#08090D] min-h-screen">
      <div className="max-w-[800px] mx-auto px-6">
        <div className="text-center mb-20 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 border border-brand/20 text-brand text-[10px] font-black uppercase tracking-widest">
            Centro de Ajuda
          </div>
          <h1 className="text-4xl sm:text-5xl font-black font-display tracking-tight text-white">Dúvidas <span className="text-brand">Frequentes</span></h1>
          <p className="text-zinc-500 max-w-xl mx-auto leading-relaxed">
            Tudo o que você precisa saber sobre a RONYCINE API e nossa infraestrutura de streaming.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <FaqItem key={i} question={faq.question} answer={faq.answer} />
          ))}
        </div>

        {/* Contact CTA */}
        <div className="mt-20 p-12 rounded-2xl bg-[#11131A] border border-white/5 text-center space-y-6">
          <div className="flex justify-center -space-x-4">
            <div className="w-12 h-12 rounded-full border-2 border-[#11131A] bg-zinc-800" />
            <div className="w-12 h-12 rounded-full border-2 border-[#11131A] bg-zinc-700" />
            <div className="w-12 h-12 rounded-full border-2 border-[#11131A] bg-zinc-600" />
          </div>
          <h3 className="text-2xl font-bold text-white">Ainda tem dúvidas?</h3>
          <p className="text-zinc-500 max-w-md mx-auto text-sm leading-relaxed">
            Nossa equipe de suporte técnico está pronta para ajudar você com qualquer questão sobre integração.
          </p>
          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <button className="px-8 py-3 bg-brand text-white font-black text-xs uppercase tracking-widest rounded transition-all hover:bg-brand-hover flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Enviar Email
            </button>
            <button className="px-8 py-3 bg-zinc-800 text-white font-black text-xs uppercase tracking-widest rounded transition-all hover:bg-zinc-700 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
              Chat ao Vivo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const FaqItem: React.FC<{ question: string; answer: string }> = ({ question, answer }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden bg-[#11131A]/50">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-8 py-6 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
      >
        <span className="font-bold text-zinc-200">{question}</span>
        {isOpen ? <Minus className="w-4 h-4 text-brand" /> : <Plus className="w-4 h-4 text-zinc-500" />}
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-8 pb-8 text-sm text-zinc-500 leading-relaxed">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
