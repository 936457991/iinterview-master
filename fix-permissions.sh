#!/bin/bash

echo "Fixing permissions and rebuilding..."

# 尝试修复权限
echo "Attempting to fix permissions..."
sudo chown -R $(whoami):staff dist out 2>/dev/null || true
sudo chmod -R 755 dist out 2>/dev/null || true

# 强制删除目录
echo "Removing build directories..."
sudo rm -rf dist out 2>/dev/null || true

# 创建新的目录
echo "Creating fresh directories..."
mkdir -p dist out

echo "Permissions fixed. You can now run:"
echo "npm run build"
echo "npm run build:mac"
