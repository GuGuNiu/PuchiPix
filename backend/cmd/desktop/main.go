package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wopts "github.com/wailsapp/wails/v2/pkg/options/windows"

	"backend/internal/app"
	"backend/internal/config"
	"backend/internal/infra"
	"backend/internal/webui"
)

const singleInstanceID = "puchipix-desktop-single-instance"

// earlyLockName guards startup, before the database is opened. It is
// deliberately distinct from the identifier handed to Wails, which only takes
// effect once the runtime boots.
const earlyLockName = "Global\\PuchiPixDesktopStartupLock"

func main() {
	// Claim the startup lock before anything touches the database. Wails only
	// takes its own lock inside wails.Run, which would let a second launch
	// open the SQLite file and start the scheduler before being rejected.
	release, acquired := earlyInstanceLock(earlyLockName)
	if !acquired {
		// A primary instance owns the startup lock. Raise its window, then
		// leave without touching the database.
		focusExistingInstance(singleInstanceID)
		return
	}
	defer release()

	dataDir, err := resolveDataDir()
	if err != nil {
		fatal("resolve data directory", err)
	}
	if err := injectEnv(dataDir); err != nil {
		fatal("configure environment", err)
	}

	cfg, err := config.Load()
	if err != nil {
		fatal("load config", err)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		fatal("reserve loopback port", err)
	}
	origin := "http://" + ln.Addr().String()

	application, err := app.New(app.Options{
		Config: cfg,
		Dev:    false,
		Assets: webui.Handler(),
	})
	if err != nil {
		ln.Close()
		fatal("initialize application", err)
	}
	logger := application.Logger()

	srv := &http.Server{
		Handler: application.Router(),
		// WriteTimeout must stay zero: SSE responses are long-lived and a
		// write deadline would sever every progress stream mid-download.
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0,
		IdleTimeout:  120 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("Desktop HTTP server listening", "origin", origin, "dataDir", dataDir)
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			serveErr <- err
		}
		close(serveErr)
	}()

	shutdownDone := make(chan struct{})
	var shutdownOnce bool

	shutdown := func() {
		if shutdownOnce {
			return
		}
		shutdownOnce = true

		go func() {
			defer close(shutdownDone)

			logger.Info("Desktop shutdown requested")

			shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := srv.Shutdown(shutdownCtx); err != nil {
				logger.Error("Desktop HTTP server forced to shutdown", err)
			}

			application.Shutdown()
		}()
	}

	err = wails.Run(&options.App{
		Title:  "PuchiPix",
		Width:  1440,
		Height: 900,
		MinWidth:  1024,
		MinHeight: 640,
		// The window is pointed at the backend origin rather than at the
		// Wails asset server. Serving the UI from the same origin as the API
		// keeps every frontend request a relative /api call, and avoiding the
		// asset-server reverse proxy is what preserves true streaming for the
		// SSE endpoints: a proxied EventSource would be subject to response
		// buffering and would need an explicit flush interval to behave.
		AssetServer: &assetserver.Options{
			Handler: redirectHandler(origin),
		},
		BindingsAllowedOrigins: origin + ",",
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: singleInstanceID,
			OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
				logger.Info("Second instance launch detected, focusing existing window")
			},
		},
		Windows: &wopts.Options{
			WebviewUserDataPath: filepath.Join(dataDir, "webview"),
			Theme:               wopts.SystemDefault,
		},
		OnStartup: func(ctx context.Context) {
			logger.Info("Desktop UI ready", "origin", origin)
		},
		OnShutdown: func(ctx context.Context) {
			shutdown()
			select {
			case <-shutdownDone:
			case <-time.After(30 * time.Second):
				logger.Warn("Desktop shutdown timed out, exiting anyway")
			}
		},
	})
	if err != nil {
		shutdown()
		<-shutdownDone
		fmt.Fprintf(os.Stderr, "desktop runtime error: %v\n", err)
		os.Exit(1)
	}

	shutdown()
	<-shutdownDone

	select {
	case serveErr, ok := <-serveErr:
		if ok && serveErr != nil {
			logger.Error("Desktop HTTP server error", serveErr)
		}
	default:
	}
}

// redirectHandler sends the WebView to the backend origin. The asset server
// is used purely as a launchpad: the first navigation leaves the
// wails:// scheme, and from then on the WebView talks to the HTTP server
// directly, so no asset-server hop sits between the UI and the API.
func redirectHandler(origin string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			http.Redirect(w, r, origin+"/", http.StatusFound)
			return
		}
		http.NotFound(w, r)
	})
}

// resolveDataDir returns %APPDATA%\PuchiPix, creating it on first run. The
// desktop shell injects the path into the environment rather than teaching
// config.Load about desktop mode, so server mode keeps its own resolution.
func resolveDataDir() (string, error) {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		return "", fmt.Errorf("APPDATA is not set")
	}
	dir := filepath.Join(appData, "PuchiPix")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func injectEnv(dataDir string) error {
	if err := os.Setenv("DATA_DIR", dataDir); err != nil {
		return err
	}
	if err := os.Setenv("DB_PATH", filepath.Join(dataDir, "puchipix.db")); err != nil {
		return err
	}
	// The desktop binary is always a production build; GO_ENV gates both the
	// log level and the dev-only pprof listener.
	return os.Setenv("GO_ENV", "production")
}

func fatal(stage string, err error) {
	infra.NewLogger("Desktop").Error("Desktop startup failed: "+stage, err)
	fmt.Fprintf(os.Stderr, "PuchiPix failed to start (%s): %v\n", stage, err)
	os.Exit(1)
}