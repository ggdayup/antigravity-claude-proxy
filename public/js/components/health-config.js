/**
 * Health Config Component
 * Manages health management configuration separately from server config
 * Extracted from server-config.js for single responsibility
 */
window.Components = window.Components || {};

window.Components.healthConfig = () => ({
    healthConfig: {},
    loading: false,
    debounceTimers: {},

    // Accordion state for collapsible sections
    accordions: {
        autoDisable: true,      // Section 1: Auto-Disable (失败保护)
        quotaProtection: true,  // Section 2: Quota Protection (配额保护)
        issueDetection: false,  // Section 3: Issue Detection (问题检测)
        displayStorage: false   // Section 4: Display & Storage (显示与存储)
    },

    init() {
        // Fetch health config when component initializes
        this.fetchHealthConfig();

        // Watch for tab changes (activeTab comes from parent scope)
        this.$watch('activeTab', (tab, oldTab) => {
            if (tab === 'health' && oldTab !== undefined) {
                this.fetchHealthConfig();
            }
        });
    },

    toggleAccordion(name) {
        this.accordions[name] = !this.accordions[name];
    },

    async fetchHealthConfig() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/health/config', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error('Failed to fetch health config');
            const data = await response.json();
            this.healthConfig = data.config || {};
        } catch (e) {
            console.error('Failed to fetch health config:', e);
        }
    },

    /**
     * Get recovery hours from autoRecoveryMs for UI display
     * Backend stores milliseconds, UI displays hours
     */
    getRecoveryHours() {
        const ms = this.healthConfig.autoRecoveryMs;
        if (!ms) return 24; // Default 24 hours
        return Math.round(ms / (60 * 60 * 1000));
    },

    async updateHealthConfig(updates, optimistic = true) {
        const store = Alpine.store('global');
        const password = store.webuiPassword;

        // Fields that should be debounced (numeric ranges)
        const numericFields = [
            'consecutiveFailureThreshold', 'autoRecoveryMs',
            'warningThreshold', 'criticalThreshold',
            'eventMaxCount', 'eventRetentionDays',
            'quotaPollIntervalMs', 'staleIssueMs', 'quotaThreshold'
        ];
        const firstField = Object.keys(updates)[0];

        if (numericFields.includes(firstField)) {
            // Clear existing debounce timer
            if (this.debounceTimers['health_config']) {
                clearTimeout(this.debounceTimers['health_config']);
            }

            // Optimistic update for UI responsiveness
            if (optimistic) {
                this.healthConfig = { ...this.healthConfig, ...updates };
            }

            this.debounceTimers['health_config'] = setTimeout(async () => {
                await this.executeHealthConfigUpdate(updates, store, password);
            }, window.AppConstants.INTERVALS.CONFIG_DEBOUNCE || 500);
            return;
        }

        // Immediate update for toggles
        if (optimistic) {
            this.healthConfig = { ...this.healthConfig, ...updates };
        }
        await this.executeHealthConfigUpdate(updates, store, password);
    },

    async executeHealthConfigUpdate(updates, store, password) {
        try {
            const { response, newPassword } = await window.utils.request('/api/health/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            }, password);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                // Only show toast for explicit toggles, not sliders to avoid spam
                const isToggle = typeof Object.values(updates)[0] === 'boolean';
                if (isToggle) {
                    store.showToast(store.t('configSaved') || 'Configuration saved', 'success');
                }
                this.healthConfig = data.config;
            } else {
                throw new Error(data.error || 'Update failed');
            }
        } catch (e) {
            store.showToast('Failed to update health config: ' + e.message, 'error');
            this.fetchHealthConfig(); // Rollback to server state
        }
    },

    // ========== Auto-Disable Section Setters ==========

    setFailureThreshold(value) {
        const { HEALTH_THRESHOLD_MIN, HEALTH_THRESHOLD_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, HEALTH_THRESHOLD_MIN, HEALTH_THRESHOLD_MAX, 'Failure Threshold');
        if (validation.isValid) this.updateHealthConfig({ consecutiveFailureThreshold: validation.value });
    },

    setRecoveryHours(value) {
        const { RECOVERY_HOURS_MIN, RECOVERY_HOURS_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, RECOVERY_HOURS_MIN, RECOVERY_HOURS_MAX, 'Recovery Hours');
        // Convert hours to milliseconds for backend
        if (validation.isValid) this.updateHealthConfig({ autoRecoveryMs: validation.value * 60 * 60 * 1000 });
    },

    // ========== Health Score Alerts Section Setters ==========

    setWarnThreshold(value) {
        const { HEALTH_SCORE_MIN, HEALTH_SCORE_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, HEALTH_SCORE_MIN, HEALTH_SCORE_MAX, 'Warning Threshold');
        if (validation.isValid) this.updateHealthConfig({ warningThreshold: validation.value });
    },

    setCriticalThreshold(value) {
        const { HEALTH_SCORE_MIN, HEALTH_SCORE_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, HEALTH_SCORE_MIN, HEALTH_SCORE_MAX, 'Critical Threshold');
        if (validation.isValid) this.updateHealthConfig({ criticalThreshold: validation.value });
    },

    // ========== Quota Protection Section Setters ==========

    setQuotaThreshold(value) {
        // value is percentage (5-50), convert to fraction (0.05-0.5)
        const pct = parseInt(value, 10);
        if (pct >= 5 && pct <= 50) {
            this.updateHealthConfig({ quotaThreshold: pct / 100 });
        }
    },

    setQuotaPollInterval(value) {
        const { QUOTA_POLL_INTERVAL_MIN, QUOTA_POLL_INTERVAL_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, QUOTA_POLL_INTERVAL_MIN, QUOTA_POLL_INTERVAL_MAX, 'Poll Interval');
        if (validation.isValid) this.updateHealthConfig({ quotaPollIntervalMs: validation.value * 60 * 1000 });
    },

    // ========== Data Retention Section Setters ==========

    setStaleIssueInterval(value) {
        const { STALE_ISSUE_MIN, STALE_ISSUE_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, STALE_ISSUE_MIN, STALE_ISSUE_MAX, 'Stale Issue Interval');
        if (validation.isValid) this.updateHealthConfig({ staleIssueMs: validation.value * 60 * 1000 });
    },

    setMaxEvents(value) {
        const { MAX_EVENTS_MIN, MAX_EVENTS_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, MAX_EVENTS_MIN, MAX_EVENTS_MAX, 'Max Events');
        if (validation.isValid) this.updateHealthConfig({ eventMaxCount: validation.value });
    },

    setRetentionDays(value) {
        const { RETENTION_DAYS_MIN, RETENTION_DAYS_MAX } = window.AppConstants.VALIDATION;
        const validation = window.Validators.validateRange(value, RETENTION_DAYS_MIN, RETENTION_DAYS_MAX, 'Retention Days');
        if (validation.isValid) this.updateHealthConfig({ eventRetentionDays: validation.value });
    }
});
