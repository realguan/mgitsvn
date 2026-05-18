.PHONY: help install build dev package publish publish-current publish-bump release release-dry clean lint check vsix-install vscode-install bump all

# ─── 变量 ────────────────────────────────────────────────────
DIST_DIR   = dist
VERSION   ?= patch
VSCE_FLAGS = --no-dependencies --allow-missing-repository --skip-license
PNPM_CI    = CI=true pnpm

# 颜色
GREEN  = \033[32m
YELLOW = \033[33m
CYAN   = \033[36m
RESET  = \033[0m

# ─── 默认目标 ────────────────────────────────────────────────
all: build

# ─── 帮助 ─────────────────────────────────────────────────────
help:
	@echo ""
	@echo "$(CYAN)📦 MGitSVN 插件打包发布工具$(RESET)"
	@echo "   版本: $$(node -p "require('./package.json').version")"
	@echo ""
	@echo "$(GREEN)常用命令:$(RESET)"
	@echo "  make install      安装依赖"
	@echo "  make build        编译项目 (production)"
	@echo "  make dev          开发模式 (watch)"
	@echo "  make package      打包成 .vsix 文件"
	@echo "  make vscode-install  打包并安装到本地 VS Code"
	@echo "  make vsix-install 打包并安装到本地 VS Code"
	@echo ""
	@echo "$(GREEN)发布命令:$(RESET)"
	@echo "  make publish                发布当前版本 [默认，不改 package.json]"
	@echo "  make publish-current        发布当前版本 [不改 package.json]"
	@echo "  make publish-bump           升 patch 版本后发布 [默认]"
	@echo "  make publish-bump VERSION=minor  升 minor 版本后发布"
	@echo "  make publish-bump VERSION=major  升 major 版本后发布"
	@echo ""
	@echo "$(GREEN)一键发布（推荐）:$(RESET)"
	@echo "  make release                 升版本 → 提交 → 打tag → 推送 → 发布"
	@echo "  make release VERSION=minor   同上，升 minor 版本"
	@echo "  make release-dry             仅预览 release 步骤，不实际执行"
	@echo ""
	@echo "$(GREEN)其他命令:$(RESET)"
	@echo "  make lint         代码检查"
	@echo "  make check        TypeScript 类型检查"
	@echo "  make bump         仅升版本号 (不发布)"
	@echo "  make clean        清理产物"
	@echo ""

# ─── 安装依赖 ─────────────────────────────────────────────────
install:
	@echo "$(CYAN)📥 安装依赖...$(RESET)"
	$(PNPM_CI) install
	@echo "$(GREEN)✅ 依赖安装完成$(RESET)"

# ─── 编译 ─────────────────────────────────────────────────────
build:
	@echo "$(CYAN)🔨 编译项目...$(RESET)"
	pnpm run esbuild -- --production
	@echo "$(GREEN)✅ 编译完成$(RESET)"

# ─── 开发模式 ─────────────────────────────────────────────────
dev:
	@echo "$(CYAN)👀 启动开发监听模式...$(RESET)"
	pnpm run esbuild-watch

# ─── 代码检查 ─────────────────────────────────────────────────
lint:
	@echo "$(CYAN)🔍 代码检查...$(RESET)"
	pnpm run lint
	@echo "$(GREEN)✅ 检查通过$(RESET)"

# ─── 类型检查 ─────────────────────────────────────────────────
check:
	@echo "$(CYAN)🔍 TypeScript 类型检查...$(RESET)"
	npx tsc --noEmit
	@echo "$(GREEN)✅ 类型检查通过$(RESET)"

# ─── 一键打包 ─────────────────────────────────────────────────
package: build
	@echo "$(CYAN)📦 打包 .vsix...$(RESET)"
	@mkdir -p $(DIST_DIR)
	pnpm exec vsce package $(VSCE_FLAGS) --out $(DIST_DIR)
	@echo "$(GREEN)✅ 打包完成:$(RESET)"
	@ls -lh $(DIST_DIR)/*.vsix 2>/dev/null

# ─── 本地安装 ─────────────────────────────────────────────────
vscode-install: package
	@VSIX_FILE=$$(ls -t $(DIST_DIR)/*.vsix 2>/dev/null | head -1); \
	if [ -z "$$VSIX_FILE" ]; then \
		echo "$(YELLOW)⚠️  未找到 .vsix 文件$(RESET)"; \
		exit 1; \
	fi; \
	if ! command -v code >/dev/null 2>&1; then \
		echo "$(YELLOW)⚠️  未找到 code 命令，请先确保 VS Code Command Line 可用$(RESET)"; \
		exit 1; \
	fi; \
	echo "$(CYAN)🚀 安装到 VS Code: $$VSIX_FILE$(RESET)"; \
	code --install-extension "$$VSIX_FILE" --force; \
	echo "$(GREEN)✅ 已安装到 VS Code — 请重启编辑器$(RESET)"

vsix-install: package
	@VSIX_FILE=$$(ls -t $(DIST_DIR)/*.vsix 2>/dev/null | head -1); \
	if [ -z "$$VSIX_FILE" ]; then \
		echo "$(YELLOW)⚠️  未找到 .vsix 文件$(RESET)"; \
		exit 1; \
	fi; \
	echo "$(CYAN)🚀 安装: $$VSIX_FILE$(RESET)"; \
	INSTALLED=""; \
	if command -v code >/dev/null 2>&1; then \
		echo "   → VS Code"; \
		code --install-extension "$$VSIX_FILE" --force; \
		INSTALLED="$$INSTALLED VS Code"; \
	fi; \
	if command -v antigravity >/dev/null 2>&1; then \
		echo "   → Antigravity"; \
		antigravity --install-extension "$$VSIX_FILE" --force; \
		INSTALLED="$$INSTALLED Antigravity"; \
	fi; \
	if [ -z "$$INSTALLED" ]; then \
		echo "$(YELLOW)⚠️  未找到 code 或 antigravity 命令$(RESET)"; \
		exit 1; \
	fi; \
	echo "$(GREEN)✅ 已安装到:$$INSTALLED — 请重启编辑器$(RESET)"

# ─── 升版本号 ─────────────────────────────────────────────────
bump:
	@echo "$(CYAN)🏷️  升版本号 ($(VERSION))...$(RESET)"
	npm version $(VERSION) --no-git-tag-version
	@echo "$(GREEN)✅ 新版本: $$(node -p "require('./package.json').version")$(RESET)"

# ─── 发布当前版本（不改版本号） ───────────────────────────────
# 注意：需要先执行 `npx vsce login` 或设置环境变量 `VSCE_PAT`
publish: publish-current

publish-current: build
	@echo "$(CYAN)🚀 发布当前版本到 VS Code 市场...$(RESET)"
	@echo "   当前版本: $$(node -p "require('./package.json').version")"
	pnpm exec vsce publish $(VSCE_FLAGS)
	@echo "$(GREEN)✅ 发布完成: $$(node -p "require('./package.json').version")$(RESET)"

# ─── 显式升版本后发布 ────────────────────────────────────────
# 注意：会修改 package.json，但不会自动创建 git tag / version commit
publish-bump: build
	@echo "$(CYAN)🚀 升版本并发布到 VS Code 市场 ($(VERSION))...$(RESET)"
	pnpm exec vsce publish $(VERSION) --no-git-tag-version $(VSCE_FLAGS)
	@echo "$(GREEN)✅ 发布完成: $$(node -p "require('./package.json').version")$(RESET)"

# ─── 清理产物 ─────────────────────────────────────────────────
clean:
	@echo "$(CYAN)🧹 清理产物...$(RESET)"
	rm -rf out
	rm -rf $(DIST_DIR)
	rm -f *.vsix
	@echo "$(GREEN)✅ 清理完成$(RESET)"

# ─── 一键发布（推荐流程） ──────────────────────────────────────
# 流程：升版本 → 提交 → 打 tag → 推送 → 发布到 VS Code Marketplace
# 用法：
#   make release                 # 升 patch（默认）
#   make release VERSION=minor   # 升 minor
#   make release VERSION=major   # 升 major
release:
	@echo "$(CYAN)🚀 一键发布流程$(RESET)"
	@NEW_VER=$$(npm version $(VERSION) --no-git-tag-version 2>/dev/null | sed 's/^v//') && \
	echo "$(GREEN)📌 版本号: $$NEW_VER$(RESET)" && \
	git add package.json && \
	git commit -m "chore: bump version to $$NEW_VER" && \
	git tag "v$$NEW_VER" && \
	echo "$(CYAN)📤 推送到 GitHub...$(RESET)" && \
	git push && git push --tags && \
	echo "$(CYAN)📦 构建并发布到 VS Code Marketplace...$(RESET)" && \
	pnpm run esbuild -- --production && \
	pnpm exec vsce publish $(VSCE_FLAGS) && \
	echo "$(GREEN)✅ 发布完成: v$$NEW_VER$(RESET)"

# ─── 预览发布步骤（不实际执行） ─────────────────────────────────
release-dry:
	@echo "$(CYAN)📋 预览发布步骤:$(RESET)"
	@echo ""
	@CURRENT=$$(node -p "require('./package.json').version") && \
	case "$(VERSION)" in \
		patch) NEW=$$(echo $$CURRENT | awk -F. '{print $$1"."$$2"."$$3+1}') ;; \
		minor) NEW=$$(echo $$CURRENT | awk -F. '{print $$1"."$$2+1".0"}') ;; \
		major) NEW=$$(echo $$CURRENT | awk -F. '{print $$1+1".0.0"}') ;; \
		*) NEW="$(VERSION)" ;; \
	esac && \
	echo "  当前版本:  $$CURRENT" && \
	echo "  目标版本:  $$NEW" && \
	echo "" && \
	echo "  1. npm version $(VERSION) --no-git-tag-version" && \
	echo "  2. git add package.json" && \
	echo "  3. git commit -m 'chore: bump version to $$NEW'" && \
	echo "  4. git tag v$$NEW" && \
	echo "  5. git push && git push --tags" && \
	echo "  6. esbuild --production" && \
	echo "  7. vsce publish --no-dependencies --allow-missing-repository --skip-license"
