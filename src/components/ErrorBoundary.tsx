import React from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onBack?: () => void;
  resetKey?: string | number;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare props: Readonly<ErrorBoundaryProps>;
  declare state: ErrorBoundaryState;
  declare setState: (
    nextState:
      | Partial<ErrorBoundaryState>
      | ((prevState: Readonly<ErrorBoundaryState>, props: Readonly<ErrorBoundaryProps>) => Partial<ErrorBoundaryState> | null)
      | null,
    callback?: () => void
  ) => void;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[280px] bg-[#08090D] border border-white/10 rounded-2xl flex flex-col items-center justify-center p-8 text-center text-white">
          <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 mb-5">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-black uppercase tracking-tight mb-2 font-display">
            {this.props.fallbackTitle || 'Ocorreu um erro ao carregar esta área'}
          </h3>
          <p className="text-xs text-zinc-400 max-w-md mb-6 leading-relaxed">
            {this.props.fallbackMessage || 'Não foi possível renderizar este conteúdo neste momento. Podes tentar novamente ou voltar.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleReset}
              className="px-5 py-2.5 bg-[#E50914] hover:bg-red-700 text-white text-xs font-bold uppercase tracking-widest rounded-xl flex items-center gap-2 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Tentar Novamente</span>
            </button>
            {this.props.onBack && (
              <button
                type="button"
                onClick={this.props.onBack}
                className="px-5 py-2.5 bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-bold uppercase tracking-widest rounded-xl flex items-center gap-2 transition-all"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Voltar</span>
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
