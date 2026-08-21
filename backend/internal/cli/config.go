package cli

import (
	"os"
	"strings"

	"backend/internal/db/dbconfig"
)

type Config struct {
	Host    string
	Port    string
	BaseURL string
	DBPath  string
	JSON    bool
	ShowHelp bool
}

func ParseGlobalOptions(args []string) (Config, []string) {
	host := os.Getenv("PUCHIPIX_HOST")
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv("PUCHIPIX_PORT")
	if port == "" {
		port = "10540"
	}
	dbPath := os.Getenv("PUCHIPIX_DB_PATH")
	if dbPath == "" {
		dbPath = dbconfig.DefaultDBPath
	}

	cfg := Config{Host: host, Port: port, DBPath: dbPath}
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
		case arg == "--db-path" && i+1 < len(args):
			i++
			cfg.DBPath = args[i]
		case arg == "--json":
			cfg.JSON = true
		case arg == "-h" || arg == "--help":
			cfg.ShowHelp = true
		case strings.HasPrefix(arg, "--host="):
			cfg.Host = strings.TrimPrefix(arg, "--host=")
		case strings.HasPrefix(arg, "--port="):
			cfg.Port = strings.TrimPrefix(arg, "--port=")
		case strings.HasPrefix(arg, "--db-path="):
			cfg.DBPath = strings.TrimPrefix(arg, "--db-path=")
		default:
			remaining = append(remaining, arg)
		}
	}

	cfg.BaseURL = "http://" + cfg.Host + ":" + cfg.Port
	return cfg, remaining
}
