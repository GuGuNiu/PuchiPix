package sites

import (
	"net/url"
	"strings"
	"sync"

	"backend/internal/infra"
)

// SiteRegistry manages provider registration and URL-based provider lookup,
// serving as the central routing layer for all site-specific operations.
type SiteRegistry struct {
	mu        sync.RWMutex
	providers map[string]SiteProvider
	modules   map[string]SiteModuleConfig
	logger    *infra.Logger
}

// NewSiteRegistry creates an empty registry with a logger for diagnostics.
func NewSiteRegistry() *SiteRegistry {
	return &SiteRegistry{
		providers: make(map[string]SiteProvider),
		modules:   make(map[string]SiteModuleConfig),
		logger:    infra.NewLogger("SiteRegistry"),
	}
}

// Register adds a provider to the registry, keyed by its SiteID.
func (r *SiteRegistry) Register(p SiteProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[p.SiteID()] = p
}

// Unregister removes a provider by its site ID.
func (r *SiteRegistry) Unregister(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.providers, id)
}

// GetProvider returns the provider registered under the given site ID.
func (r *SiteRegistry) GetProvider(id string) (SiteProvider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

// GetProviderByUrl finds the first provider whose CanHandle matches the URL.
func (r *SiteRegistry) GetProviderByUrl(rawURL string) (SiteProvider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, p := range r.providers {
		if p.CanHandle(rawURL) {
			return p, true
		}
	}
	return nil, false
}

// GetAllProviders returns a slice of all registered providers.
func (r *SiteRegistry) GetAllProviders() []SiteProvider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]SiteProvider, 0, len(r.providers))
	for _, p := range r.providers {
		result = append(result, p)
	}
	return result
}

// GetEnabledProviders returns only providers whose module is enabled.
func (r *SiteRegistry) GetEnabledProviders() []SiteProvider {
	all := r.GetAllProviders()
	result := make([]SiteProvider, 0, len(all))
	for _, p := range all {
		if mod, ok := r.GetModule(p.SiteID()); ok && mod.Enabled {
			result = append(result, p)
		}
	}
	return result
}

// RegisterModule associates a site module configuration with a site ID.
func (r *SiteRegistry) RegisterModule(mod SiteModuleConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.modules[mod.ID] = mod
}

// GetModule returns the module configuration for a site ID.
func (r *SiteRegistry) GetModule(id string) (SiteModuleConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	mod, ok := r.modules[id]
	return mod, ok
}

// GetSiteInfos builds display metadata for all registered sites.
func (r *SiteRegistry) GetSiteInfos() []SiteInfo {
	all := r.GetAllProviders()
	result := make([]SiteInfo, 0, len(all))
	for _, p := range all {
		mod, ok := r.GetModule(p.SiteID())
		if !ok {
			continue
		}
		result = append(result, SiteInfo{
			ID:      mod.ID,
			Name:    mod.NameCn,
			NameCn:  mod.NameCn,
			NameEn:  mod.NameEn,
			BaseURL: mod.BaseURL,
			Enabled: mod.Enabled,
			Type:    mod.Type,
			Badge:   mod.Badge,
			Gallery: mod.Type == "photo",
		})
	}
	return result
}

// GetEnabledSiteInfos returns site infos for enabled modules only.
func (r *SiteRegistry) GetEnabledSiteInfos() []SiteInfo {
	all := r.GetSiteInfos()
	result := make([]SiteInfo, 0, len(all))
	for _, s := range all {
		if s.Enabled {
			result = append(result, s)
		}
	}
	return result
}

// GetModuleByUrl finds a module whose base URL or domains match the given URL.
func (r *SiteRegistry) GetModuleByUrl(rawURL string) (SiteModuleConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	urlLower := strings.ToLower(rawURL)
	for _, mod := range r.modules {
		if mod.ID == "universal" {
			continue
		}
		if mod.BaseURL != "" {
			if host := extractHost(mod.BaseURL); host != "" && strings.Contains(urlLower, host) {
				return mod, true
			}
		}
		for _, domain := range mod.Domains {
			if host := extractHost(domain); host != "" && strings.Contains(urlLower, host) {
				return mod, true
			}
		}
		if strings.Contains(urlLower, mod.ID) {
			return mod, true
		}
	}
	return SiteModuleConfig{}, false
}

func extractHost(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(parsed.Hostname())
}

// InitDefaultModules registers all site module configurations loaded
// from the unified SiteDataStore, replacing the former hardcoded list.
func (r *SiteRegistry) InitDefaultModules() {
	for _, mod := range GetSiteDataStore().GetAllModuleConfigs() {
		r.RegisterModule(mod)
	}
}

var (
	registryOnce sync.Once
	registryInst *SiteRegistry
)

// GetSiteRegistry returns the singleton registry, initializing it with
// default modules on first access.
func GetSiteRegistry() *SiteRegistry {
	registryOnce.Do(func() {
		registryInst = NewSiteRegistry()
		registryInst.InitDefaultModules()
	})
	return registryInst
}
