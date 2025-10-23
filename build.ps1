# PuchiPix 打包脚本
Write-Host "正在打包PuchiPix应用程序..." -ForegroundColor Green
Write-Host ""

# 创建虚拟环境
Write-Host "正在创建虚拟环境..." -ForegroundColor Yellow
python -m venv venv
Write-Host ""

# 激活虚拟环境
Write-Host "正在激活虚拟环境..." -ForegroundColor Yellow
.\venv\Scripts\Activate.ps1
Write-Host ""

# 升级pip并安装必要工具
Write-Host "正在升级pip并安装必要工具..." -ForegroundColor Yellow
python -m pip install --upgrade pip
pip install pyinstaller
Write-Host ""

# 安装依赖
Write-Host "正在安装依赖..." -ForegroundColor Yellow
pip install -r requirements.txt
Write-Host ""

# 构建可执行文件
Write-Host "正在构建可执行文件..." -ForegroundColor Yellow
pyinstaller --onefile --windowed --add-data "history.json;." --add-data "config.json;." --add-data "failed_tasks.txt;." --add-data "task_state.json;." --add-data "chromedriver.exe;." --icon=NONE run.py
Write-Host ""

# 复制必要的文件到dist目录
Write-Host "正在复制必要文件..." -ForegroundColor Yellow
Copy-Item README.md dist\
Copy-Item requirements.txt dist\
Write-Host ""

Write-Host "打包完成！可执行文件位于dist目录中。" -ForegroundColor Green
Read-Host "按Enter键退出"