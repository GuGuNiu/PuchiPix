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
	mu            sync.RWMutex
	providers     map[string]SiteProvider
	providerOrder []string // registration order, so provider lookup is deterministic
	modules       map[string]SiteModuleConfig
	logger        *infra.Logger
}

func NewSiteRegistry() *SiteRegistry {
	return &SiteRegistry{
		providers: make(map[string]SiteProvider),
		modules:   make(map[string]SiteModuleConfig),
		logger:    infra.NewLogger("SiteRegistry"),
	}
}

// Register adds a provider to the registry, keyed by its SiteID.
// Providers are stored in registration order for deterministic
// GetProviderByUrl lookup — the first registered provider whose
// CanHandle matches wins.
func (r *SiteRegistry) Register(p SiteProvider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := p.SiteID()
	if _, exists := r.providers[id]; !exists {
		r.providerOrder = append(r.providerOrder, id)
	}
	r.providers[id] = p
}

func (r *SiteRegistry) GetProvider(id string) (SiteProvider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

// GetProviderByUrl finds the first provider whose CanHandle matches the URL.
// Iterates providers in registration order for deterministic results —
// earlier-registered providers take priority over later ones. This avoids
// the non-deterministic behavior of Go map iteration.
func (r *SiteRegistry) GetProviderByUrl(rawURL string) (SiteProvider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, id := range r.providerOrder {
		if p, ok := r.providers[id]; ok && p.CanHandle(rawURL) {
			return p, true
		}
	}
	return nil, false
}

// GetAllProviders returns a slice of all registered providers in
// registration order, ensuring deterministic output for consumers
// that iterate over all providers (e.g., CLI diagnostics).
func (r *SiteRegistry) GetAllProviders() []SiteProvider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]SiteProvider, 0, len(r.providers))
	for _, id := range r.providerOrder {
		if p, ok := r.providers[id]; ok {
			result = append(result, p)
		}
	}
	return result
}

func (r *SiteRegistry) RegisterModule(mod SiteModuleConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.modules[mod.ID] = mod
}

func (r *SiteRegistry) GetModule(id string) (SiteModuleConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	mod, ok := r.modules[id]
	return mod, ok
}

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
			Domains: mod.Domains,
		})
	}
	return result
}

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
