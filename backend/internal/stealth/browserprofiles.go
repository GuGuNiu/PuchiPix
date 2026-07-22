package stealth

import (
	"math/rand"
	"net/http"
	"strconv"
	"strings"
)

// BrowserType identifies the browser family for a profile.
type BrowserType string

const (
	BrowserChrome  BrowserType = "chrome"
	BrowserFirefox BrowserType = "firefox"
	BrowserSafari  BrowserType = "safari"
	BrowserEdge    BrowserType = "edge"
)

// Platform identifies the operating system for a profile.
type Platform string

const (
	PlatformWindows Platform = "windows"
	PlatformMacOS   Platform = "macos"
	PlatformLinux   Platform = "linux"
	PlatformAndroid Platform = "android"
	PlatformIOS     Platform = "ios"
)

// BrowserProfile carries the full identity used to construct stealth
// HTTP headers and browser context configurations.
type BrowserProfile struct {
	UA                 string
	Browser            BrowserType
	Platform           Platform
	SecChUa            string
	SecChUaMobile      string
	SecChUaPlatform    string
	Accept             string
	AcceptEncoding     string
	ViewportWidth      int
	ViewportHeight     int
	HardwareConcurrency int
	DeviceMemory       int
	NavigatorPlatform  string
	Vendor             string
	MaxTouchPoints     int
}

const defaultAcceptLanguage = "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7"

const (
	chromeAccept    = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"
	firefoxAccept   = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
	safariAccept    = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
	chromeEncoding  = "gzip, deflate, br, zstd"
	firefoxEncoding = "gzip, deflate, br"
	safariEncoding  = "gzip, deflate, br"
)

