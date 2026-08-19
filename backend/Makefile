.PHONY: build test test-coverage test-short lint migrate run dev dev-cli clean tidy mock

APP_NAME := puchipix-server
CLI_NAME := puchipix-cli

# ── Development mode (recommended for daily use) ──
# Hot reload: auto-rebuild and restart server on .go file changes
# Build artifacts are placed in .tmp/ to keep the workspace clean
dev:
	air

# Run CLI directly (no need to build exe)
dev-cli:
	go run -buildvcs=false ./cmd/cli $(ARGS)

# Run server directly (no hot reload, suitable for quick testing)
run:
	go run -buildvcs=false ./cmd/server

# ── Build mode (use only for release/deployment) ──
# Artifacts are output to .tmp/ directory
build:
	go build -buildvcs=false -o .tmp/$(APP_NAME) ./cmd/server
	go build -buildvcs=false -o .tmp/$(CLI_NAME) ./cmd/cli

test:
	go test -v -race ./...

test-short:
	go test -v -race -short ./...

lint:
	go vet ./...
	go run -buildvcs=false honnef.co/go/tools/cmd/staticcheck@latest -checks=U1000 ./...

clean:
	rm -rf .tmp

test-coverage:
	go test -race -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

mock:
	go generate ./...

tidy:
	go mod tidy
