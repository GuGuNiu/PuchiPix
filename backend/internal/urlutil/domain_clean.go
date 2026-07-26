package urlutil

import (
	"net/url"
	"strings"
)

// domainCleanerRE defines patterns used for domain normalization, applied
// in order during CleanDomain's multi-pass processing.
var domainCleanerRE = &domainCleanerPatterns{
	wwwPrefix: "www.",
}

type domainCleanerPatterns struct {
	wwwPrefix string
}

// CleanDomain normalizes a domain name by applying successive
// transformation passes, each removing a layer of syntactic noise.
// The resulting "core domain" strips common prefixes (www.) while
// preserving the TLD and path structure so that downstream matching
// (URL dedup, task signature) treats mirror domains as equivalent.
//
// Pass order:
//  1. Lowercase (case-insensitive matching)
//  2. Strip "www." prefix (canonical form)
//  3. Extract hostname from URL
//
// Examples:
//
//	https://www.LoveCutes.net/article/123 → lovecutes.net
//	https://lovecutes.com/article/123       → lovecutes.com
//	https://xx.knit.bid/article/123         → xx.knit.bid
func CleanDomain(raw string) string {
	if raw == "" {
		return ""
	}

	// Pass 1: lowercase the entire input.
	cleaned := strings.ToLower(raw)

	// Pass 2: parse as URL to extract hostname.
	if u, err := url.Parse(cleaned); err == nil && u.Hostname() != "" {
		cleaned = u.Hostname()
	}

	// Pass 3: strip www. prefix.
	cleaned = strings.TrimPrefix(cleaned, domainCleanerRE.wwwPrefix)

	return cleaned
}

// ExtractDomainGroupSignature computes a shared substring from a set
// of domain names that represents their common identity. This is used
// to determine whether two domains with different TLDs or prefixes
// (e.g. lovecutes.com vs lovecutes.net vs www.lovecutes.com) refer
// to the same site.
//
// Algorithm:
//  1. Clean each domain via CleanDomain.
//  2. Find the longest common substring across all cleaned domains.
//  3. The common substring is the "domain group signature".
//
// Returns empty string when fewer than 2 domains are provided or no
// common substring is found.
//
// Examples:
//
//	["lovecutes.com", "lovecutes.net", "www.lovecutes.net"]
//	  → cleaned: ["lovecutes.com", "lovecutes.net", "lovecutes.net"]
//	  → common: "lovecutes."
//
//	["sjs66.com", "sjs96.com", "sjs47.com"]
//	  → cleaned: ["sjs66.com", "sjs96.com", "sjs47.com"]
//	  → common: "sjs"
func ExtractDomainGroupSignature(domains []string) string {
	if len(domains) < 2 {
		return ""
	}

	// Clean all domains first.
	cleaned := make([]string, len(domains))
	for i, d := range domains {
		cleaned[i] = CleanDomain(d)
	}

	// Use the shortest cleaned domain as the search key for common prefix
	// extraction. Different domains within a group typically share a
	// common prefix (e.g. "lovecutes" in "lovecutes.com"/"lovecutes.net")
	// but may have entirely different suffixes.
	shortest := cleaned[0]
	for _, c := range cleaned[1:] {
		if len(c) < len(shortest) {
			shortest = c
		}
	}

	// Extract the longest prefix that all domains share.
	common := findLongestCommonPrefix(cleaned, shortest)

	return common
}

// findLongestCommonPrefix finds the longest prefix that appears in all
// strings within the slice.
func findLongestCommonPrefix(items []string, shortest string) string {
	for prefixLen := len(shortest); prefixLen > 0; prefixLen-- {
		prefix := shortest[:prefixLen]
		allMatch := true
		for _, item := range items {
			if !strings.HasPrefix(item, prefix) {
				allMatch = false
				break
			}
		}
		if allMatch {
			return prefix
		}
	}
	return ""
}

// AreDomainsEquivalent reports whether two domain names refer to the
// same site, using domain group matching from the configured mirror
// domain map and fallback prefix-based comparison.
func AreDomainsEquivalent(a, b string, groupDomains map[string][]string) bool {
	ca := CleanDomain(a)
	cb := CleanDomain(b)
	if ca == cb {
		return true
	}

	// Check mirror domain map: if a maps to b's mirrors or vice versa.
	if mirrors, ok := groupDomains[a]; ok {
		for _, m := range mirrors {
			if CleanDomain(m) == cb {
				return true
			}
		}
	}
	if mirrors, ok := groupDomains[b]; ok {
		for _, m := range mirrors {
			if CleanDomain(m) == ca {
				return true
			}
		}
	}

	return false
}

// GroupDomainsBySignature partitions a slice of domain names into
// groups where all members share a common prefix signature. This is
// useful for auto-discovering mirror relationships without manual
// configuration.
//
// Example:
//
//	Input:  ["lovecutes.com", "lovecutes.net", "sjs66.com", "sjs96.com"]
//	Output: {"lovecutes": ["lovecutes.com","lovecutes.net"], "sjs": ["sjs66.com","sjs96.com"]}
func GroupDomainsBySignature(domains []string) map[string][]string {
	if len(domains) < 2 {
		return nil
	}

	// Build all pairs and find common signatures.
	groups := make(map[string][]string)
	assigned := make(map[string]bool)

	for i := 0; i < len(domains); i++ {
		if assigned[domains[i]] {
			continue
		}
		ci := CleanDomain(domains[i])

		for j := i + 1; j < len(domains); j++ {
			if assigned[domains[j]] {
				continue
			}
			cj := CleanDomain(domains[j])

			sig := findLongestCommonPrefix([]string{ci, cj}, shortest(ci, cj))
			if len(sig) >= 3 { // minimum 3 chars for a meaningful signature
				if _, exists := groups[sig]; !exists {
					groups[sig] = []string{domains[i], domains[j]}
					assigned[domains[i]] = true
					assigned[domains[j]] = true
				} else {
					// Add to existing group if signature matches.
					groups[sig] = append(groups[sig], domains[j])
					assigned[domains[j]] = true
				}
			}
		}
	}

	if len(groups) == 0 {
		return nil
	}
	return groups
}

func shortest(a, b string) string {
	if len(a) < len(b) {
		return a
	}
	return b
}