var chromeBrands = map[int]string{
	120: `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
	121: `"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"`,
	122: `"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"`,
	123: `"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"`,
	124: `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`,
	125: `"Not.A/Brand";v="24", "Google Chrome";v="125", "Chromium";v="125"`,
	126: `"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"`,
}

var edgeBrands = map[int]string{
	120: `"Not_A Brand";v="8", "Chromium";v="120", "Microsoft Edge";v="120"`,
	121: `"Not A(Brand";v="99", "Microsoft Edge";v="121", "Chromium";v="121"`,
	122: `"Chromium";v="122", "Not(A:Brand";v="24", "Microsoft Edge";v="122"`,
	123: `"Microsoft Edge";v="123", "Not:A-Brand";v="8", "Chromium";v="123"`,
	124: `"Chromium";v="124", "Microsoft Edge";v="124", "Not-A.Brand";v="99"`,
	125: `"Not.A/Brand";v="24", "Microsoft Edge";v="125", "Chromium";v="125"`,
	126: `"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"`,
}

var navPlatforms = map[Platform]string{
	PlatformWindows: "Win32",
	PlatformMacOS:   "MacIntel",
	PlatformLinux:   "Linux x86_64",
	PlatformAndroid: "Linux armv8l",
	PlatformIOS:     "iPhone",
}

var vendors = map[BrowserType]string{
	BrowserChrome:  "Google Inc.",
	BrowserEdge:    "Google Inc.",
	BrowserFirefox: "",
	BrowserSafari:  "Apple Computer, Inc.",
}

type profileEntry struct {
	Browser    BrowserType
	Platform   Platform
	Major      int
	Full       string
	VP         [2]int
	HW         int
	Mem        int
	Device     string
	AndroidVer int
	EdgePatch  string
}

func genProfile(entry profileEntry) BrowserProfile {
	browser := entry.Browser
	platform := entry.Platform
	major := entry.Major
	full := entry.Full

	vpW, vpH := 1920, 1080
	if entry.VP[0] > 0 {
		vpW, vpH = entry.VP[0], entry.VP[1]
	}
	hw := entry.HW
	if hw == 0 {
		hw = 8
	}
	mem := entry.Mem
	if mem == 0 {
		mem = 8
	}
	maxTouch := 0
	isMobile := platform == PlatformAndroid || platform == PlatformIOS

	var ua, secChUa, accept, acceptEncoding string

	switch browser {
	case BrowserChrome:
		accept = chromeAccept
		acceptEncoding = chromeEncoding
		secChUa = chromeBrands[major]
		if platform == PlatformAndroid {
			dev := entry.Device
			if dev == "" {
				dev = "Pixel 8"
			}
			av := entry.AndroidVer
			if av == 0 {
				av = 14
			}
			ua = "Mozilla/5.0 (Linux; Android " + itoa(av) + "; " + dev + ") AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + full + " Mobile Safari/537.36"
			if entry.VP[0] == 0 {
				vpW, vpH = 412, 915
			}
			maxTouch = 5
		} else if platform == PlatformWindows {
			ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + full + " Safari/537.36"
		} else if platform == PlatformMacOS {
			ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + full + " Safari/537.36"
		} else if platform == PlatformLinux {
			ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + full + " Safari/537.36"
		}

	case BrowserFirefox:
		accept = firefoxAccept
		acceptEncoding = firefoxEncoding
		if platform == PlatformWindows {
			ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:" + itoa(major) + ".0) Gecko/20100101 Firefox/" + itoa(major) + ".0"
		} else if platform == PlatformMacOS {
			ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:" + itoa(major) + ".0) Gecko/20100101 Firefox/" + itoa(major) + ".0"
		} else if platform == PlatformLinux {
			ua = "Mozilla/5.0 (X11; Linux x86_64; rv:" + itoa(major) + ".0) Gecko/20100101 Firefox/" + itoa(major) + ".0"
		}

	case BrowserSafari:
		accept = safariAccept
		acceptEncoding = safariEncoding
		if platform == PlatformMacOS {
			ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/" + full + " Safari/605.1.15"
		} else if platform == PlatformIOS {
			iosVer := strings.ReplaceAll(full, ".", "_")
			ua = "Mozilla/5.0 (iPhone; CPU iPhone OS " + iosVer + " like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/" + full + " Mobile/15E148 Safari/604.1"
			if entry.VP[0] == 0 {
				vpW, vpH = 390, 844
			}
			maxTouch = 5
		}

	case BrowserEdge:
		accept = chromeAccept
		acceptEncoding = chromeEncoding
		secChUa = edgeBrands[major]
		edgePatch := entry.EdgePatch
		if edgePatch == "" {
			edgePatch = "2592.81"
		}
		edgeFull := itoa(major) + ".0." + edgePatch
		if platform == PlatformWindows {
			ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + full + " Safari/537.36 Edg/" + edgeFull
		} else if platform == PlatformMacOS {
			ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + full + " Safari/537.36 Edg/" + edgeFull
		}
	}

	platformStr := string(platform)
	if len(platformStr) > 0 {
		platformStr = strings.ToUpper(platformStr[:1]) + platformStr[1:]
	}
	platformCapitalized := platformStr

	return BrowserProfile{
		UA:                 ua,
		Browser:            browser,
		Platform:           platform,
		SecChUa:            secChUa,
		SecChUaMobile:      boolToStr(isMobile, "?1", "?0"),
		SecChUaPlatform:    `"` + platformCapitalized + `"`,
		Accept:             accept,
		AcceptEncoding:     acceptEncoding,
		ViewportWidth:      vpW,
		ViewportHeight:     vpH,
		HardwareConcurrency: hw,
		DeviceMemory:       mem,
		NavigatorPlatform:  navPlatforms[platform],
		Vendor:             vendors[browser],
		MaxTouchPoints:     maxTouch,
	}
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

func boolToStr(b bool, trueVal, falseVal string) string {
	if b {
		return trueVal
	}
	return falseVal
}

func init() {
	profiles := []profileEntry{
		{Browser: BrowserChrome, Platform: PlatformWindows, Major: 126, Full: "126.0.6478.126"},
		{Browser: BrowserChrome, Platform: PlatformWindows, Major: 125, Full: "125.0.6422.142", VP: [2]int{1366, 768}, HW: 4, Mem: 4},
		{Browser: BrowserChrome, Platform: PlatformMacOS, Major: 126, Full: "126.0.6478.126"},
		{Browser: BrowserChrome, Platform: PlatformLinux, Major: 126, Full: "126.0.6478.126"},
		{Browser: BrowserChrome, Platform: PlatformAndroid, Major: 126, Full: "126.0.6478.126", Device: "Pixel 8", AndroidVer: 14},
		{Browser: BrowserFirefox, Platform: PlatformWindows, Major: 127, Full: "127.0"},
		{Browser: BrowserFirefox, Platform: PlatformLinux, Major: 127, Full: "127.0"},
		{Browser: BrowserEdge, Platform: PlatformWindows, Major: 126, Full: "126.0.6478.126", EdgePatch: "2592.81"},
		{Browser: BrowserSafari, Platform: PlatformMacOS, Major: 0, Full: "17.5"},
		{Browser: BrowserSafari, Platform: PlatformIOS, Major: 0, Full: "17.5", VP: [2]int{390, 844}},
	}

	for _, e := range profiles {
		browserProfiles = append(browserProfiles, genProfile(e))
	}
}

var browserProfiles []BrowserProfile

// GetAllProfiles returns all generated browser profiles.
func GetAllProfiles() []BrowserProfile {
	return browserProfiles
}

// RandomProfile returns a random browser profile for stealth requests.
func RandomProfile() BrowserProfile {
	if len(browserProfiles) == 0 {
		return BrowserProfile{
			UA:             "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Safari/537.36",
			Browser:        BrowserChrome,
			Platform:       PlatformWindows,
			Accept:         chromeAccept,
			AcceptEncoding: chromeEncoding,
			SecChUa:        chromeBrands[126],
			SecChUaMobile:  "?0",
			SecChUaPlatform: `"Windows"`,
			ViewportWidth:  1920,
			ViewportHeight: 1080,
			HardwareConcurrency: 8,
			DeviceMemory:   8,
			NavigatorPlatform: "Win32",
			Vendor:         "Google Inc.",
		}
	}
	return browserProfiles[rand.Intn(len(browserProfiles))]
}

// RandomUA returns a random User-Agent string.
func RandomUA() string {
	return RandomProfile().UA
}

// BuildStealthHeaders constructs HTTP headers that mimic a real browser,
// reducing the chance of being blocked by basic anti-crawler checks.
func BuildStealthHeaders(profile BrowserProfile, referer string) http.Header {
	if profile.UA == "" {
		profile = RandomProfile()
	}
	h := http.Header{}
	h.Set("User-Agent", profile.UA)
	h.Set("Accept", profile.Accept)
	h.Set("Accept-Encoding", profile.AcceptEncoding)
	h.Set("Accept-Language", defaultAcceptLanguage)
	h.Set("Connection", "keep-alive")

	if profile.SecChUa != "" {
		h.Set("sec-ch-ua", profile.SecChUa)
		h.Set("sec-ch-ua-mobile", profile.SecChUaMobile)
		h.Set("sec-ch-ua-platform", profile.SecChUaPlatform)
	}

	if profile.Browser == BrowserChrome || profile.Browser == BrowserEdge || profile.Browser == BrowserFirefox {
		h.Set("sec-fetch-dest", "document")
		h.Set("sec-fetch-mode", "navigate")
		h.Set("sec-fetch-site", "none")
		h.Set("sec-fetch-user", "?1")
		h.Set("upgrade-insecure-requests", "1")
	} else if profile.Browser == BrowserSafari {
		h.Set("upgrade-insecure-requests", "1")
	}

	if referer != "" {
		h.Set("Referer", referer)
	}

	return h
}
