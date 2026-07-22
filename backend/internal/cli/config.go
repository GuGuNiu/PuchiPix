package cli

import (
	"os"
	"strings"
)

// Config holds the parsed global CLI options shared by all commands.
type Config struct {
	Host    string
	Port    string
	BaseURL string
	JSON    bool
	ShowHelp bool
}

// ParseGlobalOptions extracts global flags from args and returns the
// remaining positional arguments, mirroring the TypeScript
// parseGlobalOptions function.
func ParseGlobalOptions(args []string) (Config, []string) {
	host := os.Getenv("PUCHIPIX_HOST")
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv("PUCHIPIX_PORT")
	if port == "" {
		port = "10540"
	}

	cfg := Config{Host: host, Port: port}
	var remaining []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--host" && i+1 < len(args):
			i++
			cfg.Host = args[i]
		case arg == "--port" && i+1 < len(args):
			i++
			cfg.Port = args[i]
		case arg == "--json":
			cfg.JSON = true
		case arg == "-h" || arg == "--help":
			cfg.ShowHelp = true
		case strings.HasPrefix(arg, "--host="):
			cfg.Host = strings.TrimPrefix(arg, "--host=")
		case strings.HasPrefix(arg, "--port="):
			cfg.Port = strings.TrimPrefix(arg, "--port=")
		default:
			remaining = append(remaining, arg)
		}
	}

	cfg.BaseURL = "http://" + cfg.Host + ":" + cfg.Port
	return cfg, remaining
}

// ExtractFlag returns the value of a named flag from args, supporting
// both --flag value and --flag=value syntaxes, with an optional default.
func ExtractFlag(args []string, flag, def string) string {
	prefix := flag + "="
	for _, a := range args {
		if strings.HasPrefix(a, prefix) {
			return strings.TrimPrefix(a, prefix)
		}
	}
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
	}
	return def
}
