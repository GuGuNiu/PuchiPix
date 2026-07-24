// cmd/pg-wipe 清空 PostgreSQL 数据库的全部数据。
//
// 执行步骤：
//  1. 终止所有残留的 postgres.exe / pg_ctl.exe 进程（孤儿进程清理）
//  2. 删除 data/postgres/data/ 目录（擦除全部数据库文件）
//  3. 保留 data/postgres/bin/（PG 二进制，重启需要）
//  4. 保留 data/galleries/（已下载的图片/视频）
//  5. 保留 backend/resources/（预置 JSON，重建时 seed 用）
//
// 清空后恢复步骤：
//   cd backend
//   go run ./cmd/server        # 启动会自动初始化新的空 PG 实例
//   # 另开终端：
//   go run ./cmd/migrate        # 重建全部表结构（CREATE TABLE IF NOT EXISTS + TRUNCATE）
//   go run ./cmd/pg-setup       # 重新 seed 预置模特/角色数据
//
// 用法: cd backend && go run ./cmd/pg-wipe/
package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

func main() {
	projectRoot := resolveProjectRoot()
	pgDataPath := filepath.Join(projectRoot, "data", "postgres", "data")
	pgBinPath := filepath.Join(projectRoot, "data", "postgres", "bin")
	galleriesPath := filepath.Join(projectRoot, "data", "galleries")

	fmt.Println("╔══════════════════════════════════════════════════════════╗")
	fmt.Println("║          PuchiPix 数据库清空工具 (pg-wipe)               ║")
	fmt.Println("╚══════════════════════════════════════════════════════════╝")
	fmt.Println()

	// ── 确认路径 ──
	fmt.Println("【路径确认】")
	fmt.Printf("  PG 数据目录 (将删除): %s\n", pgDataPath)
	fmt.Printf("  PG 二进制 (将保留):   %s\n", pgBinPath)
	fmt.Printf("  下载文件   (将保留):   %s\n", galleriesPath)
	fmt.Println()

	// 安全检查：确保不会误删
	if !dirExists(pgBinPath) {
		fmt.Fprintf(os.Stderr, "FATAL: PG 二进制目录不存在: %s\n", pgBinPath)
		fmt.Fprintln(os.Stderr, "拒绝执行：避免误删项目根目录。请确认从 backend/ 目录运行。")
		os.Exit(1)
	}
	if !dirExists(pgDataPath) {
		fmt.Fprintf(os.Stderr, "WARN: PG 数据目录不存在: %s（可能已清空）\n", pgDataPath)
	}

	// ── Step 1: 终止孤儿 postgres.exe 进程 ──
	fmt.Println("【Step 1】终止残留 PostgreSQL 进程...")
	killPostgresProcesses()
	time.Sleep(3 * time.Second) // 等待端口释放
	fmt.Println("  ✓ 进程清理完成")
	fmt.Println()

	// ── Step 2: 删除 PG 数据目录 ──
	fmt.Println("【Step 2】删除 PG 数据目录...")
	if dirExists(pgDataPath) {
		if err := os.RemoveAll(pgDataPath); err != nil {
			fmt.Fprintf(os.Stderr, "  ✗ 删除失败: %v\n", err)
			fmt.Fprintln(os.Stderr, "  可能原因：进程仍持有文件锁。请手动在任务管理器结束所有 postgres.exe 后重试。")
			os.Exit(1)
		}
		fmt.Printf("  ✓ 已删除: %s\n", pgDataPath)
	} else {
		fmt.Println("  ⚠ 目录已不存在，跳过")
	}
	fmt.Println()

	// ── Step 3: 验证保留项 ──
	fmt.Println("【Step 3】验证保留项完整性...")
	if dirExists(pgBinPath) {
		fmt.Printf("  ✓ PG 二进制保留: %s\n", pgBinPath)
	} else {
		fmt.Fprintf(os.Stderr, "  ✗ 警告: PG 二进制目录缺失！\n")
	}
	if dirExists(galleriesPath) {
		count := countDirEntries(galleriesPath)
		fmt.Printf("  ✓ 下载文件保留: %s (%d 个子目录)\n", galleriesPath, count)
	} else {
		fmt.Println("  ℹ 无 galleries 目录（可能从未下载过）")
	}
	fmt.Println()

	// ── 完成 ──
	fmt.Println("╔══════════════════════════════════════════════════════════╗")
	fmt.Println("║                    ✅ 清空完成                           ║")
	fmt.Println("╚══════════════════════════════════════════════════════════╝")
	fmt.Println()
	fmt.Println("【恢复步骤】请在 backend/ 目录下依次执行：")
	fmt.Println()
	fmt.Println("  1. 启动服务器（自动初始化新的空 PG 实例）:")
	fmt.Println("     go run ./cmd/server")
	fmt.Println()
	fmt.Println("  2. 另开终端，重建全部表结构:")
	fmt.Println("     go run ./cmd/migrate")
	fmt.Println()
	fmt.Println("  3. 重新 seed 预置模特/角色数据:")
	fmt.Println("     go run ./cmd/pg-setup")
	fmt.Println()
	fmt.Println("  4. 启动后即可从零开始抓取新图集")
}

// killPostgresProcesses 终止所有 postgres.exe 和 pg_ctl.exe 进程。
func killPostgresProcesses() {
	if runtime.GOOS == "windows" {
		// taskkill /F /IM 强制终止指定名称的进程
		for _, procName := range []string{"pg_ctl.exe", "postgres.exe"} {
			cmd := exec.Command("taskkill", "/F", "/IM", procName, "/T")
			output, err := cmd.CombinedOutput()
			if err != nil {
				// 进程不存在是正常情况
				fmt.Printf("  %s: %s\n", procName, string(output))
			} else {
				fmt.Printf("  ✓ 已终止 %s\n", procName)
			}
		}
	} else {
		// Linux/macOS: pkill
		for _, procName := range []string{"pg_ctl", "postgres"} {
			cmd := exec.Command("pkill", "-f", procName)
			_ = cmd.Run()
			fmt.Printf("  ✓ 已终止 %s\n", procName)
		}
	}
}

func resolveProjectRoot() string {
	// 从 backend/cmd/pg-wipe/ 向上三级到项目根
	dir, _ := os.Getwd()
	for i := 0; i < 5; i++ {
		if dirExists(filepath.Join(dir, "data", "postgres")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// 默认：假设从 backend/ 运行，项目根是上一级
	dir, _ = os.Getwd()
	return filepath.Dir(dir)
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func countDirEntries(path string) int {
	entries, err := os.ReadDir(path)
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() {
			count++
		}
	}
	return count
}
