package sites

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"

	"backend/internal/sites/data"
)

// AgeVerifyConfig holds the anti-addiction verification parameters
// for sites that require age confirmation before accessing content.
type AgeVerifyConfig struct {
	Field  string `json:"field"`
	Value  string `json:"value"`
	Cookie string `json:"cookie"`
}

type ProviderData struct {
	PlaceholderFragment        string            `json:"placeholderFragment"`
	PublisherURL               string            `json:"publisherUrl"`
	TitleSuffixPatterns        []string          `json:"titleSuffixPatterns"`
	PublisherPrefixes          []string          `json:"publisherPrefixes"`
	BlockedTitleKeywords       []string          `json:"blockedTitleKeywords"`
	BlockedCategories          []string          `json:"blockedCategories"`
	BlockedProtagonists        []string          `json:"blockedProtagonists"`
	BlockedProtagonistsEnabled bool              `json:"blockedProtagonistsEnabled"`
	BaseEURL                   string            `json:"baseEURL"`
	BaseExURL                  string            `json:"baseExURL"`
	ImageBatchSize             int               `json:"imageBatchSize"`
	ImageFetchTimeout          int               `json:"imageFetchTimeout"`
	ThumbsPerPage              int               `json:"thumbsPerPage"`
	CategoryLabels             map[string]int    `json:"categoryLabels"`
	CategoryNames              map[string]string `json:"categoryNames"`
	PrimaryDomain              string            `json:"primaryDomain"`
	DiscuzCookiePrefix         string            `json:"discuzCookiePrefix"`
	PlaceholderGif             string            `json:"placeholderGif"`
	UrlPatterns                map[string]string `json:"urlPatterns"`
	TitleCleanPatterns         []string          `json:"titleCleanPatterns"`
	ImgCdnDomain               string            `json:"imgCdnDomain"`
	ResCdnDomain               string            `json:"resCdnDomain"`
	AgeVerifyField             string            `json:"ageVerifyField"`
	AgeVerifyValue             string            `json:"ageVerifyValue"`
	AgeVerifyCookie            string            `json:"ageVerifyCookie"`
}

type siteEntry struct {
	Module   SiteModuleConfig `json:"module"`
	Provider ProviderData     `json:"provider"`
}

type siteConfigFile struct {
	Version string               `json:"version"`
	Sites   map[string]siteEntry `json:"sites"`
}

// SiteDataStore provides unified access to all site-specific data.
// Static configuration is loaded from an embedded JSON file at init
// time; variable data (blocked keywords) can optionally be overridden
// via a DB-backed cache.
type SiteDataStore interface {
	GetModuleConfig(siteID string) (SiteModuleConfig, bool)
	GetAllModuleConfigs() []SiteModuleConfig
	GetDomains(siteID string) []string
	GetPlaceholder(siteID string) string
	GetPublisherPrefixes(siteID string) []string
	GetTitleSuffixPatterns(siteID string) []string
	GetTitleCleanPatterns(siteID string) []string
	GetCategoryLabels(siteID string) map[string]int
	GetCategoryNames(siteID string) map[int]string
	GetCDNDomains(siteID string) map[string]string
	GetCookiePrefix(siteID string) string
	GetAgeVerifyConfig(siteID string) (AgeVerifyConfig, bool)
	GetProviderData(siteID string) (ProviderData, bool)

	GetBlockedKeywords(siteID string) []string
	GetBlockedCategories(siteID string) []string
	GetBlockedProtagonists(siteID string) []string
	IsBlockedProtagonistsEnabled(siteID string) bool
	GetPublisherURL(siteID string) string

	CanHandle(siteID string, rawURL string) bool
}

type siteDataStoreImpl struct {
	mu    sync.RWMutex
	sites map[string]siteEntry
}

// NewSiteDataStore panics on malformed JSON because the configuration is
// embedded in the binary and must be valid at build time.
func NewSiteDataStore() SiteDataStore {
	return newSiteDataStoreFromJSON(data.SiteConfigsJSON)
}

func newSiteDataStoreFromJSON(raw []byte) SiteDataStore {
	var cfg siteConfigFile
	if err := json.Unmarshal(raw, &cfg); err != nil {
		panic(fmt.Sprintf("SiteDataStore: failed to parse site-configs.json: %v", err))
	}
	if cfg.Sites == nil {
		panic("SiteDataStore: site-configs.json contains no sites")
	}
	return &siteDataStoreImpl{sites: cfg.Sites}
}

func (s *siteDataStoreImpl) getEntry(siteID string) (siteEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry, ok := s.sites[siteID]
	return entry, ok
}

