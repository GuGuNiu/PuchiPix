#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PuchiPix Launcher — 一键启动前后端
使用 PySide6 作为 GUI 界面，提供日志台和启动/停止/重启按钮

@date 2026-07-09
@lastModified 2026-07-10
"""

import sys
import os
import subprocess
import signal
import time
import socket
import webbrowser
import json
import urllib.request
from pathlib import Path

from PySide6.QtCore import Qt, QThread, Signal, QTimer
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QTextEdit, QStatusBar, QSystemTrayIcon,
    QMenu, QGroupBox
)
from PySide6.QtGui import (
    QAction, QFont, QTextCursor, QColor, QIcon, QPainter, QPixmap
)


# ============================================================
# 全局常量
# ============================================================

PROJECT_DIR = Path(__file__).resolve().parent
DEFAULT_PORT = 10540
APP_TITLE = "PuchiPix Launcher"
APP_VERSION = "1.1.0"

DARK_STYLESHEET = """
QMainWindow {
    background-color: #0d1117;
}

QWidget#central {
    background-color: #0d1117;
}

QWidget#toolbar {
    background-color: #161b22;
    border-bottom: 1px solid #30363d;
}

QLabel#toolbar_title {
    color: #e6edf3;
    font-size: 16px;
    font-weight: bold;
    padding-left: 4px;
}

QPushButton {
    background-color: #21262d;
    color: #c9d1d9;
    border: 1px solid #30363d;
    border-radius: 6px;
    padding: 7px 16px;
    font-size: 13px;
    font-weight: 600;
    min-width: 70px;
}
QPushButton:hover {
    background-color: #30363d;
    border-color: #8b949e;
}
QPushButton:pressed {
    background-color: #1c2128;
}
QPushButton:disabled {
    background-color: #161b22;
    color: #484f58;
    border-color: #21262d;
}

QPushButton#btn_start {
    background-color: #1a3a2e;
    color: #3fb950;
    border-color: #238636;
}
QPushButton#btn_start:hover {
    background-color: #238636;
    color: #ffffff;
}
QPushButton#btn_start:disabled {
    background-color: #161b22;
    color: #2ea04340;
    border-color: #23863630;
}

QPushButton#btn_stop {
    background-color: #3d1a1a;
    color: #f85149;
    border-color: #da3633;
}
QPushButton#btn_stop:hover {
    background-color: #da3633;
    color: #ffffff;
}
QPushButton#btn_stop:disabled {
    background-color: #161b22;
    color: #f8514940;
    border-color: #da363330;
}

QLabel#status_dot {
    font-size: 14px;
}

QLabel#status_text {
    color: #8b949e;
    font-size: 12px;
    font-weight: 600;
}

QGroupBox {
    color: #8b949e;
    border: 1px solid #30363d;
    border-radius: 6px;
    margin-top: 10px;
    padding-top: 14px;
    font-weight: bold;
    font-size: 12px;
}
QGroupBox::title {
    subcontrol-origin: margin;
    left: 10px;
    padding: 0 6px;
}

QTextEdit#log_view {
    background-color: #0d1117;
    color: #c9d1d9;
    border: 1px solid #30363d;
    border-radius: 4px;
    font-family: "Cascadia Code", "Consolas", "Courier New", monospace;
    font-size: 12px;
    padding: 4px;
}

