import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Navbar } from './components/Navbar.js';
import { Footer } from './components/Footer.js';
import { MobileBottomNav } from './components/MobileBottomNav.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { HomeView } from './views/HomeView.js';
import { MoviesView } from './views/MoviesView.js';
import { SeriesView } from './views/SeriesView.js';
import { CategoryCatalogView } from './views/CategoryCatalogView.js';
import { MyListView } from './views/MyListView.js';
import { HistoryView } from './views/HistoryView.js';
import { MediaDetailView } from './views/MediaDetailView.js';
import { WatchView } from './views/WatchView.js';
import { EmbedView } from './views/EmbedView.js';
import { SearchView } from './views/SearchView.js';
import { ProfileView } from './views/ProfileView.js';
import { AdminView } from './views/AdminView.js';
import { LoginView } from './views/LoginView.js';
import { DocumentationView } from './views/DocumentationView.js';
import { PlaygroundView } from './views/PlaygroundView.js';
import { PlansView } from './views/PlansView.js';
import { ResourcesView } from './views/ResourcesView.js';
import { FaqView } from './views/FaqView.js';
import { DeveloperPortalView } from './views/DeveloperPortalView.js';
import { SystemStatusView } from './views/SystemStatusView.js';

const MainContent: React.FC = () => {
  const { activeView, selectedMediaId, goBack, navigateTo } = useAuth();

  // If path is /embed/* or activeView is embed, render pristine standalone EmbedView
  if (activeView === 'embed') {
    return (
      <ErrorBoundary
        fallbackTitle="Erro ao carregar o Player Incorporado"
        onBack={() => navigateTo('home')}
        resetKey={activeView}
      >
        <EmbedView />
      </ErrorBoundary>
    );
  }

  const renderCurrentView = () => {
    switch (activeView) {
      case 'home':
        return <HomeView />;
      case 'catalog':
      case 'movies':
        return <MoviesView />;
      case 'series':
        return <SeriesView />;
      case 'animes':
        return <CategoryCatalogView category="anime" />;
      case 'doramas':
        return <CategoryCatalogView category="dorama" />;
      case 'search':
        return <SearchView />;
      case 'documentation':
      case 'docs':
        return <DocumentationView />;
      case 'developer':
        return <DeveloperPortalView />;
      case 'status':
      case 'saude':
        return <SystemStatusView onBack={() => navigateTo('home')} />;
      case 'playground':
        return <PlaygroundView />;
      case 'plans':
        return <PlansView />;
      case 'resources':
        return <ResourcesView />;
      case 'faq':
        return <FaqView />;
      case 'media_detail':
      case 'movie_detail':
      case 'series_detail':
        return (
          <ErrorBoundary
            fallbackTitle="Erro ao carregar detalhes"
            onBack={() => goBack('home')}
            resetKey={`${activeView}-${selectedMediaId || ''}`}
          >
            <MediaDetailView mediaId={selectedMediaId || ''} />
          </ErrorBoundary>
        );
      case 'watch':
        return (
          <ErrorBoundary
            fallbackTitle="Erro ao inicializar o Player"
            onBack={() => goBack('home')}
            resetKey={`${activeView}-${selectedMediaId || ''}`}
          >
            <WatchView />
          </ErrorBoundary>
        );
      case 'my_list':
        return <MyListView />;
      case 'history':
        return <HistoryView />;
      case 'profile':
        return <ProfileView />;
      case 'login':
        return <LoginView />;
      case 'admin':
        return (
          <ErrorBoundary
            fallbackTitle="Erro no Painel Administrativo"
            onBack={() => navigateTo('home')}
            resetKey={activeView}
          >
            <AdminView />
          </ErrorBoundary>
        );
      default:
        return <HomeView />;
    }
  };

  const hideHeaderFooter = activeView === 'watch' || activeView === 'admin' || activeView === 'login' || activeView === 'embed';

  return (
    <div className="min-h-screen bg-[#080808] text-white font-sans antialiased selection:bg-[#E50914] selection:text-white flex flex-col justify-between overflow-x-hidden">
      <div>
        {!hideHeaderFooter && <Navbar />}
        <main>
          <ErrorBoundary
            fallbackTitle="Algo correu mal ao exibir esta página"
            onBack={() => navigateTo('home')}
            resetKey={activeView}
          >
            {renderCurrentView()}
          </ErrorBoundary>
        </main>
      </div>
      {!hideHeaderFooter && <Footer />}
      {!hideHeaderFooter && <MobileBottomNav />}
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
}
