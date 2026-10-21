#!/usr/bin/env bash
# Подключение GitHub для проекта «АЭМЗ Логистика».
# Использование: bash scripts/github-connect.sh <PAT-токен> <owner/repo>
#   Пример:    bash scripts/github-connect.sh ghp_xxxx... my-org/aemz-logistics
# Требуется: gh 2.x (уже в ~/.local/bin), PAT со scope repo (или fine-grained: Contents RW)
set -euo pipefail
GH="$HOME/.local/bin/gh"
TOKEN="${1:?Нужен PAT-токен первым аргументом}"
REPO="${2:?Нужно имя репозитория owner/repo вторым аргументом}"
echo "$TOKEN" | $GH auth login --with-token
echo "✓ gh auth ok"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$REPO.git"
$GH repo view "$REPO" >/dev/null 2>&1 && echo "✓ репозиторий $REPO найден" || {
  echo "→ репозитория нет, создаю…"; $GH repo create "$REPO" --private --source=. --push
}
git push -u origin main
echo "✓ Готово: $(git log --oneline -1) → https://github.com/$REPO"