QStatusBar {
    background-color: #161b22;
    color: #8b949e;
    border-top: 1px solid #30363d;
}
"""


# ============================================================
# 工具函数
# ============================================================

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def check_health(port: int, timeout: float = 2.0) -> bool:
    try:
        url = f"http://localhost:{port}/api/health"
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("status") == "ok"
    except Exception:
        pass
    return False


def find_pnpm() -> str | None:
    """
    查找 pnpm 可执行文件路径

    Windows 上 pnpm 通常安装为 pnpm.cmd，
    subprocess.Popen(shell=False) 无法直接执行 .cmd 文件，
    需要通过 shell=True 或直接使用 cmd /c 调用。

    @date 2026-07-10
    """
    import shutil
    return shutil.which("pnpm")


def find_npx() -> str | None:
    import shutil
    return shutil.which("npx")


# ============================================================
# 服务器进程管理线程
# ============================================================

class ServerThread(QThread):
    """
    后台线程管理 Node.js 服务器进程

    信号：
    - log_signal: 日志输出
    - status_signal: 状态变更（installing / starting / running / stopped / error）

    @date 2026-07-09
    @lastModified 2026-07-10
    """

    log_signal = Signal(str)
    status_signal = Signal(str)

    def __init__(self, project_dir: Path, port: int = DEFAULT_PORT):
        super().__init__()
        self.project_dir = project_dir
        self.port = port
        self.process: subprocess.Popen | None = None
        self._should_run = False

    def run(self):
        node_modules = self.project_dir / "node_modules"
        if not node_modules.exists():
            self.log_signal.emit("⚙ 未检测到 node_modules，正在执行 pnpm install ...")
            self.status_signal.emit("installing")
            ok = self._run_install()
            if not ok:
                self.status_signal.emit("error")
                return
            self.log_signal.emit("✓ 依赖安装完成")

        self.status_signal.emit("starting")
        self.log_signal.emit("🚀 正在启动 PuchiPix 服务器 ...")
        self._start_server()

    def _run_install(self) -> bool:
        """
        执行 pnpm install

        Windows 上 pnpm 是 .cmd 文件，必须用 shell=True

        @date 2026-07-10
        """
        pnpm = find_pnpm()
        if not pnpm:
            npx = find_npx()
            if npx:
                cmd = f'"{npx}" pnpm install'
            else:
                self.log_signal.emit("✗ 未找到 pnpm 或 npx，请先安装 Node.js 和 pnpm")
                return False
        else:
            cmd = f'"{pnpm}" install'

        try:
            result = subprocess.run(
                cmd,
                cwd=str(self.project_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=True,
            )
            if result.stdout:
                self.log_signal.emit(result.stdout.strip())
            if result.returncode != 0:
                self.log_signal.emit(f"✗ pnpm install 失败: {result.stderr.strip()}")
                return False
            return True
        except Exception as e:
            self.log_signal.emit(f"✗ 安装异常: {e}")
            return False

    def _start_server(self):
        """
        启动 Next.js 服务器

        Windows 上 pnpm 是 .cmd 文件，使用 shell=True 执行。
        server.ts 输出 "> PuchiPix server ready on http://localhost:PORT" 表示就绪。

        @date 2026-07-09
        @lastModified 2026-07-10
        """
        pnpm = find_pnpm()
        if not pnpm:
            self.log_signal.emit("✗ 未找到 pnpm 命令")
            self.status_signal.emit("error")
            return

        env = os.environ.copy()
        env["NODE_ENV"] = "development"
        env["PORT"] = str(self.port)

        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP

        cmd = f'"{pnpm}" dev'

        try:
            self.process = subprocess.Popen(
                cmd,
                cwd=str(self.project_dir),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                shell=True,
                creationflags=creation_flags,
            )
        except Exception as e:
            self.log_signal.emit(f"✗ 启动失败: {e}")
            self.status_signal.emit("error")
            return

        self._should_run = True

        for line in iter(self.process.stdout.readline, ""):
            if not self._should_run:
                break
            line = line.rstrip("\n\r")
            if line:
                self.log_signal.emit(line)
            lower = line.lower()
            if "ready on" in lower or "ready in" in lower or "server ready" in lower:
                self.status_signal.emit("running")

        if self.process:
            ret = self.process.poll()
            self.log_signal.emit(f"⏹ 服务器进程已退出 (返回码: {ret})")

        self._should_run = False
        self.status_signal.emit("stopped")

    def stop(self):
        """
        停止服务器

        Windows 上先尝试 CTRL_BREAK_EVENT，超时后用 taskkill /T /F
        强制终止整个进程树（pnpm → tsx → node），避免端口残留。

        @date 2026-07-09
        @lastModified 2026-07-10
        """
        self._should_run = False
        if self.process:
            pid = self.process.pid
            try:
                if sys.platform == "win32":
                    self.process.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    self.process.terminate()
                try:
                    self.process.wait(timeout=6)
                except subprocess.TimeoutExpired:
                    if sys.platform == "win32":
                        subprocess.run(
                            ["taskkill", "/T", "/F", "/PID", str(pid)],
                            capture_output=True, shell=True,
                        )
                    else:
                        self.process.kill()
                    self.process.wait(timeout=3)
            except Exception as e:
                print(f"停止服务器异常: {e}")
            finally:
                self.process = None


# ============================================================
# 健康检查线程
# ============================================================

class HealthCheckThread(QThread):
    """
    轮询健康检查端点，监控服务器运行状态

    @date 2026-07-10
    """

    healthy_signal = Signal(bool)

    def __init__(self, port: int, interval: float = 3.0):
        super().__init__()
        self.port = port
        self.interval = interval
        self._running = True

    def run(self):
        while self._running:
            ok = check_health(self.port, timeout=2.0)
            self.healthy_signal.emit(ok)
            time.sleep(self.interval)

    def stop(self):
        self._running = False


# ============================================================
# 主窗口
# ============================================================

class MainWindow(QMainWindow):
    """
    Launcher 主窗口

    提供日志台、启动/停止/重启按钮、浏览器打开按钮。
    无内嵌 WebView，通过浏览器访问应用界面。

    @date 2026-07-09
    @lastModified 2026-07-10
    """

    def __init__(self, project_dir: Path, port: int = DEFAULT_PORT):
        super().__init__()
        self.project_dir = project_dir
        self.server_port = port
        self.server_thread: ServerThread | None = None
        self.health_thread: HealthCheckThread | None = None
        self._is_running = False

        self._init_ui()
        self._init_tray()

        QTimer.singleShot(600, self.start_server)

    # ---- UI 初始化 ----

    def _init_ui(self):
        self.setWindowTitle(APP_TITLE)
        self.setMinimumSize(900, 600)
        self.resize(1000, 700)

        central = QWidget()
        central.setObjectName("central")
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        main_layout.addWidget(self._create_toolbar())

        log_group = QGroupBox("📋 服务器日志")
        log_layout = QVBoxLayout(log_group)
        log_layout.setContentsMargins(6, 18, 6, 6)
        self.log_view = QTextEdit()
        self.log_view.setObjectName("log_view")
        self.log_view.setReadOnly(True)
        log_layout.addWidget(self.log_view)

        main_layout.addWidget(log_group, stretch=1)

        self._init_statusbar()

    def _create_toolbar(self) -> QWidget:
        toolbar = QWidget()
        toolbar.setObjectName("toolbar")
        toolbar.setFixedHeight(52)
        layout = QHBoxLayout(toolbar)
        layout.setContentsMargins(16, 0, 16, 0)
        layout.setSpacing(10)

        title = QLabel("🚀 PuchiPix Launcher")
        title.setObjectName("toolbar_title")
        layout.addWidget(title)
        layout.addStretch()

        self.btn_start = QPushButton("▶  启动")
        self.btn_start.setObjectName("btn_start")
        self.btn_start.clicked.connect(self.start_server)
        layout.addWidget(self.btn_start)

        self.btn_stop = QPushButton("■  停止")
        self.btn_stop.setObjectName("btn_stop")
        self.btn_stop.setEnabled(False)
        self.btn_stop.clicked.connect(self.stop_server)
        layout.addWidget(self.btn_stop)

        self.btn_restart = QPushButton("↻  重启")
        self.btn_restart.setEnabled(False)
        self.btn_restart.clicked.connect(self.restart_server)
        layout.addWidget(self.btn_restart)

        self.btn_browser = QPushButton("🌐  浏览器")
        self.btn_browser.clicked.connect(self.open_browser)
        layout.addWidget(self.btn_browser)

        self.btn_clear = QPushButton("🗑  清空日志")
        self.btn_clear.clicked.connect(self.clear_log)
        layout.addWidget(self.btn_clear)

        return toolbar

    def _init_statusbar(self):
        sb = self.statusBar()
        sb.setSizeGripEnabled(False)

        self.status_dot = QLabel("●")
        self.status_dot.setObjectName("status_dot")
        self.status_dot.setStyleSheet("color: #f85149; font-size: 14px;")
        sb.addWidget(self.status_dot)
        sb.layout().setSpacing(2)

        self.status_text = QLabel("就绪")
        self.status_text.setObjectName("status_text")
        sb.addWidget(self.status_text)

        sb.addPermanentWidget(QLabel(f"  端口: {self.server_port}  "))
        sb.addPermanentWidget(QLabel(f"  v{APP_VERSION}  "))

    def _init_tray(self):
        self.tray = QSystemTrayIcon()
        self.tray.setToolTip(APP_TITLE)
        self.tray.setIcon(self._create_tray_icon())

        tray_menu = QMenu()
        show_action = QAction("显示窗口", self)
        show_action.triggered.connect(self._show_window)
        tray_menu.addAction(show_action)

        tray_menu.addSeparator()

        quit_action = QAction("退出", self)
        quit_action.triggered.connect(self.quit_app)
        tray_menu.addAction(quit_action)

        self.tray.setContextMenu(tray_menu)
        self.tray.activated.connect(self._on_tray_activated)
        self.tray.show()

    def _create_tray_icon(self) -> QIcon:
        pixmap = QPixmap(32, 32)
        pixmap.fill(Qt.transparent)
        painter = QPainter(pixmap)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setBrush(QColor("#a371f7"))
        painter.setPen(Qt.NoPen)
        painter.drawEllipse(4, 4, 24, 24)
        painter.setBrush(QColor("#ffffff"))
        font = QFont("Arial", 12, QFont.Bold)
        painter.setFont(font)
        painter.drawText(pixmap.rect(), Qt.AlignCenter, "P")
        painter.end()
        return QIcon(pixmap)

    # ---- 服务器控制 ----

    def start_server(self):
        if self._is_running:
            return

        self._set_status("starting")
        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self.btn_restart.setEnabled(False)

        self.server_thread = ServerThread(self.project_dir, self.server_port)
        self.server_thread.log_signal.connect(self._append_log)
        self.server_thread.status_signal.connect(self._on_server_status)
        self.server_thread.start()

    def stop_server(self):
        self._set_status("stopping")
        self.btn_stop.setEnabled(False)
        self.btn_restart.setEnabled(False)

        if self.health_thread:
            self.health_thread.stop()
            self.health_thread = None

        if self.server_thread:
            self.server_thread.stop()
            self.server_thread.wait(10000)
            self.server_thread = None

        self._is_running = False
        self.btn_start.setEnabled(True)
        self._set_status("stopped")

    def restart_server(self):
        self._append_log("♻ 正在重启服务器 ...")
        self.stop_server()
        QTimer.singleShot(1500, self.start_server)

    def quit_app(self):
        if self.server_thread:
            self.stop_server()
        if self.health_thread:
            self.health_thread.stop()
        self.tray.hide()
        QApplication.quit()

    # ---- 服务器状态回调 ----

    def _on_server_status(self, status: str):
        if status == "running":
            self._is_running = True
            self._set_status("running")
            self.btn_restart.setEnabled(True)

            if self.health_thread:
                self.health_thread.stop()
            self.health_thread = HealthCheckThread(self.server_port, interval=5.0)
            self.health_thread.healthy_signal.connect(self._on_health_monitor)
            self.health_thread.start()

            self.tray.showMessage(
                APP_TITLE,
                f"服务器已启动 ✓  http://localhost:{self.server_port}",
                QSystemTrayIcon.Information,
                3000,
            )

        elif status == "stopped":
            self._is_running = False
            self._set_status("stopped")
            self.btn_start.setEnabled(True)
            self.btn_stop.setEnabled(False)
            self.btn_restart.setEnabled(False)

            if self.health_thread:
                self.health_thread.stop()
                self.health_thread = None

        elif status == "error":
            self._is_running = False
            self._set_status("error")
            self.btn_start.setEnabled(True)
            self.btn_stop.setEnabled(False)
            self.btn_restart.setEnabled(False)

        elif status == "installing":
            pass

    def _on_health_monitor(self, healthy: bool):
        if not healthy and self._is_running:
            self._set_status("unhealthy")
        elif healthy and self._is_running:
            self._set_status("running")

    # ---- UI 辅助 ----

    def _set_status(self, status: str):
        status_map = {
            "ready":       ("●", "#8b949e", "就绪"),
            "starting":    ("●", "#d29922", "正在启动 ..."),
            "stopping":    ("●", "#d29922", "正在停止 ..."),
            "running":     ("●", "#3fb950", f"运行中 — http://localhost:{self.server_port}"),
            "stopped":     ("●", "#f85149", "已停止"),
            "error":       ("●", "#f85149", "启动失败"),
            "unhealthy":   ("●", "#d29922", "服务异常"),
        }
        dot, color, text = status_map.get(status, ("●", "#8b949e", "未知"))
        self.status_dot.setText(dot)
        self.status_dot.setStyleSheet(f"color: {color}; font-size: 14px;")
        self.status_text.setText(text)
        self.status_text.setStyleSheet(f"color: {color}; font-size: 12px; font-weight: 600;")

    def _append_log(self, text: str):
        color = "#c9d1d9"
        lower = text.lower()

        if "✗" in text or "error" in lower or "err!" in lower or "failed" in lower:
            color = "#f85149"
        elif "✓" in text or "ready on" in lower or "ready in" in lower or "server ready" in lower:
            color = "#3fb950"
        elif "⚙" in text or "warn" in lower or "installing" in lower:
            color = "#d29922"
        elif "🚀" in text or "⏹" in text or "♻" in text:
            color = "#a371f7"
        elif "⏹" in text:
            color = "#8b949e"

        safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        self.log_view.append(
            f'<span style="color:{color};white-space:pre-wrap;">{safe}</span>'
        )
        self.log_view.moveCursor(QTextCursor.End)

    def clear_log(self):
        self.log_view.clear()

    def open_browser(self):
        url = f"http://localhost:{self.server_port}"
        webbrowser.open(url)

    # ---- 窗口事件 ----

    def _show_window(self):
        self.show()
        self.raise_()
        self.activateWindow()

    def _on_tray_activated(self, reason):
        if reason == QSystemTrayIcon.DoubleClick:
            self._show_window()

    def closeEvent(self, event):
        event.ignore()
        self.hide()
        self.tray.showMessage(
            APP_TITLE,
            "已最小化到系统托盘，双击图标恢复窗口",
            QSystemTrayIcon.Information,
            2000,
        )

    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            if self.isFullScreen():
                self.showNormal()
                return
        super().keyPressEvent(event)


# ============================================================
# 程序入口
# ============================================================

def main():
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )

    app = QApplication(sys.argv)
    app.setApplicationName(APP_TITLE)
    app.setApplicationVersion(APP_VERSION)
    app.setStyleSheet(DARK_STYLESHEET)

    window = MainWindow(PROJECT_DIR, DEFAULT_PORT)
    window.show()

    ret = app.exec()
    sys.exit(ret)


if __name__ == "__main__":
    main()
