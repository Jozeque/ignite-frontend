/**
 * Stride Canvas — Cloud Client
 * Handles optional online features: auth, credits, and generation via Firebase.
 * Only active when user signs in. Offline mode works without this.
 */

class StrideCloud {
    constructor() {
        this.apiUrl = 'https://generate-midi-z3spyrafvq-uc.a.run.app';
        this.token = null;
        this.user = null;
        this.credits = 0;
        this.isOnline = false;
    }

    /**
     * Sign in with serial key + email.
     * Validates against the license endpoint, caches token locally.
     */
    async signIn(serial, email) {
        try {
            const res = await fetch(`${this.apiUrl}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'validate_license',
                    serial: serial,
                    email: email,
                    machine_id: await this._getMachineId()
                })
            });
            const data = await res.json();
            if (data.success) {
                this.token = data.token;
                this.user = { email, serial, display_name: data.display_name || '' };
                this.credits = data.credits || 0;
                this.isOnline = true;

                // Cache locally for offline grace
                if (window.stride) {
                    await window.stride.saveLicense({
                        serial, email, token: this.token,
                        credits: this.credits,
                        display_name: this.user.display_name
                    });
                }

                return { success: true, credits: this.credits };
            }
            return { success: false, error: data.error || 'Invalid license' };
        } catch (e) {
            // Try offline cache
            return this._tryOfflineAuth();
        }
    }

    /**
     * Generate automation curves (and optionally MIDI) via cloud.
     * Sends rack params + settings, receives raw curve data.
     */
    async generate(params, settings) {
        if (!this.isOnline || !this.token) {
            return { success: false, error: 'Sign in to use generation' };
        }

        try {
            const res = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    action: 'generate',
                    format: 'json', // Raw curves, no ALC packaging
                    parameters: params.map(p => ({
                        envelopeId: p.envelopeId || p.id,
                        name: p.name,
                        min: p.min,
                        max: p.max
                    })),
                    ...settings // bars, key, bpm, style, prompt, etc.
                })
            });

            const data = await res.json();
            if (data.success) {
                this.credits = data.credits_remaining || this.credits - 1;
                return {
                    success: true,
                    curves: data.curves || [],
                    midi: data.midi || null,
                    credits_remaining: this.credits
                };
            }
            return { success: false, error: data.error || 'Generation failed' };
        } catch (e) {
            return { success: false, error: 'Network error: ' + e.message };
        }
    }

    /**
     * Check remaining credits.
     */
    async refreshCredits() {
        if (!this.isOnline || !this.token) return;
        try {
            const res = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ action: 'check_credits' })
            });
            const data = await res.json();
            if (data.success) this.credits = data.credits || 0;
        } catch (_) {}
    }

    /**
     * Sign out — clear cached credentials.
     */
    async signOut() {
        this.token = null;
        this.user = null;
        this.credits = 0;
        this.isOnline = false;
        if (window.stride) {
            await window.stride.saveLicense({});
        }
    }

    /**
     * Try loading cached license for offline grace period (14 days).
     */
    async _tryOfflineAuth() {
        if (!window.stride) return { success: false, error: 'Offline, no cached license' };
        const result = await window.stride.loadLicense();
        if (result.success && result.license && result.license.token) {
            const age = Date.now() - (result.license.cached_at || 0);
            const graceDays = 14;
            if (age < graceDays * 24 * 60 * 60 * 1000) {
                this.token = result.license.token;
                this.user = {
                    email: result.license.email,
                    serial: result.license.serial,
                    display_name: result.license.display_name || ''
                };
                this.credits = result.license.credits || 0;
                this.isOnline = true; // Cached online mode
                return { success: true, credits: this.credits, offline: true };
            }
        }
        return { success: false, error: 'Offline grace period expired' };
    }

    async _getMachineId() {
        // Simple machine fingerprint from platform info
        const p = window.stride ? window.stride.platform : 'unknown';
        const nav = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        // In production, use a more robust machine ID (e.g., from Electron's machineId)
        return btoa(p + '|' + nav).slice(0, 32);
    }
}

// Singleton
window.strideCloud = new StrideCloud();
