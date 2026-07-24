.PHONY: build test test-coverage test-short lint migrate run clean tidy mock

APP_NAME := puchipix-server
CLI_NAME := puchipix-cli
BUILD_DIR := bin

build:
	go build -o $(BUILD_DIR)/$(APP_NAME) ./cmd/server
	go build -o $(BUILD_DIR)/$(CLI_NAME) ./cmd/cli

test:
	go test -v -race ./...

test-short:
	go test -v -race -short ./...

lint:
	go vet ./...

# SQLite → PostgreSQL data migration (one-time, idempotent)
migrate:
	go run ./cmd/migrate

run:
	go run ./cmd/server

clean:
	rm -rf $(BUILD_DIR)

test-coverage:
	go test -race -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

mock:
	go generate ./...

tidy:
	go mod tidy
