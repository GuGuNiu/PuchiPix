# PuchiPix 打包说明

## 打包方式

本项目支持两种打包方式：

### 1. 使用PyInstaller打包（推荐）

1. 确保已安装Python 3.10+
2. 右键点击 `build.ps1` 脚本，选择"使用PowerShell运行"
3. 或者在PowerShell中运行 `.\build.ps1`
4. 等待打包完成
5. 可执行文件将生成在 `dist` 目录中

### 2. 使用setuptools打包

1. 安装依赖：
   ```
   pip install -r requirements.txt
   ```

2. 构建源码分发包：
   ```
   python setup.py sdist
   ```

3. 构建wheel包：
   ```
   python setup.py bdist_wheel
   ```

## 数据文件处理

为了确保打包后的程序能正确访问数据文件（如配置文件、历史记录等），我们采用了以下策略：

1. 使用 `run.py` 作为程序入口点，它能自动检测运行环境（开发环境或打包环境）
2. 在打包环境中，使用 `sys._MEIPASS` 获取资源文件的正确路径
3. 在开发环境中，使用相对路径访问数据文件

## 注意事项

1. 打包后的程序会将数据文件存储在其运行目录中，确保与可执行文件在同一目录
2. 如果需要迁移数据，只需复制整个目录即可
3. 程序首次运行时会自动创建必要的数据文件

## 文件说明

- `build.bat`: Windows平台下的打包脚本
- `setup.py`: setuptools打包配置文件
- `requirements.txt`: 项目依赖列表
- `MANIFEST.in`: 包含在分发包中的额外文件列表
- `run.py`: 程序入口点，处理资源文件路径