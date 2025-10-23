@echo off
chcp 65001 >nul
echo 正在打包PuchiPix应用程序...
echo.

REM 创建虚拟环境
echo 正在创建虚拟环境...
python -m venv venv
echo.

REM 激活虚拟环境
echo 正在激活虚拟环境...
call venv\Scripts\activate.bat
echo.

REM 升级pip并安装必要工具
echo 正在升级pip并安装必要工具...
python -m pip install --upgrade pip
pip install pyinstaller
echo.

REM 安装依赖
echo 正在安装依赖...
pip install -r requirements.txt
echo.

REM 构建可执行文件
echo 正在构建可执行文件...
pyinstaller --onefile --windowed --add-data "history.json;." --add-data "config.json;." --add-data "failed_tasks.txt;." --add-data "task_state.json;." --add-data "chromedriver.exe;." --icon=NONE run.py
echo.

REM 复制必要的文件到dist目录
echo 正在复制必要文件...
copy README.md dist\
copy requirements.txt dist\
echo.

echo 打包完成！可执行文件位于dist目录中。
pause