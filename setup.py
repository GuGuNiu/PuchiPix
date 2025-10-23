from setuptools import setup, find_packages
import os

# 读取README文件作为长描述
def read_readme():
    with open("README.md", "r", encoding="utf-8") as fh:
        return fh.read()

# 读取requirements.txt文件作为依赖
def read_requirements():
    with open("requirements.txt", "r", encoding="utf-8") as fh:
        return [line.strip() for line in fh if line.strip() and not line.startswith("#")]

setup(
    name="PuchiPix",
    version="2.2.0",
    author="GuGuNiu",
    author_email="example@example.com",
    description="PuchiPix - 噗呲专用图包下载器",
    long_description=read_readme(),
    long_description_content_type="text/markdown",
    url="https://github.com/GuGuNiu/PuchiPix/",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        '': ['*.json', '*.txt', 'chromedriver.exe'],
    },
    install_requires=read_requirements(),
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.10",
    entry_points={
        "console_scripts": [
            "puchipix=main:main",
        ],
    },
    data_files=[
        ('.', ['history.json', 'config.json', 'failed_tasks.txt', 'task_state.json']),
    ],
)