func (s *siteDataStoreImpl) GetModuleConfig(siteID string) (SiteModuleConfig, bool) {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return SiteModuleConfig{}, false
	}
	return entry.Module, true
}

func (s *siteDataStoreImpl) GetAllModuleConfigs() []SiteModuleConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]SiteModuleConfig, 0, len(s.sites))
	for _, entry := range s.sites {
		result = append(result, entry.Module)
	}
	return result
}

func (s *siteDataStoreImpl) GetDomains(siteID string) []string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Module.Domains
}

func (s *siteDataStoreImpl) GetPlaceholder(siteID string) string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return ""
	}
	return entry.Provider.PlaceholderFragment
}

func (s *siteDataStoreImpl) GetPublisherPrefixes(siteID string) []string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Provider.PublisherPrefixes
}

func (s *siteDataStoreImpl) GetTitleSuffixPatterns(siteID string) []string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Provider.TitleSuffixPatterns
}

func (s *siteDataStoreImpl) GetTitleCleanPatterns(siteID string) []string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Provider.TitleCleanPatterns
}

func (s *siteDataStoreImpl) GetCategoryLabels(siteID string) map[string]int {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Provider.CategoryLabels
}

func (s *siteDataStoreImpl) GetCategoryNames(siteID string) map[int]string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	result := make(map[int]string, len(entry.Provider.CategoryNames))
	for k, v := range entry.Provider.CategoryNames {
		var n int
		if _, err := fmt.Sscanf(k, "%d", &n); err == nil {
			result[n] = v
		}
	}
	return result
}

func (s *siteDataStoreImpl) GetCDNDomains(siteID string) map[string]string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	pd := entry.Provider
	result := make(map[string]string)
	if pd.ImgCdnDomain != "" {
		result["img"] = pd.ImgCdnDomain
	}
	if pd.ResCdnDomain != "" {
		result["res"] = pd.ResCdnDomain
	}
	return result
}

func (s *siteDataStoreImpl) GetCookiePrefix(siteID string) string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return ""
	}
	return entry.Provider.DiscuzCookiePrefix
}

func (s *siteDataStoreImpl) GetAgeVerifyConfig(siteID string) (AgeVerifyConfig, bool) {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return AgeVerifyConfig{}, false
	}
	pd := entry.Provider
	if pd.AgeVerifyField == "" {
		return AgeVerifyConfig{}, false
	}
	return AgeVerifyConfig{
		Field:  pd.AgeVerifyField,
		Value:  pd.AgeVerifyValue,
		Cookie: pd.AgeVerifyCookie,
	}, true
}

func (s *siteDataStoreImpl) GetProviderData(siteID string) (ProviderData, bool) {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return ProviderData{}, false
	}
	return entry.Provider, true
}

func (s *siteDataStoreImpl) GetBlockedKeywords(siteID string) []string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Provider.BlockedTitleKeywords
}

func (s *siteDataStoreImpl) GetBlockedCategories(siteID string) []string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Provider.BlockedCategories
}

func (s *siteDataStoreImpl) GetBlockedProtagonists(siteID string) []string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return nil
	}
	return entry.Provider.BlockedProtagonists
}

func (s *siteDataStoreImpl) IsBlockedProtagonistsEnabled(siteID string) bool {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return false
	}
	return entry.Provider.BlockedProtagonistsEnabled
}

// GetPublisherURL returns the site page that lists its current domains.
func (s *siteDataStoreImpl) GetPublisherURL(siteID string) string {
	entry, ok := s.getEntry(siteID)
	if !ok {
		return ""
	}
	return entry.Provider.PublisherURL
}

// CanHandle checks whether a URL belongs to the given site by
// matching its hostname against the site's configured domain list.
// Subdomain suffix matching is supported so that "www.example.com"
// matches a configured domain of "example.com".
func (s *siteDataStoreImpl) CanHandle(siteID string, rawURL string) bool {
	domains := s.GetDomains(siteID)
	if len(domains) == 0 {
		return false
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	hostname := strings.ToLower(parsed.Hostname())
	for _, domain := range domains {
		d, err := url.Parse(domain)
		if err != nil {
			continue
		}
		targetHost := strings.ToLower(d.Hostname())
		if hostname == targetHost || strings.HasSuffix(hostname, "."+targetHost) {
			return true
		}
	}
	return false
}

var (
	dataStoreOnce sync.Once
	dataStoreInst SiteDataStore
)

// GetSiteDataStore returns the singleton SiteDataStore, initializing
// it from the embedded JSON on first access.
func GetSiteDataStore() SiteDataStore {
	dataStoreOnce.Do(func() {
		dataStoreInst = NewSiteDataStore()
	})
	return dataStoreInst
}
