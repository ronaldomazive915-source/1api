import { adminDb } from './firebaseAdmin.js';

export const M3UImporterService = {
  maskUrl(url: string) {
    if (!url) return '';
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}/******`;
    } catch {
      return '******';
    }
  }
};

// Local in-memory store for fallback when Firestore is unprovisioned or returns PERMISSION_DENIED
const inMemoryStore = {
  liveChannels: [] as any[],
  m3uSources: [] as any[],
  m3uSyncJobs: [] as any[],
  m3uSyncErrors: [] as any[]
};

export const m3uImporter = {
  async getLiveChannels(enabledOnly: boolean) {
    try {
      const snapshot = await adminDb.collection('liveChannels').get();
      let channels = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (enabledOnly) channels = channels.filter((c: any) => c.enabled);
      return channels;
    } catch (e) {
      let channels = inMemoryStore.liveChannels;
      if (enabledOnly) channels = channels.filter((c: any) => c.enabled);
      return channels;
    }
  },

  async getSources() {
    try {
      const snapshot = await adminDb.collection('m3uSources').get();
      return snapshot.docs.map(doc => ({ id: doc.id, url: '', name: '', enabled: false, autoSync: false, syncIntervalMinutes: 60, lastSyncAt: '', ...doc.data() }));
    } catch (e) {
      return inMemoryStore.m3uSources;
    }
  },

  async getSource(id: string) {
    try {
      const doc = await adminDb.collection('m3uSources').doc(id).get();
      return doc.exists ? ({ id: doc.id, ...doc.data() } as any) : null;
    } catch (e) {
      return inMemoryStore.m3uSources.find(s => s.id === id) || null;
    }
  },

  async updateSource(id: string, updates: any) {
    try {
      await adminDb.collection('m3uSources').doc(id).update(updates);
      const doc = await adminDb.collection('m3uSources').doc(id).get();
      return { id: doc.id, ...doc.data() };
    } catch (e) {
      const idx = inMemoryStore.m3uSources.findIndex(s => s.id === id);
      if (idx !== -1) {
        inMemoryStore.m3uSources[idx] = { ...inMemoryStore.m3uSources[idx], ...updates };
        return inMemoryStore.m3uSources[idx];
      }
      const newSrc = { id, ...updates };
      inMemoryStore.m3uSources.push(newSrc);
      return newSrc;
    }
  },

  async testConnection(url: string) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      return { ok: res.ok, message: res.ok ? 'Conexão estabelecida' : `Erro HTTP: ${res.status}` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },

  async getActiveJob() {
    try {
      const snapshot = await adminDb.collection('m3uSyncJobs')
        .where('status', '==', 'RUNNING')
        .limit(1)
        .get();
      return snapshot.empty ? null : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    } catch (e) {
      return inMemoryStore.m3uSyncJobs.find(j => j.status === 'RUNNING') || null;
    }
  },

  async runSync(sourceId: string, type: string) {
    const jobId = `job-${Date.now()}`;
    const job = {
      id: jobId,
      sourceId,
      status: 'RUNNING',
      triggeredBy: type,
      createdAt: new Date().toISOString()
    };
    try {
      await adminDb.collection('m3uSyncJobs').doc(jobId).set(job);
    } catch (e) {
      inMemoryStore.m3uSyncJobs.unshift(job);
    }
    return jobId;
  },

  async cancelSync(jobId: string) {
    if (!jobId) return false;
    try {
      await adminDb.collection('m3uSyncJobs').doc(jobId).update({ status: 'CANCELLED', updatedAt: new Date().toISOString() });
    } catch (e) {
      const j = inMemoryStore.m3uSyncJobs.find(item => item.id === jobId);
      if (j) {
        j.status = 'CANCELLED';
        j.updatedAt = new Date().toISOString();
      }
    }
    return true;
  },

  async getSyncJobs(limit: number = 15) {
    try {
      const snapshot = await adminDb.collection('m3uSyncJobs').orderBy('createdAt', 'desc').limit(limit).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      return inMemoryStore.m3uSyncJobs.slice(0, limit);
    }
  },

  async getSyncErrors(jobId?: string) {
    try {
      let query: any = adminDb.collection('m3uSyncErrors');
      if (jobId) query = query.where('jobId', '==', jobId);
      const snapshot = await query.orderBy('timestamp', 'desc').limit(50).get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (e) {
      let errs = inMemoryStore.m3uSyncErrors;
      if (jobId) errs = errs.filter(item => item.jobId === jobId);
      return errs.slice(0, 50);
    }
  },

  async addCustomChannel(channel: any) {
    const id = channel.id || `ch-${Date.now()}`;
    const data = { ...channel, id, enabled: channel.enabled ?? channel.active ?? true };
    try {
      await adminDb.collection('liveChannels').doc(id).set(data);
    } catch (e) {
      inMemoryStore.liveChannels.unshift(data);
    }
    return data;
  },

  async updateCustomChannel(id: string, updates: any) {
    try {
      await adminDb.collection('liveChannels').doc(id).update(updates);
    } catch (e) {
      const idx = inMemoryStore.liveChannels.findIndex(c => c.id === id);
      if (idx >= 0) {
        inMemoryStore.liveChannels[idx] = { ...inMemoryStore.liveChannels[idx], ...updates };
      }
    }
    return { id, ...updates };
  },

  async deleteCustomChannel(id: string) {
    try {
      await adminDb.collection('liveChannels').doc(id).delete();
    } catch (e) {
      inMemoryStore.liveChannels = inMemoryStore.liveChannels.filter(c => c.id !== id);
    }
    return true;
  },

  async removeUnavailableItems() {
    return { removedMovies: 0, removedSeries: 0, removedChannels: 0 };
  }
};
