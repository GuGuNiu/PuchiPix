package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wopts "github.com/wailsapp/wails/v2/pkg/options/windows"

	"backend/cmd/desktop/window"
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

// windowCornerRadius is the rounded-corner radius (CSS pixels) the web shell
// applies to the window; it is published to the frontend through
// /api/window/state and can be tuned here without touching the web layer.
// The maximised window drops the radius on the frontend side.
const windowCornerRadius = 24

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
	// With -H=windowsgui the packaged exe has no console, so stdio output
	// would be lost; route it into a log file under the data directory.
	// Kept non-fatal: the app still runs if the log file cannot be opened.
	if err := setupDesktopLog(dataDir); err != nil {
		fmt.Fprintf(os.Stderr, "desktop log unavailable: %v\n", err)
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

	winCtrl := window.New(window.Options{CornerRadiusPx: windowCornerRadius})

	srv := &http.Server{
		Handler: mountWindowControl(winCtrl, application.Router()),
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

			// Short grace period: the WebView holds long-lived SSE connections
			// that never drain on their own, so a full drain would always hit
			// the deadline and add that latency to every close. Two seconds is
			// enough for in-flight normal requests, then force the rest.
			shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := srv.Shutdown(shutdownCtx); err != nil {
				logger.Info("Desktop HTTP server closing remaining connections", "reason", err.Error())
				if closeErr := srv.Close(); closeErr != nil {
					logger.Error("Desktop HTTP server close error", closeErr)
				}
			}

			application.Shutdown()
		}()
	}

	err = wails.Run(&options.App{
		Title:     "PuchiPix",
		Width:     1440,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 640,
		// The window draws its own title bar, so the system frame is removed.
		// The frontend serves the same document in browser mode and renders
		// the bar only when these endpoints answer.
		Frameless: true,
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
			// The web layer draws the shell's rounded corners, so the webview
			// itself must be a per-pixel alpha layer: without this the WebView2
			// paints an opaque rectangle behind the web content and the rounded
			// corners would show that solid backing instead of the desktop.
			WebviewIsTransparent: true,
			// WS_EX_NOREDIRECTIONBITMAP + DWMSBT_NONE: the DWM draws no system
			// backdrop (no Mica/Acrylic layer), so what is composited onto the
			// desktop is exactly the web layer's alpha — transparent pixels
			// stay transparent, with no extra layer in between.
			WindowIsTranslucent: true,
			BackdropType:        wopts.None,
			// Drop the frameless-window decorations (Aero shadow + the Win11
			// system corner rounding). The system rounds at a fixed ~8px which
			// would fight the web shell's own --window-radius parameter and
			// leave a visible system-drawn edge behind the transparent
			// corners; with decorations off, the web radius is the single
			// source of the shell's shape. Resize still works through Wails'
			// own frameless hit-testing.
			DisableFramelessWindowDecorations: true,
		},
		OnStartup: func(ctx context.Context) {
			winCtrl.Bind(ctx)
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

// mountWindowControl puts the window endpoints in front of the application
// router. The title bar is the only consumer, and keeping the two routers
// separate means the app package stays unaware of desktop windowing.
func mountWindowControl(ctrl *window.Controller, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/window/") {
			ctrl.Routes().ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
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

// setupDesktopLog gives every stdio writer — the infra logger, fmt output,
// and runtime panics — a file destination when the process has no console
// (the packaged windowsgui build). With a console attached (go run in a
// terminal) nothing is redirected and output stays on screen. The log keeps
// one previous generation, enough for a post-mortem of the last run without
// growing without bound.
func setupDesktopLog(dataDir string) error {
	logDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}
	logPath := filepath.Join(logDir, "desktop.log")
	if info, err := os.Stat(logPath); err == nil && info.Size() > 10<<20 {
		_ = os.Rename(logPath, logPath+".old")
	}
	if err := redirectStdio(logPath); err != nil {
		return err
	}
	// The std library logger captured os.Stderr at init time, before the
	// redirect; repoint it so e.g. http.Server error logging follows too.
	log.SetOutput(os.Stderr)
	fmt.Fprintf(os.Stdout, "=== PuchiPix desktop session %s ===\n", time.Now().Format(time.RFC3339))
	return nil
}

func fatal(stage string, err error) {
	infra.NewLogger("Desktop").Error("Desktop startup failed: "+stage, err)
	fmt.Fprintf(os.Stderr, "PuchiPix failed to start (%s): %v\n", stage, err)
	os.Exit(1)
}
