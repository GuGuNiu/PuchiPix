.PHONY: build test test-coverage test-short lint migrate run dev dev-cli clean tidy mock

APP_NAME := puchipix-server
CLI_NAME := puchipix-cli
BUILD_DIR := bin

# ── 开发模式 (推荐日常使用) ──
# 热重载: 修改 .go 文件后自动重新编译并重启服务器
dev:
	air

# 直接运行 CLI (无需构建 exe)
dev-cli:
	go run -buildvcs=false ./cmd/cli $(ARGS)

# 直接运行 server (无热重载, 适合快速验证)
run:
	go run -buildvcs=false ./cmd/server

# ── 构建模式 (仅在需要发布时使用) ──
build:
	go build -buildvcs=false -o $(BUILD_DIR)/$(APP_NAME) ./cmd/server
	go build -buildvcs=false -o $(BUILD_DIR)/$(CLI_NAME) ./cmd/cli

test:
	go test -v -race ./...

test-short:
	go test -v -race -short ./...

lint:
	go vet ./...
	go run -buildvcs=false honnef.co/go/tools/cmd/staticcheck@latest -checks=U1000 ./...

clean:
	rm -rf $(BUILD_DIR)
	rm -rf .tmp

test-coverage:
	go test -race -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out

mock:
	go generate ./...

tidy:
	go mod tidy
